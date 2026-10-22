import { join } from 'node:path';
import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { type Spot, strayStart, strayWay } from '../../src/moments/stray-way';
import { tuning } from '../../src/tuning';
import world from '../../src/data/world.json';
import { followZoom, footprintSpan, goesAstray, hop, nearScale, ratePerMinute, schedule, strayCooldown, zoomedScale } from '../../src/world/traffic';
import { ROOT } from './helpers/blender';
import { glbBounds } from './helpers/glb';

const DAY = 86_400_000;
const now = Date.parse('2026-10-18T12:00:00Z');
const daysAgo = (d: number) => new Date(now - d * DAY).toISOString();

describe('traffic', () => {
  test('rate is 12 at age 0, 6.5 at 30 days, about 1 when very old, and 1+11*0.5^(365/30) when the date is missing', () => {
    expect(ratePerMinute(daysAgo(0), now)).toBeCloseTo(12, 9);
    expect(ratePerMinute(daysAgo(30), now)).toBeCloseTo(6.5, 9);
    expect(ratePerMinute(daysAgo(3650), now)).toBeCloseTo(1, 3);
    expect(ratePerMinute(undefined, now)).toBeCloseTo(1 + 11 * 0.5 ** (365 / 30), 9);
  });

  // Motion audit #15: the hub never sends a burst. Signals due together leave at least
  // tuning.hubSpacing apart; a due route waits for the next free slot.
  test('signals due at once leave the hub at least hubSpacing apart, none lost', () => {
    const routes = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, gap: 10, wait: 0 }));
    const hub = { wait: 0 };
    const left: { id: string; at: number }[] = [];
    const dt = 1 / 60;
    for (let f = 0; f < 120; f++) {
      for (const r of schedule(routes, dt, hub, () => 0.5)) left.push({ id: r.id, at: f * dt });
    }
    expect(left.map((l) => l.id).sort()).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    for (let i = 1; i < left.length; i++) {
      expect(left[i]!.at - left[i - 1]!.at).toBeGreaterThanOrEqual(tuning.hubSpacing - 1e-9);
    }
    expect(tuning.hubSpacing).toBeGreaterThanOrEqual(0.15);
  });

  // A signal on the gondola's link hops the grip. In the line's vertical plane the clamp is a
  // block 0.064 either side of the pin (0.05 ahead, rounded up to the longer side, since the
  // gondola faces either way), from under the knuckle to 0.032 over the pin; the signal a capsule
  // 0.26 long, 0.056 in half girth at its pulse (both from the models' Blender sources, not in
  // this repo), tilted along the hop as place() points it.
  test('hop is level on the line beyond half, and the pill clears the clamp all the way over', () => {
    const { height, half } = tuning.signalHop;
    expect(hop(0)).toBe(height);
    expect(hop(half)).toBe(0);
    expect(hop(-half - 0.1)).toBe(0);
    expect(hop(0.1)).toBe(hop(-0.1));
    const slope = (d: number) => (hop(d + 1e-4) - hop(d - 1e-4)) / 2e-4;
    expect(Math.abs(slope(half - 1e-4))).toBeLessThan(0.01); // back on the line level
    expect(Math.abs(slope(0.02))).toBeLessThan(0.01); // level over the pin
    const clampGap = (x: number, y: number) =>
      Math.hypot(Math.max(-0.064 - x, 0, x - 0.064), Math.max(-0.06 - y, 0, y - 0.032));
    let least = Infinity;
    for (let d = -0.6; d <= 0.6; d += 0.002) {
      const k = slope(d);
      const n = Math.hypot(1, k);
      for (let t = -0.08; t <= 0.08; t += 0.004) {
        least = Math.min(least, clampGap(d + t / n, hop(d) + (t * k) / n) - 0.056); // the capsule's core, less its girth
      }
    }
    expect(least).toBeGreaterThan(0.005);
  });

  // A signal comes out where its link leaves the origin's model and goes in where the link
  // enters the node's: a straight link 5 long, through a model ±0.3 at its start and ±0.4 at its end.
  test('footprintSpan runs from the origin footprint edge to the node footprint edge', () => {
    const a = new Vector3(0, 0.3, 0);
    const b = new Vector3(5, 0.3, 0);
    const point = (u: number, out: Vector3) => out.lerpVectors(a, b, u);
    const box = (cx: number, h: number) => (p: Vector3) => Math.abs(p.x - cx) <= h && Math.abs(p.z) <= h;
    const { from, to } = footprintSpan(point, 5, box(0, 0.3), box(5, 0.4));
    expect(from).toBeCloseTo(0.3, 3);
    expect(to).toBeCloseTo(4.6, 3);
    // No footprint (a model not in yet): end to end.
    expect(footprintSpan(point, 5, () => false, () => false)).toEqual({ from: 0, to: 5 });
  });
});

