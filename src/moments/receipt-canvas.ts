// The trip receipt (Task 16): Fettle prints the visit, and the same canvas is the printed
// paper's texture and the PNG the visitor keeps. Part of the lazy receipt moment
// (src/moments/load.ts), never the first load. Its words are src/copy-receipt.ts's, approved
// with the Task 16 proposal.
//
// The paper is white in both themes (owner, 2026-10-18: `--paper`), so the receipt prints with
// the light theme's inks whatever the page's theme; `theme` gives the paper. Set like the site's
// leader lists (src/styles.css `.leaders`, owner 2026-10-18): every value ends on one right
// edge, and every dotted leader runs from its label right up to its value, on the label's
// baseline lifted 0.3em. The leader is laid from the value leftwards, so its last dot always
// sits one gap before the value, whatever the widths.
//
// The fonts are the site's (Newsreader, Schibsted Grotesk), already loaded by the page; a
// caller that draws before they're in awaits receiptFontsReady() first.

import type { Copy } from '../copy';
import type { ReceiptCopyKey } from '../copy-receipt';
import type { Theme } from '../stage/theme';

/** The words the receipt prints: its own, and the wordmark. */
export type ReceiptWords = Pick<Copy, ReceiptCopyKey | 'wordmark'>;
/** What the receipt reads of the theme: only the paper. */
export type ReceiptTheme = Pick<Theme, 'paper'>;
import type { TripSummary } from './trip';

export type { TripSummary };

/** The receipt's width in its own units (CSS px); 576 dots is a real 80 mm print head. */
export const RECEIPT_WIDTH = 576;
/** The longest it gets: about the paper Fettle can feed (1.3 units of a 0.38 strip). */
export const RECEIPT_MAX = Math.round((RECEIPT_WIDTH * 1.3) / 0.38);
/** Pixels per unit: the canvas is drawn at 2x, for the PNG and the texture's mips. */
export const RECEIPT_SCALE = 2;

// The light theme's inks (src/styles.css :root), on white paper in both themes.
const INK = '#18181b';
const SOFT = '#52525b';
const DOTS = '#a1a1aa'; // --edge, as the panel's leaders

const DISPLAY = '"Newsreader", Georgia, serif';
const TEXT = '"Schibsted Grotesk", system-ui, sans-serif';
const PAD = 36;
const GAP = 12; // --sp-3, between a leader and its words
const MIN_LEADER = 24; // --sp-5
const DOT = 1.2;
const PERIOD = 3;
const HANG = 20; // a tick's hanging column

/** Resolves once the receipt's faces are loaded (a no-op where they already are). */
export async function receiptFontsReady(): Promise<void> {
  await Promise.all([
    document.fonts.load(`600 24px ${DISPLAY}`),
    document.fonts.load(`400 15px ${TEXT}`),
    document.fonts.load(`500 15px ${TEXT}`),
    document.fonts.load(`600 12px ${TEXT}`),
  ]);
}

export const fill = (template: string, n: number): string => template.replace('{n}', String(n));

/** Time since arriving, m:ss. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A length of time in words: 42 s, 6 min 42 s, 1 h 3 min. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Lays the receipt out top to bottom; `y` is where the next thing goes. */
class Printer {
  y = 40;
  /** Each leader row as laid: where its leader ends, and where its value starts and ends. */
  readonly rows: ReceiptRow[] = [];
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  font(spec: string, colour = INK, spacing = '0px'): void {
    this.ctx.font = spec;
    this.ctx.fillStyle = colour;
    this.ctx.letterSpacing = spacing;
  }

  width(text: string): number {
    return this.ctx.measureText(text).width;
  }

