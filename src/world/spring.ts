// Springs for hover and pull ("custom springs, not a physics engine"). Mass 1, stiffness k,
// damping c, integrated by semi-implicit Euler (velocity first, then position with the new
// velocity), which keeps an undamped spring's energy bounded.
//
// It always steps at a fixed tuning.spring.step (1/120 s), whatever dt the frame brings: a
// single step at the clock's longest dt (0.1 s) is unstable with k = 170, c = 14 (one
// eigenvalue is about −1.39, so it grows after a tab switch). The part of dt too short for
// a whole step carries to the next call, kept on the state itself, so every spring keeps
// its own and the result doesn't depend on how a second was cut into frames.

import type { Vector3 } from 'three';
import { tuning } from '../tuning';

const STEP = tuning.spring.step;

export interface Spring {
  x: number;
  v: number;
  /** Time not yet stepped, under one STEP (managed by stepSpring). */
  carry?: number;
}

export interface Spring3 {
  x: Vector3;
  v: Vector3;
  carry?: number;
}

/** Whole steps owed after adding dt, leaving the remainder on `s.carry`. */
function steps(s: { carry?: number }, dt: number): number {
  const total = (s.carry ?? 0) + dt;
  const n = Math.floor(total / STEP + 1e-9);
  s.carry = Math.max(total - n * STEP, 0);
  return n;
}

/** Moves `s` towards `target` by dt seconds. */
export function stepSpring(s: Spring, target: number, dt: number, k: number = tuning.spring.k, c: number = tuning.spring.c): void {
  for (let n = steps(s, dt); n > 0; n--) {
    s.v += (k * (target - s.x) - c * s.v) * STEP;
    s.x += s.v * STEP;
  }
}

/**
 * The same per axis, for a point: allocates nothing. x and z (the floor plane) may take their
 * own constants, `kxz` and `cxz`: a dragged model follows the pointer on a stiffer spring
 * than its lift (tuning.dragFollow). They default to k and c.
 */
export function stepSpring3(
  s: Spring3,
  target: Vector3,
  dt: number,
  k: number = tuning.spring.k,
  c: number = tuning.spring.c,
  kxz: number = k,
  cxz: number = c,
): void {
  const { x, v } = s;
  for (let n = steps(s, dt); n > 0; n--) {
    v.x += (kxz * (target.x - x.x) - cxz * v.x) * STEP;
    v.y += (k * (target.y - x.y) - c * v.y) * STEP;
    v.z += (kxz * (target.z - x.z) - cxz * v.z) * STEP;
    x.x += v.x * STEP;
    x.y += v.y * STEP;
    x.z += v.z * STEP;
  }
}