// Task 17, secret 4: now and then a signal leaves down the duck's undrawn link instead.
describe('goesAstray', () => {
  test('about one signal in tuning.stray.odds (20) goes astray', () => {
    expect(tuning.stray.odds).toBe(20); // 1 in 40 until the owner's test notes: never seen
    // A seeded stream (mulberry32), so the count is the same every run.
    let seed = 17;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const n = 40_000;
    let astray = 0;
    for (let i = 0; i < n; i++) if (goesAstray(random)) astray++;
    expect(astray / n).toBeGreaterThan(1 / 20 - 0.004);
    expect(astray / n).toBeLessThan(1 / 20 + 0.004);
  });

  test('the edges: a draw under 1/odds strays, at or over it doesn’t', () => {
    expect(goesAstray(() => 0)).toBe(true);
    expect(goesAstray(() => 1 / 20 - 1e-9)).toBe(true);
    expect(goesAstray(() => 1 / 20)).toBe(false);
    expect(goesAstray(() => 0.99)).toBe(false);
    expect(goesAstray(() => 0.5, 1)).toBe(true); // odds 1: every one
  });

  // The owner's test (duck-cooldown): at 1 in 20 of ~66 signals a minute, a new stray left
  // almost as soon as the last one ended. None by chance until tuning.stray.first seconds after
  // the arrival ends, then none for tuning.stray.gap seconds after each one ends.
  test('strayCooldown: none before `first` after the arrival, none for `gap` after one ends', () => {
    const { first, gap } = tuning.stray;
    expect(first).toBe(40);
    expect(gap).toBe(120);
    const cool = strayCooldown();
    expect(cool.ok(0)).toBe(false); // the arrival still running
    expect(cool.ok(1e6)).toBe(false);
    cool.arrived(10);
    expect(cool.ok(10)).toBe(false);
    expect(cool.ok(10 + first - 0.01)).toBe(false);
    expect(cool.ok(10 + first)).toBe(true);
    cool.ended(100); // reached the duck, followed, or gone
    expect(cool.ok(100)).toBe(false);
    expect(cool.ok(100 + gap - 0.01)).toBe(false);
    expect(cool.ok(100 + gap)).toBe(true);
    expect(cool.ok(100 + gap + 500)).toBe(true);
  });

  // The station finding (Task 18's day review): a signal near a
  // station's camera read as a big blue pill. Nearer than signalNear it shrinks with its depth,
  // so its size on screen (scale / depth) holds at what it is at signalNear.
  test('nearScale is whole from signalNear out and holds the on-screen size nearer', () => {
    const near = tuning.signalNear;
    expect(nearScale(near)).toBe(1);
    expect(nearScale(near * 3)).toBe(1);
    for (const depth of [0.5, 4.7, 6, 11, near * 0.99]) expect(nearScale(depth) / depth).toBeCloseTo(1 / near, 12);
    expect(nearScale(0)).toBe(0);
    expect(nearScale(-2)).toBe(0); // behind the camera
  });

  // Zoomed in, the overview's signals grow with the map (map-tweaks): signalNear is the zoom's
  // share of itself, at once as the zoom goes in, eased back out after travel resets it.
  test('followZoom: down to the zoom at once, back up to it eased over signalUnzoom, never past it', () => {
    const T = tuning.signalUnzoom;
    expect(followZoom(1, 0.5, 1 / 60)).toBe(0.5);
    expect(followZoom(0.7, 0.5, 0)).toBe(0.5);
    expect(followZoom(0.5, 1, T)).toBeCloseTo(1 - 0.5 / Math.E, 9);
    expect(followZoom(0.5, 1, 0)).toBe(0.5);
    let z = 0.5;
    for (let i = 0; i < 600; i++) {
      const next = followZoom(z, 1, 1 / 60);
      expect(next).toBeGreaterThanOrEqual(z);
      expect(next).toBeLessThanOrEqual(1);
      z = next;
    }
    expect(z).toBeCloseTo(1, 9);
    // Zoomed to 1.2 / signalZoomMax (1.8x) a signal that share of signalNear deep is still world-sized.
    const s = 1.2 / tuning.signalZoomMax;
    expect(zoomedScale(tuning.signalNear * s, s)).toBe(1);
  });

  // Zoomed in past 1 / signalZoomMax (the zoom goes to 4x since 2026-10-22), signals stop
  // growing on screen: a signal world-sized in the overview (deeper than signalNear) is about
  // `share` as deep zoomed, so its size there (scale / depth) is scale / share times the
  // overview's, at most signalZoomMax times (signals.spec measures it on screen).
  test('zoomedScale: as nearScale down to 1.2 / signalZoomMax, then at most signalZoomMax times the overview size', () => {
    const near = tuning.signalNear;
    const max = tuning.signalZoomMax;
    expect(max).toBeGreaterThan(2); // 2x grows them as it did
    expect(max).toBeLessThanOrEqual(2.5);
    // Down to 1.2 / max as it was; past that a signal near the camera holds 1.8x one at signalNear.
    for (const depth of [0.5, 3, 6]) expect((zoomedScale(depth, tuning.zoom.min) / depth) * near).toBeCloseTo(max / 1.2, 9);
    for (const share of [1, 0.8, 0.6, 1.2 / max]) for (const depth of [3, 12, 29, 40]) expect(zoomedScale(depth, share)).toBe(nearScale(depth, near * share));
    for (const share of [0.4, 0.3, tuning.zoom.min]) {
      for (const overview of [near, 34.1, 45, 60]) {
        const grown = zoomedScale(overview * share, share) / share; // on screen, against the overview's 1 / overview
        expect(grown).toBeLessThanOrEqual(max + 1e-9);
        expect(grown).toBeGreaterThan(1.8); // held there, not 1 / share
      }
    }
  });

  // The overview stays as it was: every point a signal rides (its links, lifted by a hop and its
  // half girth) is deeper than signalNear from the overview's camera, turned the old ±20° and
  // drifted all the way either side. Its fit only ever pulls the camera back (fit.ts), so the
  // authored one is nearest. Turned on round (decided 2026-10-21), the nearest link comes to
  // 29.3 near 180°, so a signal there is at most 3% smaller (the second test). Zoomed in, the
  // signals keep their size on screen at signalNear, as at a station.
  test('no link is within signalNear of the overview camera, at any turn up to ±20°', () => {
    const { position, target } = world.cameras.overview;
    const t = new Vector3(...(target as [number, number, number]));
    const arm = new Vector3(...(position as [number, number, number])).sub(t);
    const lift = tuning.signalHop.height + 0.06;
    const limit = 20 + tuning.driftYawDeg;
    let nearest = Infinity;
    for (let deg = -limit; deg <= limit; deg += 0.5) {
      const eye = arm.clone().applyAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180).add(t);
      const look = t.clone().sub(eye).normalize();
      for (const segs of Object.values(world.links) as number[][][])
        for (const seg of segs)
          for (let i = 0; i < seg.length; i += 3) {
            const p = new Vector3(seg[i], seg[i + 1]! + lift, seg[i + 2]);
            nearest = Math.min(nearest, p.sub(eye).dot(look));
          }
    }
    expect(nearest).toBeGreaterThan(tuning.signalNear + 2);
  });

  test('turned all the way round, no link comes within 97% of signalNear of the overview camera', () => {
    const { position, target } = world.cameras.overview;
    const t = new Vector3(...(target as [number, number, number]));
    const arm = new Vector3(...(position as [number, number, number])).sub(t);
    const lift = tuning.signalHop.height + 0.06;
    let nearest = Infinity;
    for (let deg = -180; deg < 180; deg += 1) {
      const eye = arm.clone().applyAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180).add(t);
      const look = t.clone().sub(eye).normalize();
      for (const segs of Object.values(world.links) as number[][][])
        for (const seg of segs)
          for (let i = 0; i < seg.length; i += 3) {
            const p = new Vector3(seg[i], seg[i + 1]! + lift, seg[i + 2]);
            nearest = Math.min(nearest, p.sub(eye).dot(look));
          }
    }
    expect(nearest).toBeGreaterThan(tuning.signalNear * 0.97);
  });
});