  /** Words broken into lines no wider than `max`; `sep` is where a line may break. */
  wrap(parts: string[], max: number, sep = ' '): string[] {
    const groups: string[][] = [];
    let line: string[] = [];
    for (const part of parts) {
      if (line.length && this.width([...line, part].join(sep)) > max) {
        groups.push(line);
        line = [part];
      } else line.push(part);
    }
    if (line.length) groups.push(line);
    // No lone word (or station) on the last line: take one more down with it.
    const last = groups[groups.length - 1];
    const prev = groups[groups.length - 2];
    if (last && prev && last.length === 1 && prev.length > 2) last.unshift(prev.pop()!);
    // A line that breaks at a separator ends with it ("Homelab →"), so the reader reads on.
    const tail = sep.trim();
    return groups.map((g, i) => g.join(sep) + (tail && i < groups.length - 1 ? ` ${tail}` : ''));
  }

  /** As many of `items` as fit in `max` at a row's value weight, then "…" (the route has them all). */
  fitList(items: string[], max: number): string {
    this.font(`500 15px ${TEXT}`);
    let out = items[0] ?? '';
    for (let i = 1; i < items.length; i++) {
      const more = `${out}, ${items[i]}`;
      if (this.width(i < items.length - 1 ? `${more}, …` : more) > max) return `${out}, …`;
      out = more;
    }
    return out;
  }

  /** The dotted leader, laid from the value back toward the label. */
  leader(from: number, to: number, baseline: number, em: number): number {
    const y = baseline - 0.3 * em;
    this.ctx.fillStyle = DOTS;
    for (let x = to - DOT / 2; x - DOT / 2 >= from; x -= PERIOD) {
      this.ctx.beginPath();
      this.ctx.arc(x, y, DOT / 2, 0, Math.PI * 2);
      this.ctx.fill();
    }
    return to;
  }

  /** A dashed hairline from x0 to x1 whose dashes start and end exactly on both ends. */
  dashed(x0: number, x1: number, y: number): void {
    const dash = 4;
    const n = Math.max(2, Math.round((x1 - x0 + dash) / (2 * dash)));
    const gap = (x1 - x0 - n * dash) / (n - 1);
    this.ctx.fillStyle = DOTS;
    for (let i = 0; i < n; i++) this.ctx.fillRect(x0 + i * (dash + gap), y - 0.5, dash, 1);
  }

  /** A label, its leader and its value flush right; a long label wraps under itself. */
  row(label: string, value: string, opts: { tick?: boolean } = {}): void {
    const { ctx } = this;
    const right = RECEIPT_WIDTH - PAD;
    const left = PAD + (opts.tick ? HANG : 0);
    this.font(`500 15px ${TEXT}`);
    const vw = this.width(value);
    this.font(`400 15px ${TEXT}`, opts.tick ? INK : SOFT);
    const lines = this.wrap(label.split(' '), right - vw - GAP * 2 - MIN_LEADER - left);
    const base = this.y + 15;
    lines.forEach((l, i) => ctx.fillText(l, left, base + i * 21));
    const end = left + this.width(lines[0] ?? '');
    if (opts.tick) this.tick(PAD, base);
    const leaderStart = end + GAP;
    const leaderEnd = this.leader(leaderStart, right - vw - GAP, base, 15);
    this.rows.push({ label, leaderStart, leaderEnd, valueStart: right - vw, valueEnd: right });
    this.font(`500 15px ${TEXT}`);
    ctx.textAlign = 'right';
    ctx.fillText(value, right, base);
    ctx.textAlign = 'left';
    this.y += 21 * lines.length + 6;
  }

