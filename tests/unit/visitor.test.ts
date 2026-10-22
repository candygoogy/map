import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import world from '../../src/data/world.json';
import { linkCurve, parentOf } from '../../src/data/layout';
import { tuning } from '../../src/tuning';
import { crossing } from '../../src/world/links';
import { dockDistance } from '../../src/world/visitor';

// The gondola hangs tuning.visitorDrop under the line, so it docks (and parks beside the hub)
// where the line is high enough for its belly to clear the floor by tuning.visitorDockGap:
// at least tuning.visitorDock from the end, and no farther out than that needs.

const positions = new Map(Object.entries(world.nodes).map(([id, [x, z]]) => [id, new Vector3(x, 0, z)]));
const ids = [...positions.keys()].filter((id) => id !== 'origin');
const CLEAR = tuning.visitorDrop + tuning.visitorDockGap;

describe('dockDistance', () => {
  for (const from of ['node', 'hub'] as const) {
    test(`on every link, from the ${from}, the belly clears the floor by the gap, and no farther out than it needs`, () => {
      for (const id of ids) {
        const c = linkCurve(id, positions, world);
        const L = c.getLength();
        const height = (d: number) => c.getPointAt(from === 'node' ? (L - d) / L : d / L).y;
        const d = dockDistance(c, from);
        expect(d, id).toBeGreaterThanOrEqual(tuning.visitorDock);
        expect(d, id).toBeLessThan(L / 2);
        expect(height(d) - tuning.visitorDrop, `${id}: belly over the floor`).toBeGreaterThanOrEqual(tuning.visitorDockGap - 1e-6);
        if (d > tuning.visitorDock + 1e-6) expect(height(d - 0.005), `${id}: 5 mm in`).toBeLessThan(CLEAR);
        expect(dockDistance(c, from), `${id}: cached`).toBe(d);
      }
    });
  }

  // The links' ends sit on masts (tuning.linkMast), so the line is high enough for the cabin
  // at visitorDock on every link, at both ends: it docks and parks right by its node again.
  test('on the authored links, on their masts, it docks and parks at exactly visitorDock', () => {
    for (const id of ids) {
      const c = linkCurve(id, positions, world);
      expect(dockDistance(c, 'node'), id).toBe(tuning.visitorDock);
      expect(dockDistance(c, 'hub'), id).toBe(tuning.visitorDock);
    }
  });

  // It parks and rounds the hub on the turnaround (links.ts): visitorDock round the hub's
  // centre at linkMast. There the cabin clears the floor by the gap, and every authored link
  // meets the ring no nearer the hub than it would clear the floor on the link itself.
  // A cluster's links leave their hub, which has a turnaround of its own; the hub's own link
  // meets that ring near its far end, where it docks. Since the real wiring's tree (2026-10-21)
  // the router, the switch and the AP are each such a hub.
  test('on the turnaround the hanging cabin clears the floor by the gap, and it is where the hub-end dock would be', () => {
    expect(tuning.linkMast - tuning.visitorDrop).toBeGreaterThanOrEqual(tuning.visitorDockGap - 1e-9);
    for (const id of ids) {
      const hub = positions.get(parentOf(world, id))!.clone().setY(tuning.linkMast);
      const c = linkCurve(id, positions, world);
      expect(crossing(c, hub, tuning.visitorDock), id).toBeCloseTo(dockDistance(c, 'hub'), 4);
    }
    const hubs = [...new Set(Object.values(world.linkFrom))];
    expect(hubs.sort()).toEqual(['ap', 'homelab', 'switch']);
    for (const h of hubs) {
      const hub = positions.get(h)!.clone().setY(tuning.linkMast);
      const own = linkCurve(h, positions, world);
      expect(crossing(own, hub, tuning.visitorDock, true), `${h}: its own link`).toBeCloseTo(dockDistance(own, 'node'), 4);
    }
  });

  test('nowhere along a link, the hub end included, does the hanging cabin reach below the floor', () => {
    for (const id of ids) {
      const c = linkCurve(id, positions, world);
      for (let i = 0; i <= 400; i++) expect(c.getPointAt(i / 400).y - tuning.visitorDrop, `${id} at ${i / 400}`).toBeGreaterThan(0);
    }
  });
});
