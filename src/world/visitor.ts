// The visitor's signal (Task 11): "you" on the map, a gondola made in Blender
// (public/models/visitor.glb) that rides the links ahead of the camera. Code only decides where
// it is; its moves are Blender's clips: `appear`, `idle`, `dock` and `boost`.
//
// - Where: on the link curves themselves (links.livePoint), not the camera's path, and round
//   the hub on the turnaround (links.turnaround, 2026-10-20, the owner's pick): down one link
//   to where it crosses that ring (tuning.visitorDock from the hub's centre, at mast height,
//   where every link is level), round the ring the shorter way to the next link's crossing,
//   and out along that one, like a cable car round its bull wheel. So it never rides through
//   the origin's model (it used to pass the hub's centre, inside it). On the ring the grip
//   doesn't pitch, the heading follows the ring's tangent and `at` reports the id 'turnaround'
//   (no link's: traffic doesn't hop it there), its distance round the ring in world units. The
//   ride is measured in distance all the way, the ring's included, so the lead, the breakaway
//   and the dock below work on it unchanged. The homelab cluster (Task 13 Batch B) makes the
//   network a tree, and the ride goes up to the nearest node the two ends share and down again,
//   rounding every node it passes through on that node's own turnaround (links.turnaroundAt):
//   origin → homelab → desktop rounds the origin's ring and then homelab's, desktop → switch
//   only homelab's. On homelab's ring `at` reports 'turnaround:homelab'. Docked at a hub (the
//   homelab station), it waits on the hub's own link, where it crosses that ring.
//   The model's contract (its Blender source isn't in this repo):
//   its root `visitor` is the grip's pin, ON the line (no hover), and the cabin hangs `drop`
//   (its extras) below it. An outer group carries the
//   position and the heading (yaw) and stays level, so the cabin hangs level; only the `grip`
//   node is pitched along the link (no clip keys it), and `visitor`, `swing` and `cabin` are
//   left to the clips. The contact shadow is moved under the outer group so it turns with the
//   heading but never tilts; it stays on the floor, fades with height and is hidden while the
//   gondola rides.
// - The dock (dockDistance): tuning.visitorDock from the node at least, and farther out where
//   the line is too low for the hanging cabin, so the belly clears the floor by
//   tuning.visitorDockGap. It's found on the authored curve: a link stretched by a pull keeps
//   its rest dock. With the links' ends on their masts (tuning.linkMast) the line is high
//   enough there on every link, so it docks at visitorDock; the rule stays for a link reshaped
//   lower. Its park beside the origin is on the turnaround, where the link it last rode
//   crosses it (also visitorDock out, at linkMast, the belly just over the floor).
// - A flight between stations: the gondola leaves its dock from rest, joins the point
//   tuning.visitorLead ahead of the camera's own progress along the link (route.linkAt) over
//   the first tuning.visitorLaunch of the flight, and holds it. It breaks away for the dock at
//   tuning.visitorBreakaway, or sooner if holding the lead would carry it past the dock (the
//   camera's route stops a clearance short of the node, about 2 units, so a long lead runs out
//   of room before the camera does): from there a monotone cubic takes it to the dock as the
//   camera lands, arriving at the speed the `dock` clip starts with, which then brakes it the
//   last 0.1, the cabin swinging forward and back on its hanger.
// - A dive (overview ↔ station: the camera zooms, there's no link to ride) and any flight
//   with no room for the lead: it rides out (or home) on its own eased curve over the flight.
//   Its park beside the origin is the ring crossing of the link it last rode, and at first of
//   the link that faces the overview camera, so it waits in front of the hub.
// - Hold to boost: Shift, or a pointer press on the canvas held tuning.boostHoldMs without a
//   drag's movement, during a flight. The director's flight clock runs tuning.boost× faster
//   (the camera, the sheet and the panel follow it); the gondola eases into Blender's `boost`
//   pose (the cabin trailing back on its hanger: a rotation of `swing`, played at a weight
//   that slerps it over the rest pose) and draws a short --acc hairline trail behind it,
//   both easing back on release. A press that boosted isn't a click (tookPress). Space never
//   boosts. All of it is off under reduced motion, where flights cut and the gondola just
//   hangs at the dock with no idle, so a parked map requests no frames.

