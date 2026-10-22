// Map rotation (approved by the owner 2026-10-20): a floor drag turns the view left and right, a
// station's framing about its own target within ±tuning.turn.stationDeg, slowing near the clamp,
// and the overview about the network's middle all the way round (decided 2026-10-21); the fit runs
// for the turned camera and only ever pulls back, holding every model's corners too, the overview's
// tuning.turn.gutterPx inside the visible area. At a turn of 0 every framing is exactly Blender's,
// as fitted today.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { corners, middleOf, overviewCamera, type Pose, stationCamera, turned, visibleRect, type Rect, type WorldCamera } from '../../src/camera/fit';
import { type DirPose, dockedBounds, turnLimit, unturnPose, unturnShare, wrapDeg } from '../../src/camera/director';
import world from '../../src/data/world.json';
import { clampToHull, hullOf } from '../../src/input/zoom';
import { HIDDEN } from '../../src/nav/stations';
import { linkCurve } from '../../src/data/layout';
import { panelInsetFor, type PanelInset } from '../../src/stage/stage';
import { tuning } from '../../src/tuning';
import { glbBounds } from './helpers/glb';

type Size = { width: number; height: number };
const DESKTOP: Size = { width: 1440, height: 900 };
const PHONE: Size = { width: 390, height: 844 };
const DEG = Math.PI / 180;

const positions = new Map(Object.entries(world.nodes).map(([id, [x, z]]) => [id, new Vector3(x, 0, z)]));
const floor = (id: string) => positions.get(id)!;
// The overview leaves a hidden node out of its fit, turned or not (the duck, Task 17), as the
// director does; its station framing is tested with the rest.
const shown = (id: string) => !HIDDEN.includes(id);
const points = [...positions].filter(([id]) => shown(id)).map(([, p]) => p);

const MODELS = join(import.meta.dirname, '..', '..', 'public', 'models');
let bounds: Promise<Map<string, Box3>> | null = null;
/** Every node's model as nodes.ts measures it (its own GLB, or the placeholder box; no floor shadow). */
function runtimeBounds(): Promise<Map<string, Box3>> {
  bounds ??= Promise.all(
    [...positions.keys()].map(async (id) => {
      const file = existsSync(join(MODELS, `${id}.glb`)) ? id : 'box';
      const b = await glbBounds(join(MODELS, `${file}.glb`), ['shadow']);
      return [id, new Box3(new Vector3(...b.min), new Vector3(...b.max))] as const;
    }),
  ).then((e) => new Map(e));
  return bounds;
}

function cameraFor(pose: Pose, vp: Size, inset: PanelInset): PerspectiveCamera {
  const cam = new PerspectiveCamera(pose.fovY, vp.width / vp.height, 0.1, 200);
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.setViewOffset(vp.width, vp.height, inset.right / 2, inset.bottom / 2, vp.width, vp.height);
  cam.updateMatrixWorld(true);
  return cam;
}

/** The points of `ps` that land outside `r` on the canvas (0.5 px of slack). */
function outside(ps: readonly Vector3[], cam: PerspectiveCamera, vp: Size, r: Rect): Vector3[] {
  return ps.filter((p) => {
    const n = p.clone().project(cam);
    const x = ((n.x + 1) / 2) * vp.width;
    const y = ((1 - n.y) / 2) * vp.height;
    return !(n.z < 1 && x >= r.x - 0.5 && x <= r.x + r.width + 0.5 && y >= r.y - 0.5 && y <= r.y + r.height + 0.5);
  });
}

/** `r` less `px` on every side. */
const inside = (r: Rect, px: number): Rect => ({ x: r.x + px, y: r.y + px, width: r.width - 2 * px, height: r.height - 2 * px });

/** A pose as a flight's: its direction, and its reach to its target. */
const dirOf = (p: Pose): DirPose => ({ position: p.position.clone(), forward: p.target.clone().sub(p.position).normalize(), reach: p.position.distanceTo(p.target) });

/** The horizontal angle (radians) from a's offset off its target to b's, positive about +y. */
function yawBetween(a: Pose, b: Pose): number {
  const oa = a.position.clone().sub(a.target);
  const ob = b.position.clone().sub(b.target);
  return Math.atan2(oa.z * ob.x - oa.x * ob.z, oa.x * ob.x + oa.z * ob.z);
}

