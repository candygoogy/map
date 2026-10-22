// Zoom and pan (the owner's test notes; decided 2026-10-22 morning): the overview at zoom z looking
// at a floor point, zoomed about another floor point as a scaling about it (scaleAbout), the
// wheel's and keys' ease (easeZoom), and a pan's glide on release: the drag's speed over its last
// moments (flingVelocity), capped (capSpeed), decaying (glideStep).

import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { diveDuration } from '../../src/camera/director';
import { capSpeed, easeZoom, flingVelocity, glideStep, scaleAbout } from '../../src/input/zoom';
import { tuning } from '../../src/tuning';

describe('scaleAbout', () => {
  // The overview's camera, its target and its offset from it.
  const position = new Vector3(3.5, 24.6, 33.4);
  const target = new Vector3(-0.09, 0, 2.78);
  const off = position.clone().sub(target);
  /** The camera at zoom z looking at t: t + z·off. */
  const camera = (t: Vector3, z: number) => t.clone().addScaledVector(off, z);

  test("the floor point zoomed about keeps its place on the screen: the camera keeps its direction to it, the zoom's share as far", () => {
    for (const [z, z2] of [
      [1, 0.7],
      [0.8, 0.6],
      [0.6, 0.9], // zooming out
      [0.5, 0.25],
    ] as const) {
      const t = new Vector3(1, 0, 2);
      const p = new Vector3(-3, 0, 5);
      const from = camera(t, z);
      const t2 = scaleAbout(t.clone(), p, z, z2);
      const to = camera(t2, z2);
      const a = p.clone().sub(from);
      const b = p.clone().sub(to);
      expect(a.clone().normalize().distanceTo(b.clone().normalize()), `${z} → ${z2}`).toBeLessThan(1e-12);
      expect(b.length() / a.length()).toBeCloseTo(z2 / z, 12);
      expect(t2.y).toBe(0); // still on the floor
    }
  });

  test('two zooms are one: z → z2 → z3 about the same point is z → z3 about it', () => {
    const p = new Vector3(4, 0, -2);
    const t = new Vector3(0.5, 0, 1.5);
    const twice = scaleAbout(scaleAbout(t.clone(), p, 1, 0.7), p, 0.7, 0.4);
    const once = scaleAbout(t.clone(), p, 1, 0.4);
    expect(twice.distanceTo(once)).toBeLessThan(1e-12);
  });

  test('about the target itself, or to the same zoom, the target stays', () => {
    const t = new Vector3(2, 0, 1);
    expect(scaleAbout(t.clone(), t, 0.8, 0.5).distanceTo(t)).toBeLessThan(1e-12);
    expect(scaleAbout(t.clone(), new Vector3(9, 0, 9), 0.6, 0.6).distanceTo(t)).toBeLessThan(1e-12);
  });
});

describe('the glide', () => {
  test('flingVelocity: the speed over the last window; nothing once held still that long', () => {
    const w = tuning.pan.window;
    const samples = [0, 1, 2, 3, 4, 5].map((i) => ({ t: i * 0.02, x: i * 0.1, z: -i * 0.05 })); // 5 and −2.5 units a second
    const [vx, vz] = flingVelocity(samples, 0.1, w);
    expect(vx).toBeCloseTo(5, 6);
    expect(vz).toBeCloseTo(vx * -0.5, 9);
    expect(flingVelocity(samples, 0.1 + w + 0.01, w)).toEqual([0, 0]); // held still before letting go
    expect(flingVelocity([], 1, w)).toEqual([0, 0]);
    expect(flingVelocity([{ t: 1, x: 2, z: 2 }], 1, w)).toEqual([0, 0]); // one sample: no speed
  });

  test('flingVelocity only looks at the window: an early fast stretch, then slow, flings slow', () => {
    const w = 0.08;
    const samples = [
      { t: 0, x: 0, z: 0 },
      { t: 0.02, x: 1, z: 0 }, // fast, long ago
      { t: 0.2, x: 1.1, z: 0 },
      { t: 0.24, x: 1.2, z: 0 },
      { t: 0.28, x: 1.3, z: 0 },
    ];
    const [vx] = flingVelocity(samples, 0.28, w);
    expect(vx).toBeCloseTo(2.5, 6); // 0.2 over the last 0.08
  });

  test('capSpeed keeps the direction and holds the length', () => {
    expect(capSpeed([3, 4], 10)).toEqual([3, 4]);
    const [x, z] = capSpeed([30, 40], 10);
    expect(Math.hypot(x, z)).toBeCloseTo(10, 12);
    expect(x / z).toBeCloseTo(0.75, 12);
  });

  test('glideStep: decays at the time constant, goes speed × tau in all, however the time is cut', () => {
    const tau = tuning.pan.glide;
    const total = (dt: number, n: number) => {
      let [vx, vz, x, z] = [2, -1, 0, 0];
      for (let i = 0; i < n; i++) {
        const [dx, dz, nvx, nvz] = glideStep(vx, vz, dt, tau);
        x += dx;
        z += dz;
        [vx, vz] = [nvx, nvz];
      }
      return { x, z, vx, vz };
    };
    const a = total(1 / 60, 60);
    const b = total(1 / 30, 30);
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.z).toBeCloseTo(b.z, 12);
    expect(a.vx).toBeCloseTo(2 * Math.exp(-1 / tau), 12);
    const far = total(1 / 60, 600);
    expect(far.x).toBeCloseTo(2 * tau, 9);
    expect(far.z).toBeCloseTo(-tau, 9);
    // Short and damped: 95% of it within 3 tau, under half a second.
    expect(3 * tau).toBeLessThan(0.5);
    expect(total(1 / 60, Math.round(3 * tau * 60)).x / far.x).toBeGreaterThan(0.94);
  });

  test('its numbers: a short coast, at most maxSpeed × glide of the camera distance', () => {
    expect(tuning.pan.maxSpeed * tuning.pan.glide).toBeLessThan(0.3);
    expect(tuning.pan.stop).toBeLessThan(tuning.pan.maxSpeed / 20);
    expect(tuning.pan.window).toBeGreaterThan(0.04);
    expect(tuning.pan.twistDeg).toBeGreaterThan(3);
  });
});

