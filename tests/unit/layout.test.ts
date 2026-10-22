import { describe, expect, test } from 'vitest';
import { CubicBezierCurve3, Vector3 } from 'three';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import world from '../../src/data/world.json' with { type: 'json' };
import { parseFeed, type FeedNode, type MapFeed } from '../../src/data/feed';
import { layout, linkCurve, linkPath, parentOf, type World } from '../../src/data/layout';
import { tuning } from '../../src/tuning';

const feed = parseFeed(fixture);

const withNodes = (extra: FeedNode[]): MapFeed => ({ ...feed, nodes: [...feed.nodes, ...extra] });
const project = (id: string): FeedNode => ({ id, kind: 'project', name: id, links: [] });

describe('layout', () => {
  test("the range rings keep 0.3 clear of every node's ground ring, so none grazes or crosses one", () => {
    // The owner's test, 2026-10-21: the ring at 9 touched the AP's and ran through homelab's.
    const origin = world.nodes.origin as number[];
    for (const [id, [x, z]] of Object.entries(world.nodes as Record<string, number[]>)) {
      const d = Math.hypot(x! - origin[0]!, z! - origin[1]!);
      for (const r of tuning.rangeRings) {
        expect(Math.abs(d - r) - tuning.groundRing, `${id} and the ring at ${r}`).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  test('known ids take their positions from world.json', () => {
    // A copy of world.json with fettle moved, as if the owner had dragged it in world.blend.
    const moved: World = { ...world, nodes: { ...world.nodes, fettle: [6.1, -1.9] } };
    const at = layout(feed, moved);
    expect(at.get('fettle')).toEqual(new Vector3(6.1, 0, -1.9));
    for (const node of feed.nodes) {
      if (node.id === 'fettle') continue;
      const [x, z] = (world.nodes as Record<string, number[]>)[node.id]!;
      expect(at.get(node.id), node.id).toEqual(new Vector3(x, 0, z));
    }
  });

  // world.json holds each link's Bezier points, [left handle, point, right handle] each; the
  // runtime's curve is the cubics between them (Blender's own), measured evenly in length.
  test("known links are their Blender curves: a cubic between each two Bezier points, even in length", () => {
    const at = layout(feed, world);
    const links = world.links as Record<string, number[][]>;
    expect(Object.keys(links).length).toBeGreaterThan(0);
    const v = (p: number[], i: number) => new Vector3(p[i], p[i + 1], p[i + 2]);
    for (const [id, pts] of Object.entries(links)) {
      for (const p of pts) expect(p, id).toHaveLength(9);
      const curve = linkCurve(id, at, world);
      const L = curve.getLength();
      expect(curve.getPointAt(0).distanceTo(v(pts[0]!, 3)), id).toBe(0);
      expect(curve.getPointAt(1).distanceTo(v(pts.at(-1)!, 3)), id).toBeLessThan(1e-12);
      // Every Bezier point is on it, as far along as the cubics before it are long; and the
      // cubics' own points (Blender draws them at t = k / resolution_u) are on it.
      let along = 0;
      for (let i = 1; i < pts.length; i++) {
        const cubic = new CubicBezierCurve3(v(pts[i - 1]!, 3), v(pts[i - 1]!, 6), v(pts[i]!, 0), v(pts[i]!, 3));
        cubic.arcLengthDivisions = 4000;
        const lengths = cubic.getLengths(4000);
        for (let k = 0; k <= 4000; k += 250) {
          const want = cubic.getPoint(k / 4000);
          const got = curve.getPointAt(Math.min((along + lengths[k]!) / L, 1));
          expect(got.distanceTo(want), `${id} cubic ${i} t=${k / 4000}`).toBeLessThan(1e-6);
        }
        along += lengths.at(-1)!;
      }
      expect(along, id).toBeCloseTo(L, 6);
    }
  });

  // Level cable ends (2026-10-20): out past the dock (tuning.visitorDock and its clip's last
  // 0.1) from the node and through the hub's ring at the same radius, the rebuilt curve is
  // at mast height (its shoulders are exact cubics, so to the float), and nowhere is it too low
  // for the hanging cabin.
  test('known links run level at linkMast for 0.9 from each end, and never under the hanging cabin', () => {
    const at = layout(feed, world);
    for (const id of Object.keys(world.links)) {
      const curve = linkCurve(id, at, world);
      const L = curve.getLength();
      for (let d = 0; d <= 0.9 + 1e-9; d += 0.005) {
        for (const u of [d / L, 1 - d / L]) {
          expect(Math.abs(curve.getPointAt(u).y - tuning.linkMast), `${id} ${d.toFixed(3)} from an end`).toBeLessThan(1e-6);
        }
      }
      for (let i = 0; i <= 400; i++) {
        expect(curve.getPoint(i / 400).y, id).toBeGreaterThanOrEqual(tuning.visitorDrop + tuning.visitorDockGap);
      }
    }
  });

  // Not yet the level-ended shape world.py now makes: layout.ts keeps the plain quadratic.
  test("an unknown id's link is the quadratic arc world.py started with, from mast top to mast top", () => {
    const at = layout(withNodes([project('alpha')]), world);
    const curve = linkCurve('alpha', at, world);
    const o = at.get('origin')!;
    const a = at.get('alpha')!;
    expect(curve.getPoint(0).distanceTo(new Vector3(o.x, tuning.linkMast, o.z))).toBeLessThan(1e-9);
    expect(curve.getPoint(1).distanceTo(new Vector3(a.x, tuning.linkMast, a.z))).toBeLessThan(1e-9);
    // The quadratic's top: half the lift over its ends.
    expect(curve.getPoint(0.5).y).toBeCloseTo(tuning.linkMast + tuning.linkLift / 2, 9);
  });

  // The homelab cluster (Batch B): the network is a tree, and a way between two nodes goes up to
  // the nearest node they share and down again. Since 2026-10-21 the cluster is the real wiring's
  // tree, router → switch → desktop / server / AP, AP → laptop: several levels deep.
  test('linkPath walks the tree via the nearest shared node: the origin, or a hub within the cluster', () => {
    const parent = (id: string) => parentOf(world, id);
    const path = (a: string, b: string) => linkPath(parent, a, b).map((s) => `${s.up ? '↑' : '↓'}${s.id}`);
    expect(['switch', 'desktop', 'server', 'ap', 'laptop'].map(parent)).toEqual(['homelab', 'switch', 'switch', 'switch', 'ap']);
    expect(parent('homelab')).toBe('origin');
    expect(path('origin', 'desktop')).toEqual(['↓homelab', '↓switch', '↓desktop']);
    expect(path('origin', 'laptop')).toEqual(['↓homelab', '↓switch', '↓ap', '↓laptop']);
    expect(path('desktop', 'server')).toEqual(['↑desktop', '↓server']); // they meet at the switch
    expect(path('laptop', 'desktop')).toEqual(['↑laptop', '↑ap', '↓desktop']);
    expect(path('desktop', 'switch')).toEqual(['↑desktop']); // a direct link now
    expect(path('fettle', 'desktop')).toEqual(['↑fettle', '↓homelab', '↓switch', '↓desktop']);
    expect(path('laptop', 'notary')).toEqual(['↑laptop', '↑ap', '↑switch', '↑homelab', '↓notary']);
    expect(path('desktop', 'homelab')).toEqual(['↑desktop', '↑switch']);
    expect(path('homelab', 'laptop')).toEqual(['↓switch', '↓ap', '↓laptop']);
    expect(path('fettle', 'idiff')).toEqual(['↑fettle', '↓idiff']);
    expect(path('desktop', 'origin')).toEqual(['↑desktop', '↑switch', '↑homelab']);
    expect(path('ap', 'ap')).toEqual([]);
  });

  test('two unknown ids get distinct ring positions at least 1.5 from every node', () => {
    const f = withNodes([project('alpha'), project('beta')]);
    const at = layout(f, world);
    const a = at.get('alpha')!;
    const b = at.get('beta')!;
    for (const p of [a, b]) {
      expect(p.y).toBe(0);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(tuning.unknownRing, 6);
      for (const [id, q] of at) {
        if (q === p) continue;
        expect(p.distanceTo(q), id).toBeGreaterThanOrEqual(tuning.unknownGap);
      }
    }
    expect(a.distanceTo(b)).toBeGreaterThanOrEqual(tuning.unknownGap);
    // Deterministic: the same feed lands them in the same places.
    const again = layout(f, world);
    expect(again.get('alpha')).toEqual(a);
    expect(again.get('beta')).toEqual(b);
  });
});
