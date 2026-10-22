// The stray's way (Task 17, secret 4; the owner's test, 2026-10-21: "always in one position"):
// a stray signal used to leave the origin down the duck's undrawn link, every time, so it was
// the same line each time. Now it sets out from a node near where the visitor is looking
// (strayStart) and goes to the duck by a way of its own (strayWay). The duck stays where it is,
// with its own link, camera and flights; only the stray's way changes.
//
// - The start: at a station, that station's node. Anywhere else (the overview, a flight, the
//   receipt), a node on screen, at random, of those at least WAY.near from the duck, so the
//   stray has a run to watch; if none is that far, any on screen; if none is on screen, the origin.
// - The way, round the origin (the map's centre) on the floor at the links' height: it leaves
//   its node heading straight out, towards the map's edge, turns round the centre as it goes
//   and comes in to the duck from off the edge. Its distance from the centre runs evenly from
//   the node's to the duck's, plus a bow of `bump` (most halfway); its angle turns from the
//   node's to the duck's on a smoothstep, so it sets out and arrives square to the edge. From
//   the origin, which has no "out", it leaves WAY.swing to one side of the duck's line.
// - Its models: each way is tried both ways round the centre, at each of WAY.bumps, and the one
//   that crosses the fewest other footprints (each grown by WAY.clear) wins, then the shortest.
//   Every station's way crosses none (traffic.test).
// - In the duck's chunk, so the first load carries none of it: map.ts loads the chunk as the
//   first stray is due, and traffic.ts sends it once its way is known (StrayTo.way).

import { Vector3 } from 'three';
import type { StrayWay } from '../world/traffic';

/** A node as the way sees it: where it stands on the floor, its model's footprint there (world
 *  x and z, min then max; none: just its centre), and whether it's on screen. */
export interface Spot {
  id: string;
  x: number;
  z: number;
  box?: readonly [number, number, number, number];
  seen?: boolean;
}

/** How far from the duck a start in view is preferred; the bows tried and the clearance kept
 *  round each footprint (world units); the origin's swing off the duck's line (radians); and
 *  the samples a way is tried at and kept at, even in length. */
export const WAY = { near: 5, bumps: [0.8, 1.6, 2.4, 3.2, 4.4], clear: 0.2, swing: 0.7, samples: 240 } as const;

/** Where the stray sets out: `at` (the station the camera is at, or null), else a node in view. */
export function strayStart(at: string | null, spots: readonly Spot[], duck: Spot, random: () => number = Math.random): string {
  if (at !== null && at !== duck.id && spots.some((s) => s.id === at)) return at;
  const seen = spots.filter((s) => s.seen && s.id !== duck.id);
  const far = seen.filter((s) => Math.hypot(s.x - duck.x, s.z - duck.z) >= WAY.near);
  const pool = far.length ? far : seen;
  return pool.length ? pool[Math.floor(random() * pool.length)]!.id : 'origin';
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The stray's way from `from` to `duck` at height `y`, clear of the other `spots`' footprints if it can be. */
export function strayWay(from: Spot, duck: Spot, spots: readonly Spot[], y: number): StrayWay {
  const ra = Math.hypot(from.x, from.z);
  const rb = Math.hypot(duck.x, duck.z);
  const tb = Math.atan2(duck.z, duck.x);
  const turns: [number, number][] = [];
  if (ra > 0.01) {
    const ta = Math.atan2(from.z, from.x);
    const short = Math.atan2(Math.sin(tb - ta), Math.cos(tb - ta));
    turns.push([ta, short], [ta, short - Math.sign(short || 1) * 2 * Math.PI]);
  } else turns.push([tb + WAY.swing, -WAY.swing], [tb - WAY.swing, WAY.swing]);
  const n = WAY.samples;
  const near = spots
    .filter((s) => s.id !== from.id && s.id !== duck.id)
    .map((s) => s.box ?? [s.x, s.z, s.x, s.z])
    .map(([x0, z0, x1, z1]) => [x0 - WAY.clear, z0 - WAY.clear, x1 + WAY.clear, z1 + WAY.clear]);
  let best: Vector3[] = [];
  let score = Infinity;
  for (const [a, turn] of turns)
    for (const bump of WAY.bumps) {
      const pts: Vector3[] = [];
      let length = 0;
      let hits = 0;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const r = ra + (rb - ra) * t + bump * Math.sin(Math.PI * t);
        const th = a + turn * smooth(t);
        const p = new Vector3(r * Math.cos(th), y, r * Math.sin(th));
        if (i) length += p.distanceTo(pts[i - 1]!);
        if (near.some(([x0, z0, x1, z1]) => p.x >= x0! && p.x <= x1! && p.z >= z0! && p.z <= z1!)) hits++;
        pts.push(p);
      }
      if (hits * 1000 + length < score) {
        score = hits * 1000 + length;
        best = pts;
      }
    }
  // Even in length: n equal steps along it.
  const even: Vector3[] = [best[0]!.clone()];
  const total = best.reduce((sum, p, i) => sum + (i ? p.distanceTo(best[i - 1]!) : 0), 0);
  let i = 1;
  let done = 0;
  for (let k = 1; k < n; k++) {
    const want = (total * k) / n;
    let step = best[i]!.distanceTo(best[i - 1]!);
    while (done + step < want && i < n) {
      done += step;
      i++;
      step = best[i]!.distanceTo(best[i - 1]!);
    }
    even.push(new Vector3().lerpVectors(best[i - 1]!, best[i]!, step ? (want - done) / step : 0));
  }
  even.push(best[n]!.clone());
  return {
    from: from.id,
    length: total,
    point(u, out) {
      const f = Math.min(Math.max(u, 0), 1) * n;
      const k = Math.min(Math.floor(f), n - 1);
      return out.lerpVectors(even[k]!, even[k + 1]!, f - k);
    },
  };
}