// The owner's test (2026-10-21): every stray left the origin down the duck's link, "always in one
// position". Now it sets out from a node near the view (strayStart) on a way of its own
// (strayWay, moments/stray-way.ts): out towards the map's edge and round into the duck.
describe('the stray’s way', () => {
  const at = (id: string): Spot => {
    const [x, z] = (world.nodes as Record<string, number[]>)[id]!;
    return { id, x: x!, z: z! };
  };
  const duck = at('duck');

  test('strayStart: at a station, its node; elsewhere a node on screen, at least WAY.near from the duck if any is', () => {
    const spots = Object.keys(world.nodes).map(at);
    expect(strayStart('server', spots, duck)).toBe('server');
    expect(strayStart('siel-eolie', spots, duck)).toBe('siel-eolie'); // near the duck, but it's where you are
    // The overview: only what's on screen, the near ones left out while a far one is in view.
    const seen = new Set(['siel-eolie', 'dolci-eoliani', 'fettle', 'colophon']);
    const view = spots.map((s) => ({ ...s, seen: seen.has(s.id) }));
    const picked = new Set<string>();
    for (let i = 0; i < 64; i++) picked.add(strayStart(null, view, duck, () => i / 64));
    expect([...picked].sort()).toEqual(['colophon', 'fettle']);
    // Only near ones in view: one of those. None in view: the origin.
    const near = spots.map((s) => ({ ...s, seen: s.id === 'siel-eolie' }));
    expect(strayStart(null, near, duck)).toBe('siel-eolie');
    expect(strayStart(null, spots, duck)).toBe('origin');
  });

  // Every station's way, on the models' real footprints (their GLBs' bounds without the shadow,
  // as nodes.ts measures them): it starts at its node, heads out, crosses no other model and ends
  // in the duck's footprint, even in length.
  test('strayWay from every station: out from its node, past no other model, into the duck’s footprint', async () => {
    const ids = Object.keys(world.nodes);
    const spots: Spot[] = await Promise.all(
      ids.map(async (id) => {
        const s = at(id);
        const { min, max } = await glbBounds(join(ROOT, 'public', 'models', `${id}.glb`), ['shadow']);
        return { ...s, box: [s.x + min[0]!, s.z + min[2]!, s.x + max[0]!, s.z + max[2]!] as const };
      }),
    );
    const duckSpot = spots.find((s) => s.id === 'duck')!;
    const [dx0, dz0, dx1, dz1] = duckSpot.box!;
    const p = new Vector3();
    const q = new Vector3();
    for (const from of spots.filter((s) => s.id !== 'duck')) {
      const way = strayWay(from, duckSpot, spots, tuning.linkMast);
      expect(way.from).toBe(from.id);
      expect(way.point(0, p).distanceTo(new Vector3(from.x, tuning.linkMast, from.z)), from.id).toBeLessThan(1e-6);
      way.point(1, p);
      expect(p.x >= dx0 && p.x <= dx1 && p.z >= dz0 && p.z <= dz1, `${from.id} ends in the duck`).toBe(true);
      // Out towards the edge first (from the origin, any way is out).
      expect(Math.hypot(way.point(0.04, p).x, p.z), from.id).toBeGreaterThan(Math.hypot(from.x, from.z));
      let length = 0;
      way.point(0, q);
      for (let i = 1; i <= 400; i++) {
        way.point(i / 400, p);
        length += p.distanceTo(q);
        q.copy(p);
        for (const o of spots) {
          if (o.id === from.id || o.id === 'duck') continue;
          const [x0, z0, x1, z1] = o.box!;
          expect(p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1, `${from.id}'s way crosses ${o.id}`).toBe(false);
        }
      }
      expect(length / way.length, from.id).toBeCloseTo(1, 2);
      // Even in length: a hundredth of it is a hundredth of its length, anywhere along it.
      for (const u of [0.1, 0.5, 0.9]) expect(way.point(u + 0.01, p).distanceTo(way.point(u, q)) / (way.length * 0.01)).toBeCloseTo(1, 1);
      console.info(`stray from ${from.id}: ${way.length.toFixed(1)} long`);
    }
  });
});