describe('turned', () => {
  const cam = world.cameras.overview as WorldCamera;

  test('swings the camera about the vertical through its target: same target, height, distance and fov', () => {
    for (const deg of [-20, -5, 7, 20]) {
      const t = turned(cam, deg * DEG);
      expect(t.target).toEqual(cam.target);
      expect(t.fovY).toBe(cam.fovY);
      expect(t.position[1]).toBeCloseTo(cam.position[1]!, 12);
      const d = (c: WorldCamera) => Math.hypot(c.position[0]! - c.target[0]!, c.position[2]! - c.target[2]!);
      expect(d(t)).toBeCloseTo(d(cam), 12);
      const pose = (c: WorldCamera): Pose => ({ position: new Vector3(...c.position), target: new Vector3(...c.target), fovY: c.fovY });
      expect(yawBetween(pose(cam), pose(t))).toBeCloseTo(deg * DEG, 12);
    }
    expect(turned(cam, 0)).toBe(cam);
  });

  test('about another point, swings the target with the camera: same height, distance, pitch and fov', () => {
    const about = [1.5, 7, -2];
    const pose = (c: WorldCamera): Pose => ({ position: new Vector3(...c.position), target: new Vector3(...c.target), fovY: c.fovY });
    const flat = (v: Vector3) => Math.hypot(v.x - about[0]!, v.z - about[2]!);
    for (const deg of [-90, -5, 30, 180]) {
      const t = turned(cam, deg * DEG, about);
      const [a, b] = [pose(cam), pose(t)];
      expect(t.fovY).toBe(cam.fovY);
      expect(b.target.y).toBe(a.target.y);
      expect(b.position.y).toBe(a.position.y);
      expect(b.position.distanceTo(b.target)).toBeCloseTo(a.position.distanceTo(a.target), 12);
      expect(flat(b.target)).toBeCloseTo(flat(a.target), 12);
      expect(flat(b.position)).toBeCloseTo(flat(a.position), 12);
      expect(yawBetween(a, b)).toBeCloseTo(deg * DEG, 12);
    }
    expect(turned(cam, 0, about)).toBe(cam);
  });

  test('a positive turn moves the camera to its own right, as the drift does', () => {
    const t = turned(cam, 5 * DEG);
    const fwd = new Vector3(...cam.target).sub(new Vector3(...cam.position)).normalize();
    const right = fwd.clone().cross(new Vector3(0, 1, 0)).normalize();
    expect(new Vector3(...t.position).sub(new Vector3(...cam.position)).dot(right)).toBeGreaterThan(0);
  });
});

