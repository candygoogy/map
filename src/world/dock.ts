// Where the gondola docks on a link (visitor.ts): pure geometry on the authored curve, apart
// from the visitor's runtime so the e2e tests can import it without the model loader.

import { type Curve, Vector3 } from 'three';
import { clamp01 } from '../motion/ease';
import { tuning } from '../tuning';

/** dockDistance searches in steps this long, then halves the last one 16 times. */
const DOCK_STEP = 0.02;
const docks = new WeakMap<Curve<Vector3>, Map<string, number>>();
const probe = new Vector3();

/**
 * Where on a link the gondola docks (from 'node': its distance from the node's end), or would
 * clear the floor by the hub (from 'hub': from the hub's end; it parks on the turnaround, at
 * linkMast, since 2026-10-20, and the unit test checks that's as far out): the nearest point at least
 * tuning.visitorDock from that end where the line is `clear` over the floor (y 0), so the
 * cabin hanging under it clears the floor. Half the link at most. Cached per curve, so it's
 * the authored curve's (links.curve): a pulled link keeps its rest dock.
 */
export function dockDistance(
  curve: Curve<Vector3>,
  from: 'node' | 'hub',
  clear = tuning.visitorDrop + tuning.visitorDockGap,
): number {
  const key = `${from} ${clear}`;
  let cached = docks.get(curve);
  const hit = cached?.get(key);
  if (hit !== undefined) return hit;
  const L = curve.getLength();
  const half = L / 2;
  const high = (d: number) => curve.getPointAt(clamp01(from === 'node' ? (L - d) / L : d / L), probe).y >= clear;
  let d = Math.min(tuning.visitorDock, half);
  if (!high(d)) {
    let lo = d;
    while (d < half && !high(d)) {
      lo = d;
      d = Math.min(d + DOCK_STEP, half);
    }
    if (high(d)) {
      for (let i = 0; i < 16; i++) {
        const mid = (lo + d) / 2;
        if (high(mid)) d = mid;
        else lo = mid;
      }
    }
  }
  if (!cached) docks.set(curve, (cached = new Map()));
  cached.set(key, d);
  return d;
}

/** Where the gondola docks on a node's link (dockDistance from the node), on the curve, and the
 *  way the link runs there across the floor (unit): its cabin hangs along it (cable.ts keeps its
 *  lines off that cabin's plan). */
export function dockPose(curve: Curve<Vector3>): { at: Vector3; dir: Vector3 } {
  const L = curve.getLength();
  const t = clamp01((L - dockDistance(curve, 'node')) / L);
  return { at: curve.getPointAt(t, new Vector3()), dir: curve.getTangentAt(t, new Vector3()).setY(0).normalize() };
}