describe('easeZoom', () => {
  test('eases towards the goal at the time constant, and lands on it', () => {
    const tau = tuning.zoom.ease;
    expect(easeZoom(1, 0.5, tau)).toBeCloseTo(0.5 + 0.5 * Math.exp(-1), 12);
    let z = 1;
    let frames = 0;
    while (z !== 0.5 && frames < 600) {
      const next = easeZoom(z, 0.5, 1 / 60);
      expect(next).toBeLessThan(z); // never overshoots, never stalls
      expect(next).toBeGreaterThanOrEqual(0.5);
      z = next;
      frames++;
    }
    expect(z).toBe(0.5);
    expect(frames / 60).toBeLessThan(tau * 12); // done in well under a second
  });

  test('its range is the composed overview in to about a quarter of its distance (4x)', () => {
    expect(tuning.zoom.min).toBe(0.25);
    // A mouse wheel's notch (about 100 px) and a key press each zoom a step about as big as at 2x
    // (14% and 16% a step then), so the deeper end takes more of them, never a jump.
    const notch = 1 - Math.exp(-100 * tuning.zoom.wheel);
    const press = 1 - tuning.zoom.key;
    expect(notch).toBeGreaterThan(0.13);
    expect(notch).toBeLessThan(0.18);
    expect(press).toBeGreaterThan(0.15);
    expect(press).toBeLessThan(0.2);
    const notches = Math.log(tuning.zoom.min) / Math.log(1 - notch);
    const presses = Math.log(tuning.zoom.min) / Math.log(1 - press);
    expect(notches).toBeGreaterThan(6);
    expect(notches).toBeLessThan(9);
    expect(presses).toBeGreaterThan(6);
    expect(presses).toBeLessThan(9);
  });

  test('the ease takes a notch to its goal in under half a second, down to the clamp', () => {
    let z = 0.28;
    const goal = Math.max(z * Math.exp(-100 * tuning.zoom.wheel), tuning.zoom.min);
    expect(goal).toBe(tuning.zoom.min);
    let t = 0;
    while (z !== goal && t < 2) {
      z = easeZoom(z, goal, 1 / 60);
      t += 1 / 60;
    }
    expect(z).toBe(tuning.zoom.min);
    expect(t).toBeLessThan(0.5);
  });
});

describe('diveDuration', () => {
  test('is flightDive up to a 20° turn, and up to diveLonger more for a half turn', () => {
    expect(diveDuration(0)).toBe(tuning.flightDive);
    expect(diveDuration(-20)).toBe(tuning.flightDive);
    expect(diveDuration(180)).toBeCloseTo(tuning.flightDive * (1 + tuning.turn.diveLonger), 12);
    expect(diveDuration(-90)).toBeCloseTo(diveDuration(90), 12);
    expect(diveDuration(90)).toBeGreaterThan(tuning.flightDive);
    expect(diveDuration(90)).toBeLessThan(diveDuration(180));
  });
});
