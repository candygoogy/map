import { describe, expect, test } from 'vitest';
import { copy } from '../../src/copy';
import { printReceipt, RECEIPT_MAX, RECEIPT_WIDTH, receiptPng, type ReceiptRow } from '../../src/moments/receipt-canvas';
import type { TripSummary } from '../../src/moments/trip';

// The receipt's layout (Task 16; the owner's leader rule, 2026-10-18): every value ends on one
// right edge, and every dotted leader runs from its label right up to its value. Laid on a
// stand-in 2D context whose text is as wide as its letters at the font's size, so the rule is
// checked for any widths, without a browser (the e2e test checks the real fonts' rows too).

const PAD = 36;
const GAP = 12;

/** A 2D context that measures text by its letters and draws nothing; it records what's written. */
function stubContext() {
  const texts: string[] = [];
  const ctx = {
    canvas: { width: RECEIPT_WIDTH, height: RECEIPT_MAX },
    font: '400 15px sans-serif',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    letterSpacing: '0px',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 15);
      return { width: text.length * size * 0.55 + text.length * parseFloat(this.letterSpacing) };
    },
    fillText: (t: string) => void texts.push(t),
    fillRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    scale: () => undefined,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const theme = { paper: { getHexString: () => 'fafafa' } } as never;

function trip(over: Partial<TripSummary> = {}): TripSummary {
  return {
    startedAt: Date.UTC(2026, 9, 20, 12, 25, 10),
    endedAt: Date.UTC(2026, 9, 20, 12, 31, 52),
    visited: [
      { id: 'origin', name: 'candygoogy.dev', at: 14_000 },
      { id: 'fettle', name: 'Fettle', at: 41_000 },
      { id: 'idiff', name: 'Install diff', at: 98_000 },
    ],
    route: ['candygoogy.dev', 'Fettle', 'Install diff', 'Fettle'],
    total: 17,
    pokes: 11,
    powerCycles: 1,
    secretsFound: [{ id: 'mat-key', name: 'The key under the mat', at: 384_000 }],
    ...over,
  };
}

function expectFlush(rows: ReceiptRow[]): void {
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.valueEnd, r.label).toBe(RECEIPT_WIDTH - PAD); // one right edge
    expect(r.valueStart - r.leaderEnd, r.label).toBeCloseTo(GAP, 6); // the leader reaches its value
    expect(r.leaderEnd - r.leaderStart, r.label).toBeGreaterThan(0);
  }
}

describe('the receipt’s layout', () => {
  test('every value ends on one right edge and every leader reaches its value', () => {
    const { ctx, texts } = stubContext();
    const { rows, length } = printReceipt(ctx, trip(), theme, copy);
    expectFlush(rows);
    expect(rows.map((r) => r.label)).toEqual([
      'Arrived',
      'Left',
      'Time on the map',
      'candygoogy.dev',
      'Fettle',
      'Install diff',
      'Stops',
      'Back again at',
      'Things poked',
      'Turned off and on again',
      'Secrets found',
      'The key under the mat',
    ]);
    expect(texts).toContain('Just passing through.'); // 3 of 17
    expect(texts).toContain('14 stations left for next time.');
    expect(texts).toContain('1 of a few'); // never the total
    expect(texts).toContain('6 min 42 s');
    expect(length).toBeGreaterThan(400);
    expect(length).toBeLessThanOrEqual(RECEIPT_MAX);
  });

  test('a long label wraps under itself and its value still ends on the edge', () => {
    const { ctx } = stubContext();
    const long = 'A station with a name so long it can never fit on one line of the receipt';
    const { rows } = printReceipt(ctx, trip({ visited: [{ id: 'x', name: long, at: 1_000 }] }), theme, copy);
    expectFlush(rows);
  });

  test('the verdict follows how much was seen, and the numbers leave out what didn’t happen', () => {
    const all = Array.from({ length: 17 }, (_, i) => ({ id: `s${i}`, name: `Station ${i}`, at: i * 1000 }));
    let { ctx, texts } = stubContext();
    printReceipt(ctx, trip({ visited: all, powerCycles: 0, secretsFound: [] }), theme, copy);
    expect(texts).toContain('Seen it all.');
    expect(texts).toContain('Every station, start to finish.');
    expect(texts).toContain('None yet');
    expect(texts).not.toContain('Turned off and on again');
    ({ ctx, texts } = stubContext());
    printReceipt(ctx, trip({ visited: all.slice(0, 16) }), theme, copy);
    expect(texts).toContain('Well travelled.');
    expect(texts).toContain('One station left for next time.');
  });

  test('the longest trip still fits the paper Fettle can feed', () => {
    const all = Array.from({ length: 17 }, (_, i) => ({ id: `s${i}`, name: `Station number ${i}`, at: i * 1000 }));
    const route = Array.from({ length: 60 }, (_, i) => `Station number ${i % 17}`);
    const { ctx } = stubContext();
    const { length, rows } = printReceipt(ctx, trip({ visited: all, route }), theme, copy);
    expectFlush(rows);
    expect(length).toBeLessThanOrEqual(RECEIPT_MAX);
  });

  test('the PNG comes from the canvas as image/png', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    let asked = '';
    const canvas = {
      toBlob(cb: (b: Blob | null) => void, type: string) {
        asked = type;
        cb(blob);
      },
    } as unknown as HTMLCanvasElement;
    await expect(receiptPng(canvas)).resolves.toBe(blob);
    expect(asked).toBe('image/png');
    const broken = { toBlob: (cb: (b: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement;
    await expect(receiptPng(broken)).rejects.toThrow();
  });
});
