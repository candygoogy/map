// The models' load order (src/world/models.ts; the owner's model budgets): rank 0 alone and first,
// then the lowest ranks a few at a time, unranked last. The loader is a stand-in that records which
// loads have started and finishes each when the test says.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const started: string[] = [];
const finish = new Map<string, () => void>();

vi.mock('../../src/vendor/meshopt_decoder.js', () => ({ MeshoptDecoder: {} }));
vi.mock('../../src/vendor/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setMeshoptDecoder() {
      return this;
    }
    loadAsync(url: string) {
      const id = /\/models\/([^.]+)\.glb/.exec(url)![1]!;
      started.push(id);
      return new Promise((done) => finish.set(id, () => done({ id })));
    }
  },
}));

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('loadModel', () => {
  beforeEach(() => {
    started.length = 0;
    finish.clear();
    vi.resetModules();
  });

  test('rank 0 goes alone and first, then the lowest ranks three at a time, unranked last', async () => {
    const { loadModel } = await import('../../src/world/models');
    // Asked for in one task, in no particular order: they start by rank.
    const loads = [loadModel('c', 2), loadModel('late'), loadModel('origin', 0), loadModel('a', 1), loadModel('b', 1), loadModel('d', 3)];
    await settle();
    expect(started).toEqual(['origin']);
    loads.push(loadModel('world', 0)); // a rank-0 load asked for later still goes before the others
    await settle();
    expect(started).toEqual(['origin', 'world']);
    finish.get('origin')!();
    await settle();
    expect(started).toEqual(['origin', 'world']); // nothing else while a rank-0 load runs
    finish.get('world')!();
    await settle();
    expect(started).toEqual(['origin', 'world', 'a', 'b', 'c']);
    finish.get('b')!();
    await settle();
    expect(started).toEqual(['origin', 'world', 'a', 'b', 'c', 'd']);
    for (const id of ['a', 'c', 'd']) finish.get(id)!();
    await settle();
    expect(started.at(-1)).toBe('late');
    finish.get('late')!();
    expect((await Promise.all(loads)).map((g) => (g as unknown as { id: string }).id)).toEqual(['c', 'late', 'origin', 'a', 'b', 'd', 'world']);
  });

  test('a failed load frees its place', async () => {
    const { loadModel } = await import('../../src/world/models');
    const bad = loadModel('Bad id');
    await expect(bad).rejects.toThrow(/isn't a model id/);
    const loads = [1, 2, 3, 4].map((i) => loadModel(`m${i}`, i));
    await settle();
    expect(started).toEqual(['m1', 'm2', 'm3']);
    finish.get('m1')!();
    await settle();
    expect(started).toEqual(['m1', 'm2', 'm3', 'm4']);
    for (const id of ['m2', 'm3', 'm4']) finish.get(id)!();
    await Promise.all(loads);
  });
});