  /** The site's ✓ mark, drawn (the faces don't carry it). */
  tick(x: number, baseline: number): void {
    const { ctx } = this;
    ctx.strokeStyle = SOFT;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 1, baseline - 5);
    ctx.lineTo(x + 4.5, baseline - 1.5);
    ctx.lineTo(x + 11, baseline - 10);
    ctx.stroke();
  }

  /** A dashed rule across the paper, as Fettle's receipt separates its parts. */
  rule(): void {
    this.dashed(PAD, RECEIPT_WIDTH - PAD, this.y + 11);
    this.y += 22;
  }

  /** A section's name in spaced capitals, its dashed rule running on to the right edge. */
  section(name: string): void {
    const { ctx } = this;
    this.y += 14;
    this.font(`600 12px ${TEXT}`, INK, '1.5px');
    const text = name.toUpperCase();
    const base = this.y + 12;
    ctx.fillText(text, PAD, base);
    const end = PAD + this.width(text) + GAP;
    this.ctx.letterSpacing = '0px';
    this.dashed(end, RECEIPT_WIDTH - PAD, base - 4.5);
    this.y += 26;
  }

  /** Plain wrapped text in the column. */
  text(lines: string[], lineHeight: number, size: number): void {
    for (const l of lines) {
      this.ctx.fillText(l, PAD, this.y + size);
      this.y += lineHeight;
    }
  }

  /** A decorative barcode from the route (no readable text), centred. */
  barcode(seed: string): void {
    let h = 2166136261;
    for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const w = 220;
    let x = (RECEIPT_WIDTH - w) / 2;
    const end = x + w;
    this.ctx.fillStyle = INK;
    while (x < end) {
      h = Math.imul(h ^ (h >>> 13), 2246822507) >>> 0;
      const bar = 1 + (h % 3);
      const space = 1 + ((h >>> 8) % 3);
      if (x + bar > end) break;
      this.ctx.fillRect(x, this.y, bar, 40);
      x += bar + space;
    }
    this.y += 40;
  }
}

/** The verdict at the top, and its line: how much of the map the trip saw. */
export function verdictOf(s: Pick<TripSummary, 'visited' | 'total'>, copy: ReceiptWords): { title: string; sub: string } {
  const n = s.visited.length;
  const left = Math.max(0, s.total - n);
  const verdict = left === 0 ? copy.receiptVerdictAll : n * 2 >= s.total ? copy.receiptVerdictHalf : copy.receiptVerdictFew;
  const sub = left === 0 ? copy.receiptSubAll.text : left === 1 ? copy.receiptSubLeftOne.text : fill(copy.receiptSubLeft.text, left);
  return { title: verdict.text, sub };
}

/** The stations seen more than once, in the order they were first seen again. */
export const revisitsOf = (route: readonly string[]): string[] => [...new Set(route.filter((r, i) => route.indexOf(r) !== i))];

function layout(p: Printer, s: TripSummary, theme: ReceiptTheme, copy: ReceiptWords): void {
  const { ctx } = p;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = `#${theme.paper.getHexString()}`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // The head: the wordmark, and the day on the right, as Fettle's receipt has its date.
  p.font(`600 24px ${DISPLAY}`, INK, '-0.48px');
  ctx.fillText(copy.wordmark.text, PAD, p.y + 24);
  p.font(`400 14px ${TEXT}`, SOFT);
  ctx.textAlign = 'right';
  ctx.fillText(DATE.format(s.endedAt), RECEIPT_WIDTH - PAD, p.y + 22);
  ctx.textAlign = 'left';
  p.y += 44;
  p.row(copy.receiptStarted.text, TIME.format(s.startedAt));
  p.row(copy.receiptLeft.text, TIME.format(s.endedAt));
  p.row(copy.receiptDuration.text, duration(s.endedAt - s.startedAt));
  p.rule();

  // The verdict, as Fettle prints one at the top.
  const n = s.visited.length;
  const { title, sub } = verdictOf(s, copy);
  p.y += 6;
  p.font(`600 34px ${DISPLAY}`, INK, '-0.5px');
  p.text([title], 46, 34);
  p.font(`400 15px ${TEXT}`, SOFT);
  p.text(p.wrap(sub.split(' '), RECEIPT_WIDTH - PAD * 2), 22, 15);

  p.section(`${copy.receiptStations.text} · ${n} of ${s.total}`);
  for (const v of s.visited) p.row(v.name, clock(v.at), { tick: true });

  p.section(copy.receiptRoute.text);
  p.font(`400 15px ${TEXT}`, INK);
  p.text(p.wrap(s.route, RECEIPT_WIDTH - PAD * 2, ' → '), 22, 15);

  p.section(copy.receiptNumbers.text);
  const again = revisitsOf(s.route);
  p.row(copy.receiptStops.text, String(s.route.length));
  if (again.length) p.row(copy.receiptRevisits.text, p.fitList(again, RECEIPT_WIDTH / 2 - PAD));
  p.row(copy.receiptPokes.text, String(s.pokes));
  if (s.powerCycles) p.row(copy.receiptPower.text, String(s.powerCycles));
  const found = s.secretsFound.length;
  p.row(copy.receiptSecrets.text, found ? fill(copy.receiptSecretsCount.text, found) : copy.receiptSecretsNone.text);
  for (const f of s.secretsFound) p.row(f.name, clock(f.at), { tick: true });

  p.y += 8;
  p.rule();
  p.y += 6;
  p.font(`600 22px ${DISPLAY}`, INK, '-0.3px');
  ctx.textAlign = 'center';
  ctx.fillText(copy.receiptThanks.text, RECEIPT_WIDTH / 2, p.y + 22);
  p.y += 34;
  p.font(`400 13px ${TEXT}`, SOFT);
  for (const l of p.wrap(copy.receiptJoke.text.split(' '), RECEIPT_WIDTH - PAD * 2)) {
    ctx.fillText(l, RECEIPT_WIDTH / 2, p.y + 13);
    p.y += 19;
  }
  ctx.textAlign = 'left';
  p.y += 14;
  p.barcode(s.route.join('>') + s.startedAt);
  p.y += 8;
  p.font(`400 12px ${TEXT}`, SOFT, '0.5px');
  ctx.textAlign = 'center';
  ctx.fillText(copy.receiptHost.text, RECEIPT_WIDTH / 2, p.y + 12);
  ctx.textAlign = 'left';
  p.y += 12 + 40;
}