import {
  type AnimationAction,
  AnimationMixer,
  type Curve,
  Group,
  type InterleavedBufferAttribute,
  LoopOnce,
  LoopRepeat,
  type Material,
  type Mesh,
  type MeshBasicMaterial,
  type Object3D,
  Vector2,
  Vector3,
} from 'three';
import { Line2 } from '../vendor/lines/Line2.js';
import { LineGeometry } from '../vendor/lines/LineGeometry.js';
import { LineMaterial } from '../vendor/lines/LineMaterial.js';
import type { Director, FlightInfo, LinkPos, RoutePiece } from '../camera/director';
import { isUnder, linkPath } from '../data/layout';
import { clamp01, smoothstep } from '../motion/ease';
import { onPrefsChange, prefs } from '../motion/prefs';
import { stationNode, type Stations } from '../nav/stations';
import { applyRoleMaterials, recolourRoleMaterial } from '../shading';
import type { Clock } from '../stage/clock';
import type { Stage } from '../stage/stage';
import type { Theme } from '../stage/theme';
import { tuning } from '../tuning';
import { dockDistance } from './dock';
import type { Links } from './links';
import { loadModel } from './models';
import { cue } from '../sound-cue';

export { dockDistance };

export interface Visitor {
  /** Its pin on the link point (the GLB's origin), turned along the link; the cabin hangs below. */
  readonly root: Group;
  /** Resolves once the model is in (or failed to load: then there's no gondola). */
  readonly ready: Promise<void>;
  /** Where it is on the network: `at` world units along link `id` from its start (its parent's
   *  end); on the origin's turnaround, id 'turnaround' (no link) and `at` world units round it,
   *  and on a cluster hub's, 'turnaround:<hub>'. */
  readonly at: LinkPos;
  /** The clip in charge of its pose (`appear`, `idle`, `dock`), or null. */
  readonly playing: string | null;
  /** How far into the boost it is, 0..1 (eased). */
  readonly boost: number;
  /** The flight share at which it left the lead for its dock, or null while it holds it (or rests). */
  readonly breakaway: number | null;
  /** The pointer press under way, or just released, boosted a flight: it isn't a click. */
  readonly tookPress: boolean;
  dispose(): void;
}

export type VisitorStage = Pick<Stage, 'renderer' | 'scene' | 'camera' | 'theme' | 'viewport' | 'onTheme' | 'onResize'>;

/** The piece id of the origin's turnaround: its `from` and `to` are world units round it (its
 *  angle from +x toward +z, times its radius), not wrapped, so a piece may run past ±π. A
 *  cluster hub's is `turnaround:<hub>`. */
const RING = 'turnaround';
const ringId = (hub: string) => (hub === 'origin' ? RING : `${RING}:${hub}`);
/** The hub whose turnaround piece id `id` is, or null for a link. */
const hubOfRing = (id: string): string | null => (id === RING ? 'origin' : id.startsWith(`${RING}:`) ? id.slice(RING.length + 1) : null);

/** A ride's way round a turnaround: off link `a`'s crossing (null: from part way round it)
 *  onto link `b`'s, between ring places `from` and `to`. */
interface Turn {
  a: string | null;
  b: string;
  from: number;
  to: number;
}

interface Ride {
  f: FlightInfo;
  pieces: RoutePiece[];
  total: number;
  /** Where the ride hands over to `dock` (the clip's own approach short of the dock), or the end. */
  end: number;
  docks: boolean;
  /** How far its end is short of the camera route's: the dock from the node (the park from the hub). */
  gap: number;
  /** Room the lead leaves before the hand-over, for the cubic after the breakaway to reach the
   *  `dock` clip's speed (its tangent is held within 3× the distance): 0 when it doesn't dock. */
  reserve: number;
  /** Its last frame: flight share, distance along `pieces`, and speed in units per share. */
  t: number;
  v: number;
  m: number;
  v0: number;
  /** The share of the flight it takes to reach the lead. */
  launch: number;
  /** Left the lead (or never had one): a cubic from here to `end`. */
  away: { t: number; p: number; m: number } | null;
}

/** The trail's height against the line: the cabin's middle, hanging under the pin (its body
 *  runs from 0.255 to 0.102 below it, visitor.py's BELLY and ROOF). */
const MIDDLE = -0.18;
const TRAIL_SEGMENTS = 12;
/** How softly the lead gives way near the dock, in world units: within 0.1 of visitorLead
 *  until the camera has visitorLead + 1.3 (+ the dock) to go. */
const LEAD_GIVE = 0.4;

/** Distance left to the end of `pieces` from `p`, NaN if `p` isn't on them. */
function left(pieces: readonly RoutePiece[], p: LinkPos): number {
  let r = 0;
  let found = false;
  for (const s of pieces) {
    if (found) r += Math.abs(s.to - s.from);
    else if (s.id === p.id) {
      found = true;
      r += Math.abs(s.to - p.at);
    }
  }
  return found ? r : NaN;
}

