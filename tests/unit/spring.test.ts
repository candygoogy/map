import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { tuning } from '../../src/tuning';
import { clearOf } from '../../src/input/zoom';
import { stepSpring, stepSpring3 } from '../../src/world/spring';

describe('spring', () => {
  test('released from 2.5 it overshoots past 0 and settles within 0.001 by 1.5 s', () => {
    const s = { x: 2.5, v: 0 };
    let lowest = Infinity;
    for (let i = 0; i < 90; i++) {
      stepSpring(s, 0, 1 / 60);
      lowest = Math.min(lowest, s.x);
    }
    expect(lowest).toBeLessThan(0);
    expect(Math.abs(s.x)).toBeLessThan(0.001);
  });

  test('stable at dt 0.1: 100 steps of 0.1 s from 2.5 stay within ±2.5 and settle at 0', () => {
    const s = { x: 2.5, v: 0 };
    for (let i = 0; i < 100; i++) {
      stepSpring(s, 0, 0.1);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(2.5);
    }
    expect(Math.abs(s.x)).toBeLessThan(0.001);
    expect(Math.abs(s.v)).toBeLessThan(0.001);
  });

  test('ten 0.1 s calls match a thousand 0.001 s calls within 0.01', () => {
    const coarse = { x: 2.5, v: 0 };
    const fine = { x: 2.5, v: 0 };
    for (let i = 0; i < 10; i++) stepSpring(coarse, 0, 0.1);
    for (let i = 0; i < 1000; i++) stepSpring(fine, 0, 0.001);
    expect(Math.abs(coarse.x - fine.x)).toBeLessThan(0.01);
    expect(Math.abs(coarse.v - fine.v)).toBeLessThan(0.01);
  });

  // Motion audit #7: a dragged model follows the pointer on the floor with its own stiff,
  // critically damped spring, while its lift keeps the springy one.
  test('stepSpring3 can take its own constants for x and z: a drag follows without overshoot and the lift still pops', () => {
    const s = { x: new Vector3(), v: new Vector3() };
    const target = new Vector3(1, tuning.dragLift, 0);
    const { k, c } = tuning.dragFollow;
    let maxX = 0;
    let maxY = 0;
    let caught = Infinity;
    for (let i = 1; i <= 60; i++) {
      stepSpring3(s, target, 1 / 60, tuning.spring.k, tuning.spring.c, k, c);
      maxX = Math.max(maxX, s.x.x);
      maxY = Math.max(maxY, s.x.y);
      if (caught === Infinity && Math.abs(s.x.x - 1) < 0.02) caught = i / 60;
    }
    expect(maxX).toBeLessThanOrEqual(1 + 1e-3); // no overshoot on the floor
    expect(caught).toBeLessThan(0.25); // close behind the pointer
    expect(maxY).toBeGreaterThan(tuning.dragLift * 1.05); // the lift keeps its pop
  });
});

