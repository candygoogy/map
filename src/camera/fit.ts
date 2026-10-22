// Fitting Blender's cameras to the screen (Task 9; the rule: "code may fit, never
// re-author"). Each authored camera keeps its direction, target and fov exactly; the only
// thing code changes is its distance from the target, by a factor s along its own line of
// sight: position = target + (authored position − target) · s.
//
// The screen model is stage.ts's: the projection uses the whole canvas's aspect, and the
// panel inset is a view offset (right/2, bottom/2) that slides the projection's centre to
// the middle of the visible area without zooming. So in the camera's unshifted image the
// visible area is a window centred on the view axis, (W − right) / W of the half-width and
// (H − bottom) / H of the half-height, and each of its four edges is a plane through the
// camera. A point with its margin (a sphere of that radius, the model Blender composed
// cam_overview_portrait under) is inside when the sphere is inside all four planes, which is
// linear in s: each point and edge gives a lower bound on s, and s is the largest of them.
// Closed form, exact, no iteration, and nothing allocated per point.
//
// Map rotation: the visitor's turn swings a framing's camera
// about the vertical through its target (turned), and the overview's about the network's middle
// (the middle of its nodes' bounds), so the far end doesn't swing wide of the screen side on. The
// fit then runs for the turned camera and only ever pulls back from the resting s, holding the
// models' corners too, the overview's a gutter (tuning.turn.gutterPx) inside the visible area. Like
// the drift, the turn is the visitor's offset on top: at a turn of 0 every framing is exactly as above.

import { Box3, Vector3 } from 'three';
import { HIDDEN } from '../nav/stations';
import type { PanelInset } from '../stage/stage';
import { tuning } from '../tuning';

/** An authored camera as world.json stores it, in Three.js space; fovY in degrees. */
export interface WorldCamera {
  position: readonly number[];
  target: readonly number[];
  fovY: number;
}

/** A camera pose at runtime: the camera stands at `position` and looks at `target`. */
export interface Pose {
  position: Vector3;
  target: Vector3;
  fovY: number;
}

/** A rectangle on the canvas in CSS px, y down. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Size = { width: number; height: number };

/** What fit.ts reads from world.json. `station_<id>` is node <id>'s own station camera, if
 *  world.blend has one (cam_station_<id>), relative to its node like `station`. */
export interface FitWorld {
  nodes: Record<string, readonly number[]>;
  cameras: {
    overview: WorldCamera;
    overviewPortrait: WorldCamera;
    station: WorldCamera;
    [node: `station_${string}`]: WorldCamera | undefined;
  };
}

export interface FitOptions {
  /** The smallest s returned: 1 for the overview, so Blender's framing is never pushed in. */
  minScale?: number;
  /** CSS px kept free to the right of every point (not of its margin): a label's room. */
  labelPx?: number;
}

/** stage.ts's near plane: a fitted camera never brings a margin sphere closer than this. */
const NEAR = 0.1;

/** The part of the canvas the panel doesn't cover: left of the right panel, above the sheet. */
export function visibleRect(viewport: Size, inset: PanelInset): Rect {
  return {
    x: 0,
    y: 0,
    width: Math.max(viewport.width - inset.right, 0),
    height: Math.max(viewport.height - inset.bottom, 0),
  };
}

/** Whether the overview for this viewport and inset is the portrait one: a visible area taller
 *  than wide. labels.ts asks too, with the peek inset, as the director fits the overview. */
export function isPortrait(viewport: Size, inset: PanelInset): boolean {
  const rect = visibleRect(viewport, inset);
  return rect.width < rect.height;
}

// Scratch for fitScale: the camera's basis and the vector from the target to a point.
const fwd = new Vector3();
const rightAxis = new Vector3();
const upAxis = new Vector3();
const toPoint = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

/** Sets fwd, rightAxis and upAxis to the camera's basis; returns its authored distance d. */
function setBasis(cam: WorldCamera): number {
  const [px, py, pz] = cam.position as [number, number, number];
  const [tx, ty, tz] = cam.target as [number, number, number];
  fwd.set(tx - px, ty - py, tz - pz);
  const d = fwd.length();
  fwd.divideScalar(d);
  // Object3D.lookAt's basis with up = +y (no authored camera looks straight down).
  rightAxis.crossVectors(fwd, WORLD_UP);
  if (rightAxis.lengthSq() < 1e-12) rightAxis.set(1, 0, 0);
  rightAxis.normalize();
  upAxis.crossVectors(rightAxis, fwd);
  return d;
}