/** A leader row as laid, in receipt units: where its leader starts and ends, and its value. */
export interface ReceiptRow {
  label: string;
  leaderStart: number;
  leaderEnd: number;
  valueStart: number;
  valueEnd: number;
}

/**
 * Lays the receipt out on `ctx` (in receipt units; the caller scales it) and returns how long
 * it is and every leader row as laid, so "flush and reaching" can be checked without a screen.
 */
export function printReceipt(
  ctx: CanvasRenderingContext2D,
  summary: TripSummary,
  theme: ReceiptTheme,
  copy: ReceiptWords,
): { length: number; rows: ReceiptRow[] } {
  const printer = new Printer(ctx);
  layout(printer, summary, theme, copy);
  return { length: Math.ceil(printer.y), rows: printer.rows };
}

/**
 * Draws the receipt for `summary`: the printed paper's texture, and the PNG the visitor keeps.
 * The canvas is RECEIPT_WIDTH units wide at RECEIPT_SCALE px a unit, as long as its lines (at
 * most RECEIPT_MAX: the paper Fettle can feed; a longer trip is cut at the foot).
 */
export function drawReceipt(summary: TripSummary, theme: ReceiptTheme, copy: ReceiptWords, doc: Document = document): HTMLCanvasElement {
  const canvas = doc.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('receipt: no 2D context');
  // First pass on a full-length sheet to find the length, then the real one.
  canvas.width = RECEIPT_WIDTH * RECEIPT_SCALE;
  canvas.height = RECEIPT_MAX * RECEIPT_SCALE;
  ctx.scale(RECEIPT_SCALE, RECEIPT_SCALE);
  const length = Math.min(printReceipt(ctx, summary, theme, copy).length, RECEIPT_MAX);
  canvas.height = length * RECEIPT_SCALE; // resets the context
  ctx.scale(RECEIPT_SCALE, RECEIPT_SCALE);
  const { rows } = printReceipt(ctx, summary, theme, copy);
  // For tests: every leader row as laid (units), so "flush and reaching" can be checked.
  canvas.dataset.rows = JSON.stringify(rows);
  return canvas;
}

/** The receipt's length in units: what Fettle feeds (RECEIPT_WIDTH is the paper's width). */
export const receiptLength = (canvas: HTMLCanvasElement): number => canvas.height / RECEIPT_SCALE;

/** The PNG the visitor keeps. */
export function receiptPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('receipt: the canvas gave no PNG'))), 'image/png'),
  );
}