// The owner, 2026-10-22 morning: a pulled model stops at its neighbours' ground rings (nodes.ts
// keeps them 2 × tuning.groundRing apart, rings touching), on the way there and back.
describe('clearOf', () => {
  const r = 2 * tuning.groundRing;
  const at = (x: number, z: number) => new Vector3(x, 0, z);
  const gap = (p: Vector3, c: Vector3) => Math.hypot(p.x - c.x, p.z - c.z);

  test('a pull away from every ring goes where it was asked', () => {
    expect(clearOf(at(0, 0), at(1, 0.5), [at(5, 5)], r)).toEqual(at(1, 0.5));
  });

  test('a pull straight at a neighbour stops at its ring', () => {
    const n = at(2, 0);
    const to = clearOf(at(0, 0), at(2.2, 0), [n], r);
    expect(gap(to, n)).toBeCloseTo(r, 9);
    expect(to.x).toBeCloseTo(2 - r, 9);
    expect(to.z).toBeCloseTo(0, 9);
  });

  test('a pull past a neighbour never jumps through it: step by step, it slides round its ring', () => {
    const n = at(2, 0);
    let from = at(0, 0.1);
    for (let i = 1; i <= 40; i++) {
      const want = at(from.x + 0.1, from.z); // on along the line, through it
      const to = clearOf(from, want.clone(), [n], r);
      expect(gap(to, n), `step ${i}`).toBeGreaterThanOrEqual(r - 1e-9);
      expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeLessThanOrEqual(0.1 + 1e-9); // never more than the move
      from = to;
    }
    // A pointer leaning past it a little takes it round the top, on the side it leans to.
    expect(from.z).toBeGreaterThan(0);
  });

  test('a whole jump across a ring stops where its way meets the ring', () => {
    const n = at(2, 0);
    const to = clearOf(at(0, 0), at(4, 0), [n], r);
    expect(to.x).toBeCloseTo(2 - r, 9);
  });

  test('between two neighbours it keeps clear of both', () => {
    const a = at(1.5, 0.7);
    const b = at(1.5, -0.7);
    const to = clearOf(at(0, 0), at(3, 0), [a, b], r);
    expect(gap(to, a)).toBeGreaterThanOrEqual(r - 1e-9);
    expect(gap(to, b)).toBeGreaterThanOrEqual(r - 1e-9);
  });

  test('with the speed, its part into the ring it ends on comes off, the part along it stays', () => {
    const n = at(2, 0);
    const v = new Vector3(3, 0, 1);
    clearOf(at(0, 0), at(2.2, 0), [n], r, false, v);
    expect(v.x).toBeCloseTo(0, 9); // into the ring, straight on: gone
    expect(v.z).toBeCloseTo(1, 9);
    const away = new Vector3(-1, 0, 0);
    clearOf(at(0, 0), at(2.2, 0), [n], r, false, away);
    expect(away.x).toBe(-1); // away from it: kept
  });

  test('wedged where two rings overlap (no way between them), it stays where it was', () => {
    // homelab and the AP are 2.06 apart: their rings (1.2 each) overlap.
    const a = at(-5.2, 7.4);
    const b = at(-6.8, 6.1);
    let from = at(-6.55, 8.2); // the switch, pulled down between them and on
    for (let i = 1; i <= 30; i++) {
      const to = clearOf(from, at(from.x + 0.02, from.z - 0.12), [a, b], r);
      expect(gap(to, a), `step ${i}`).toBeGreaterThanOrEqual(r - 1e-9);
      expect(gap(to, b), `step ${i}`).toBeGreaterThanOrEqual(r - 1e-9);
      from = to;
    }
    expect(from.z).toBeGreaterThan(6.1); // never through
  });

  test('one that starts inside a ring is pushed straight out of it', () => {
    const n = at(0, 0);
    const to = clearOf(at(0.3, 0), at(0.3, 0), [n], r);
    expect(gap(to, n)).toBeCloseTo(r, 9);
    expect(to.z).toBeCloseTo(0, 9);
  });

  test('round (a release springing home): head on into a ring it goes round it, the move as long, so it gets home', () => {
    const n = at(1, 0);
    let p = at(2 + r, 0); // behind the neighbour, home at the origin, dead straight through it
    const home = at(-0.5, 0);
    for (let i = 0; i < 400 && gap(p, home) > 0.05; i++) {
      const d = Math.min(0.05, gap(p, home));
      const want = p.clone().add(home.clone().sub(p).setLength(d));
      const to = clearOf(p, want, [n], r, true);
      expect(gap(to, n)).toBeGreaterThanOrEqual(r - 1e-9);
      p = to;
    }
    expect(gap(p, home)).toBeLessThan(0.06);
    // Without `round` it would stop dead at the ring.
    const stuck = clearOf(at(1 + r, 0), at(1 + r - 0.05, 0), [n], r);
    expect(stuck.x).toBeCloseTo(1 + r, 9);
  });
});