/**
 * The factor s such that the camera at target + (position − target) · s holds every point,
 * each with a sphere of `margin` world units around it, inside visibleRect(viewport, inset).
 * The smallest such s (tight), but never below `opts.minScale`. With `opts.labelPx`, every
 * point also keeps that many CSS px clear to its right inside the visible area.
 */
export function fitScale(
  cam: WorldCamera,
  points: readonly Vector3[],
  viewport: Size,
  inset: PanelInset,
  margin: number = tuning.fitMargin,
  opts: FitOptions = {},
): number {
  const [tx, ty, tz] = cam.target as [number, number, number];
  const d = setBasis(cam);

  const rect = visibleRect(viewport, inset);
  const h = Math.tan((cam.fovY * Math.PI) / 360);
  // Each edge's slope (half-extent per unit of depth) in the unshifted image: the visible
  // window is centred on the view axis, at the whole canvas's scale.
  const sx = (h * rect.width) / viewport.height;
  const sy = (h * rect.height) / viewport.height;
  const kx = margin * Math.sqrt(1 + sx * sx);
  const ky = margin * Math.sqrt(1 + sy * sy);
  // The label's edge: the visible right edge less labelPx (2/W of NDC per px). Capped so it
  // never passes the view axis; a label that wide can't fit beside anything anyway.
  const labelPx = Math.min(opts.labelPx ?? 0, rect.width / 2 - rect.width / 8);
  const sl = (h * (rect.width - 2 * labelPx)) / viewport.height;

  // Depth of a point at scale s is s·d + v·fwd, where v = point − target. A sphere is inside
  // the edge plane a·x ≤ slope·depth when a·x + margin·√(1 + slope²) ≤ slope·depth.
  let s = opts.minScale ?? 0;
  for (const p of points) {
    toPoint.set(p.x - tx, p.y - ty, p.z - tz);
    const x = toPoint.dot(rightAxis);
    const y = toPoint.dot(upAxis);
    const z = toPoint.dot(fwd);
    const depth = Math.max((Math.abs(x) + kx) / sx, (Math.abs(y) + ky) / sy, NEAR + margin, labelPx > 0 ? x / sl : 0);
    s = Math.max(s, (depth - z) / d);
  }
  return s;
}

/**
 * The share of the visible area's height the points span, top to bottom on the screen, with
 * the camera at scale s (no margin). Infinity if a point is at or behind the near plane.
 */
export function heightShare(cam: WorldCamera, points: readonly Vector3[], viewport: Size, inset: PanelInset, s: number): number {
  const [tx, ty, tz] = cam.target as [number, number, number];
  const d = setBasis(cam);
  const h = Math.tan((cam.fovY * Math.PI) / 360);
  let top = -Infinity;
  let bottom = Infinity;
  for (const p of points) {
    toPoint.set(p.x - tx, p.y - ty, p.z - tz);
    const depth = s * d + toPoint.dot(fwd);
    if (depth <= NEAR) return Infinity;
    const y = toPoint.dot(upAxis) / (depth * h); // NDC, the whole canvas spanning −1..1
    top = Math.max(top, y);
    bottom = Math.min(bottom, y);
  }
  return ((top - bottom) * viewport.height) / (2 * visibleRect(viewport, inset).height);
}

/**
 * The s in [lo, hi] at which the points span `share` of the visible height (heightShare): hi if
 * they already do there, lo if they don't even there. The span only grows as s shrinks, so a
 * bisection; 30 steps put s within 1e-9 of the root.
 */