/** The place `d` along `pieces`, into `out` (its link, distance and the way it's heading). */
function walk(pieces: readonly RoutePiece[], d: number, out: { id: string; at: number; dir: number }): void {
  let rest = Math.max(d, 0);
  for (const p of pieces) {
    const span = Math.abs(p.to - p.from);
    out.id = p.id;
    out.dir = Math.sign(p.to - p.from) || out.dir;
    out.at = p.from + out.dir * Math.min(rest, span);
    if (rest <= span) return;
    rest -= span;
  }
}


const probe = new Vector3();

export function createVisitor(
  stage: VisitorStage,
  links: Pick<Links, 'curve' | 'livePoint' | 'turnaround'> & Partial<Pick<Links, 'turnaroundAt' | 'parent'>>,
  director: Director,
  clock: Pick<Clock, 'add' | 'invalidate'>,
  stations: Pick<Stations, 'ids' | 'subscribe'> & { readonly current: string | null },
): Visitor {
  const root = new Group();
  root.name = 'visitor:root'; // not `visitor`: the clips find that node by name
  root.visible = false;
  stage.scene.add(root);
  const canvas = stage.renderer.domElement;
  const len = (id: string) => links.curve(id).getLength(); // three caches a curve's arc lengths
  /** The line's height over the floor at the dock: the model's drop, and the gap under the belly. */
  let clear = tuning.visitorDrop + tuning.visitorDockGap;
  /** A station's dock: this far from its node along its link. */
  const dockOf = (id: string) => dockDistance(links.curve(id), 'node', clear);
  /** The node link `id` leaves from. */
  const parent = (id: string) => links.parent?.(id) ?? 'origin';
  const turnOf = (hub: string) => {
    const t = hub === 'origin' ? links.turnaround : links.turnaroundAt?.(hub);
    if (!t) throw new Error(`visitor: no turnaround at "${hub}"`);
    return t;
  };
  /** How far along link `id` from its start it meets `hub`'s turnaround (the origin's: its park beside the origin). */
  const crossAt = (hub: string, id: string) => turnOf(hub).crossing(id);
  const crossOf = (id: string) => crossAt('origin', id);
  /** Where round `hub`'s turnaround link `id` crosses it, in that ring's units. */
  const ringAt = (hub: string, id: string) => {
    const { centre, radius } = turnOf(hub);
    const p = links.curve(id).getPointAt(Math.min(crossAt(hub, id) / len(id), 1), probe);
    return Math.atan2(p.z - centre.z, p.x - centre.x) * radius;
  };
  /** The way round each hub the gondola is on, or was last (none before its first). */
  const wheels = new Map<string, Turn>();

  let disposed = false;
  let shown = false;
  let mixer: AnimationMixer | null = null;
  let current: AnimationAction | null = null;
  let boostAction: AnimationAction | null = null;
  const clips = new Map<string, AnimationAction>();
  let materials: Material[] = [];
  /** The clamp on the line: the one part pitched along the link (the cabin hangs level). */
  let grip: Object3D | null = null;
  let shadow: { node: Object3D; y: number; material: MeshBasicMaterial; opacity: number } | null = null;
  /** The `dock` clip's speed as it starts, units a second: the ride arrives at it. */
  let dockSpeed = 0;
  let approach = 0;

  const here = { id: '', at: 0, dir: -1 };
  let ride: Ride | null = null;
  /** Along the link's own coordinate, units a second (for a ride that interrupts this one). */
  let vel = 0;
  let w = 0; // boost weight
  let ground = 1; // the shadow: 1 at rest, 0 riding
  let yawTo = 0;
  let pitchTo = 0;
  /** The turnaround it was on when last placed (null: on a link). */
  let ringed: string | null = null;
  let press: { id: number; x: number; y: number; held: number } | null = null;
  let shift = false;
  let tookPress = false;

  // --- the trail: a hairline from --acc at the gondola to --bg at its end --------------------

  const trailGeometry = new LineGeometry();
  trailGeometry.setPositions(new Float32Array(3 * (TRAIL_SEGMENTS + 1)));
  trailGeometry.setColors(new Float32Array(3 * (TRAIL_SEGMENTS + 1)));
  const trailMaterial = new LineMaterial({ vertexColors: true, worldUnits: false });
  const trail = new Line2(trailGeometry, trailMaterial);
  trail.frustumCulled = false;
  trail.visible = false;
  stage.scene.add(trail);
  const buffer = (name: string) => (trailGeometry.getAttribute(name) as InterleavedBufferAttribute).data as unknown as { array: Float32Array; needsUpdate: boolean };

  const size = new Vector2();
  function fitTrail(): void {
    stage.renderer.getDrawingBufferSize(size);
    trailMaterial.resolution = size;
    trailMaterial.linewidth = tuning.visitorTrailPx * stage.viewport.pixelRatio;
  }

  function recolor(t: Theme): void {
    for (const m of materials) recolourRoleMaterial(m, t); // shading.ts's default is tuning.shadeStrength
    const data = buffer('instanceColorStart');
    const c = t.acc.clone();
    // Each segment's two ends: 3 floats each, the end of one where the next starts.
    for (let j = 0; j < 2 * TRAIL_SEGMENTS; j++) c.copy(t.acc).lerp(t.bg, ((j + 1) >> 1) / TRAIL_SEGMENTS).toArray(data.array, 3 * j);
    data.needsUpdate = true;
    clock.invalidate();
  }

  // --- clips ---------------------------------------------------------------------------------

  /** Hands the pose to `next` (null: the rest pose), blending from whatever had it. */
  function take(next: AnimationAction | null, blend: number): void {
    const prev = current;
    current = next;
    if (next) {
      next.reset().setEffectiveWeight(1).play();
    }
    if (prev && prev !== next) {
      if (blend > 0 && !prefs.reduced) {
        if (next) prev.crossFadeTo(next, blend, false);
        else prev.fadeOut(blend);
      } else prev.stop();
    }
    wake();
  }

  const play = (name: string, blend: number) => (cue('visitor', name), take(clips.get(name) ?? null, blend));
  const idle = () => !prefs.reduced && !ride && play('idle', 0.4);

  // --- where it stands -----------------------------------------------------------------------

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const e = new Vector3();

  /** `hub`'s turnaround's place `at` (its ring units), on the circle as drawn. */
  const onRing = (hub: string, at: number, out: Vector3) => {
    const { centre, radius } = turnOf(hub);
    return out.set(centre.x + radius * Math.cos(at / radius), centre.y, centre.z + radius * Math.sin(at / radius));
  };

  /**
   * The ring place `at` round `hub`, at mast height. Between the ends of its wheel it eases from
   * link `a`'s crossing as drawn now to link `b`'s, so it meets a link bent by a pull (at rest
   * both are on the circle, within a micron; a cluster's short links may still be rising a
   * hair where they cross).
   */
  function ringPoint(hub: string, at: number, out: Vector3): Vector3 {
    onRing(hub, at, out);
    const t = wheels.get(hub);
    if (!t) return out;
    const s = t.to !== t.from ? clamp01((at - t.from) / (t.to - t.from)) : 1;
    const off = (id: string, end: number) => links.livePoint(id, crossAt(hub, id) / len(id), c).sub(onRing(hub, end, e));
    if (t.a !== null) out.addScaledVector(off(t.a, t.from), 1 - s);
    return out.addScaledVector(off(t.b, t.to), s);
  }

  /** The point `at` along link `id` as drawn now, or round a turnaround (a ring id). */
  const pointAt = (id: string, at: number, out: Vector3) => {
    const hub = hubOfRing(id);
    return hub !== null ? ringPoint(hub, at, out) : links.livePoint(id, at / len(id), out);
  };

  /** Puts the gondola at `here`, aimed along the way it's heading (at once when `snap`). */
  function place(snap: boolean): void {
    const { id, at, dir } = here;
    pointAt(id, at, root.position);
    pointAt(id, at + 0.05 * dir, a).sub(pointAt(id, at - 0.05 * dir, b));
    const was = yawTo;
    const ring = hubOfRing(id) !== null;
    yawTo = Math.atan2(a.x, a.z);
    pitchTo = ring ? 0 : Math.atan2(a.y, Math.hypot(a.x, a.z)); // the ring is level
    // Round the ring the heading turns with it (at ride speed that's about 16 rad/s, which the
    // easing in tick would trail by some 35°, the nose crabbing); only the right-angle kinks
    // onto and off the ring are eased.
    if (ring && ringed === id) root.rotation.y += turn(0, yawTo - was, 1);
    ringed = ring ? id : null;
    if (snap || prefs.reduced) {
      root.rotation.y = yawTo;
      if (grip) grip.rotation.x = -pitchTo;
    }
    dress();
  }

  /** Off the turnaround onto the nearer end of its turn, at that link's crossing, facing the hub. */
  function offRing(): void {
    const hub = hubOfRing(here.id)!;
    const t = wheels.get(hub)!;
    const id = t.a !== null && Math.abs(here.at - t.from) < Math.abs(here.at - t.to) ? t.a : t.b;
    // A link leaving the hub runs away from it; the hub's own link runs into it.
    Object.assign(here, { id, at: crossAt(hub, id), dir: parent(id) === hub ? -1 : 1 });
  }

  /** Rests at a station's dock (null or the origin: beside the hub, where the link it's on, or
   *  the origin's link above it in a cluster, crosses the turnaround). */
  function park(to: string | null): void {
    if (hubOfRing(here.id) !== null) offRing();
    if (to !== null && to !== 'origin') Object.assign(here, { id: to, at: len(to) - dockOf(to), dir: 1 });
    else {
      let id = here.id;
      for (let i = 0; i < 32 && parent(id) !== 'origin'; i++) id = parent(id);
      Object.assign(here, { id, at: crossOf(id), dir: -1 });
    }
    place(true);
  }

  /** The shadow on the floor under it and the trail behind it, for where it is now. */
  const spot = { id: '', at: 0, dir: 1 };
  function dress(): void {
    if (shadow) {
      // The clips key it on the docked floor, `clear` under the pin; the line may be higher.
      const above = root.position.y - clear;
      shadow.node.position.y = shadow.y - above;
      shadow.material.opacity = shadow.opacity * ground * clamp01(1 - above / tuning.dragLift); // gone by a drag's lift
      shadow.node.visible = ground > 0.01;
    }
    const r = ride;
    const length = w * tuning.visitorTrail;
    trail.visible = r !== null && length > 0.01;
    if (r && trail.visible) {
      const data = buffer('instanceStart');
      for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
        walk(r.pieces, r.v - (length * i) / TRAIL_SEGMENTS, spot);
        pointAt(spot.id, spot.at, a);
        a.y += MIDDLE;
        if (i < TRAIL_SEGMENTS) a.toArray(data.array, 6 * i);
        if (i > 0) a.toArray(data.array, 6 * i - 3);
      }
      data.needsUpdate = true;
    }
    clock.invalidate();
  }

  // --- flights -------------------------------------------------------------------------------

  /**
   * The way from where it is to `to`'s dock (null or the origin: its park), and how far that
   * end is short of the camera route's (the dock from the node, the park from the hub): along
   * its link to the turnaround of the node it's heading through, round it the shorter way to
   * the next link and along that, node after node through the tree, or along its own link alone
   * when that's where it's going. A hub's dock is on the hub's own link, so a ride up to it
   * from one of its sub-links rounds its ring onto that link. Sets each hub's wheel for its way
   * round.
   */
  function plan(to: string | null): { pieces: RoutePiece[]; gap: number } {
    const goal = to ?? 'origin';
    const pieces: RoutePiece[] = [];
    const done = (gap: number) => ({ pieces: pieces.filter((p) => p.from !== p.to), gap });
    const dock = (id: string) => len(id) - dockOf(id);
    /** Round `hub` from ring place `from` (off link `came`, null: from part way round) to link `next`'s crossing. */
    const round = (hub: string, came: string | null, from: number, next: string) => {
      const span = 2 * Math.PI * turnOf(hub).radius;
      const d = ringAt(hub, next) - from;
      const to1 = from + d - Math.round(d / span) * span; // the shorter way: under half of it
      wheels.set(hub, { a: came, b: next, from, to: to1 });
      pieces.push({ id: ringId(hub), from, to: to1 });
    };
    // Where it starts: a node's turnaround to go on round (`node`, at ring place `at`, off `came`).
    let node: string;
    let came: string | null;
    let at: number;
    const ring = hubOfRing(here.id);
    if (ring === null) {
      const id = here.id;
      if (isUnder(parent, goal, id)) {
        // Out along the link it's on: to its own dock, or on to the hub at its end.
        if (goal === id) {
          pieces.push({ id, from: here.at, to: dock(id) });
          return done(dockOf(id));
        }
        pieces.push({ id, from: here.at, to: crossAt(id, id) });
        [node, came, at] = [id, id, ringAt(id, id)];
      } else {
        const up = parent(id);
        if (up === 'origin' && goal === 'origin') {
          pieces.push({ id, from: here.at, to: crossOf(id) }); // home: its park on this link
          return done(crossOf(id));
        }
        pieces.push({ id, from: here.at, to: crossAt(up, id) });
        [node, came, at] = [up, id, ringAt(up, id)];
      }
    } else {
      [node, came, at] = [ring, null, here.at];
      // From the origin's ring itself (a flight that cut in), home is on round to the link it was making for.
      if (ring === 'origin' && goal === 'origin') {
        const out = wheels.get('origin')!.b;
        round('origin', null, at, out);
        return done(crossOf(out));
      }
    }
    for (let guard = 0; guard < 32; guard++) {
      if (node === goal) {
        // Up to a hub's own station: round onto its own link, to its dock there.
        round(node, came, at, node);
        pieces.push({ id: node, from: crossAt(node, node), to: dock(node) });
        return done(dockOf(node));
      }
      if (isUnder(parent, goal, node)) {
        const next = linkPath(parent, node, goal)[0]!.id; // down: the link towards it
        round(node, came, at, next);
        if (next === goal) {
          pieces.push({ id: next, from: crossAt(node, next), to: dock(next) });
          return done(dockOf(next));
        }
        pieces.push({ id: next, from: crossAt(node, next), to: crossAt(next, next) });
        [node, came, at] = [next, next, ringAt(next, next)];
      } else {
        const up = parent(node); // up: the hub's own link, towards the node above it
        round(node, came, at, node);
        if (up === 'origin' && goal === 'origin') {
          pieces.push({ id: node, from: crossAt(node, node), to: crossOf(node) });
          return done(crossOf(node));
        }
        pieces.push({ id: node, from: crossAt(node, node), to: crossAt(up, node) });
        [node, came, at] = [up, node, ringAt(up, node)];
      }
    }
    return done(0);
  }

  function begin(f: FlightInfo): void {
    const { pieces, gap } = plan(f.to === null ? null : stationNode(f.to)); // the receipt: Fettle's dock
    const total = pieces.reduce((s, p) => s + Math.abs(p.to - p.from), 0);
    const docks = total > approach;
    const heading = pieces[0] ? Math.sign(pieces[0].to - pieces[0].from) : 0;
    // A ride it interrupts carries on at its speed if it heads the same way; otherwise from rest.
    const v0 = (Math.max(vel * heading, 0) * f.duration) / f.rate;
    const own = f.from === null || f.to === null || f.route.length === 0;
    // At rate 1: a boost later only lowers the speed the cubic has to reach.
    const reserve = docks ? (dockSpeed * f.duration * (1 - tuning.visitorBreakaway)) / 3 : 0;
    const r: Ride = { f, pieces, total, end: docks ? total - approach : total, docks, gap, reserve, t: 0, v: 0, m: v0, v0, launch: 0, away: own ? { t: 0, p: 0, m: v0 } : null };
    // It reaches the lead over visitorLaunch of the flight, or longer when that would mean
    // averaging over visitorLaunchSpeed (a short hop's lead sits right by the dock: no dash).
    const reach = leadAt(r, left(f.route.pieces, f.route.linkAt(0)));
    r.launch = Math.min(Math.max((reach * f.rate) / (tuning.visitorLaunchSpeed * f.duration), tuning.visitorLaunch), tuning.visitorBreakaway) || tuning.visitorLaunch;
    ride = r;
    if (current && current !== clips.get('appear')) take(null, 0.2); // steady while it rides
    wake();
  }

  /**
   * The lead, as distance along the ride, for the camera `q` from the node: visitorLead less to
   * go than the camera, but never past the hand-over (less the reserve the final cubic needs):
   * a softplus floor (width LEAD_GIVE) eases it off the lead as the room runs out, rather than
   * stopping it dead. Without the reserve the farther gondola dock (1.07 to 1.69 from the node
   * before the masts, against the pod's 0.75) left it parked at the hand-over for the last
   * third of the flight, then lurching into `dock` from rest.
   */
  function leadAt(r: Ride, q: number): number {
    const hand = r.total - r.end + r.gap + r.reserve;
    const z = (q - tuning.visitorLead - hand) / LEAD_GIVE;
    return r.total + r.gap - hand - LEAD_GIVE * (z > 20 ? z : Math.log1p(Math.exp(z)));
  }

  function follow(f: FlightInfo | null): void {
    if (!mixer || !shown) return;
    if (!f) {
      land();
      return;
    }
    if (ride?.f !== f) begin(f);
    const r = ride!;
    const t = f.t;
    const dt = t - r.t;
    let v = NaN;
    const q = left(f.route.pieces, f.route.linkAt(f.along)); // the camera's distance left to the node
    if (!r.away && (Number.isNaN(q) || t >= tuning.visitorBreakaway)) r.away = { t: r.t, p: r.v, m: r.m };
    if (!r.away) {
      // Joined from the dock over its launch, on a smoothstep: it leaves at rest.
      v = r.v0 * t + (leadAt(r, q) - r.v0 * t) * smoothstep(0, r.launch, t);
    } else {
      // A cubic Hermite from where it left to the hand-over at the flight's end, its tangents
      // held within 3× the distance so it never runs past and back (Fritsch–Carlson).
      const { t: t0, p, m } = r.away;
      const T = 1 - t0;
      const D = r.end - p;
      const s = clamp01((t - t0) / T);
      const m0 = Math.min(Math.max(m * T, 0), 3 * Math.max(D, 0));
      const m1 = Math.min(r.docks ? (dockSpeed * f.duration * T) / f.rate : 0, 3 * Math.max(D, 0));
      v = p + (m0 * (s - 2 * s * s + s * s * s)) + D * s * s * (3 - 2 * s) + m1 * (s * s * s - s * s);
    }
    if (dt > 0) r.m = (v - r.v) / dt;
    r.t = t;
    r.v = v;
    walk(r.pieces, v, here);
    vel = ((r.m * f.rate) / f.duration) * here.dir;
    place(false);
  }

  /** The flight is over (landed, or cut): at the dock, and `dock` brakes it the last bit. */
  function land(): void {
    const r = ride;
    if (!r) return;
    ride = null;
    vel = 0;
    walk(r.pieces, r.total, here);
    if (hubOfRing(here.id) !== null) offRing(); // home from the ring: onto the link it came round to
    place(prefs.reduced);
    if (prefs.reduced) return;
    if (r.docks) {
      play('dock', 0);
      mixer?.update(0); // its first pose now: the clock may have run this tick's mixer already
    } else idle();
    wake();
  }

  const offFlight = director.onFlight(follow);

  // A cut (reduced motion) has no flight to follow: it stands at the dock at once.
  const offStations = stations.subscribe((to) => {
    if (!prefs.reduced || !shown || director.flight || director.state === 'arrival') return;
    ride = null;
    park(to === null ? null : stationNode(to));
  });

  // --- the tick ------------------------------------------------------------------------------

  let offTick: (() => void) | null = null;
  function wake(): void {
    if (!disposed && mixer) offTick ??= clock.add(tick);
  }

  /** Turns `x` toward `to` (radians, the short way) by share k. */
  const turn = (x: number, to: number, k: number) => x + (to - x - Math.round((to - x) / (2 * Math.PI)) * 2 * Math.PI) * k;

  function tick(dt: number): boolean {
    if (!shown) {
      if (director.state === 'arrival') return true; // it joins the network once the arrival ends
      show();
    }
    if (press) press.held += dt;
    const held = press !== null && press.held * 1000 >= tuning.boostHoldMs;
    const want = !prefs.reduced && director.flight !== null && (shift || held) ? 1 : 0;
    if (want && held) tookPress = true;
    w += (want - w) * (1 - Math.exp(-dt / tuning.boostEase));
    if (Math.abs(want - w) < 1e-3) w = want;
    director.timeScale = 1 + (tuning.boost - 1) * w;
    if (boostAction) {
      if (w > 0) boostAction.setEffectiveWeight(w).play();
      else boostAction.stop();
    }
    const g = ride ? 0 : 1;
    ground += (g - ground) * (1 - Math.exp(-dt / 0.08));
    if (Math.abs(g - ground) < 1e-3) ground = g;
    const k = 1 - Math.exp(-dt * 14);
    root.rotation.y = turn(root.rotation.y, yawTo, k);
    const pitch = grip ? (grip.rotation.x = turn(grip.rotation.x, -pitchTo, k)) : -pitchTo;
    const turning = Math.abs(turn(0, yawTo - root.rotation.y, 1)) + Math.abs(pitchTo + pitch) > 1e-4;
    mixer!.update(dt);
    dress();
    const busy = current !== null || ride !== null || press !== null || w > 0 || ground !== g || turning;
    if (!busy) {
      offTick?.();
      offTick = null;
    }
    return busy;
  }

  /** It joins the map: beside the hub, rising in with `appear` (at once under reduced motion). */
  function show(): void {
    shown = true;
    if (!here.id) {
      // The link whose way out of the hub faces the camera best: it waits in front of the hub.
      const cam = stage.camera.position;
      let best = -Infinity;
      for (const id of stations.ids) {
        if (id === 'origin' || parent(id) !== 'origin') continue; // a link out of the hub
        const c = links.curve(id);
        const o = c.getPointAt(0);
        c.getPointAt(Math.min(1 / len(id), 1), a).sub(o).setY(0).normalize();
        const score = a.dot(b.subVectors(cam, o).setY(0).normalize());
        if (score > best) {
          best = score;
          here.id = id;
        }
      }
    }
    park(null);
    if ((director.state === 'station' || director.state === 'receipt') && !director.flight && stations.current) park(stationNode(stations.current));
    root.visible = true;
    if (!prefs.reduced) play('appear', 0);
    wake();
  }

  // --- input: hold to boost ------------------------------------------------------------------

  function onDown(e: PointerEvent): void {
    if (press || (e.pointerType === 'mouse' && e.button !== 0)) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, held: 0 };
    tookPress = false;
    wake();
  }
  function onMove(e: PointerEvent): void {
    if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= tuning.dragThresholdPx) press = null; // a drag
  }
  function onUp(e: PointerEvent): void {
    if (press?.id === e.pointerId) press = null; // after the canvas's own pointerup has read tookPress
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Shift') return;
    shift = e.type === 'keydown';
    wake();
  }
  function onBlur(): void {
    shift = false;
    press = null;
  }
  const listening = new AbortController();
  const signal = { signal: listening.signal };
  canvas.addEventListener('pointerdown', onDown, signal);
  canvas.addEventListener('pointermove', onMove, signal);
  addEventListener('pointerup', onUp, signal);
  addEventListener('pointercancel', onUp, signal);
  addEventListener('keydown', onKey, signal);
  addEventListener('keyup', onKey, signal);
  addEventListener('blur', onBlur, signal);

  const offTheme = stage.onTheme(recolor);
  fitTrail();
  const offResize = stage.onResize(fitTrail);
  const offPrefs = onPrefsChange(() => {
    if (!shown) return;
    if (prefs.reduced) {
      w = 0;
      director.timeScale = 1;
      boostAction?.stop();
      take(null, 0);
      ground = 1;
      place(true);
    } else if (!ride) idle();
    wake();
  });

  // --- the model -----------------------------------------------------------------------------

  const ready = loadModel('visitor')
    .then((gltf) => {
      if (disposed) return;
      const scene = gltf.scene;
      materials = applyRoleMaterials(scene, stage.theme);
      // The root's extras (the loader names the scene `visitor` and the root node `visitor_1`).
      let drop: unknown;
      scene.traverse((o) => void (drop ??= o.userData['drop']));
      if (typeof drop === 'number' && drop > 0) clear = drop + tuning.visitorDockGap;
      grip = scene.getObjectByName('grip') ?? null;
      const node = scene.getObjectByName('shadow');
      if (node) {
        root.add(node); // turns with the heading
        const material = (node.getObjectByProperty('isMesh', true) as Mesh | undefined)?.material as MeshBasicMaterial | undefined;
        if (material) shadow = { node, y: node.position.y, material, opacity: material.opacity };
      }
      root.add(scene);
      mixer = new AnimationMixer(root);
      for (const clip of gltf.animations) {
        const action = mixer.clipAction(clip);
        action.setLoop(clip.name === 'idle' || clip.name === 'boost' ? LoopRepeat : LoopOnce, Infinity);
        action.clampWhenFinished = true;
        clips.set(clip.name, action);
        // The gondola's own track (the loader may rename its node `visitor_1`), not the shadow's.
        const track = clip.name === 'dock' ? clip.tracks.find((k) => k.name.endsWith('.position') && !k.name.startsWith('shadow')) : undefined;
        if (track && track.times.length > 1) {
          const v = track.values;
          approach = -v[2]!;
          dockSpeed = (v[5]! - v[2]!) / (track.times[1]! - track.times[0]!);
        }
      }
      boostAction = clips.get('boost') ?? null;
      mixer.addEventListener('finished', (e) => {
        if (e.action === current) idle();
      });
      recolor(stage.theme); // its role materials share the nodes' shader programs, compiled already
      if (director.state !== 'arrival') show();
      else wake();
    })
    .catch((err: unknown) => console.error('visitor: no gondola model', err)); // the map works without it

  return {
    root,
    ready,
    get at() {
      return { id: here.id || null, at: here.at };
    },
    get playing() {
      return current?.getClip().name ?? null;
    },
    get boost() {
      return w;
    },
    get breakaway() {
      return ride?.away?.t ?? null;
    },
    get tookPress() {
      return tookPress;
    },
    dispose() {
      disposed = true;
      offTick?.();
      offFlight();
      offStations();
      offTheme();
      offResize();
      offPrefs();
      listening.abort();
      mixer?.stopAllAction();
      root.removeFromParent();
      trail.removeFromParent();
      trailGeometry.dispose();
      trailMaterial.dispose();
    },
  };
}
