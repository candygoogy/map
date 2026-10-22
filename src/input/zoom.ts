// Zoom and pan (the owner's test notes, 2026-10-22 morning): the overview
// only, by the wheel, `+` `-`, a drag on the floor and two fingers. A lazy chunk
// (moments/load.ts), fetched as the arrival ends in the overview, or else on the first wheel,
// pinch, key, press or floor drag there; map.ts keeps the listeners, which must answer at once
// (preventDefault).
//
// The director holds the view as a zoom z (a share of the fitted overview's distance) and the
// floor point the camera looks at (director.ts, viewTo), kept within reach of the network. Every
// move here holds a floor point where it is on the screen:
//
// - The wheel: zooms towards the floor point under the pointer, tuning.zoom.wheel a CSS px of
//   wheel travel, eased over tuning.zoom.ease (the point stays under the pointer as it eases): the
//   view scaled about that point (scaleAbout). Ctrl with the wheel (the browser's zoom, and a
//   trackpad's pinch) is the browser's: map.ts leaves it.
// - `+` `-`: towards the view's centre, tuning.zoom.key a press, eased the same way.
// - A drag (pan): the floor point grabbed stays under the pointer (the target moved by what lies
//   between it and the point under the pointer now). Let go, it glides on at the drag's speed
//   over its last tuning.pan.window, capped, decaying over tuning.pan.glide (flingVelocity,
//   glideStep); none with motion reduced, and any new gesture stops it.
// - Two fingers: the distance between them scales the view from where it was as they landed,
//   their twist turns it once past tuning.pan.twistDeg (then 1:1), and the floor point under
//   their middle as they landed stays under their middle: pinch, twist and pan together, no
//   easing, the fingers lead.
// - Reduced motion: the wheel and the keys zoom at once, without easing.
// - Wherever it's moved, the view's centre is kept within tuning.pan.margin of the network's
//   convex hull (hullOf, clampToHull), at any zoom and turn: the chunk hands the director that
//   clamp as it comes in (director.bound), so the first pan is already held by it.
// - It carries the pulls' ring stop as well (clearOf, nodes.clearWith; the owner, 2026-10-22
//   morning: a pulled model stops at its neighbours' ground rings): map.ts asks for the chunk as
//   the arrival ends in the overview, so it's in before the first pull (a mouse pulls at once),
//   and again on the first press on the canvas there (a deep link's arrival ends at a station).
// - And the phone's start: after the arrival plays out on the composed overview, map.ts asks it
//   to ease in to the director's home view (start), over tuning.zoom.phoneEase.
//
// Like the moments, it imports three.js's types only and takes its vectors from the runtime's
// (director.look is a fresh one): a value import here split three.core out of the runtime,
// 2.2 kB more on the first load (budget.test).

import type { Vector3 } from 'three';
import type { Director } from '../camera/director';
import type { Nodes } from '../world/nodes';
import { easeInOutCubic } from '../motion/ease';
import { prefs } from '../motion/prefs';
import type { Clock } from '../stage/clock';
import type { Stage } from '../stage/stage';
import { tuning } from '../tuning';
import type { Point } from './pointer';

const DEG = Math.PI / 180;

/** The zoom's next value, eased from `z` towards `goal` over dt seconds (tuning.zoom.ease); `goal` once within 1e-4. */
export function easeZoom(z: number, goal: number, dt: number): number {
  const next = goal + (z - goal) * Math.exp(-dt / tuning.zoom.ease);
  return Math.abs(next - goal) < 1e-4 ? goal : next;
}

/**
 * The target a view looking at `target` from zoom z has at zoom z2, scaled about the floor point
 * `about` (so that point keeps its place on the screen): about + (z2 / z)(target − about). Into
 * `target`; returns it.
 */
export function scaleAbout(target: Vector3, about: Vector3, z: number, z2: number): Vector3 {
  return target.sub(about).multiplyScalar(z2 / z).add(about);
}

/** Where the view's target was, and when (seconds), as a drag moved it. */
export type Sample = { t: number; x: number; z: number };

/**
 * A drag's speed over the floor as it lets go at `now` (seconds): from the samples of the last
 * `window` seconds, x and z units a second. Nothing if it was held still for that long first.
 */
export function flingVelocity(samples: readonly Sample[], now: number, window: number = tuning.pan.window): [number, number] {
  const last = samples.at(-1);
  if (!last || now - last.t > window) return [0, 0];
  let first = last;
  for (let i = samples.length - 2; i >= 0 && now - samples[i]!.t <= window; i--) first = samples[i]!;
  const dt = Math.max(now - first.t, 1e-3);
  return [(last.x - first.x) / dt, (last.z - first.z) / dt];
}