describe('the turned overview', () => {
  for (const [name, vp] of [
    ['1440×900', DESKTOP],
    ['390×844', PHONE],
  ] as const) {
    const inset = panelInsetFor(vp.width, vp.height, 'peek');
    const rest = overviewCamera(world, vp, inset, points);

    test(`at ${name}, a turn of 0 is the overview exactly as fitted today`, async () => {
      const own = await runtimeBounds();
      const cs = [...own].filter(([id]) => shown(id)).flatMap(([id, b]) => corners(b, floor(id)));
      const zero = overviewCamera(world, vp, inset, points, [], 0, cs);
      expect(zero).toEqual(rest);
    });

    const gutter = tuning.turn.gutterPx[+(vp.width >= tuning.panelMinViewportPx)]!;

    test(`at ${name}, turned all the way round it swings about the network's middle, only pulls back, and holds every node and model corner a gutter inside`, async () => {
      const own = await runtimeBounds();
      const cs = [...own].filter(([id]) => shown(id)).flatMap(([id, b]) => corners(b, floor(id)));
      const rect = visibleRect(vp, inset);
      const middle = middleOf(points);
      const flat = (v: Vector3) => Math.hypot(v.x - middle.x, v.z - middle.z);
      // Every 15°, the drift either side of the old ±20°, and a few more.
      const turns = [-22.5, -3, 3, 22.5, 177.5, -177.5];
      for (let deg = -180; deg <= 180; deg += 15) turns.push(deg);
      for (const deg of turns) {
        const fit = overviewCamera(world, vp, inset, points, [], deg * DEG, cs);
        expect(fit.camera).toBe(rest.camera);
        expect(fit.target.y).toBeCloseTo(rest.target.y, 12);
        expect(flat(fit.target), `${deg}°: the target swings about the middle`).toBeCloseTo(flat(rest.target), 9);
        expect(Math.abs(wrapDeg((yawBetween(rest, fit) - deg * DEG) / DEG))).toBeLessThan(1e-7);
        expect(fit.s, `${deg}°`).toBeGreaterThanOrEqual(rest.s - 1e-9);
        // The first measure of the turn found up to 8% (desktop, −20°). About the middle the
        // desktop's needs no more at any angle; the phone's tall overview seen side on pulls back up
        // to 1.23× (about −70°): the map's long side across the narrow screen, and its gutter.
        // The phone pass's P3c (2026-10-22) rests 6% nearer (66.4 from 70.9), so the same turned
        // view is a larger share of its rest: the cap is the old one's distance, 1.24 × 70.9 / 66.4
        // (P3c reaches 1.32×, 87.3, at −75°).
        const most = vp === PHONE ? 1.325 : 1.001;
        expect(fit.s / rest.s, `${deg}° pulls back too far`).toBeLessThan(most);
        // The gutter, eased in over gutterDeg (at 0° the authored view keeps it already).
        const px = gutter * Math.min(Math.abs(deg) / tuning.turn.gutterDeg, 1);
        const cam = cameraFor(fit, vp, inset);
        expect(outside(points, cam, vp, inside(rect, px)), `${deg}°: a node is within ${px} px of the edge`).toEqual([]);
        expect(outside(cs, cam, vp, inside(rect, px)).length, `${deg}°: a model corner is within ${px} px of the edge`).toBe(0);
      }
    });

    test(`at ${name}, side on it draws at most 1.21× smaller (the phone), or as composed (the desktop)`, async () => {
      const own = await runtimeBounds();
      const cs = [...own].filter(([id]) => shown(id)).flatMap(([id, b]) => corners(b, floor(id)));
      for (const deg of [-90, 90, 270]) {
        const fit = overviewCamera(world, vp, inset, points, [], deg * DEG, cs);
        // The phone: 1.29× of P3c's rest (66.4) is 85.7, within the 1.21× of the old rest (70.9).
        expect(fit.s / rest.s, `${deg}°`).toBeLessThanOrEqual(vp === PHONE ? 1.29 : 1 + 1e-9);
      }
    });

    test(`at ${name}, the pull back follows the turn smoothly: no step from one tenth of a degree to the next`, async () => {
      const own = await runtimeBounds();
      const cs = [...own].filter(([id]) => shown(id)).flatMap(([id, b]) => corners(b, floor(id)));
      let last = overviewCamera(world, vp, inset, points, [], -180 * DEG, cs).s;
      for (let i = -1799; i <= 1800; i++) {
        const s = overviewCamera(world, vp, inset, points, [], (i / 10) * DEG, cs).s;
        expect(Math.abs(s - last), `${i / 10}°`).toBeLessThan(0.004);
        last = s;
      }
    });

    test(`at ${name}, a flight's swing back from any turn leaves from the turned view and lands exactly on the overview as composed`, async () => {
      const own = await runtimeBounds();
      const cs = [...own].filter(([id]) => shown(id)).flatMap(([id, b]) => corners(b, floor(id)));
      const to = dirOf(rest);
      const out: DirPose = { position: new Vector3(), forward: new Vector3() };
      for (let deg = -165; deg <= 180; deg += 15) {
        const from = dirOf(overviewCamera(world, vp, inset, points, [], deg * DEG, cs));
        unturnPose(from, to, 0, out);
        expect(out.position.distanceTo(from.position), `${deg}°: leaves from the turned view`).toBeLessThan(1e-9);
        expect(out.forward.angleTo(from.forward)).toBeLessThan(1e-6);
        unturnPose(from, to, 1, out);
        expect(out.position.distanceTo(to.position), `${deg}°: lands`).toBeLessThan(1e-9);
        expect(out.forward.angleTo(to.forward)).toBeLessThan(1e-6);
        expect(out.reach).toBeCloseTo(to.reach!, 12);
      }
    });

    test(`at ${name}, the turned fit eases out of the rest: no jump at the first degree`, async () => {
      const own = await runtimeBounds();
      const cs = [...own].filter(([id]) => shown(id)).flatMap(([id, b]) => corners(b, floor(id)));
      for (const deg of [-0.05, 0.05]) {
        const fit = overviewCamera(world, vp, inset, points, [], deg * DEG, cs);
        expect(fit.position.distanceTo(rest.position)).toBeLessThan(0.05);
      }
    });
  }
});

