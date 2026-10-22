import { describe, expect, test, vi } from 'vitest';
import { found, list, onFound, SECRET_IDS } from '../../src/moments/secrets';
import { secretsCopy } from '../../src/copy-secrets';

// The secrets' registry (Task 17): each is recorded once per visit with its id, name, receipt line
// and time, in the order found, and Task 16's trip can subscribe to them as they're found.
describe('secrets', () => {
  test('a secret is recorded once, with its name, its line and when; listeners hear it once', () => {
    const heard = vi.fn();
    const off = onFound(heard);
    expect(list()).toEqual([]);
    expect(found('key-under-mat')).toBe(true);
    expect(found('key-under-mat')).toBe(false);
    expect(found('taped-switch')).toBe(true);
    expect(list().map((s) => s.id)).toEqual(['key-under-mat', 'taped-switch']);
    expect(list()[0]).toMatchObject({ name: 'The key under the mat', line: 'Left the key under the mat' });
    expect(list()[1]).toMatchObject({ name: 'The taped-over switch', line: 'Taped over the power switch' });
    expect(list()[0]!.at).toBeGreaterThan(0);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    found('test-means-test');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  test('every secret has a name and a line in copy-secrets', () => {
    expect(SECRET_IDS.length).toBeGreaterThanOrEqual(4);
    // Each secret's name and line (the welcome's counter words are here too: html.ts, found-count.ts).
    expect(Object.keys(secretsCopy).filter((k) => k.startsWith('secret')).length).toBe(SECRET_IDS.length * 2);
  });
});