/** A speed held to `max` units a second (its direction kept). */
export function capSpeed([vx, vz]: [number, number], max: number): [number, number] {
  const v = Math.hypot(vx, vz);
  return v > max ? [(vx * max) / v, (vz * max) / v] : [vx, vz];
}

/**
 * One step of a glide at speed (vx, vz), dt seconds, decaying with the time constant `tau`:
 * how far it goes in that step and its speed after, [dx, dz, vx, vz]. Steps add up to the same
 * however the time is cut, and the whole glide goes speed × tau.
 */
export function glideStep(vx: number, vz: number, dt: number, tau: number = tuning.pan.glide): [number, number, number, number] {
  const k = Math.exp(-dt / tau);
  const s = tau * (1 - k);
  return [vx * s, vz * s, vx * k, vz * k];
}

/** A point on the floor, x and z. */
export type Flat = readonly [number, number];

/** The convex hull of the points on the floor (x, z), anticlockwise from the lowest x; monotone chain. */
export function hullOf(points: readonly Vector3[]): Flat[] {
  const ps = points.map((p): Flat => [p.x, p.z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (ps.length < 3) return ps;
  const cross = (o: Flat, a: Flat, b: Flat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (from: Flat[]): Flat[] => {
    const h: Flat[] = [];
    for (const p of from) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(ps), ...half([...ps].reverse())];
}

/**
 * The pan's clamp (director.bound): `p` (x and z, its y left alone) kept within
 * `margin` of the floor's convex `hull` (hullOf): left alone inside, else moved straight to that
 * distance from the hull's nearest point. Into `p`; returns it.
 */
export function clampToHull(p: Vector3, hull: readonly Flat[], margin: number): Vector3 {
  const n = hull.length;
  if (n === 0) return p;
  let inside = n >= 3;
  let best = Infinity;
  let bx = hull[0]![0];
  let bz = hull[0]![1];
  for (let i = 0; i < n; i++) {
    const [ax, az] = hull[i]!;
    const [cx, cz] = hull[(i + 1) % n]!;
    const ex = cx - ax;
    const ez = cz - az;
    if (ex * (p.z - az) - ez * (p.x - ax) < 0) inside = false; // right of an anticlockwise edge: outside
    const len = ex * ex + ez * ez;
    const t = len > 0 ? Math.min(Math.max(((p.x - ax) * ex + (p.z - az) * ez) / len, 0), 1) : 0;
    const qx = ax + ex * t;
    const qz = az + ez * t;
    const d = Math.hypot(p.x - qx, p.z - qz);
    if (d < best) [best, bx, bz] = [d, qx, qz];
  }
  if (inside || best <= margin) return p;
  const k = margin / best;
  return p.set(bx + (p.x - bx) * k, p.y, bz + (p.z - bz) * k);
}

/**
 * The pulls' ring stop (nodes.clearWith): a pull's way on the floor (x, z), from `from` (where
 * it is, clear) towards `to`, kept outside a ring of radius `r` round each of `others` (the
 * owner, 2026-10-22 morning: a pulled model stops at its neighbours' ground rings, so no two ever
 * overlap). It stops where its way first meets a ring and slides on round it with the rest of the
 * move, so it never jumps through one, then is pushed straight out of any it still ends in;
 * wedged where two rings overlap, it stays where it was. `round` (a release springing home): a
 * move straight into a ring, which would stop dead there, goes round it instead, the same length
 * along it, so the way home always gets there. With `v` (the model's speed), its part into a ring
 * it ends on is taken off. Into `to` (y left alone); returns it.
 */
export function clearOf(from: Vector3, to: Vector3, others: readonly Vector3[], r: number, round = false, v?: Vector3): Vector3 {
  let fx = from.x;
  let fz = from.z;
  let px = to.x;
  let pz = to.z;
  for (let pass = 0; pass < 3; pass++) {
    const ex = px - fx;
    const ez = pz - fz;
    const a = ex * ex + ez * ez;
    if (a < 1e-12) break;
    let first = 1;
    let hit: Vector3 | null = null;
    for (const c of others) {
      const ox = fx - c.x;
      const oz = fz - c.z;
      const b = ox * ex + oz * ez;
      const cc = ox * ox + oz * oz - r * r;
      const disc = b * b - a * cc;
      if (cc < 0 || b >= 0 || disc <= 0) continue; // already in (pushed out below), heading away, or passing by
      const t = (-b - Math.sqrt(disc)) / a;
      if (t < first) [first, hit] = [t, c];
    }
    if (!hit) break;
    fx += ex * first;
    fz += ez * first;
    // The rest of the move, less its part into the ring: along the ring's tangent there.
    const nx = (fx - hit.x) / r;
    const nz = (fz - hit.z) / r;
    const rx = px - fx;
    const rz = pz - fz;
    const into = Math.min(rx * nx + rz * nz, 0);
    px -= nx * into;
    pz -= nz * into;
    const along = Math.hypot(px - fx, pz - fz);
    const rest = Math.hypot(rx, rz);
    if (round && along < 0.2 * rest) {
      // Head on: round the ring on the side the move leans to (either, dead straight).
      const side = nx * rz - nz * rx >= 0 ? 1 : -1;
      px = fx - nz * side * rest;
      pz = fz + nx * side * rest;
    }
  }
  const into = (x: number, z: number) => others.find((c) => Math.hypot(x - c.x, z - c.z) < r - 1e-9);
  for (let pass = 0, c = into(px, pz); c && pass < 4; pass++, c = into(px, pz)) {
    const d = Math.hypot(px - c.x, pz - c.z);
    const [ux, uz] = d > 1e-9 ? [(px - c.x) / d, (pz - c.z) / d] : [1, 0];
    px = c.x + ux * r;
    pz = c.z + uz * r;
  }
  // Wedged where two rings overlap (no way between them): it stays where it was, if that's clear.
  if (into(px, pz) && !into(from.x, from.z)) [px, pz] = [from.x, from.z];
  for (const c of v ? others : []) {
    const nx = (px - c.x) / r;
    const nz = (pz - c.z) / r;
    const into = v!.x * nx + v!.z * nz;
    if (Math.hypot(px - c.x, pz - c.z) <= r + 1e-6 && into < 0) {
      v!.x -= nx * into;
      v!.z -= nz * into;
    }
  }
  to.x = px;
  to.z = pz;
  return to;
}

/** Degrees in (−180, 180]. */
const wrap = (a: number) => a - 360 * Math.ceil((a - 180) / 360);

export interface Zoom {
  /** A wheel event over the map (map.ts has prevented its default). */
  wheel(e: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'clientX' | 'clientY'>): void;
  /** `+` (1) or `-` (−1). */
  key(dir: 1 | -1): void;
  /** Two fingers (client px), on each move; null as one lifts. */
  pinch(a: Point | null, b?: Point): void;
  /** A drag on the floor: where it was pressed and where it is (client px), on each move; null as it lets go. */
  pan(from: Point | null, to?: Point): void;
  /** The phone's start: from the composed overview the arrival ends on, eased in to the home view. */
  start(): void;
  dispose(): void;
}

export function createZoom(
  stage: Pick<Stage, 'camera' | 'renderer' | 'viewport' | 'inset'>,
  director: Director,
  clock: Pick<Clock, 'add'>,
  nodes?: Pick<Nodes, 'clearWith'>,
): Zoom {
  const canvas = stage.renderer.domElement;
  const camera = stage.camera;
  const anchor = director.look; // a fresh one each time
  const at = director.look;
  let goal = 1;
  let offEase: (() => void) | null = null;
  let offGlide: (() => void) | null = null;
  let glide: [number, number] = [0, 0];
  let fingers: { d: number; angle: number; z: number; turn: number; anchor: Vector3; twisting: boolean } | null = null;
  let grab: { anchor: Vector3; samples: Sample[] } | null = null;
  const overview = () => director.state === 'overview';
  const clampZ = (z: number) => Math.min(Math.max(z, tuning.zoom.min), 1);
  const now = () => performance.now() / 1000;
  // The view's centre kept within tuning.pan.margin of the shown nodes' hull, from now on.
  let hull: Flat[] | null = null;
  director.bound((t, points) => void clampToHull(t, (hull ??= hullOf(points)), tuning.pan.margin));
  nodes?.clearWith(clearOf);

  /** The floor point under client (x, y), or, where the ray misses the floor, what the view looks at. */
  function under(x: number, y: number, out: Vector3): Vector3 {
    const r = canvas.getBoundingClientRect();
    out.set(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2, 0.5).unproject(camera).sub(camera.position);
    if (out.y >= -1e-6) return out.copy(director.look); // at or above the horizon
    return out.multiplyScalar(-camera.position.y / out.y).add(camera.position);
  }

  /** Zooms to z2 keeping floor point `about` where it is on the screen; false outside the overview. */
  function scaleTo(z2: number, about: Vector3): boolean {
    const z = director.zoom;
    const to = clampZ(z2);
    // By the camera's distances, not the zooms: turned and a little zoomed, the distance isn't
    // quite in step with the zoom (director.ts, zoomedReach).
    return director.viewTo(to, scaleAbout(director.look, about, director.distanceAt(z), director.distanceAt(to)));
  }

  /** Pans so that floor point `p` is under client (x, y) again. */
  function holdUnder(p: Vector3, x: number, y: number): boolean {
    under(x, y, at);
    return director.viewTo(director.zoom, director.look.add(p).sub(at));
  }

  function stopEase(): void {
    offEase?.();
    offEase = null;
  }

  function stopGlide(): void {
    offGlide?.();
    offGlide = null;
  }

  function easeTick(dt: number): boolean {
    const next = easeZoom(director.zoom, goal, dt);
    if (!scaleTo(next, anchor) || next === goal) {
      stopEase();
      return false;
    }
    return true;
  }

  /** Towards `goal` about `anchor`: at once with motion reduced, else eased on the clock. */
  function towards(z: number): void {
    stopGlide();
    if (!offEase) goal = director.zoom; // a fresh start (travel may have reset it)
    goal = clampZ(goal * z);
    if (prefs.reduced) {
      scaleTo(goal, anchor);
      return;
    }
    offEase ??= clock.add(easeTick);
  }

  /** The camera's distance from what it looks at: a glide's speeds are shares of it, so it looks the same at any zoom. */
  const reach = () => camera.position.distanceTo(director.look);

  function glideTick(dt: number): boolean {
    const [dx, dz, vx, vz] = glideStep(glide[0], glide[1], dt);
    glide = [vx, vz];
    const from = director.look;
    const want = from.clone().set(from.x + dx, from.y, from.z + dz);
    const went = director.viewTo(director.zoom, want) ? director.look.distanceTo(from) : 0;
    // Stopped by the network's edge, or slowed to nothing: done.
    if (went < 0.5 * Math.hypot(dx, dz) || Math.hypot(vx, vz) < tuning.pan.stop * reach()) {
      stopGlide();
      return false;
    }
    return true;
  }

  /** Eases the view from where it is to the overview's home over tuning.zoom.phoneEase; any gesture ends it. */
  function start(): void {
    const from = director.look;
    const z0 = director.zoom;
    const { zoom: z1, target } = director.home;
    let t = 0;
    stopGlide();
    offGlide = clock.add((dt) => {
      t = Math.min(t + dt / tuning.zoom.phoneEase, 1);
      const e = easeInOutCubic(t);
      if (!director.viewTo(z0 + (z1 - z0) * e, at.lerpVectors(from, target, e)) || t >= 1) {
        stopGlide();
        return false;
      }
      return true;
    });
  }

  function letGo(): void {
    const g = grab;
    grab = null;
    director.hold(false);
    if (!g || prefs.reduced || !overview()) return;
    const r = reach();
    const v = capSpeed(flingVelocity(g.samples, now()), tuning.pan.maxSpeed * r);
    if (Math.hypot(v[0], v[1]) < tuning.pan.stop * r) return;
    glide = v;
    offGlide ??= clock.add(glideTick);
  }

  return {
    wheel(e) {
      if (!overview()) return;
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.viewport.height : 1);
      under(e.clientX, e.clientY, anchor);
      towards(Math.exp(px * tuning.zoom.wheel));
    },
    key(dir) {
      if (!overview()) return;
      anchor.copy(director.look);
      towards(dir > 0 ? tuning.zoom.key : 1 / tuning.zoom.key);
    },
    start,
    pan(from, to) {
      if (!from || !to) return letGo();
      if (!overview()) {
        grab = null;
        return;
      }
      if (!grab) {
        stopEase();
        stopGlide();
        grab = { anchor: under(from.x, from.y, director.look), samples: [] };
        director.hold(true);
      }
      holdUnder(grab.anchor, to.x, to.y);
      const t = director.look;
      const s = grab.samples;
      s.push({ t: now(), x: t.x, z: t.z });
      if (s.length > 32) s.splice(0, s.length - 32);
    },
    pinch(a, b) {
      if (!a || !b || !overview()) {
        fingers = null;
        return;
      }
      const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (!fingers) {
        stopEase(); // the fingers take over from an ease, or a glide
        stopGlide();
        fingers = { d, angle, z: director.zoom, turn: director.turn, anchor: under(mx, my, director.look), twisting: false };
        return;
      }
      const f = fingers;
      // The twist, clockwise on the screen turning the map clockwise with it: a positive turn.
      let twist = wrap((angle - f.angle) / DEG);
      if (!f.twisting && Math.abs(twist) >= tuning.pan.twistDeg) {
        f.twisting = true;
        f.angle += Math.sign(twist) * tuning.pan.twistDeg * DEG; // from here, so it doesn't jump
        twist = wrap((angle - f.angle) / DEG);
      }
      const by = f.twisting ? wrap(f.turn + twist - director.turn) : 0;
      if (by !== 0) director.turnBy(-by / tuning.turn.keyDeg);
      goal = clampZ((f.z * f.d) / d);
      director.viewTo(goal, director.look);
      holdUnder(f.anchor, mx, my);
    },
    dispose() {
      director.bound(null);
      nodes?.clearWith(null);
      stopEase();
      stopGlide();
      if (grab) director.hold(false);
      grab = null;
    },
  };
}