function scaleForShare(cam: WorldCamera, points: readonly Vector3[], viewport: Size, inset: PanelInset, share: number, lo: number, hi: number): number {
  if (hi <= lo || heightShare(cam, points, viewport, inset, hi) >= share) return hi;
  if (heightShare(cam, points, viewport, inset, lo) <= share) return lo;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (heightShare(cam, points, viewport, inset, mid) > share) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * `cam` turned `yaw` radians about the vertical through `about` (x and z; its target if left out),
 * +y, positive moving it to its own right, as the drift does: camera and target swung together, so
 * the same height, distance, pitch and fov. About its target, the same target. `cam` itself at 0.
 */
export function turned(cam: WorldCamera, yaw: number, [ax, , az] = cam.target): WorldCamera {
  if (!yaw) return cam;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const swing = ([x, y, z]: readonly number[]) => [ax! + (x! - ax!) * c + (z! - az!) * s, y!, az! - (x! - ax!) * s + (z! - az!) * c];
  return { position: swing(cam.position), target: swing(cam.target), fovY: cam.fovY };
}

/** The overview's turn pivot: the middle of the points' bounds on the floor. */
export function middleOf(points: readonly Vector3[]): Vector3 {
  return new Box3().setFromPoints(points as Vector3[]).getCenter(new Vector3());
}

/** The authored camera at scale s: same target, direction and fov, s times as far. */
export function fittedPose(cam: WorldCamera, s: number): Pose {
  const target = new Vector3(...(cam.target as [number, number, number]));
  const position = new Vector3(...(cam.position as [number, number, number])).sub(target).multiplyScalar(s).add(target);
  return { position, target, fovY: cam.fovY };
}

export interface OverviewFit extends Pose {
  /** Which authored overview was fitted; the arrival plays the clip that ends on it. */
  camera: 'overview' | 'overviewPortrait';
  s: number;
}

/** Every known node's ground point (floor, y = 0), but a hidden one's (stations.ts HIDDEN). */
export function groundPoints(world: Pick<FitWorld, 'nodes'>): Vector3[] {
  return Object.entries(world.nodes)
    .filter(([id]) => !HIDDEN.includes(id))
    .map(([, xz]) => new Vector3(xz[0], 0, xz[1]));
}

/** A node's label, for the overview to keep room for: it starts beside the model's right edge. */
export interface LabelRoom {
  /** The model's centre. */
  centre: Vector3;
  /** The model's half-width, in world units: the label starts this far right of the centre. */
  halfWidth: number;
  /** CSS px the label takes from there: its gap and its width, the status line's included. */
  px: number;
}

const labelEdge = new Vector3();

/**
 * The overview for this screen: `overviewPortrait` when the visible area is taller than wide,
 * otherwise `overview`, pushed back just enough that every node's ground point with its
 * footprint margin is in view, and never brought closer than authored (s ≥ 1). `points`
 * defaults to world.json's nodes; pass the laid-out positions to include unknown ids. With
 * `labels`, each label also fits in the visible area to its model's right, in the room it
 * gives: none for a phone's hidden labels (labels.ts), so there the network takes the whole
 * width.
 */
export function overviewCamera(
  world: FitWorld,
  viewport: Size,
  inset: PanelInset,
  points: readonly Vector3[] = groundPoints(world),
  labels: readonly LabelRoom[] = [],
  yaw = 0,
  modelCorners: readonly Vector3[] = [],
): OverviewFit {
  const camera = isPortrait(viewport, inset) ? 'overviewPortrait' : 'overview';
  const cam = world.cameras[camera];
  /** The s `c` needs for the points and the labels' room, and with `all` the models' corners,
   *  each `gutter` CSS px inside the visible area. */
  const need = (c: WorldCamera, all: boolean, gutter = 0): number => {
    let s = fitScale(c, points, viewport, inset, tuning.fitMargin, { minScale: 1 });
    if (labels.some((l) => l.px > 0)) {
      // The camera's right, as fitScale's basis has it.
      fwd.set(c.target[0]! - c.position[0]!, c.target[1]! - c.position[1]!, c.target[2]! - c.position[2]!).normalize();
      const r = new Vector3().crossVectors(fwd, WORLD_UP).normalize();
      for (const l of labels) {
        if (l.px <= 0) continue; // a hidden label takes no room
        labelEdge.copy(l.centre).addScaledVector(r, l.halfWidth);
        s = Math.max(s, fitScale(c, [labelEdge], viewport, inset, 0, { minScale: 1, labelPx: l.px }));
      }
    }
    // The gutter: fitScale centres its window on the view axis, so a wider inset by 2·gutter
    // narrows it by a gutter on every side.
    return all ? Math.max(s, fitScale(c, modelCorners, viewport, { right: inset.right + 2 * gutter, bottom: inset.bottom + 2 * gutter }, 0)) : s;
  };
  const s = need(cam, false);
  if (!yaw) return { ...fittedPose(cam, s), camera, s };
  // Turned about the network's middle: back as far as the turn needs more than the rest did (a
  // corner the authored view already leaves out stays out by as much), never closer than the
  // rest. The gutter eases in over the first gutterDeg, so the view pulls back from the rest
  // without a jump.
  const { gutterPx, gutterDeg } = tuning.turn;
  const gutter = gutterPx[+(viewport.width >= tuning.panelMinViewportPx)]! * Math.min(Math.abs(yaw) / (gutterDeg * (Math.PI / 180)), 1);
  const at = turned(cam, yaw, middleOf(points).toArray());
  const t = Math.max(s, need(at, true, gutter) - Math.max(need(cam, true) - s, 0));
  return { ...fittedPose(at, t), camera, s: t };
}

export interface StationFit extends Pose {
  s: number;
}

/** The eight corners of a box, offset by `at`. */
export function corners(b: Box3, at: Vector3): Vector3[] {
  const out: Vector3[] = [];
  for (let c = 0; c < 8; c++) {
    out.push(
      new Vector3(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z).add(at),
    );
  }
  return out;
}

/**
 * The station framing at node `id`: world.json's station camera offset placed at the node's
 * home (the node's own `station_<id>` if world.blend has one, else the shared `station`),
 * scaled so the model's bounds (root space, as NodeView.bounds) with `margin` around them, and
 * `labelPx` of room for its label on the right, sit inside the visible area, and never closer
 * than `minScale` (tuning.stationMinScale, 1: Blender's own framing, like the overview's rule).
 * On the bottom-sheet layout it only moves out, for a narrow screen. With the side panel
 * (viewport.width ≥ tuning.panelMinViewportPx) the floor drops until the bounds span
 * tuning.stationFill of the visible height, never below tuning.stationSideMinScale.
 * On the bottom-sheet layout the director passes labelPx = 0: the open sheet names the station.
 * Turned by `yaw` (map rotation), the same fit runs for the turned camera, never closer than the rest.
 */
export function stationCamera(
  world: FitWorld,
  id: string,
  nodeHome: Vector3,
  nodeBounds: Box3,
  viewport: Size,
  inset: PanelInset,
  labelPx: number = tuning.stationLabelPx,
  margin: number = tuning.stationMargin,
  minScale: number = tuning.stationMinScale,
  yaw = 0,
): StationFit {
  const st = world.cameras[`station_${id}`] ?? world.cameras.station;
  const at = (v: readonly number[]) => [v[0]! + nodeHome.x, v[1]! + nodeHome.y, v[2]! + nodeHome.z];
  const cam: WorldCamera = { position: at(st.position), target: at(st.target), fovY: st.fovY };
  const points = nodeBounds.isEmpty() ? [nodeHome.clone()] : corners(nodeBounds, nodeHome);
  const need = (c: WorldCamera): number => {
    let floor = minScale;
    // The side panel: the floor drops to where the bounds span stationFill of the visible
    // height, but no lower than stationSideMinScale. The fit below still keeps every corner,
    // with its margin and the label's room, in view, so this only ever brings it closer.
    if (viewport.width >= tuning.panelMinViewportPx) floor = scaleForShare(c, points, viewport, inset, tuning.stationFill, tuning.stationSideMinScale, floor);
    return fitScale(c, points, viewport, inset, margin, { labelPx, minScale: floor });
  };
  const s = need(cam);
  if (!yaw) return { ...fittedPose(cam, s), s };
  const swung = turned(cam, yaw);
  const t = Math.max(s, need(swung));
  return { ...fittedPose(swung, t), s: t };
}

/**
 * One frame of the arrival clip, scaled about its overview's target by that overview's s:
 * the authored move keeps its shape and timing and lands exactly on the fitted overview.
 * The clip's rotations are used as authored.
 */
export function scaleArrivalFrame(framePos: Vector3, overviewTarget: Vector3, s: number, out = new Vector3()): Vector3 {
  return out.copy(framePos).sub(overviewTarget).multiplyScalar(s).add(overviewTarget);
}
