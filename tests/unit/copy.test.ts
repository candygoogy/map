import { describe, expect, it } from 'vitest';
import { copy, pageCopy } from '../../src/copy';
import { receiptCopy } from '../../src/copy-receipt';
import { runtimeCopy } from '../../src/copy-runtime';
import { secretsCopy } from '../../src/copy-secrets';

describe('copy', () => {
  it('every key has text', () => {
    const entries = Object.entries(copy);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, { text, approved }] of entries) {
      expect(text.trim(), key).not.toBe('');
      expect(typeof approved, key).toBe('boolean');
    }
  });

  // The runtime's words (src/copy-runtime.ts) are split out of the page's so the runtime chunk
  // doesn't carry the prerendered words; `copy` must still be every one of both, once.
  it('copy is the page words and the runtime words, each key in one of them', () => {
    const page = Object.keys(pageCopy);
    const runtime = Object.keys(runtimeCopy);
    const secrets = Object.keys(secretsCopy); // Task 17's, in their lazy chunk
    const receipt = Object.keys(receiptCopy); // the trip receipt's (its lazy chunk's)
    const all = [...page, ...runtime, ...secrets, ...receipt];
    expect(new Set(all).size).toBe(all.length); // each key in one of them
    expect(Object.keys(copy).sort()).toEqual(all.sort());
    for (const k of runtime) expect(copy[k as keyof typeof copy], k).toBe(runtimeCopy[k as keyof typeof runtimeCopy]);
  });

  // Launch gate (Task 20): every map-only word has the owner's go.
  it.runIf(process.env.LAUNCH === '1')('all copy approved', () => {
    const pending = Object.entries(copy)
      .filter(([, v]) => !v.approved)
      .map(([k]) => k);
    expect(pending).toEqual([]);
  });
});
