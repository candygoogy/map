// Where everything stands (Task 6). Known ids take their floor position from world.json,
// which world.py exports from world.blend; models stand on the floor, so y is 0. An id the
// world doesn't know yet (a new project in the feed) goes on the unknown ring, as far from
// everything else as the ring allows: runtime-only, until the owner places it in Blender.
//
// The links' shapes come from the same place: a known link is its `link_<id>` curve itself
// (world.json → links holds its Bezier points and handles, hooks applied), rebuilt here as the
// same cubics, so the runtime's line is Blender's and the owner's hand edits carry through.
// Only an id with no curve gets a computed arc, the quadratic world.py started every curve as:
// from mast top to mast top (tuning.linkMast over each node's floor point), its control point
// tuning.linkLift above the ends' midpoint.
//
// The network is a tree (the homelab cluster, Task 13 Batch B): every link leaves the origin
// but a cluster's, which leave their hub (world.json → linkFrom, from world.blend's
// link_<hub>_<id> curves). A link runs from its parent's end, so "along a link from its start"
// means from the origin or from the hub. parentOf names a link's parent; linkPath walks the
// tree between two nodes.

import { CubicBezierCurve3, Curve, QuadraticBezierCurve3, Vector3 } from 'three';
import { tuning } from '../tuning';
import type { MapFeed } from './feed';

/**
 * What layout reads from world.json: floor positions [x, z], each link's Bezier points, its
 * parent's end first, each [left handle xyz, point xyz, right handle xyz] (world.py's export),
 * each link's parent where it isn't the origin, and the links drawn dotted (over the air).
 */
export interface World {
  nodes: Record<string, number[]>;
  links?: Record<string, number[][]>;
  linkFrom?: Record<string, string>;
  dotted?: string[];
}

/** The node the link to `id` leaves from: its hub (world.json's linkFrom), else the origin. */
export function parentOf(world: Pick<World, 'linkFrom'>, id: string): string {
  return world.linkFrom?.[id] ?? 'origin';
}

/** One link of a way through the tree, and which way it's taken: up (to its parent) or down. */
export interface PathStep {
  id: string;
  up: boolean;
}

/** `id` and every node above it, the origin last. */
function lineage(parent: (id: string) => string, id: string): string[] {
  const out = [id];
  for (let n = id; n !== 'origin' && out.length < 64; ) out.push((n = parent(n)));
  return out;
}

/**
 * The links from node `from` to node `to` through the tree: up from `from` to the first node
 * they share above them (the origin, or a cluster's hub), then down to `to`. Empty when they're
 * the same node.
 */
export function linkPath(parent: (id: string) => string, from: string, to: string): PathStep[] {
  const up = lineage(parent, from);
  const down = lineage(parent, to);
  const meet = up.find((n) => down.includes(n)) ?? 'origin';
  const steps: PathStep[] = [];
  for (const n of up) {
    if (n === meet) break;
    steps.push({ id: n, up: true });
  }
  const below = down.slice(0, down.indexOf(meet)).reverse();
  for (const n of below) steps.push({ id: n, up: false });
  return steps;
}

/** Whether `id` is `above` or somewhere under it. */
export function isUnder(parent: (id: string) => string, id: string, above: string): boolean {
  return lineage(parent, id).includes(above);
}

/**
 * Chords per cubic for its arc length (three.js defaults to 200). At 400 a link's length is off
 * by under 1e-7, and a point getPointAt puts along it by under 1e-5.
 */
const BEZIER_DIVISIONS = 400;

/**
 * A link's cubics, end to end, even in length: getPoint(t) is the point t of the whole length
 * along (that far into the cubic it falls in, by the cubic's getPointAt), so getPointAt is
 * getPoint, with no second sampled table over the whole. (three's CurvePath has one, and it
 * brings every curve class three has into the bundle: 1.9 kB gzipped more than this.)
 */
class BezierPath extends Curve<Vector3> {
  /** Each cubic's far end, as a length along the whole. */
  private readonly ends: number[] = [];

  constructor(private readonly cubics: CubicBezierCurve3[]) {
    super();
    let sum = 0;
    for (const c of cubics) this.ends.push((sum += c.getLength()));
  }

  override getLength(): number {
    return this.ends.at(-1)!;
  }

  override getPoint(t: number, out = new Vector3()): Vector3 {
    const d = Math.min(Math.max(t, 0), 1) * this.getLength();
    let i = 0;
    while (i < this.ends.length - 1 && this.ends[i]! < d) i++;
    const start = i > 0 ? this.ends[i - 1]! : 0;
    const span = this.ends[i]! - start;
    return this.cubics[i]!.getPointAt(span > 0 ? Math.min((d - start) / span, 1) : 0, out);
  }

  override getUtoTmapping(u: number, distance?: number | null): number {
    return distance == null ? u : distance / this.getLength();
  }
}

/** Angles tried on the unknown ring: every half degree, from +x towards +z. */
const RING_STEPS = 720;

/**
 * Every feed node's floor position. Unknown ids are placed in feed order, each at the ring
 * angle with the most room to the nodes already placed (ties go to the smaller angle), so
 * the same feed always lands them in the same places and each keeps at least
 * tuning.unknownGap from every other node while the ring has room.
 */
export function layout(feed: MapFeed, world: World): Map<string, Vector3> {
  const at = new Map<string, Vector3>();
  const unknown: string[] = [];
  for (const { id } of feed.nodes) {
    const xz = world.nodes[id];
    if (xz) at.set(id, new Vector3(xz[0], 0, xz[1]));
    else unknown.push(id);
  }
  const r = tuning.unknownRing;
  const p = new Vector3();
  for (const id of unknown) {
    let best = 0;
    let room = -Infinity;
    for (let k = 0; k < RING_STEPS; k++) {
      const a = (k / RING_STEPS) * Math.PI * 2;
      p.set(r * Math.cos(a), 0, r * Math.sin(a));
      let nearest = Infinity;
      for (const q of at.values()) nearest = Math.min(nearest, p.distanceTo(q));
      if (nearest > room) {
        room = nearest;
        best = a;
      }
    }
    at.set(id, new Vector3(r * Math.cos(best), 0, r * Math.sin(best)));
  }
  return at;
}

/**
 * The link to `id`, its parent's end first (the origin's, or its hub's). A known link is Blender's curve exactly:
 * one cubic per pair of neighbouring Bezier points (a point, its right handle, the next one's
 * left handle, that point), joined end to end (BezierPath).
 * An id with no curve gets world.py's starting arc between the tops of the two nodes' masts.
 */
export function linkCurve(id: string, positions: Map<string, Vector3>, world: World): Curve<Vector3> {
  const pts = world.links?.[id];
  if (pts && pts.length >= 2) {
    const v = (p: number[], i: number) => new Vector3(p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0);
    const cubics: CubicBezierCurve3[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const cubic = new CubicBezierCurve3(v(a, 3), v(a, 6), v(b, 0), v(b, 3));
      cubic.arcLengthDivisions = BEZIER_DIVISIONS;
      cubics.push(cubic);
    }
    return new BezierPath(cubics);
  }
  const to = positions.get(id);
  if (!to) throw new Error(`layout: no position for "${id}"`);
  const from = (positions.get(parentOf(world, id)) ?? positions.get('origin') ?? new Vector3()).clone();
  from.y += tuning.linkMast;
  const end = to.clone();
  end.y += tuning.linkMast;
  const control = from.clone().add(end).multiplyScalar(0.5);
  control.y += tuning.linkLift;
  return new QuadraticBezierCurve3(from, control, end);
}