describe('the turned station framing', () => {
  for (const [name, vp] of [
    ['1440×900', DESKTOP],
    ['390×844', PHONE],
  ] as const) {
    test(`at ${name}, every station turned ±${tuning.turn.stationDeg}° keeps its target, only pulls back, and holds its model and docked gondola`, async () => {
      const own = await runtimeBounds();
      const inset = panelInsetFor(vp.width, vp.height, 'open');
      const rect = visibleRect(vp, inset);
      const labelPx = vp.width >= tuning.panelMinViewportPx ? tuning.stationLabelPx : 0;
      const bad: string[] = [];
      for (const id of positions.keys()) {
        const b = id === 'origin' ? own.get(id)! : dockedBounds(id, own.get(id)!, floor(id), linkCurve(id, positions, world), new Box3());
        const rest = stationCamera(world, id, floor(id), b, vp, inset, labelPx);
        expect(stationCamera(world, id, floor(id), b, vp, inset, labelPx, undefined, undefined, 0)).toEqual(rest);
        for (const deg of [-tuning.turn.stationDeg, -6, 6, tuning.turn.stationDeg]) {
          const fit = stationCamera(world, id, floor(id), b, vp, inset, labelPx, undefined, undefined, deg * DEG);
          if (fit.target.distanceTo(rest.target) > 1e-9) bad.push(`${id} ${deg}°: its target moves`);
          if (Math.abs(yawBetween(rest, fit) - deg * DEG) > 1e-9) bad.push(`${id} ${deg}°: turned by the wrong angle`);
          if (fit.s < rest.s - 1e-9) bad.push(`${id} ${deg}°: comes closer`);
          if (fit.s / rest.s > 1.25) bad.push(`${id} ${deg}°: pulls back ${(fit.s / rest.s).toFixed(2)}×`);
          if (outside(corners(b, floor(id)), cameraFor(fit, vp, inset), vp, rect).length) bad.push(`${id} ${deg}°: a corner leaves the view`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('wrapDeg and unturnShare', () => {
  test('wrapDeg keeps a turn in (−180, 180]', () => {
    expect(wrapDeg(0)).toBe(0);
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(180)).toBe(180);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(540)).toBe(180);
    expect(wrapDeg(725)).toBeCloseTo(5, 9);
    for (let a = -1000; a <= 1000; a += 7.3) {
      const w = wrapDeg(a);
      expect(w).toBeGreaterThan(-180);
      expect(w).toBeLessThanOrEqual(180);
      const turns = (a - w) / 360;
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9); // whole turns apart
    }
  });

  test('unturnShare is the station’s for small turns and grows to unturnHalf for a half turn', () => {
    const { unturn, unturnHalf } = tuning.turn;
    expect(unturnShare(0)).toBe(unturn);
    expect(unturnShare(tuning.turn.stationDeg)).toBe(unturn); // a station's: as before
    expect(unturnShare(-tuning.turn.stationDeg)).toBe(unturn);
    expect(unturnShare(180)).toBeCloseTo(unturnHalf, 12);
    expect(unturnShare(-180)).toBeCloseTo(unturnHalf, 12);
    expect(unturnShare(360 + 90)).toBeCloseTo(unturnShare(90), 12);
    let last = 0;
    for (let d = 0; d <= 180; d += 5) {
      expect(unturnShare(d)).toBeGreaterThanOrEqual(last); // never less for a wider turn
      expect(unturnShare(-d)).toBeCloseTo(unturnShare(d), 12);
      last = unturnShare(d);
    }
    expect(unturnHalf).toBeLessThanOrEqual(1); // within the flight
  });
});

describe('turnLimit', () => {
  const max = 20;

  test('follows the drag freely, then slows near the clamp and never passes it', () => {
    expect(turnLimit(0, max, true)).toBe(0);
    expect(turnLimit(10, max, true)).toBe(10);
    expect(turnLimit(-0.8 * max, max, true)).toBeCloseTo(-0.8 * max, 12);
    let last = 0;
    for (let raw = 0; raw <= 10 * max; raw += 0.25) {
      const t = turnLimit(raw, max, true);
      expect(t).toBeGreaterThanOrEqual(last); // never turns back
      expect(t).toBeLessThanOrEqual(max);
      if (raw <= 2 * max) expect(t).toBeLessThan(max);
      expect(turnLimit(-raw, max, true)).toBeCloseTo(-t, 12);
      if (raw > 0.8 * max) expect(t - last).toBeLessThan(0.25); // slower than the drag
      last = t;
    }
    expect(turnLimit(1.4 * max, max, true)).toBeGreaterThan(0.98 * max);
    // Continuous at the knee: no step in the turn, nor in its rate.
    const k = 0.8 * max;
    expect(turnLimit(k + 1e-6, max, true) - turnLimit(k, max, true)).toBeCloseTo(1e-6, 9);
  });

  test('with motion reduced it is a hard stop at the clamp: 1:1 up to it', () => {
    expect(turnLimit(19.5, max, false)).toBe(19.5);
    expect(turnLimit(25, max, false)).toBe(max);
    expect(turnLimit(-90, max, false)).toBe(-max);
  });
});

// Moving the map (decided 2026-10-22 morning): the overview's target is kept within
// tuning.pan.margin of the shown nodes' convex hull, so the network never leaves the screen.
describe('the pan clamp', () => {
  const hull = hullOf(points);

  test("the hull's corners are nodes, anticlockwise, and every node is inside it", () => {
    expect(hull.length).toBeGreaterThanOrEqual(3);
    for (const [x, z] of hull) expect(points.some((p) => p.x === x && p.z === z)).toBe(true);
    let area = 0;
    for (let i = 0; i < hull.length; i++) {
      const [ax, az] = hull[i]!;
      const [bx, bz] = hull[(i + 1) % hull.length]!;
      area += ax * bz - bx * az;
    }
    expect(area).toBeGreaterThan(0); // anticlockwise in (x, z)
    for (const p of points) expect(clampToHull(p.clone(), hull, 0).distanceTo(p)).toBeLessThan(1e-9);
  });

  test('a point inside, or within the margin outside, is left alone; one further out comes in to the margin', () => {
    const m = tuning.pan.margin;
    const mid = middleOf(points);
    expect(clampToHull(mid.clone(), hull, m)).toEqual(mid);
    for (let a = 0; a < 360; a += 15) {
      const dir = new Vector3(Math.cos(a * DEG), 0, Math.sin(a * DEG));
      const far = mid.clone().addScaledVector(dir, 100);
      const kept = clampToHull(far.clone(), hull, m);
      // On the margin: the hull's nearest point is m away (it's now inside the margin, at its edge).
      const back = clampToHull(kept.clone(), hull, 0);
      expect(back.distanceTo(kept), `${a}°`).toBeCloseTo(m, 6);
      expect(clampToHull(kept.clone(), hull, m).distanceTo(kept)).toBeLessThan(1e-9); // and stays
      // Moved straight towards the hull: no further than it had to.
      expect(kept.distanceTo(far)).toBeCloseTo(far.distanceTo(back) - m, 6);
    }
    // Half a margin out from a corner, straight away from the hull's middle: left alone.
    const [cx, cz] = hull[0]!;
    const out = new Vector3(cx - mid.x, 0, cz - mid.z).normalize();
    const near = new Vector3(cx, 0, cz).addScaledVector(out, m / 2);
    expect(clampToHull(near.clone(), hull, m)).toEqual(near);
  });

  test('its y is left alone, and the overview as composed (any turn) is inside, desktop and phone', () => {
    const p = new Vector3(100, 3, 100);
    expect(clampToHull(p, hull, 1).y).toBe(3);
    for (const vp of [DESKTOP, PHONE]) {
      for (const deg of [0, 45, 135, -90]) {
        const f = overviewCamera(world, vp, panelInsetFor(vp.width, vp.height, 'peek'), points, [], deg * DEG);
        expect(clampToHull(f.target.clone(), hull, tuning.pan.margin).distanceTo(f.target)).toBeLessThan(1e-9);
      }
    }
  });

  test('so at any zoom a node is near: the target is within the margin and half the longest hull edge of one', () => {
    let longest = 0;
    for (let i = 0; i < hull.length; i++) {
      const [ax, az] = hull[i]!;
      const [bx, bz] = hull[(i + 1) % hull.length]!;
      longest = Math.max(longest, Math.hypot(bx - ax, bz - az));
    }
    // On the hull's edge, the farthest from both its ends is its middle.
    expect(longest / 2 + tuning.pan.margin).toBeLessThan(7.5);
  });
});
