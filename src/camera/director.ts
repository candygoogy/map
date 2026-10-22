// The camera director (Task 9). It owns stage.camera and moves it between four states:
//
//   arrival   Blender's camera clip (world.glb: `arrival`, or `arrival_portrait` when the
//             visible area is taller than wide), sampled through an AnimationMixer on a proxy
//             and scaled frame by frame about its overview's target by that overview's fit
//             (fit.ts, "code may fit, never re-author"). Each link draws outward at
//             tuning.linkDrawSpeed (a cluster's at subLinkDrawSpeed) so it lands on its reach_<id> time; there its node, hidden
//             until then, plays `appear`, and its label's pinned status goes "Checking…" →
//             "Working". Any key, click or tap skips to the clip's end state.
//   overview  the fitted overview; `station` the fitted station framing.
//   receipt   (Task 16) the trip receipt: the camera rests on Fettle as it prints, framed by
//             world.json's `receipt` camera (cam_receipt, relative to Fettle's node, fitted
//             like a station's with the strip fed out above it; without one, Fettle's own
//             station framing). The flight there is an ordinary one to Fettle's node.
//   flying    code, because it depends on where the visitor is. Between stations the camera
//             rides the Blender link curves (via the origin between two nodes, or via the
//             nearest node they share: a cluster's hub, planRoute), lifted
//             tuning.flightLift and its own arc over each link (Route.rise), joining the link from wherever it was and leaving it for the
//             station framing. Via the hub it rises over the origin's model, its view raised
//             with it so the pitch holds (Route.lift, tuning.flightHubClearance), and over a
//             cluster's hub where the way turns back there (not one it passes through); the
//             capsule still rides the links. That whole path is measured once by length (flightPath),
//             and one in-out cubic ease over flightDuration(the route's length) runs along it, so
//             the speed rises once and falls once. The camera looks tuning.flightLookAhead
//             ahead along the link, below itself, so whatever leads it on the link stays in
//             view and the destination comes into frame. To or from the overview there's no
//             link to ride: it dives (divePose), a geometric zoom over tuning.flightDive,
//             straight to the framing. A new travel mid-flight starts a new path from the
//             moving camera: the old flight keeps running underneath and is blended out, so
//             neither position nor speed jumps. A flight's clock runs at timeScale: the
//             visitor's hold to boost (Task 11) speeds it up, and the sheet and the panel's
//             swap, timed in real seconds, follow.
//
// Drift (overview and station, and carried through flights): the pointer orbits the camera
// about its target, up to tuning.driftYawDeg and driftPitchDeg, on a critically damped
// spring. An orbit rather than a turn in place keeps the framing's centre where fit.ts put it
// and shows depth. A flight lands on the drifted framing, so nothing glides on after it. None
// on coarse pointers or under reduced motion, and its tick leaves the clock once it settles.
//
// Turn (map rotation): a drag on the empty floor (pointer.ts) or
// `[` `]` (controls.ts) turns a station's framing about its own target and the overview about the
// network's middle, left and right only: all the way round in the overview, within
// tuning.turn.stationDeg at a station (turnLimit; the owner, 2026-10-21), the fit pulling back as
// the turned view needs, the overview's with a gutter at the edges (fit.ts). It
// follows the drag directly, stays where it's left, and the drift rides on top (its aim held
// while a drag turns). A flight leaves from the turned view and lands unturned, swinging back
// over more of its time the wider the turn (unturnShare). Never mid-flight or in the arrival.
// With motion reduced it stays (the visitor's own move), with a hard stop at a station's clamp.
//
// Zoom and pan (the owner's test notes, 2026-10-22 morning): in the overview
// only, src/input/zoom.ts (a lazy chunk) moves the camera in, down to tuning.zoom.min of its
// distance, and across the floor: the fitted (and turned) overview's camera at `zoom` of its
// distance from a target moved `pan` off the framing's own (viewTo). The pan is kept in the
// unturned view's terms, and the target is kept within reach of the network at any zoom and turn
// by the chunk's clamp (bound; until it's in, nothing has panned but the phone's start, which is
// inside). Zoomed in or panned, a turn orbits the view's centre at the same distance (the owner,
// 2026-10-22: it turned as if never zoomed, swinging what was zoomed on off the screen): the
// pivot slides from the network's middle to the centre of the view as the view leaves the
// composed one (turnPivotShare, turnAbout), and the turned fit's pull back gives way to the
// zoomed distance (zoomedReach), so the composed overview still turns exactly as before. The
// drift and the turn ride on it. A flight leaves from that view (a dive
// needs no more), and travel resets them, as it does the turn: to the composed overview, but on
// a phone (the portrait overview) closer, centred on the hub with the inner ring of stations
// filling the width (homeView), where the visitor starts too (a skip goes straight there; played
// out, the arrival ends on the composed overview and zoom.ts eases it in).
//
// The sheet (phones): from the overview it stays at its peek while the camera travels, so the
// map has the screen, and opens over the flight's last tuning.sheetSeconds, done as the camera
// lands. Station to station it drops to its peek as the camera leaves and opens the same way,
// so the gondola rides in view, not under it; but the camera stays framed for the open sheet
// (the projection doesn't pan), so the ride is as before with more of the map shown below.
// To the overview it drops to its peek as the camera leaves. The framing is always fitted for
// the final inset, never the one mid-animation.
//
// Reduced motion: no arrival (its end state at once), travel cuts, the node shows its end of
// `arrive`, no drift. The director then never holds a tick, so the clock (on demand) stops.
//
// A deep link (/#notary) runs the arrival, then flies to the station. The panel shows the
// station's text from the first paint, and the flight out from the origin shows where it sits
// in the network, which a cut can't. A skip lands on the arrival's end and the flight follows.

import { AnimationMixer, Box3, CubicBezierCurve3, type Curve, LoopOnce, type Object3D, Vector3 } from 'three';
import type { GLTF } from '../vendor/GLTFLoader.js';
import { runtimeCopy as copy } from '../copy-runtime';
import { clamp01, easeInOutCubic, smoothstep } from '../motion/ease';
import { onPrefsChange, prefs } from '../motion/prefs';
import { HIDDEN, RECEIPT, stationNode, type Stations } from '../nav/stations';
import type { Clock } from '../stage/clock';
import { panelInsetFor, type SheetState, type Stage } from '../stage/stage';
import { tuning } from '../tuning';
import type { Labels } from '../ui/labels';
import { isUnder, linkPath } from '../data/layout';
import type { Links } from '../world/links';
import { loadModel } from '../world/models';
import type { Nodes } from '../world/nodes';
import { type Spring, stepSpring } from '../world/spring';
import { dockDistance } from '../world/dock';
import { corners, type FitWorld, fitScale, type LabelRoom, middleOf, overviewCamera, type OverviewFit, type Pose, scaleArrivalFrame, stationCamera } from './fit';

export type DirectorState = 'arrival' | 'overview' | 'flying' | 'station' | 'receipt';

/** A camera pose for flights: where it stands and the unit direction it looks. */
export interface DirPose {
  position: Vector3;
  forward: Vector3;
  /**
   * How far ahead what it frames is: a framing's distance to its target. Unknown (a pose
   * mid-flight), it's taken where the line of sight meets the floor.
   */
  reach?: number;
}

/** A guided ride's pose at share t of the way, from `from` to `to` (Director.follow), into `out`. */
export interface Guide {
  to: string;
  duration: number;
  pose(t: number, from: DirPose, to: DirPose, out: DirPose): void;
}

/** A place on the network: `at` world units along link `id` from its origin end; id null is the origin. */
export interface LinkPos {
  id: string | null;
  at: number;
}

/** One link's stretch of a route, as distances along that link from its origin end. */
export interface RoutePiece {
  id: string;
  from: number;
  to: number;
}

/**
 * A flight's way along the links, at link height (the camera rides it lifted), in travel
 * order. It follows the link stretches in `pieces`, but keeps clear of the models: it starts
 * and ends a clearance short of a node it leaves or reaches, and rounds the origin on a curve
 * tangent to both links. The way itself stays on the links (the visitor's capsule rides them,
 * and its length sets the flight's time); how much higher the camera goes over the origin's
 * model is `lift`.
 */
export interface Route {
  /** The link stretches planned, before the clearances trim them. */
  readonly pieces: readonly RoutePiece[];
  /** World units; 0 for a flight with no link to follow (to the overview, or overview ↔ origin). */
  readonly length: number;
  /** Where the link ends at the node the route leaves from (its mast's top), or null (mid-link); likewise the one it reaches. */
  readonly startNode: Vector3 | null;
  readonly endNode: Vector3 | null;
  /** The point `d` along the route (clamped to it). A route of length 0 has none: `out` is left as it is. */
  pointAt(d: number, out: Vector3): Vector3;
  /** Which link the point `d` along the route follows, and how far along that link from its origin end. */
  linkAt(d: number): LinkPos;
  /**
   * How much to raise the camera at `d`, standing `y` high: on a way that turns back at the hub
   * (or at a cluster's), enough to clear its model (planRoute); 0 at either end, over a hub the
   * way passes straight through, and on every other way. With `view`,
   * only the share that raises what it looks at too: the origin's. Over a cluster's hub, at the
   * map's edge, a view raised with the camera looked past the cluster at empty floor (desktop →
   * switch), so there it looks down at the links instead.
   */
  lift(d: number, y: number, view?: boolean): number;
  /**
   * The camera's own rise over the way at `d`, on top of tuning.flightLift: on each link, as
   * much as puts it tuning.flightArc·4f(1−f) over the straight line between the link's ends
   * (f its share of the link), whatever the line itself does between them. So the camera
   * flies the arc the links had before they ran level at their masts (2026-10-20), while the
   * gondola rides the line. Round the hub it eases from one link's to the other's (a cubic
   * matching both values and slopes).
   */
  rise(d: number): number;
  /**
   * Round a sharp corner where the way passes through a node (a hub), which way the ride
   * looks at `d` (Phase 2, yaw tuning): `yaw` (radians about +y from +x towards +z) turns
   * from the way towards the point tuning.flightLookAhead on (lookPoint, as everywhere else)
   * to the way's own heading averaged over the stretch from `d` on, long enough that the
   * corner's whole turn spread over it is at most tuning.flightCornerLook.degPerUnit a unit,
   * by `weight` (0..1): how sharply the corner turns, eased in before the stretch reaches the
   * corner and out just after it, where the two agree. `weight` is 0 everywhere else, and
   * the ride looks at the point on, as before. Into `out`; returns it.
   */
  cornerLook(d: number, out: CornerLook): CornerLook;
}

/** Route.cornerLook's answer. */
export interface CornerLook {
  yaw: number;
  weight: number;
}

/** How far a flight keeps from a node: around it on the floor, and above its model's top. */
export interface Clearance {
  radius: number;
  top: number;
}

/** A flight in progress, for Task 11's visitor: it rides `route` ahead of `along`. */
export interface FlightInfo {
  /** The station it left (null: the overview). */
  readonly from: string | null;
  /** Where it's going (null: the overview). */
  readonly to: string | null;
  readonly route: Route;
  /** Share of the flight's time gone, 0..1 (before easing). */
  readonly t: number;
  /** Seconds. */
  readonly duration: number;
  /** How far along `route` the camera's own progress is, in world units (eased). */
  readonly along: number;
  /** How fast its clock runs right now: 1, or more while the visitor boosts (Task 11). */
  readonly rate: number;
}

export interface Director {
  readonly state: DirectorState;
  /** Resolves once every model and the camera clip are in and the arrival has begun (it begins
   *  as the origin's is in), or once the models are in without one. */
  readonly ready: Promise<void>;
  /** Resolves when the arrival has ended: played out, skipped, or never run (reduced motion). */
  readonly arrived: Promise<void>;
  /** The flight under way, or null. */
  readonly flight: FlightInfo | null;
  /** Seconds into the arrival clip, or null outside the arrival. */
  readonly arrivalTime: number | null;
  /** When a key, click or wheel skipped the arrival (that event's timeStamp, ms), or null:
   *  played out, never run, or skipped in code. map.ts's wheel holds off tuning.wheelAfterSkip. */
  readonly skippedAt: number | null;
  /** True while the director holds a tick on the clock (arrival, flight, drift settling). */
  readonly animating: boolean;
  /**
   * How fast a flight's clock runs against the page's: 1, more while the visitor holds a
   * boost (Task 11). The camera, the sheet and the panel's swap all follow it.
   */
  timeScale: number;
  /** Jumps to the arrival's end state: every link drawn, every node at rest, statuses working. */
  skipArrival(): void;
  /**
   * The arrival's timing for the screen as it is now, without its camera (Task 15's reboot
   * replays it): each node's reach, and each link's draw, from `start` for `span` seconds.
   */
  arrivalTimes(): { reach: Map<string, number>; links: Map<string, { start: number; span: number }> };
  /** Cancels the arrival's let-go of the statuses still to come (Task 15's dark empties them). */
  cancelStatusRipple(): void;
  flightDuration(distance: number): number;
  /** The visitor's turn of the view, in degrees (positive: the camera swung to its right). */
  readonly turn: number;
  /**
   * A floor drag's turn: `dx` CSS px of horizontal travel since the press, then null as it
   * lets go. False while the map can't turn (the arrival, a flight).
   */
  turnDrag(dx: number | null): boolean;
  /** Turns as a drag `steps` × tuning.turn.keyDeg to the right would (`]` is 1, `[` −1). */
  turnBy(steps: number): void;
  /** The overview's zoom: its distance as a share of the fitted overview's (1: as composed). */
  readonly zoom: number;
  /** What the resting camera looks at, on the floor (a fresh copy each time). */
  readonly look: Vector3;
  /**
   * The overview at zoom `z` (clamped to tuning.zoom.min..1), looking at `target` on the floor
   * (kept within reach of the network: bound), as turned. False outside the overview.
   */
  viewTo(z: number, target: Vector3): boolean;
  /** The overview camera's distance from what it looks at, at zoom `z` and the turn as it is (zoom.ts scales about a point by it). */
  distanceAt(z: number): number;
  /** The pan's clamp (zoom.ts): moves a target on the floor back within reach of `points`, the shown nodes' homes. */
  bound(keep: ((target: Vector3, points: readonly Vector3[]) => void) | null): void;
  /** Where travel brings the overview back to, and the visitor starts: its zoom and target. */
  readonly home: { zoom: number; target: Vector3 };
  /** While the visitor pans (true), the drift holds its aim, as it does for a turn's drag. */
  hold(on: boolean): void;
  /** The next travel to the overview lands on it as composed, every node in frame (the power
   *  moment's dark map), not on a phone's closer start. */
  composeNext(): void;
  /** The fitted framing of a station (null: the overview) for the screen as it is now, turned
   *  `yaw` radians (0: as composed). Never zoomed. */
  framing(id: string | null, yaw?: number): Pose;
  /** A moment's close look (Task 17's tape): at a station, the camera rests at `p` instead of
   *  the station's framing (the drift still rides on it); null puts the framing back. */
  closeUp(p: Pose | null): void;
  /**
   * A moment's ride (Task 17's plane): the next travel to `to` takes `duration` seconds with the
   * camera where `pose` puts it at each share t (0..1) of the way, given where it left from and
   * the framing it lands on; otherwise a flight like any other (the hash, the panel, the
   * gondola). Interrupted, the next flight leaves from it as from any. Null forgets it.
   */
  follow(guide: Guide | null): void;
  /**
   * How far Fettle's strip stands over the cover's top at the receipt, in world units (Task 16:
   * the receipt moment sets it from the receipt's length before it travels there). Null: fed
   * fully out, tuning.receiptBox as it is.
   */
  receiptHeight: number | null;
  /** Called every frame a flight moves, and with null when it lands or is cut. Returns an unsubscribe. */
  onFlight(cb: (f: FlightInfo | null) => void): () => void;
  dispose(): void;
}

export interface DirectorWorld extends FitWorld {
  cameras: FitWorld['cameras'] & { receipt?: FitWorld['cameras']['station'] };
  arrival: {
    clipLength: number;
    reach: Record<string, number>;
    portrait: { clipLength: number; reach: Record<string, number> };
  };
}

export interface DirectorOptions {
  world: DirectorWorld;
  /** Every node's floor position, layout() included: unknown ids are framed too. */
  positions: Map<string, Vector3>;
  labels: Pick<Labels, 'setStatus' | 'room'>;
  /** Moves the sheet (stage and panel together), the camera framed for `framed` (the sheet's
   *  own state unless given). Defaults to stage.setSheet(framed). */
  setSheet?: (state: SheetState, framed?: SheetState) => void;
  /** The camera clips. Defaults to /models/world.glb. */
  loadCamera?: () => Promise<GLTF>;
}

export type DirectorStage = Pick<Stage, 'camera' | 'scene' | 'renderer' | 'viewport' | 'onResize' | 'setSheet'>;

// --- pure parts (unit-tested) ---------------------------------------------------------------

/** Seconds for a flight of `distance` world units: clamp(min + perUnit·distance, min, max). */
export function flightDuration(distance: number): number {
  const { min, perUnit, max } = tuning.flight;
  return Math.min(Math.max(min + perUnit * distance, min), max);
}


/**
 * How far an overview turn's pivot has slid from the network's middle to the view's centre, 0 to
 * 1, for a view at `zoom` panned `pan` world units off the framing's target: 0 only as composed,
 * 1 zoomed in to tuning.turn.aboutZoom or panned tuning.turn.aboutPan, smoothly between. With
 * `pan` left out, the share by the zoom alone: how far the zoomed distance holds through a turn
 * instead of the turned fit's pull back (director, zoomedReach).
 */
export function turnPivotShare(zoom: number, pan = 0): number {
  const { aboutZoom, aboutPan } = tuning.turn;
  return smoothstep(0, 1, Math.max((1 - zoom) / (1 - aboutZoom), pan / aboutPan));
}

/** Degrees in (−180, 180]: the overview's turn, which goes all the way round. */
export function wrapDeg(a: number): number {
  const w = a - 360 * Math.round(a / 360);
  return w === -180 ? 180 : w;
}

/**
 * The share of a flight's time a view turned `deg` swings back to the composed one over
 * (unturnPose): tuning.turn.unturn, more for a wide turn, up to unturnHalf for a half turn, so a
 * turned-round overview doesn't whip back in a third of a dive. It grows as the root of the
 * turn, so the swing's hardest push (a smoothstep's, 6·turn / share²) is the same at any width.
 */
export function unturnShare(deg: number): number {
  const { unturn, unturnHalf } = tuning.turn;
  return Math.max(unturn, unturnHalf * Math.sqrt(Math.min(Math.abs(wrapDeg(deg)), 180) / 180));
}

/** Seconds for a dive from a view turned `deg`: tuning.flightDive, longer past 20° (tuning.turn.diveLonger). */
export function diveDuration(deg: number): number {
  return tuning.flightDive * (1 + (tuning.turn.diveLonger * Math.max(Math.abs(wrapDeg(deg)) - 20, 0)) / 160);
}

/** A turn moves freely up to this share of its clamp, then slows towards it. */
const FREE_TURN = 0.8;

/**
 * The turn shown for a drag's raw turn (degrees), within ±max: as dragged up to FREE_TURN of
 * max, then slowing towards it and never reaching it (as a pulled model does near dragRadius),
 * or, not `soft` (motion reduced), 1:1 with a hard stop at max.
 */
export function turnLimit(raw: number, max: number, soft: boolean): number {
  const a = Math.abs(raw);
  const free = max * FREE_TURN;
  const room = max - free;
  return Math.sign(raw) * (!soft ? Math.min(a, max) : a <= free ? a : free + room * (1 - Math.exp(-(a - free) / room)));
}

const NO_CLEARANCE = (): Clearance => ({ radius: 0, top: -Infinity });

/** A model's clearance from its bounds (root space): its footprint's half-diagonal plus tuning.flightClearance. */
export function clearanceOf(bounds: Box3): Clearance {
  if (bounds.isEmpty()) return { radius: tuning.flightClearance, top: 0 };
  const cx = (bounds.max.x + bounds.min.x) / 2;
  const cz = (bounds.max.z + bounds.min.z) / 2;
  const half = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2;
  return { radius: Math.hypot(cx, cz) + half + tuning.flightClearance, top: bounds.max.y };
}

/** Samples along a route, at most this far apart. */
const ROUTE_STEP = 0.1;
/**
 * The shortest stretch the hub's lift eases in or out over, in world units, for a way that
 * starts or ends near the hub: then it can't reach its full height before the radius, but it
 * never rises in a jolt. A station's way usually has about 1.8 before the radius.
 */
const LIFT_RAMP = 1.5;
/**
 * How soft the hub's floor is, in world units: the lift is ½(b + √(b² + s²)) for a camera b
 * below it, so it eases off as the camera nears the floor instead of stopping at it, and a
 * camera right at the floor gets s/2 more (a camera well below it, s²/4b).
 */
const LIFT_SOFT = 0.5;

/**
 * The way from `from` to `to` along the links: out along the destination's link from the
 * origin, back down the current link first when the camera is on another one. To the origin
 * it's the current link back; to the overview there's no link to follow. `clear` gives each
 * node's clearance (none by default).
 *
 * The network is a tree (the homelab cluster, Task 13 Batch B): `parent` names the node each
 * link leaves from (links.parent; the origin by default), and the way goes up to the nearest
 * node the two ends share and down again: origin → homelab → desktop, and desktop → switch via
 * homelab only. Each node it passes through (a junction) is rounded as the hub is.
 *
 * A way that turns back at a junction (up one link and down another: the origin, or a hub the
 * way meets at) lifts the camera over that node's model (Phase 2, the origin's; the cluster's
 * hubs too): where the way is within its clearance radius, to at least
 * tuning.flightHubClearance above the model's top, and less either side of it, eased
 * (smoothstep) in from the way's start (or the junction before) and out to its end (or the
 * junction after), where it's 0. It's a floor, not a step: a camera already that high (a
 * phone's station framing, or a flight it interrupted that was lifted already) isn't raised
 * further. The floor is soft (LIFT_SOFT), so it never corners.
 * A hub the way only passes through (up two links in a row, or down) isn't lifted over: since
 * the homelab cluster became the real wiring's tree (2026-10-21, router → switch → AP → laptop)
 * a way from a deep device crosses the router, the switch and the AP mid-flight at full speed,
 * and their lifts, eased in over a few units there, swung the pitch 4 to 6° a frame
 * (laptop → notary, laptop → candygoogy-bot, desktop → notary; the limit is 4). The ride
 * alone keeps about 2 over those small models.
 */
export function planRoute(
  curve: (id: string) => Curve<Vector3>,
  from: LinkPos,
  to: string | null,
  clear: (id: string) => Clearance = NO_CLEARANCE,
  parent: (id: string) => string = () => 'origin',
): Route {
  const len = (id: string) => curve(id).getLength();
  const pieces: RoutePiece[] = [];
  const push = (id: string, a: number, b: number) => {
    if (Math.abs(b - a) > 1e-9) pieces.push({ id, from: a, to: b });
  };
  if (to !== null) {
    let at = 'origin'; // the node the way goes on from
    if (from.id !== null) {
      if (isUnder(parent, to, from.id)) {
        // Out along the link it's on (towards `to`, or to its own end).
        push(from.id, from.at, len(from.id));
        at = from.id;
      } else {
        push(from.id, from.at, 0);
        at = parent(from.id);
      }
    }
    for (const step of linkPath(parent, at, to)) push(step.id, step.up ? len(step.id) : 0, step.up ? 0 : len(step.id));
  }

  const pts: Vector3[] = [];
  const tags: LinkPos[] = [];
  /** Per sample: the camera's rise (Route.rise), and the step from the sample before it. */
  const rises: number[] = [];
  const steps: number[] = [];
  let startNode: Vector3 | null = null;
  let endNode: Vector3 | null = null;
  /** Each corner round a junction: its first and last sample. */
  const corners: [number, number][] = [];
  /** Each node the way passes through: its point on the way (its mast's top), its clearance, and whether the way turns back there. */
  const junctions: { at: Vector3; clear: Clearance; view: boolean; turn: boolean }[] = [];
  /** A piece's point `at` along its link. */
  const pointOf = (p: RoutePiece, at: number) => curve(p.id).getPointAt(clamp01(at / len(p.id)));
  if (to !== null && pieces.length > 0) {
    const first = pieces[0]!;
    const last = pieces.at(-1)!;
    // The node it leaves from: the origin (from the overview or the origin's station), or the
    // far end of a link it's standing at; none when it leaves from mid-link.
    const startId = from.id === null ? 'origin' : from.at >= len(from.id) - 1e-6 ? from.id : null;
    const startTrim = startId === null ? 0 : clear(startId).radius;
    const endTrim = clear(to).radius;
    if (startId !== null) startNode = startId === 'origin' ? pointOf(first, first.from) : curve(startId).getPointAt(1);
    endNode = pointOf(last, last.to); // `to`'s mast top, whichever way the last link runs
    /** Never trims more than 40% of a stretch, so every stretch keeps some of its link. */
    const cut = (length: number, r: number) => Math.min(r, length * 0.4);

    // A stretch's steps are measured as the link measures itself (getLength, getPointAt), not
    // by the chords between the samples, which fall short of it where the link bends: so `d`
    // along the route and `at` along the link agree (linkAt), and a whole link's way is its
    // getLength. The corner round the hub is measured by its chords.
    const stretch = (id: string, a: number, b: number) => {
      const c = curve(id);
      const total = c.getLength();
      const n = Math.max(1, Math.ceil(Math.abs(b - a) / ROUTE_STEP));
      for (let i = pts.length ? 1 : 0; i <= n; i++) {
        const at = a + ((b - a) * i) / n;
        pts.push(c.getPointAt(clamp01(at / total)));
        tags.push({ id, at });
        rises.push(riseOn(c, at)[0]);
        steps.push(pts.length > 1 ? Math.abs(b - a) / n : 0);
      }
    };

    // Each stretch is its piece trimmed a clearance short of the nodes at its ends: the one it
    // leaves from (startTrim), `to` (endTrim), and each junction between two pieces, the node
    // where piece k ends (its parent's, going up; its own, going down).
    const junctionId = (p: RoutePiece) => (p.to < p.from ? parent(p.id) : p.id);
    const rJ = pieces.slice(0, -1).map((p) => clear(junctionId(p)));
    for (let k = 0; k < rJ.length; k++) {
      const p = pieces[k]!;
      junctions.push({ at: pointOf(p, p.to), clear: rJ[k]!, view: junctionId(p) === 'origin', turn: p.to < p.from && pieces[k + 1]!.to > pieces[k + 1]!.from });
    }
    const trimmed = pieces.map((p, k) => {
      const dir = Math.sign(p.to - p.from);
      const span = Math.abs(p.to - p.from);
      const a = p.from + dir * cut(span, k === 0 ? startTrim : rJ[k - 1]!.radius);
      const b = p.to - dir * cut(span, k === pieces.length - 1 ? endTrim : rJ[k]!.radius);
      return { p, dir, a, b: dir * (b - a) < 0 ? a : b }; // never back past its start
    });
    for (const [k, s] of trimmed.entries()) {
      if (k === trimmed.length - 1 || s.dir * (s.b - s.a) > 0) stretch(s.p.id, s.a, s.b);
      const n2 = trimmed[k + 1];
      if (!n2) break;
      // In along piece k to the junction, round it, and out along piece k + 1: a cubic tangent
      // to both, its handles 0.6 of each trimmed end's way to the junction.
      const ca = curve(s.p.id);
      const cb = curve(n2.p.id);
      const p0 = ca.getPointAt(clamp01(s.b / ca.getLength()));
      const p3 = cb.getPointAt(clamp01(n2.a / cb.getLength()));
      const inDir = ca.getTangentAt(clamp01(s.b / ca.getLength())).multiplyScalar(s.dir); // the way it's going
      const outDir = cb.getTangentAt(clamp01(n2.a / cb.getLength())).multiplyScalar(n2.dir);
      const corner = new CubicBezierCurve3(
        p0,
        p0.clone().addScaledVector(inDir, Math.abs(s.p.to - s.b) * 0.6),
        p3.clone().addScaledVector(outDir, -Math.abs(n2.a - n2.p.from) * 0.6),
        p3,
      );
      const cornerLength = corner.getLength();
      const n = Math.max(2, Math.ceil(cornerLength / ROUTE_STEP));
      // The camera's rise round it: a cubic Hermite from link A's (its slope along the way it
      // runs) to link B's, in the corner's share u.
      const [r0, s0] = riseOn(ca, s.b);
      const [r1, s1] = riseOn(cb, n2.a);
      const m0 = s.dir * s0 * cornerLength;
      const m1 = n2.dir * s1 * cornerLength;
      const cornerFrom = Math.max(pts.length - 1, 0);
      for (let i = pts.length ? 1 : 0; i <= n; i++) {
        const u = i / n;
        const prev = pts.at(-1);
        pts.push(corner.getPointAt(u));
        tags.push(
          u < 0.5
            ? { id: s.p.id, at: s.b + (s.p.to - s.b) * 2 * u }
            : { id: n2.p.id, at: n2.p.from + (n2.a - n2.p.from) * (2 * u - 1) },
        );
        const u2 = u * u;
        const u3 = u2 * u;
        rises.push((2 * u3 - 3 * u2 + 1) * r0 + (u3 - 2 * u2 + u) * m0 + (3 * u2 - 2 * u3) * r1 + (u3 - u2) * m1);
        steps.push(prev ? pts.at(-1)!.distanceTo(prev) : 0);
      }
      corners.push([cornerFrom, pts.length - 1]);
    }
  }

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + steps[i]!);
  const length = pts.length > 1 ? cum.at(-1)! : 0;

  // The way's heading at each sample (its step on; the last, its step in), unwrapped, and its
  // running integral along the way, so its average over a stretch is the integral's
  // difference across it (cornerLook). Then each corner's turn, the stretch it's averaged
  // over and how much of it the ride takes.
  const heads: number[] = [];
  for (let i = 0; i < pts.length && pts.length > 1; i++) {
    const a = pts[Math.min(i, pts.length - 2)]!;
    const b = pts[Math.min(i + 1, pts.length - 1)]!;
    const h = Math.atan2(b.z - a.z, b.x - a.x);
    heads.push(i > 0 ? nearAngle(h, heads[i - 1]!) : h);
  }
  const headSum: number[] = [0];
  for (let i = 1; i < heads.length; i++) headSum.push(headSum[i - 1]! + ((heads[i]! + heads[i - 1]!) / 2) * (cum[i]! - cum[i - 1]!));
  const cl = tuning.flightCornerLook;
  const turns = corners
    .map(([a, b]) => {
      const turn = Math.abs(heads[Math.min(b, heads.length - 1)]! - heads[a]!);
      return { from: cum[a]!, to: cum[b]!, turn, weight: smoothstep(cl.from * DEG, cl.to * DEG, turn) };
    })
    .filter((c) => c.weight > 0);
  // One stretch for the whole way, set by its sharpest corner (it only counts near a corner).
  const window = Math.max(tuning.flightLookAhead, ...turns.map((c) => c.turn / (cl.degPerUnit * DEG)));
  /** How much of the corner look the ride takes at d (Route.cornerLook). */
  const cornerWeight = (d: number): number => {
    let w = 0;
    // In over cl.ease before the averaged stretch reaches the corner, out over it after the
    // corner: either side the way runs straight on and both looks run along it.
    for (const c of turns) w = Math.max(w, c.weight * smoothstep(c.from - window - cl.ease, c.from - window, d) * (1 - smoothstep(c.to, c.to + cl.ease, d)));
    return w;
  };
  /** The heading's integral from the way's start to x, held at its end values beyond it. */
  const headTo = (x: number): number => {
    if (x <= 0) return heads[0]! * x;
    if (x >= length) return headSum.at(-1)! + heads.at(-1)! * (x - length);
    const [i, f] = locate(x);
    const h = heads[i]! + (heads[Math.min(i + 1, heads.length - 1)]! - heads[i]!) * f;
    return headSum[i]! + ((heads[i]! + h) / 2) * f * (cum[Math.min(i + 1, cum.length - 1)]! - cum[i]!);
  };

  // Over each junction: the floor the camera keeps to on the stretch [in, out] within that
  // node's clearance radius, and how much of it holds either side, eased in from the way's
  // start (or the junction before) and out to its end (or the junction after).
  const windows: { floorY: number; from: number; rampIn: number; rampOut: number; to: number; view: boolean }[] = [];
  for (const j of junctions) {
    if (!j.turn || !(j.clear.radius > 0) || !Number.isFinite(j.clear.top)) continue;
    let hubIn = -1;
    let hubOut = -1;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (Math.hypot(p.x - j.at.x, p.z - j.at.z) >= j.clear.radius) continue;
      if (hubIn < 0) hubIn = cum[i]!;
      hubOut = cum[i]!;
    }
    if (hubIn >= 0) windows.push({ floorY: j.clear.top + tuning.flightHubClearance, from: 0, rampIn: hubIn, rampOut: hubOut, to: length, view: j.view });
  }
  windows.forEach((w, k) => {
    w.from = k > 0 ? windows[k - 1]!.rampOut : 0;
    w.to = k < windows.length - 1 ? windows[k + 1]!.rampIn : length;
  });
  for (const w of windows) {
    w.rampIn = Math.max(w.rampIn, w.from + LIFT_RAMP);
    w.rampOut = Math.min(w.rampOut, w.to - LIFT_RAMP);
  }
  const lift = (d: number, y: number, view = false): number => {
    if (windows.length === 0 || d <= 0 || d >= length) return 0;
    // Two junctions' lifts overlap between them (the origin's easing out as homelab's eases
    // in): they join as the root of their squares' sum, which is either one alone where the
    // other is 0, and smooth where both rise and fall. The larger of the two had a corner where
    // they crossed, a jolt and a lurch of the pitch (candygoogy-bot → laptop: 0.48, 4.3° a frame).
    let squares = 0;
    for (const w of windows) {
      if (d <= w.from || d >= w.to || (view && !w.view)) continue;
      const up = d < w.rampIn ? smoothstep(w.from, w.rampIn, d) : 1;
      const down = d > w.rampOut ? 1 - smoothstep(w.rampOut, w.to, d) : 1;
      // How far below the floor it is, softly never less than 0.
      const below = w.floorY - y;
      squares += (up * down * 0.5 * (below + Math.hypot(below, LIFT_SOFT))) ** 2;
    }
    return Math.sqrt(squares);
  };

  /** The sample i with cum[i] ≤ d ≤ cum[i + 1], and the share of the way on to i + 1. */
  function locate(d: number): [number, number] {
    const x = Math.min(Math.max(d, 0), length);
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= x) lo = mid;
      else hi = mid;
    }
    const span = cum[hi]! - cum[lo]!;
    return [lo, span > 0 ? (x - cum[lo]!) / span : 0];
  }

  // The averaged heading at d, and the look point's way (towards lookPoint, as sights looks):
  // the turn from the second to the first is followed along the samples from the way's start
  // (both run on continuously), so a blend between them never flips where they lie about
  // opposite each other mid-corner, whichever side the wrap would put it.
  const headAt = (d: number) => (headTo(d + window) - headTo(d)) / window;
  const onWay = new Vector3();
  const ahead = new Vector3();
  const aheadAt = (d: number, fallback: number): number => {
    route.pointAt(d, onWay);
    lookPoint(route, d, ahead).sub(onWay);
    return Math.hypot(ahead.x, ahead.z) > 1e-9 ? Math.atan2(ahead.z, ahead.x) : fallback;
  };
  let gaps: number[] | null = null;
  const gapRef = (d: number): number => {
    if (!gaps) {
      gaps = [];
      for (let i = 0; i < pts.length; i++) {
        const h = headAt(cum[i]!);
        const g = h - aheadAt(cum[i]!, h);
        gaps.push(i > 0 ? nearAngle(g, gaps[i - 1]!) : wrapAngle(g));
      }
    }
    const [i, f] = locate(d);
    return gaps[i]! + (gaps[Math.min(i + 1, gaps.length - 1)]! - gaps[i]!) * f;
  };

  const route: Route = {
    pieces,
    length,
    startNode,
    endNode,
    pointAt(d, out) {
      if (length === 0) return out;
      const [i, f] = locate(d);
      return out.lerpVectors(pts[i]!, pts[Math.min(i + 1, pts.length - 1)]!, f);
    },
    linkAt(d) {
      if (length === 0) return { id: null, at: 0 };
      const [i, f] = locate(d);
      const a = tags[i]!;
      const b = tags[Math.min(i + 1, tags.length - 1)]!;
      if (a.id === b.id) return { id: a.id, at: a.at + (b.at - a.at) * f };
      return f < 0.5 ? { ...a } : { ...b };
    },
    lift,
    rise(d) {
      if (length === 0) return 0;
      const [i, f] = locate(d);
      const a = rises[i]!;
      return a + (rises[Math.min(i + 1, rises.length - 1)]! - a) * f;
    },
    cornerLook(d, out) {
      out.weight = length > 0 ? cornerWeight(d) : 0;
      if (out.weight <= 0) {
        out.yaw = 0;
        return out;
      }
      const h = headAt(d);
      const a = aheadAt(d, h);
      out.yaw = a + out.weight * nearAngle(h - a, gapRef(d));
      return out;
    },
  };
  return route;
}

/**
 * The camera's rise (Route.rise) over link `c` at `at` along it, and its slope along the link:
 * tuning.flightArc·4f(1−f) over the straight line between the link's ends, less the line's own
 * height there over that straight line.
 */
function riseOn(c: Curve<Vector3>, at: number): [number, number] {
  const total = c.getLength();
  const f = clamp01(at / total);
  const y0 = c.getPointAt(0).y;
  const y1 = c.getPointAt(1).y;
  const arc = tuning.flightArc * 4 * f * (1 - f);
  const arcSlope = (tuning.flightArc * 4 * (1 - 2 * f)) / total;
  const over = c.getPointAt(f).y - (y0 + (y1 - y0) * f);
  const overSlope = c.getTangentAt(f).y - (y1 - y0) / total;
  return [arc - over, arcSlope - overSlope];
}

/** A pose's reach: its own, or the distance along its line of sight to the floor. */
function reachOf(p: DirPose): number {
  if (p.reach !== undefined) return p.reach;
  return p.forward.y < -0.05 ? Math.min(Math.max(p.position.y / -p.forward.y, 0.5), 500) : 10;
}

/** Unit-vector slerp from a to b; `out` may be either. */
function slerpDir(a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
  const dot = Math.min(Math.max(a.dot(b), -1), 1);
  const theta = Math.acos(dot);
  let wa = 1 - t;
  let wb = t;
  if (theta > 1e-6) {
    const s = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / s;
    wb = Math.sin(t * theta) / s;
  }
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize();
}

// Scratch for flightPose and divePose.
const onRoute = new Vector3();
const routeStart = new Vector3();
const routeEnd = new Vector3();
const lookAt = new Vector3();
const endTangent = new Vector3();
const focusFrom = new Vector3();
const focusTo = new Vector3();
const offset = new Vector3();
const follow = new Vector3();
const ORIGIN = new Vector3();

/** The turn the last orbitBlend took round its point (radians, a to b), for TurnBranch. */
let orbitTurn = 0;

/**
 * Between a and b by w, about the floor point c: angle round it, distance from it and height
 * each eased separately, so the move swings round a model rather than cutting across it. The
 * angle goes the short way, or the way nearest `ref` (a TurnBranch's, NaN for none), so it
 * doesn't flip sides where a and b are about opposite. `out` may be `a`.
 */
function orbitBlend(c: Vector3, a: Vector3, b: Vector3, w: number, out: Vector3, ref = NaN): Vector3 {
  const ax = a.x - c.x;
  const az = a.z - c.z;
  const bx = b.x - c.x;
  const bz = b.z - c.z;
  const ta = Math.atan2(az, ax);
  const raw = Math.atan2(bz, bx) - ta;
  const turn = Number.isNaN(ref) ? wrapAngle(raw) : nearAngle(raw, ref);
  orbitTurn = turn;
  if (w <= 0) return out.copy(a);
  if (w >= 1) return out.copy(b);
  const ra = Math.hypot(ax, az);
  const rb = Math.hypot(bx, bz);
  const theta = ta + turn * w;
  const r = ra + (rb - ra) * w;
  return out.set(c.x + r * Math.cos(theta), a.y + (b.y - a.y) * w, c.z + r * Math.sin(theta));
}

/** A flight's blends at u: how much of `from` is left (w0) and how much of `to` has come in (w1). */
function blends(u: number): [number, number] {
  return [1 - smoothstep(0, tuning.flightOnto, u), smoothstep(1 - tuning.flightOff, 1, u)];
}

/**
 * The look point at `along` on a route: tuning.flightLookAhead further along it, and past the
 * route's end on along its last stretch, level, towards the node it reaches (motion audit #1),
 * so the camera doesn't tip down at the floor as it closes in.
 */
function lookPoint(route: Route, along: number, out: Vector3): Vector3 {
  const ahead = along + tuning.flightLookAhead;
  if (ahead <= route.length) return route.pointAt(ahead, out);
  route.pointAt(route.length, out);
  route.pointAt(route.length - ROUTE_STEP, endTangent);
  endTangent.subVectors(out, endTangent).setY(0);
  if (endTangent.lengthSq() > 1e-12) out.addScaledVector(endTangent.normalize(), ahead - route.length);
  return out;
}

const aimFrom_ = new Vector3();
const aimTo = new Vector3();
const rideTarget = new Vector3();
const atLink = new Vector3();
const lookAhead = new Vector3();
const branchAt = new Vector3();
const corner: CornerLook = { yaw: 0, weight: 0 };

/**
 * What a flight camera standing at `position`, `along` its route and raised `lift` by the
 * hub, sees in each of the three directions it blends between, as a yaw (about +y, from +x
 * towards +z) and a downward pitch, radians: the ride's own target (R), what the pose it
 * leaves frames (A) and what the pose it lands on frames (B).
 *
 * The ride's target is a point on the floor tuning.flightLookAhead ahead of the camera's
 * point on the link towards the look point, so the ride looks down the link at about
 * atan(flightLift / flightLookAhead), 29°. Over the hub (`lift`) the ride's target and the
 * target it leaves rise with the camera, so the view keeps its pitch and the station it
 * leaves sinks away below; the target it lands on stays put, so a landing frames its station
 * as it always did, looking down at it from a little higher.
 */
const seen = { yR: 0, pR: 0, yA: 0, pA: 0, yB: 0, pB: 0 };
function sights(route: Route, position: Vector3, along: number, lift: number, from: DirPose, to: DirPose): typeof seen {
  route.pointAt(along, atLink);
  lookPoint(route, along, lookAhead);
  follow.subVectors(lookAhead, atLink).setY(0);
  const h = follow.length();
  rideTarget.set(atLink.x, lift, atLink.z);
  if (route.cornerLook(along, corner).weight > 0) {
    rideTarget.x += Math.cos(corner.yaw) * tuning.flightLookAhead;
    rideTarget.z += Math.sin(corner.yaw) * tuning.flightLookAhead;
  } else if (h > 1e-9) rideTarget.addScaledVector(follow, tuning.flightLookAhead / h);
  aimFrom_.copy(from.position).addScaledVector(from.forward, reachOf(from));
  aimFrom_.y += lift;
  aimTo.copy(to.position).addScaledVector(to.forward, reachOf(to));
  [seen.yR, seen.pR] = heading(rideTarget, position);
  [seen.yA, seen.pA] = poseSight(aimFrom_, position, from);
  [seen.yB, seen.pB] = poseSight(aimTo, position, to);
  return seen;
}

/**
 * The sight of what `pose` frames (`target`) from `position`: towards it while it lies as far
 * ahead along the pose's own view (on the floor) as it does from the pose itself, and easing
 * (smoothstep) to the pose's own view direction as it comes under the camera and behind it.
 * A camera flying over a station's target would otherwise see it spin round below it in a
 * frame or two (candygoogy-bot → notary, colophon → siel-eolie).
 */
function poseSight(target: Vector3, position: Vector3, pose: DirPose): [number, number] {
  const f = pose.forward;
  const gy = Math.atan2(f.z, f.x);
  const gp = Math.asin(Math.min(Math.max(-f.y, -1), 1));
  const flat = Math.hypot(f.x, f.z);
  if (flat < 1e-6) return [gy, gp];
  const ahead = ((target.x - position.x) * f.x + (target.z - position.z) * f.z) / flat;
  const k = smoothstep(0, reachOf(pose) * flat, ahead);
  if (k <= 0) return [gy, gp];
  const [y, p] = heading(target, position);
  return [gy + k * wrapAngle(y - gy), gp + k * (p - gp)];
}

/** The direction from `position` to `target` as a yaw and a downward pitch, radians. */
function heading(target: Vector3, position: Vector3): [number, number] {
  const dx = target.x - position.x;
  const dz = target.z - position.z;
  return [Math.atan2(dz, dx), Math.atan2(position.y - target.y, Math.hypot(dx, dz))];
}

/** An angle brought into (−π, π]: the short way round. */
function wrapAngle(a: number): number {
  return a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
}

/** The angle `a` (mod 2π) nearest `ref`. */
const nearAngle = (a: number, ref: number) => ref + wrapAngle(a - ref);

/**
 * Which way round a flight turns where it blends: its swings round the look point (orbitBlend,
 * leaving `from` and reaching `to`) and its view's turns between the ride's direction and each
 * end pose's (the yaw from R to A and from R to B, sights). Each is followed continuously
 * along the way (followBranches), from the short way where its blend is whole (u 0 for those
 * leaving `from`, u 1 for those reaching `to`), so it keeps to its side however far the two
 * drift apart and never flips where they are about opposite. NaN: none followed (the short
 * way). Without them the view flipped in a frame where the camera flew over a station's
 * target, and the camera itself jumped where a station is framed against its link (idiff →
 * colophon on a phone: 10 units in one sample).
 */
export interface TurnBranch {
  orbitFrom: number;
  orbitTo: number;
  /** yaw(A) − yaw(R). */
  toFrom: number;
  /** yaw(B) − yaw(R). */
  toTo: number;
}

/** The orbits' turns the last flightPosition took (NaN where it didn't orbit). */
let posOrbitFrom = NaN;
let posOrbitTo = NaN;

/** The camera's position on a flight at u (0..1), into `out`; returns its progress along the route and leaves the hub's lift in poseLift. */
function flightPosition(route: Route, from: DirPose, to: DirPose, x: number, orbitStart: boolean, out: Vector3, branch: TurnBranch): number {
  const along = route.length * x;
  const [w0, w1] = blends(x);
  lookPoint(route, along, lookAt);
  route.pointAt(along, onRoute).y += tuning.flightLift + route.rise(along);
  posOrbitFrom = posOrbitTo = NaN;
  if (orbitStart && route.startNode) {
    orbitBlend(lookAt, onRoute, from.position, w0, out, branch.orbitFrom);
    posOrbitFrom = orbitTurn;
  } else {
    route.pointAt(0, routeStart).y += tuning.flightLift + route.rise(0);
    out.copy(onRoute).addScaledVector(offset.subVectors(from.position, routeStart), w0);
  }
  if (route.endNode) {
    orbitBlend(lookAt, out, to.position, w1, out, branch.orbitTo);
    posOrbitTo = orbitTurn;
  } else {
    route.pointAt(route.length, routeEnd).y += tuning.flightLift + route.rise(route.length);
    out.addScaledVector(offset.subVectors(to.position, routeEnd), w1);
  }
  const lift = route.lift(along, out.y);
  poseView = route.lift(along, out.y, true);
  out.y += lift;
  poseLift = lift;
  return along;
}

/**
 * Where the camera looks, standing at `position`, `along` its route and raised `lift`: the
 * three sights (R, A, B) blended with w0 and w1 as a yaw and a pitch each (Phase 2, pitch
 * cap): the pitch moves between theirs and the yaw turns round on the side `branch` keeps.
 * Blending the targets as points (before) or the directions on a great circle (before that)
 * swung the view through straight down where the link heads back the way a station looks:
 * about 30 station-to-station flights peaked at 60–89°, the yaw flipping in a frame or two at
 * the bottom. The pitch is then soft-capped (capPitch). At u 0 it is A's exactly (`from`'s
 * forward, the camera standing on it), at u 1 B's.
 */
function aimFrom(route: Route, position: Vector3, along: number, lift: number, from: DirPose, to: DirPose, w0: number, w1: number, branch: TurnBranch, out: Vector3): void {
  const s = sights(route, position, along, lift, from, to);
  const dA = nearAngle(s.yA - s.yR, branch.toFrom);
  const dB = nearAngle(s.yB - s.yR, branch.toTo);
  // As the points blended: from R towards A by w0, then from there towards B by w1.
  const turned = w0 * dA;
  const yaw = s.yR + turned + w1 * (dB - turned);
  let down = s.pR + (s.pA - s.pR) * w0;
  down += (s.pB - down) * w1;
  down = capPitch(down, from, to, w0, w1);
  out.set(Math.cos(down) * Math.cos(yaw), -Math.sin(down), Math.cos(down) * Math.sin(yaw));
}

/** How soft the pitch cap is, in radians: it starts bending this far below the cap. */
const PITCH_KNEE = (12 * Math.PI) / 180;

/**
 * The soft pitch cap (tuning.flightPitchCap): a downward pitch `down` (radians) as it is up to
 * PITCH_KNEE below the cap, and above that easing towards the cap (a tanh knee, so its slope
 * and its bend are continuous: no kink). Where the flight blends into an end pose (w0, w1)
 * the cap rises with the blend to keep the knee above that pose's own pitch, so a framing
 * steeper than the cap is still left and reached exactly.
 */
function capPitch(down: number, from: DirPose, to: DirPose, w0: number, w1: number): number {
  const cap = (tuning.flightPitchCap * Math.PI) / 180;
  const over = (p: DirPose) => Math.max(0, Math.asin(Math.min(Math.max(-p.forward.y, -1), 1)) + PITCH_KNEE - cap);
  const knee = cap + w0 * over(from) + w1 * over(to) - PITCH_KNEE;
  return down <= knee ? down : knee + PITCH_KNEE * Math.tanh((down - knee) / PITCH_KNEE);
}

/**
 * A flight's TurnBranch followed PATH_SAMPLES to the whole way (in u): the orbit leaving `from`
 * from u 0 up, then the one reaching `to` (which swings round from where the first put it)
 * from u 1 down, then the view's turns, the same ways. Returns it at any u, interpolated.
 */
function followBranches(route: Route, from: DirPose, to: DirPose, orbitStart: boolean): (u: number, out: TurnBranch) => TurnBranch {
  const n = PATH_SAMPLES;
  const oF = new Float64Array(n + 1);
  const oT = new Float64Array(n + 1);
  const tF = new Float64Array(n + 1);
  const tT = new Float64Array(n + 1);
  const b: TurnBranch = { orbitFrom: NaN, orbitTo: NaN, toFrom: NaN, toTo: NaN };
  for (let i = 0; i <= n; i++) {
    b.orbitFrom = i > 0 ? oF[i - 1]! : NaN;
    flightPosition(route, from, to, i / n, orbitStart, branchAt, b);
    oF[i] = posOrbitFrom;
  }
  for (let i = n; i >= 0; i--) {
    b.orbitFrom = oF[i]!;
    b.orbitTo = i < n ? oT[i + 1]! : NaN;
    flightPosition(route, from, to, i / n, orbitStart, branchAt, b);
    oT[i] = posOrbitTo;
  }
  const yR = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    b.orbitFrom = oF[i]!;
    b.orbitTo = oT[i]!;
    const along = flightPosition(route, from, to, i / n, orbitStart, branchAt, b);
    const s = sights(route, branchAt, along, poseView, from, to);
    yR[i] = i > 0 ? nearAngle(s.yR, yR[i - 1]!) : s.yR;
    tF[i] = i > 0 ? nearAngle(s.yA - s.yR, tF[i - 1]!) : wrapAngle(s.yA - s.yR);
    tT[i] = s.yB - s.yR;
  }
  tT[n] = wrapAngle(tT[n]!);
  for (let i = n - 1; i >= 0; i--) tT[i] = nearAngle(tT[i]!, tT[i + 1]!);
  // Each turn started the short way where its blend is whole, but the two ends and the ride's
  // own turn in between can add up to the long way round: a whole extra circle, the view
  // swinging round with the ride where it could have turned back the other way (siel-eolie →
  // eolietech 344° for a 16° change of view, dolci-eoliani → homelab 360° for none). So each
  // turn is shifted by whole circles (−1, 0 or 1) to the pair that turns the view least in
  // all (aimFrom's yaw over the samples), none where that ties. A shift is a whole circle, so
  // the end poses are still met exactly and the turns still never flip.
  const turnOf = (kF: number, kT: number) => {
    let sum = 0;
    let last = 0;
    for (let i = 0; i <= n; i++) {
      const [w0, w1] = blends(i / n);
      const dA = tF[i]! + 2 * Math.PI * kF;
      const yaw = yR[i]! + w0 * dA + w1 * (tT[i]! + 2 * Math.PI * kT - w0 * dA);
      if (i > 0) sum += Math.abs(yaw - last);
      last = yaw;
    }
    return sum;
  };
  const asIs = turnOf(0, 0);
  let shift = [0, 0];
  let least = asIs;
  for (const kF of [0, -1, 1]) {
    for (const kT of [0, -1, 1]) {
      const t = turnOf(kF, kT);
      if (t < least - 1e-6) [least, shift] = [t, [kF, kT]];
    }
  }
  if (least > asIs - TURN_SAVING) shift = [0, 0];
  for (let i = 0; i <= n; i++) {
    tF[i] = tF[i]! + 2 * Math.PI * shift[0]!;
    tT[i] = tT[i]! + 2 * Math.PI * shift[1]!;
  }
  return (u, out) => {
    const x = clamp01(u) * n;
    const lo = Math.min(Math.floor(x), n - 1);
    const f = x - lo;
    const at = (a: Float64Array) => a[lo]! + (a[lo + 1]! - a[lo]!) * f;
    out.orbitFrom = at(oF);
    out.orbitTo = at(oT);
    out.toFrom = at(tF);
    out.toTo = at(tT);
    return out;
  };
}

/**
 * How much less a flight's view must turn in all (radians) before followBranches turns it the
 * other way round: about a tie, either way is as short, and the way it started is kept.
 */
const TURN_SAVING = (20 * Math.PI) / 180;

/** A lone flightPose's branches (the tests sample one flight many times): kept for the last flight asked. */
let lone: { route: Route; orbitStart: boolean; key: number[]; at: (u: number, out: TurnBranch) => TurnBranch } | null = null;
const loneBranch: TurnBranch = { orbitFrom: NaN, orbitTo: NaN, toFrom: NaN, toTo: NaN };
const poseKey = (p: DirPose) => [...p.position.toArray(), ...p.forward.toArray(), p.reach ?? NaN];

function loneBranches(route: Route, from: DirPose, to: DirPose, orbitStart: boolean): (u: number, out: TurnBranch) => TurnBranch {
  const key = [...poseKey(from), ...poseKey(to)];
  if (lone && lone.route === route && lone.orbitStart === orbitStart && lone.key.every((v, i) => Object.is(v, key[i]))) return lone.at;
  lone = { route, orbitStart, key, at: followBranches(route, from, to, orbitStart) };
  return lone.at;
}

/**
 * The flight camera at u (0..1) along its way from the pose `from` to the pose `to` by
 * `route`; returns its progress along the route. u is the way's own parameter, not time
 * (ridePose moves along it by length, with one ease). The camera rides the route lifted
 * tuning.flightLift and the route's rise (its own arc over each link), u × the route's
 * length along it, and looks at the route tuning.flightLookAhead further on (lookPoint). At
 * the start the offset from `from` fades out over tuning.flightOnto of u, at the end the
 * offset to `to` fades in over tuning.flightOff. Leaving a station (`orbitStart`) and
 * arriving at one, those blends swing round the point it looks at (orbitBlend) rather than
 * cutting across to it, so the camera joins the link heading the way the link goes. Its
 * direction turns from `from`'s and into `to`'s with the same blends (aimFrom). Over the hub
 * the camera then rises by the route's lift, after the blends, so it clears the origin's
 * model whatever it blends with (the lift is 0 at either end), and what it looks at follows.
 * A route of length 0 has no ride: it dives (divePose). `branch` is the turn followed up to
 * here (flightPath's); without one, flightPose follows it itself. `out` must not be `from`
 * or `to`.
 */
export function flightPose(route: Route, from: DirPose, to: DirPose, u: number, out: DirPose, orbitStart = false, branch?: TurnBranch): number {
  const x = clamp01(u);
  out.reach = undefined;
  if (route.length === 0) {
    divePose(from, to, x, out);
    return 0;
  }
  const [w0, w1] = blends(x);
  const turns = branch ?? loneBranches(route, from, to, orbitStart)(x, loneBranch);
  const along = flightPosition(route, from, to, x, orbitStart, out.position, turns);
  aimFrom(route, out.position, along, poseView, from, to, w0, w1, turns, out.forward);
  return along;
}

/** The lift the last flightPose applied, and the share of it that raised its view too:
 *  flightPath keeps both with each sample, for ridePose. */
let poseLift = 0;
let poseView = 0;

/**
 * A dive (motion audit #2B): from one framing to another with no link to follow, the overview
 * to a station or back. What it looks at moves straight from `from`'s to `to`'s, its direction
 * turns on the great circle between theirs, and its distance from what it looks at goes
 * geometrically, reach0^(1-e) * reach1^e, so the view zooms at an even rate on screen rather
 * than rushing and then crawling, and it never overshoots either pose's pitch. e is the eased
 * time share; at 0 it is `from` and at 1 `to`, exactly. `out` must not be `from` or `to`.
 */
export function divePose(from: DirPose, to: DirPose, e: number, out: DirPose): void {
  const r0 = reachOf(from);
  const r1 = reachOf(to);
  focusFrom.copy(from.position).addScaledVector(from.forward, r0);
  focusTo.copy(to.position).addScaledVector(to.forward, r1);
  slerpDir(from.forward, to.forward, e, out.forward);
  const reach = r0 ** (1 - e) * r1 ** e;
  out.position.lerpVectors(focusFrom, focusTo, e).addScaledVector(out.forward, -reach);
  out.reach = reach;
}

/**
 * Map rotation: the pose a flight leaves from as it unturns, at k (0..1): from `turned` (the
 * view as the visitor turned it, and maybe zoomed) to `rest` (the framing as composed), swung
 * round what each looks at (the same target, unless zoomed) as that slides from the one to the
 * other, so a flight's way and its turns are those of the composed view (ridePose blends the
 * difference out as its source moves). Into `out`; returns it.
 */
export function unturnPose(turned: DirPose, rest: DirPose, k: number, out: DirPose): DirPose {
  const r0 = reachOf(turned);
  const r1 = reachOf(rest);
  focusFrom.copy(turned.position).addScaledVector(turned.forward, r0);
  focusTo.copy(rest.position).addScaledVector(rest.forward, r1);
  offset.subVectors(turned.position, focusFrom);
  follow.subVectors(rest.position, focusTo);
  orbitBlend(ORIGIN, offset, follow, k, out.position);
  lookAt.lerpVectors(focusFrom, focusTo, k);
  out.position.add(lookAt);
  out.forward.subVectors(lookAt, out.position).normalize();
  out.reach = r0 + (r1 - r0) * k;
  return out;
}

/** Samples along a flight's way, in u and again evenly by its measure, for its table. */
const PATH_SAMPLES = 256;

/**
 * A ride's way, measured (motion audit #2A): flightPose's poses, where each step counts its
 * distance and its turn, the turn as tuning.flightTurnUnits world units a radian, so one ease
 * along the measure gives a single speed hump, and slows the camera only where it has to turn
 * (a station framed against the link's way round). The positions are then smoothed over
 * tuning.flightSmoothing either side, so no bend is tighter than that. Built from the poses as
 * they are at take-off; ridePose adds how far the two ends have moved since (a moving flight
 * underneath, the drift).
 */
export interface FlightPath {
  /** The way's measure: world units, and turns as flightTurnUnits a radian. */
  readonly total: number;
  /** The poses it was built between. */
  readonly from: Vector3;
  readonly to: Vector3;
  /** The point `share` (0..1) of the way along by its measure into `out`; returns flightPose's u there. */
  at(share: number, out: Vector3): number;
  /** How much the hub's lift raised the camera `share` of the way along (flightPose's). */
  lift(share: number): number;
  /** How much of that raised its view too (the origin's lift; Route.lift with `view`). */
  view(share: number): number;
  /** The view's turn branch (TurnBranch) as flightPose followed it, at its u, into `out`. */
  turns(u: number, out: TurnBranch): TurnBranch;
}

export function flightPath(route: Route, from: DirPose, to: DirPose, orbitStart = false): FlightPath {
  const N = PATH_SAMPLES;
  const p: DirPose = { position: new Vector3(), forward: new Vector3() };
  const raw = new Float64Array(3 * (N + 1));
  const fwd = new Float64Array(3 * (N + 1));
  const lifts = new Float64Array(N + 1);
  const views = new Float64Array(N + 1);
  const cum = new Float64Array(N + 1);
  const turns = followBranches(route, from, to, orbitStart);
  const t: TurnBranch = { orbitFrom: NaN, orbitTo: NaN, toFrom: NaN, toTo: NaN };
  for (let i = 0; i <= N; i++) {
    flightPose(route, from, to, i / N, p, orbitStart, turns(i / N, t));
    lifts[i] = poseLift;
    views[i] = poseView;
    raw.set([p.position.x, p.position.y, p.position.z], 3 * i);
    fwd.set([p.forward.x, p.forward.y, p.forward.z], 3 * i);
    if (i > 0) cum[i] = cum[i - 1]! + Math.hypot(raw[3 * i]! - raw[3 * i - 3]!, raw[3 * i + 1]! - raw[3 * i - 2]!, raw[3 * i + 2]! - raw[3 * i - 1]!);
  }
  const rawTotal = cum[N]!;

  // Evenly by distance: sample j sits j/N of the way, with its u, its view's direction and its lift.
  const even = new Float64Array(3 * (N + 1));
  const evenF = new Float64Array(3 * (N + 1));
  const evenU = new Float64Array(N + 1);
  const evenL = new Float64Array(N + 1);
  const evenV = new Float64Array(N + 1);
  let i = 0;
  for (let j = 0; j <= N; j++) {
    const d = (j / N) * rawTotal;
    while (i < N - 1 && cum[i + 1]! < d) i++;
    const span = cum[i + 1]! - cum[i]!;
    const f = span > 0 ? Math.min(Math.max((d - cum[i]!) / span, 0), 1) : 0;
    for (let k = 0; k < 3; k++) {
      even[3 * j + k] = raw[3 * i + k]! + (raw[3 * i + 3 + k]! - raw[3 * i + k]!) * f;
      evenF[3 * j + k] = fwd[3 * i + k]! + (fwd[3 * i + 3 + k]! - fwd[3 * i + k]!) * f;
    }
    evenU[j] = (i + f) / N;
    evenL[j] = lifts[i]! + (lifts[i + 1]! - lifts[i]!) * f;
    evenV[j] = views[i]! + (views[i + 1]! - views[i]!) * f;
  }

  // Smoothed: two box passes (a tent), the window narrowing to nothing at either end so the
  // way still starts and ends exactly on its poses. The hub's lift is taken out first and put
  // back after: it is smooth already (eased in and out, a soft floor), and averaging it with
  // its ramps pulled the camera below the floor near the edge of the hub's radius.
  const r = rawTotal > 0 ? Math.round((tuning.flightSmoothing / rawTotal) * N) : 0;
  for (let j = 0; j <= N; j++) even[3 * j + 1] = even[3 * j + 1]! - evenL[j]!;
  let pts = even;
  for (let pass = 0; pass < 2 && r > 0; pass++) {
    const sum = new Float64Array(3 * (N + 2));
    for (let j = 0; j <= N; j++) for (let k = 0; k < 3; k++) sum[3 * (j + 1) + k] = sum[3 * j + k]! + pts[3 * j + k]!;
    const next = new Float64Array(3 * (N + 1));
    for (let j = 0; j <= N; j++) {
      const w = Math.min(r, j, N - j);
      for (let k = 0; k < 3; k++) next[3 * j + k] = (sum[3 * (j + w + 1) + k]! - sum[3 * (j - w) + k]!) / (2 * w + 1);
    }
    pts = next;
  }
  for (let j = 0; j <= N; j++) pts[3 * j + 1] = pts[3 * j + 1]! + evenL[j]!;

  // The measure: each step's length, and its turns (the way's change of heading and the
  // view's), a radian counting tuning.flightTurnUnits.
  const len = new Float64Array(N + 1);
  const angle = (a: Float64Array, i: number, b: Float64Array, j: number) => {
    const la = Math.hypot(a[i]!, a[i + 1]!, a[i + 2]!);
    const lb = Math.hypot(b[j]!, b[j + 1]!, b[j + 2]!);
    if (la < 1e-9 || lb < 1e-9) return 0;
    return Math.acos(Math.min(Math.max((a[i]! * b[j]! + a[i + 1]! * b[j + 1]! + a[i + 2]! * b[j + 2]!) / (la * lb), -1), 1));
  };
  const step = new Float64Array(3 * (N + 1));
  for (let j = 1; j <= N; j++) for (let k = 0; k < 3; k++) step[3 * j + k] = pts[3 * j + k]! - pts[3 * j - 3 + k]!;
  // Each step's turn, spread over tuning.flightTurnSpread either side, so the camera eases
  // into a turn and out of it instead of braking at its apex.
  const turned = new Float64Array(N + 2);
  for (let j = 1; j <= N; j++) {
    const bend = j > 1 ? angle(step, 3 * j, step, 3 * j - 3) : 0;
    turned[j + 1] = turned[j]! + bend + angle(evenF, 3 * j, evenF, 3 * j - 3);
  }
  const rt = rawTotal > 0 ? Math.max(Math.round((tuning.flightTurnSpread / rawTotal) * N), 1) : 1;
  for (let j = 1; j <= N; j++) {
    const d = Math.hypot(step[3 * j]!, step[3 * j + 1]!, step[3 * j + 2]!);
    const a = Math.max(j - rt, 1);
    const b = Math.min(j + rt, N);
    const turn = (turned[b + 1]! - turned[a]!) / (2 * rt + 1);
    len[j] = len[j - 1]! + Math.hypot(d, turn * tuning.flightTurnUnits);
  }
  const total = len[N]!;
  /** The samples lo and lo + 1 either side of `share` by the measure, and the share of the way between. */
  const locate = (share: number): [number, number, number] => {
    const d = clamp01(share) * total;
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (len[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const span = len[hi]! - len[lo]!;
    return [lo, hi, span > 0 ? (d - len[lo]!) / span : 0];
  };
  return {
    total,
    from: from.position.clone(),
    to: to.position.clone(),
    at(share, out) {
      const [lo, hi, f] = locate(share);
      out.set(
        pts[3 * lo]! + (pts[3 * hi]! - pts[3 * lo]!) * f,
        pts[3 * lo + 1]! + (pts[3 * hi + 1]! - pts[3 * lo + 1]!) * f,
        pts[3 * lo + 2]! + (pts[3 * hi + 2]! - pts[3 * lo + 2]!) * f,
      );
      return evenU[lo]! + (evenU[hi]! - evenU[lo]!) * f;
    },
    lift(share) {
      const [lo, hi, f] = locate(share);
      return evenL[lo]! + (evenL[hi]! - evenL[lo]!) * f;
    },
    view(share) {
      const [lo, hi, f] = locate(share);
      return evenV[lo]! + (evenV[hi]! - evenV[lo]!) * f;
    },
    turns,
  };
}

const ridePoint = new Vector3();
const rideTurns: TurnBranch = { orbitFrom: NaN, orbitTo: NaN, toFrom: NaN, toTo: NaN };

/**
 * A ride at the eased share e of its way: where `path` puts it, plus however far `from` and
 * `to` have moved since the path was built, faded with the blends (so a moving flight
 * underneath, or the drift, carries through without a jump). It looks as flightPose would.
 * Returns the progress along the route.
 */
export function ridePose(route: Route, path: FlightPath, from: DirPose, to: DirPose, e: number, out: DirPose): number {
  const u = path.at(e, ridePoint);
  const [w0, w1] = blends(u);
  const along = route.length * u;
  out.reach = undefined;
  out.position
    .copy(ridePoint)
    .addScaledVector(offset.subVectors(from.position, path.from), w0)
    .addScaledVector(offset.subVectors(to.position, path.to), w1);
  aimFrom(route, out.position, along, path.view(e), from, to, w0, w1, path.turns(u, rideTurns), out.forward);
  return along;
}

// --- the director -----------------------------------------------------------------------------

interface Flight extends FlightInfo {
  t: number;
  along: number;
  rate: number;
  /** No link to ride (to or from the overview): a geometric zoom, divePose. */
  readonly dive: boolean;
  /** A moment's ride (Director.follow), in place of the dive. */
  readonly guide?: Guide['pose'] | undefined;
  /** A ride's arc-length table (null for a dive). */
  readonly path: FlightPath | null;
  /** The pose it ends on: the framing, orbited by the drift as it is now (kept up each frame). */
  readonly end: DirPose;
  readonly framing: Pose;
  readonly start: number;
  /** What it leaves from: a pose, or the flight it interrupted, still moving underneath. */
  source: DirPose | Flight;
  /** The turned view it left from (map rotation), unturning to `source` over `unturnShare` of it; or null. */
  readonly unturn: DirPose | null;
  readonly unturnShare: number;
  /** Where a flight with no route started on the network (for one that interrupts it). */
  readonly startLink: LinkPos;
  /** It left from a station's framing, so it swings round that model onto the link. */
  readonly orbitStart: boolean;
  /** Scratch for evaluating a moving source. */
  readonly sourcePose: DirPose;
  sheetOpened: boolean;
}

const isFlight = (s: DirPose | Flight): s is Flight => 'route' in s;
const copyPose = (p: DirPose): DirPose => ({ position: p.position.clone(), forward: p.forward.clone(), reach: p.reach });

/** Where flight `f` puts the camera at director time `now` (it touches nothing else). */
function evalFlight(f: Flight, now: number, out: DirPose): void {
  const t = clamp01((now - f.start) / f.duration);
  let src: DirPose;
  if (isFlight(f.source)) {
    const old = f.source;
    evalFlight(old, now, f.sourcePose);
    src = f.sourcePose;
    if (now - old.start >= old.duration) f.source = copyPose(src); // it has landed: still from here on
  } else {
    src = f.unturn ? unturnPose(f.unturn, f.source, smoothstep(0, f.unturnShare, t), f.sourcePose) : f.source;
  }
  f.t = t;
  const e = easeInOutCubic(t);
  if (f.dive) {
    if (f.guide) f.guide(t, src, f.end, out);
    else divePose(src, f.end, e, out);
    f.along = f.route.length * e; // the visitor's own progress out along the link (Task 11)
    return;
  }
  f.along = ridePose(f.route, f.path!, src, f.end, e, out);
  // Once blended out, the source no longer matters: drop the chain behind it.
  if (f.along >= tuning.flightOnto * f.route.length && isFlight(f.source)) f.source = copyPose(src);
}

interface ArrivalNode {
  reach: number;
  phase: 'hidden' | 'appearing' | 'done';
}

interface Arrival {
  t: number;
  fit: OverviewFit;
  /** The framing a model's coming in moved it from, and when (tuning.arrivalJoin). */
  from: { target: Vector3; s: number; t: number } | null;
  clip: 'arrival' | 'arrival_portrait';
  length: number;
  nodes: Map<string, ArrivalNode>;
  /** Each link's draw: it starts at reach − span and takes span seconds. */
  links: Map<string, { start: number; span: number }>;
}

const UP = new Vector3(0, 1, 0);
const DEG = Math.PI / 180;
/** The authored stagger between reach markers, for ids world.blend doesn't place yet. */
const UNKNOWN_STAGGER = 0.12;
const SETTLED = 1e-4;
/** The docked gondola's room around its pin on the line: across (its half-length and a
 *  little), above (the grip on the line) and below (its cabin, tuning.visitorDrop). */
const DOCK_ROOM = 0.25;
const DOCK_TOP = 0.04;
const dockAt = new Vector3();
const dockCorner = new Vector3();
const docked = new Box3();

/**
 * A station's model bounds (root space, NodeView.bounds) and the visitor's gondola docked on
 * its link `c` (Task 11), into `out` (which may be `bounds`), so the station fit keeps both in
 * view: only the camera's distance changes. Not the origin's, whose park depends on the link
 * the capsule came by: there it is the bounds as they are.
 */
export function dockedBounds(id: string, bounds: Box3, home: Vector3, c: Curve<Vector3>, out: Box3): Box3 {
  out.copy(bounds);
  if (id === 'origin' || bounds.isEmpty()) return out;
  const L = c.getLength();
  c.getPointAt(clamp01((L - dockDistance(c, 'node')) / L), dockAt).sub(home);
  return out
    .expandByPoint(dockCorner.set(dockAt.x - DOCK_ROOM, dockAt.y - tuning.visitorDrop, dockAt.z - DOCK_ROOM))
    .expandByPoint(dockAt.add(dockCorner.set(DOCK_ROOM, DOCK_TOP, DOCK_ROOM)));
}

export function createDirector(
  stage: DirectorStage,
  links: Pick<Links, 'curve' | 'drawProgress' | 'setRoute'> & Partial<Pick<Links, 'parent'>>,
  nodes: Pick<Nodes, 'get' | 'all' | 'ready'>,
  stations: Pick<Stations, 'ids' | 'current' | 'subscribe'>,
  clock: Pick<Clock, 'add' | 'invalidate'>,
  opts: DirectorOptions,
): Director {
  const { world, positions, labels } = opts;
  const camera = stage.camera;
  const setSheet = opts.setSheet ?? ((s: SheetState, framed: SheetState = s) => stage.setSheet(framed));
  // A hidden node (Task 17, the duck) never joins the overview's fit, found or not: the overview
  // is the owner's composition. On a desktop it already stands inside it (fit.test); on a phone
  // it's off the far edge.
  const points = [...positions].filter(([id]) => !HIDDEN.includes(id)).map(([, p]) => p);
  const ids = stations.ids.filter((id) => positions.has(id));
  const linked = ids.filter((id) => id !== 'origin');
  const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  const doc = document;
  const win = window;
  const linksGroup = stage.scene.getObjectByName('links') ?? null;

  let state: DirectorState = 'arrival';
  let disposed = false;
  let time = 0; // director seconds: the sum of the clock's dts while it ticks, a flight's scaled
  let timeScale = 1;
  let receiptHeight: number | null = null;
  let rest: Pose | null = null; // the framing the camera rests at (overview, station)
  let restId: string | null = null;
  let flight: Flight | null = null;
  let guide: Guide | null = null;
  let arrival: Arrival | null = null;
  let routeLit: string | null = null;
  const listeners = new Set<(f: FlightInfo | null) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let markArrived = (): void => undefined;
  const arrived = new Promise<void>((resolve) => (markArrived = resolve));

  // --- the tick: only while the arrival runs, a flight flies or the drift settles -------------

  let offTick: (() => void) | null = null;
  const wake = () => {
    if (!disposed) offTick ??= clock.add(tick);
  };

  function tick(dt: number): boolean {
    time += flight ? dt * timeScale : dt;
    let busy = false;
    if (arrival) busy = stepArrival(dt);
    if (flight) {
      stepFlight();
      busy ||= flight !== null;
    }
    if (state !== 'arrival') busy = stepDrift(dt) || busy;
    if (!busy) {
      offTick?.();
      offTick = null;
    }
    return busy;
  }

  // --- framing ---------------------------------------------------------------------------------

  /** Every label's room beside its model, so the overview keeps them all in view. */
  function labelRooms(): LabelRoom[] {
    return ids.map((id) => {
      const n = nodes.get(id);
      const centre = n.home.clone();
      let halfWidth = 0;
      if (!n.bounds.isEmpty()) {
        centre.add(n.bounds.getCenter(scratch));
        halfWidth = Math.hypot(n.bounds.max.x - n.bounds.min.x, n.bounds.max.z - n.bounds.min.z) / 2;
      }
      return { centre, halfWidth, px: labels.room(id) };
    });
  }

  function overviewFit(): OverviewFit {
    const vp = stage.viewport;
    return overviewCamera(world, vp, panelInsetFor(vp.width, vp.height, 'peek'), points, labelRooms());
  }

  /** A framing, turned `yaw` radians by the visitor (0: as fitted at rest). */
  function framing(id: string | null, yaw = 0): Pose {
    const vp = stage.viewport;
    if (id === null) {
      if (!yaw) return overviewFit();
      const all = ids.flatMap((i) => (nodes.get(i).bounds.isEmpty() ? [] : corners(nodes.get(i).bounds, nodes.get(i).home)));
      return overviewCamera(world, vp, panelInsetFor(vp.width, vp.height, 'peek'), points, labelRooms(), yaw, all);
    }
    const node = stationNode(id);
    const n = nodes.get(node);
    const side = vp.width >= tuning.panelMinViewportPx; // a bottom sheet names the station itself
    const inset = panelInsetFor(vp.width, vp.height, 'open');
    if (id === RECEIPT) {
      // The strip fed out stands over the printer: frame it with the receipt camera, if any.
      const { min, max } = tuning.receiptBox;
      receiptBox.min.fromArray(min);
      receiptBox.max.fromArray(max);
      if (receiptHeight !== null) receiptBox.max.y = Math.min(max[1]!, min[1]! + receiptHeight);
      const cams = world.cameras.receipt ? { ...world.cameras, [`station_${node}`]: world.cameras.receipt } : world.cameras;
      return stationCamera({ ...world, cameras: cams }, node, n.home, receiptBox, vp, inset, 0, tuning.receiptMargin, undefined, yaw);
    }
    const bounds = id === 'origin' ? n.bounds : dockedBounds(id, n.bounds, n.home, curve(id), docked);
    return stationCamera(world, id, n.home, bounds, vp, inset, side ? tuning.stationLabelPx : 0, undefined, undefined, yaw);
  }

  const scratch = new Vector3();
  const panned = new Vector3();
  const offAt = new Vector3();
  const receiptBox = new Box3();
  const orbit = new Vector3();
  const right = new Vector3();

  function place(position: Vector3, look: Vector3): void {
    camera.position.copy(position);
    camera.lookAt(look);
    camera.updateMatrixWorld();
  }

  /** Where a framing's camera stands, orbited about its target by the drift. */
  function orbited(p: Pose, out: Vector3): Vector3 {
    orbit.subVectors(p.position, p.target);
    if (yaw.x !== 0 || pitch.x !== 0) {
      orbit.applyAxisAngle(UP, yaw.x * tuning.driftYawDeg * DEG);
      right.crossVectors(UP, orbit).normalize(); // the camera's right
      orbit.applyAxisAngle(right, -pitch.x * tuning.driftPitchDeg * DEG); // pointer up, camera up
    }
    return out.addVectors(p.target, orbit);
  }

  /** A framing as a flight's end pose, with the drift as it is now (motion audit #13). */
  function drifted(p: Pose, out: DirPose): DirPose {
    orbited(p, out.position);
    out.forward.subVectors(p.target, out.position).normalize();
    out.reach = p.position.distanceTo(p.target);
    return out;
  }

  /** The resting framing, orbited by the drift. */
  function applyRest(): void {
    if (!rest) return;
    place(orbited(rest, scratch), rest.target);
  }

  function applyPose(p: DirPose): void {
    place(p.position, scratch.addVectors(p.position, p.forward));
  }

  /** The camera as it stands, for a flight to leave from (at rest, its reach is the framing's). */
  function capture(): DirPose {
    return {
      position: camera.position.clone(),
      forward: new Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
      reach: rest && !flight ? rest.position.distanceTo(rest.target) : undefined,
    };
  }

  // --- drift -----------------------------------------------------------------------------------

  const yaw: Spring = { x: 0, v: 0 };
  const pitch: Spring = { x: 0, v: 0 };
  const aim = { x: 0, y: 0 };
  const driftOn = () => !prefs.reduced && !coarse?.matches;

  function stopDrift(): void {
    yaw.x = yaw.v = pitch.x = pitch.v = 0;
    yaw.carry = pitch.carry = 0;
  }

  function stepDrift(dt: number): boolean {
    const tx = driftOn() ? aim.x : 0;
    const ty = driftOn() ? aim.y : 0;
    if (yaw.x === tx && pitch.x === ty && yaw.v === 0 && pitch.v === 0) return false;
    const { k, c } = tuning.driftSpring;
    stepSpring(yaw, tx, dt, k, c);
    stepSpring(pitch, ty, dt, k, c);
    const settled =
      Math.abs(yaw.x - tx) < SETTLED && Math.abs(yaw.v) < SETTLED && Math.abs(pitch.x - ty) < SETTLED && Math.abs(pitch.v) < SETTLED;
    if (settled) {
      yaw.x = tx;
      pitch.x = ty;
      yaw.v = pitch.v = 0;
    }
    if (state !== 'flying') applyRest(); // in flight it bends the end pose instead (stepFlight)
    return !settled;
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch' || !driftOn() || dragAt !== null || held) return; // a drag turning or panning the map holds the aim
    // Over the visible part of the canvas, -1..1; held at the edge over the panel.
    const vp = stage.viewport;
    const inset = panelInsetFor(vp.width, vp.height, state === 'station' || state === 'receipt' ? 'open' : 'peek');
    const w = Math.max(vp.width - inset.right, 1);
    const h = Math.max(vp.height - inset.bottom, 1);
    const x = Math.min(Math.max((e.clientX / w) * 2 - 1, -1), 1);
    const y = Math.min(Math.max(1 - (e.clientY / h) * 2, -1), 1);
    if (x === aim.x && y === aim.y) return;
    aim.x = x;
    aim.y = y;
    if (state !== 'arrival' && state !== 'flying') wake();
  }

  function onPointerLeave(): void {
    aim.x = aim.y = 0;
    if (state !== 'arrival' && state !== 'flying') wake();
  }

  // --- turn ------------------------------------------------------------------------------------

  let turn = 0; // degrees, as shown (turnLimit; wrapDeg in the overview)
  let turnRaw = 0; // degrees, as dragged
  let dragAt: number | null = null; // the floor drag's last dx while it turns the map
  let zoom = 1; // the overview's distance, as a share of its fit's
  const pan = new Vector3(); // the overview's target off its framing's, in the unturned view's terms (x, z)
  let held = false;
  let composed = false; // composeNext
  const turnable = () => state === 'overview' || state === 'station';
  let keep: ((target: Vector3, points: readonly Vector3[]) => void) | null = null;
  // A turn of the zoomed or panned overview: where it started (degrees), the target it looked at
  // then and the point it turns about. Kept while the turn goes on, so turning back lands exactly
  // where it started; any zoom, pan, refit or travel lets it go (turnAbout).
  let about: { from: number; target: Vector3; pivot: Vector3 } | null = null;
  const middle = middleOf(points);
  const hub = positions.get('origin');
  const inner = hub ? points.filter((p) => p !== hub && p.distanceTo(hub) < tuning.rangeRings[1]) : [];

  /** `v` (x, z) turned `yaw` radians as fit.ts's turned() swings a camera. Into `v`. */
  const swing = (v: Vector3, yaw: number) => v.set(v.x * Math.cos(yaw) + v.z * Math.sin(yaw), v.y, v.z * Math.cos(yaw) - v.x * Math.sin(yaw));

  /**
   * The overview turned `yaw` radians, at zoom `z`, its target moved `by` (unturned, x and z) and
   * kept within reach (bound); with `back`, the pan as kept goes back into `by`.
   */
  function overviewAt(yaw: number, z: number, by: Vector3, back = false): Pose {
    const p = framing(null, yaw);
    if (z === 1 && by.x === 0 && by.z === 0) return p;
    const off = offAt.subVectors(p.position, p.target);
    const from = p.target.clone();
    p.target.add(swing(panned.copy(by), yaw));
    keep?.(p.target, points);
    p.position.copy(p.target).addScaledVector(off, zoomedReach(yaw, z, off.length()));
    if (back) swing(by.subVectors(p.target, from), -yaw);
    return p;
  }

  /**
   * What the turned overview's offset (`reach` long) is multiplied by at zoom z: z, but zoomed in
   * the turned fit's pull back gives way to the unturned fit's distance (turnPivotShare by the
   * zoom), so a turn keeps the zoomed distance. Just z unturned, or as composed.
   */
  function zoomedReach(yaw: number, z: number, reach: number): number {
    const k = yaw ? turnPivotShare(z) : 0;
    if (k === 0) return z;
    const f = overviewFit();
    return z * (f.position.distanceTo(f.target) / reach) ** k;
  }

  /**
   * Zoomed in or panned, the overview turned to `to` degrees about the view's centre (`about`):
   * the pan set so that the target swings round the pivot from where the turn started, the clamp
   * (overviewAt) still holding it. Nothing to do as composed: it turns about the network's middle,
   * as framing() has it.
   */
  function turnAbout(to: number): void {
    if (zoom === 1 && pan.x === 0 && pan.z === 0) return;
    if (!about) {
      const target = overviewAt(turn * DEG, zoom, pan).target;
      const pivot = middle.clone().setY(target.y).lerp(target, turnPivotShare(zoom, Math.hypot(pan.x, pan.z)));
      about = { from: turn, target, pivot };
    }
    const yaw = to * DEG;
    const target = swing(panned.subVectors(about.target, about.pivot), (to - about.from) * DEG).add(about.pivot);
    swing(pan.subVectors(target, framing(null, yaw).target).setY(0), -yaw);
  }

  /**
   * The overview travel brings back, and the visitor starts at: the composed one, but on a phone
   * (the portrait overview) closer, centred on the hub, the inner ring of stations (inside the
   * outer range ring) just filling the visible width, each with the overview's footprint margin,
   * but never closer than tuning.zoom.home (a tablet's would crop the network).
   */
  function homeView(): { zoom: number; pan: Vector3 } {
    const f = overviewFit();
    if (f.camera !== 'overviewPortrait' || !hub) return { zoom: 1, pan: new Vector3() };
    const cam = world.cameras.overviewPortrait;
    const at = (v: readonly number[], i: number) => v[i]! - cam.target[i]! + hub.getComponent(i);
    const centred = { position: [0, 1, 2].map((i) => at(cam.position, i)), target: hub.toArray(), fovY: cam.fovY };
    const vp = stage.viewport;
    const s = fitScale(centred, inner, vp, panelInsetFor(vp.width, vp.height, 'peek'));
    return { zoom: Math.min(Math.max(s / f.s, tuning.zoom.home), 1), pan: new Vector3(hub.x - f.target.x, 0, hub.z - f.target.z) };
  }

  /** The framing the camera rests at: the turned one, and in the overview zoomed and panned. */
  function resting(): Pose {
    return restId === null ? overviewAt(turn * DEG, zoom, pan, true) : framing(restId, turn * DEG);
  }

  function rerest(): void {
    rest = resting();
    applyRest();
    clock.invalidate();
  }

  function turnTo(raw: number): void {
    let t: number;
    if (restId === null) {
      t = turnRaw = wrapDeg(raw); // all the way round
    } else {
      const max = tuning.turn.stationDeg;
      const soft = !prefs.reduced;
      // Never far past the clamp (0.99 of it shown), so turning back answers at once.
      const lim = soft ? max * 1.4 : max;
      turnRaw = Math.min(Math.max(raw, -lim), lim);
      t = turnLimit(turnRaw, max, soft);
    }
    if (t === turn) return;
    if (restId === null) turnAbout(t);
    turn = t;
    rerest();
  }

  /** Travel resets the turn, the zoom and the pan: to the overview's home. */
  function resetTurn(): void {
    turn = turnRaw = 0;
    about = null;
    const h = composed ? { zoom: 1, pan: new Vector3() } : homeView();
    composed = false;
    zoom = h.zoom;
    pan.copy(h.pan);
    dragAt = null;
  }

  function turnDrag(dx: number | null): boolean {
    if (dx === null || !turnable()) {
      const was = dragAt !== null;
      dragAt = null;
      return dx === null && was;
    }
    const vp = stage.viewport;
    const w = Math.max(vp.width - panelInsetFor(vp.width, vp.height, state === 'station' ? 'open' : 'peek').right, 1);
    // Grabbing the floor: drag it right and the camera swings left (a negative turn).
    const { overviewWidthDeg, span, stationDeg } = tuning.turn;
    turnTo(turnRaw - ((dx - (dragAt ?? dx)) / w) * (restId === null ? overviewWidthDeg : (2 * stationDeg) / span));
    dragAt = dx;
    return true;
  }

  // --- travel ----------------------------------------------------------------------------------

  const curve = (id: string) => links.curve(id);
  const parent = (id: string) => links.parent?.(id) ?? 'origin';
  const clearance = (id: string) => clearanceOf(nodes.get(id).bounds);

  function lightRoute(id: string | null): void {
    if (id === routeLit) return;
    routeLit = id;
    links.setRoute(id);
  }

  function notify(f: FlightInfo | null): void {
    for (const cb of [...listeners]) cb(f);
  }

  function settleAt(to: string | null, at: Pose): void {
    rest = at;
    restId = to;
    state = to === null ? 'overview' : to === RECEIPT ? 'receipt' : 'station';
    lightRoute(null);
    applyRest();
    wake(); // the drift picks up where the pointer is
  }

  /** Reduced motion: straight to the framing, the node at the end of its `arrive`. */
  function cut(to: string | null): void {
    const was = flight;
    flight = null;
    stopDrift();
    resetTurn();
    setSheet(to === null ? 'peek' : 'open');
    settleAt(to, to === null ? overviewAt(0, zoom, pan) : framing(to));
    if (to !== null && to !== RECEIPT) nodes.get(to).showEndOfArrive();
    clock.invalidate();
    if (was) notify(null);
  }

  function travel(to: string | null): void {
    if (disposed || state === 'arrival') return; // the arrival's end takes it from there
    if (to !== null && !positions.has(stationNode(to))) return; // not a node
    const g = guide?.to === to ? guide : null;
    guide = null;
    if (prefs.reduced) {
      cut(to);
      return;
    }
    let now = capture();
    // Turned, it leaves from the view as it is, which unturns as it sets off (unturnPose): the
    // way is planned from the framing as composed, and lands on it. Zoomed only, a dive leaves
    // from the zoomed view as from any pose.
    const unturn = turn && !flight ? now : null;
    const turnFrom = turn;
    const unturnFor = unturnShare(turn);
    if (unturn) now = drifted(framing(restId), { position: new Vector3(), forward: new Vector3() });
    resetTurn();
    let source: DirPose | Flight = now;
    let startLink: LinkPos = { id: null, at: 0 };
    let from: string | null = restId;
    if (flight) {
      source = flight;
      from = flight.from;
      startLink = flight.route.length > 0 ? flight.route.linkAt(flight.along) : flight.startLink;
      evalFlight(flight, time, now); // where the moving camera is
    } else if (restId !== null && stationNode(restId) !== 'origin') {
      startLink = { id: stationNode(restId), at: curve(stationNode(restId)).getLength() };
    }
    // The drift carries on through the flight (motion audit #13): no reset here.
    const target = to === null ? overviewAt(0, zoom, pan) : framing(to);
    const end = drifted(target, { position: new Vector3(), forward: new Vector3() });
    const route = planRoute(curve, startLink, to === null ? null : stationNode(to), clearance, parent);
    // To or from the overview there's no link to ride: straight to the framing (audit #2C).
    // The route stays planned for the visitor's own way out along the links (Task 11).
    const dive = !!g || from === null || to === null || route.length === 0;
    const orbitStart = !isFlight(source) && restId !== null; // leaving a station: swing round its model
    flight = {
      from,
      to,
      route,
      t: 0,
      along: 0,
      rate: timeScale,
      dive,
      path: dive ? null : flightPath(route, now, end, orbitStart),
      duration: g ? g.duration : dive ? diveDuration(unturn ? turnFrom : 0) : flightDuration(route.length),
      guide: g?.pose,
      orbitStart,
      end,
      framing: target,
      start: time,
      source,
      unturn,
      unturnShare: unturnFor,
      startLink,
      sourcePose: { position: new Vector3(), forward: new Vector3() },
      sheetOpened: false,
    };
    state = 'flying';
    // To the overview the map takes the screen back at once. Station to station a bottom sheet
    // peeks for the ride, framed as open still (it opens over the last sheetSeconds, below);
    // a hop shorter than sheetPeekMinFlight keeps it open. From the overview it's at its peek
    // already.
    if (to === null) setSheet('peek');
    else if (from !== null && stage.viewport.width < tuning.panelMinViewportPx && flight.duration >= tuning.sheetPeekMinFlight) setSheet('peek', 'open');
    lightRoute(route.length > 0 ? route.linkAt(0).id : null);
    wake();
  }

  const pose: DirPose = { position: new Vector3(), forward: new Vector3() };

  function stepFlight(): void {
    const f = flight!;
    drifted(f.framing, f.end); // lands on the drift as it is: nothing glides on after
    evalFlight(f, time, pose);
    applyPose(pose);
    const gone = time - f.start;
    f.rate = timeScale;
    // The sheet takes sheetSeconds of real time, however fast the flight's clock runs.
    if (f.to !== null && !f.sheetOpened && (f.duration - gone) / timeScale <= tuning.sheetSeconds) {
      f.sheetOpened = true;
      setSheet('open'); // done as the camera lands
    }
    if (f.route.length > 0) lightRoute(f.route.linkAt(f.along).id);
    if (gone < f.duration) {
      notify(f);
      return;
    }
    flight = null;
    if (f.to !== null && !f.sheetOpened) setSheet('open');
    settleAt(f.to, f.framing);
    if (f.to !== null && f.to !== RECEIPT) void nodes.get(f.to).play('arrive'); // then idle loops (nodes.ts); the receipt moment prints
    notify(null);
  }

  // --- the arrival -------------------------------------------------------------------------------

  let proxy: Object3D | null = null;
  let mixer: AnimationMixer | null = null;
  let clips: GLTF['animations'] = [];
  let playing: string | null = null;

  function arrivalFit(): Pick<Arrival, 'fit' | 'clip' | 'length' | 'nodes' | 'links'> {
    const fit = overviewFit();
    const portrait = fit.camera === 'overviewPortrait';
    const timing = portrait ? world.arrival.portrait : world.arrival;
    const known = Object.values(timing.reach);
    let next = (known.length ? Math.max(...known) : 0) + UNKNOWN_STAGGER;
    const reach = new Map<string, number>();
    for (const id of ids) {
      const r = timing.reach[id];
      if (r !== undefined) reach.set(id, r);
      else {
        reach.set(id, Math.min(next, timing.clipLength));
        next += UNKNOWN_STAGGER;
      }
    }
    // A cluster's links draw out from their hub once its own link has landed there (world.py
    // lays their markers so); retimed earlier by hand, one still waits for it and lands later,
    // its node rising as it lands. Parents come before their sub-nodes in station order. A
    // cluster's draw at tuning.subLinkDrawSpeed (world.py's SUB_LINK_SPEED), the rest at linkDrawSpeed.
    const linksOut = new Map<string, { start: number; span: number }>();
    for (const id of linked) {
      const top = parent(id) === 'origin';
      const span = curve(id).getLength() / (top ? tuning.linkDrawSpeed : tuning.subLinkDrawSpeed);
      const after = top ? -Infinity : (reach.get(parent(id)) ?? -Infinity);
      const start = Math.max(reach.get(id)! - span, after);
      linksOut.set(id, { start, span });
      reach.set(id, Math.max(reach.get(id)!, start + span));
    }
    const nodesOut = new Map<string, ArrivalNode>();
    for (const id of ids) nodesOut.set(id, { reach: reach.get(id)!, phase: arrival?.nodes.get(id)?.phase ?? 'hidden' });
    return { fit, clip: portrait ? 'arrival_portrait' : 'arrival', length: timing.clipLength, nodes: nodesOut, links: linksOut };
  }

  function playClip(name: string): void {
    if (!mixer || playing === name) return;
    const clip = clips.find((c) => c.name === name);
    if (!clip) return;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    playing = name;
  }

  function appear(id: string, a: ArrivalNode): void {
    a.phase = 'appearing';
    const view = nodes.get(id);
    void view.play('appear').then(() => {
      if (disposed) return;
      if (!view.root.visible) view.showEndOfArrive(); // a model with no appear clip just stands
      a.phase = 'done';
      labels.setStatus(id, copy.working.text, { pinned: arrival !== null });
    });
  }

  /** The arrival's framing now: its fit, or on the way there from where a model's coming in
   *  moved it (joinArrival). */
  function arrivalAt(a: Arrival): { target: Vector3; s: number } {
    const k = a.from ? smoothstep(0, tuning.arrivalJoin, a.t - a.from.t) : 1;
    if (k >= 1) {
      a.from = null;
      return a.fit;
    }
    return { target: a.from!.target.clone().lerp(a.fit.target, k), s: a.from!.s + (a.fit.s - a.from!.s) * k };
  }

  /** A model in while the arrival plays: its bounds join the framing, eased. */
  function joinArrival(a: Arrival): void {
    const { target, s } = arrivalAt(a);
    Object.assign(a, arrivalFit(), { from: { target: target.clone(), s, t: a.t } });
    clock.invalidate();
  }

  function arrivalFrame(a: Arrival): void {
    for (const [id, n] of a.nodes) if (n.phase === 'hidden' && a.t >= n.reach) appear(id, n);
    for (const [id, l] of a.links) links.drawProgress(id, (a.t - l.start) / l.span);
    if (!mixer || !proxy) return;
    playClip(a.clip);
    mixer.setTime(Math.min(a.t, a.length));
    const { target, s } = arrivalAt(a);
    camera.position.copy(scaleArrivalFrame(proxy.position, target, s, scratch));
    camera.quaternion.copy(proxy.quaternion);
    camera.updateMatrixWorld();
  }

  function stepArrival(dt: number): boolean {
    const a = arrival!;
    a.t += dt;
    arrivalFrame(a);
    if (a.t < a.length) return true;
    finishArrival(false);
    return false;
  }

  /** The arrival's end state: links drawn, models at rest, statuses working, the overview. */
  function finishArrival(skipped: boolean): void {
    if (state !== 'arrival') return;
    const a = arrival;
    arrival = null;
    offSkip();
    doc.documentElement.removeAttribute('data-arrival');
    for (const id of linked) links.drawProgress(id, 1);
    // Every status reads "Working", then lets go one by one in station order (motion audit
    // #14): a ripple rather than twelve lines vanishing in one frame. Decorative: input is
    // never held up for it, and with motion reduced they all let go at once. Skipped, they're
    // there in the skip's frame, as the models and the camera are: "Checking…" crossfading to
    // "Working" as the line let go read as a flicker, and a model the skip brought in faded its
    // label in with the line pinned, then lost it.
    const stagger = prefs.reduced ? 0 : tuning.statusStaggerMs;
    ids.forEach((id, i) => {
      const phase = a?.nodes.get(id)?.phase ?? 'hidden';
      if (phase === 'hidden' || (skipped && phase === 'appearing')) nodes.get(id).showEndOfArrive();
      if (skipped) {
        labels.setStatus(id, copy.working.text, { now: true });
        return;
      }
      if (i === 0 || stagger === 0) {
        labels.setStatus(id, copy.working.text);
        return;
      }
      labels.setStatus(id, copy.working.text, { pinned: true });
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!disposed) labels.setStatus(id, copy.working.text);
      }, i * stagger);
      timers.add(timer);
    });
    if (linksGroup) linksGroup.visible = true;
    mixer?.stopAllAction();
    mixer = null;
    proxy = null;
    setSheet('peek');
    settleAt(null, framing(null));
    if (stations.current === null && (skipped || prefs.reduced)) {
      // The phone's start: skipped (or with motion reduced), there at once; played out, the input
      // chunk eases it in from the composed overview the clip ends on (map.ts, zoom.ts start).
      const h = homeView();
      zoom = h.zoom;
      pan.copy(h.pan);
      rerest();
    }
    clock.invalidate();
    if (stations.current !== null) travel(stations.current);
    markArrived();
  }

  /** Shader programs for what the arrival will show, compiled now while nothing moves. */
  function precompile(): void {
    const hidden = nodes.all().filter((n) => !n.root.visible);
    for (const n of hidden) n.root.visible = true;
    const linksShown = linksGroup?.visible ?? true;
    if (linksGroup) linksGroup.visible = true;
    stage.renderer.compile(stage.scene, camera);
    for (const n of hidden) n.root.visible = false;
    if (linksGroup) linksGroup.visible = linksShown;
  }

  function beginArrival(gltf: GLTF | null): void {
    if (disposed || state !== 'arrival') return;
    if (!gltf) {
      finishArrival(true);
      return;
    }
    clips = gltf.animations;
    proxy = gltf.cameras[0] ?? null;
    mixer = new AnimationMixer(gltf.scene);
    precompile();
    arrival = { t: 0, from: null, ...arrivalFit() };
    if (linksGroup) linksGroup.visible = true;
    arrivalFrame(arrival);
    clock.invalidate();
    wake();
  }

  // Any key, click, tap or wheel skips it, except on the header's controls (the theme pill, the
  // sound toggle, the way back): choosing a theme while it plays shouldn't end it.
  let skippedAt: number | null = null;
  const skipOn = (e: Event) => {
    if ((e.target as Element | null)?.closest?.('header.top')) return;
    if (state === 'arrival') skippedAt = e.timeStamp;
    skipArrival();
  };
  win.addEventListener('keydown', skipOn, true);
  win.addEventListener('pointerdown', skipOn, true);
  win.addEventListener('wheel', skipOn, { capture: true, passive: true });
  let skipBound = true;
  function offSkip(): void {
    if (!skipBound) return;
    skipBound = false;
    win.removeEventListener('keydown', skipOn, true);
    win.removeEventListener('pointerdown', skipOn, true);
    win.removeEventListener('wheel', skipOn, true);
  }

  function skipArrival(): void {
    finishArrival(true);
  }

  // --- start -------------------------------------------------------------------------------------

  setSheet('peek');
  if (prefs.reduced) {
    finishArrival(true);
  } else {
    // While it plays, a theme choice switches at once: the wipe would freeze it (theme-switch.ts).
    doc.documentElement.setAttribute('data-arrival', '');
    // The empty floor: nothing shows until the arrival draws it.
    for (const n of nodes.all()) n.root.visible = false;
    for (const id of linked) links.drawProgress(id, 0);
    if (linksGroup) linksGroup.visible = false;
    for (const id of ids) labels.setStatus(id, copy.checking.text, { pinned: true });
  }

  const loadCamera = opts.loadCamera ?? (() => loadModel('world', 0)); // with the origin, first (models.ts)
  const camLoad = state === 'arrival'
    ? loadCamera().catch((err: unknown) => {
        console.error('director: no arrival clip; starting at its end', err);
        return null;
      })
    : Promise.resolve(null);
  // The web fonts too: the labels' widths are part of the overview's fit, so they must be
  // final before the arrival commits to it.
  const fonts = doc.fonts?.ready.catch(() => undefined) ?? Promise.resolve();
  // The arrival starts once the origin is in (it rises first) and every model is, or
  // tuning.arrivalLoadWait after the origin: on a slow line the others come in as it plays, in
  // the order it shows them (map.ts), each playing `appear` as its link lands or, late, as it
  // comes in. A model in during the arrival joins its framing (joinArrival); one in after it,
  // the overview's, once all are in. Any other start waits for every model.
  const models =
    state === 'arrival'
      ? nodes.get('origin').ready.then(() =>
          Promise.race([
            nodes.ready,
            new Promise<void>((go) => {
              const timer = setTimeout(() => (timers.delete(timer), go()), tuning.arrivalLoadWait * 1000);
              timers.add(timer);
            }),
          ]),
        )
      : nodes.ready;
  let begun = false;
  let late = false;
  const started = Promise.all([models, camLoad, fonts]).then(([, gltf]) => {
    if (disposed) return;
    begun = true;
    if (state === 'arrival') beginArrival(gltf);
    else refit(); // the models' bounds are in: frame them
  });
  for (const n of nodes.all()) {
    void n.ready.then(() => {
      if (disposed || !begun) return;
      if (arrival) joinArrival(arrival);
      else late = state !== 'arrival';
    });
  }
  const ready = Promise.all([started, nodes.ready]).then(() => {
    if (!disposed && late) refit();
  });

  // --- resize, rotation, preference ------------------------------------------------------------

  function refit(): void {
    if (disposed) return;
    if (state === 'arrival') {
      if (arrival) {
        Object.assign(arrival, arrivalFit());
        arrivalFrame(arrival);
      }
      return;
    }
    if (flight) {
      travel(flight.to); // retargets from the moving camera, like any go
      return;
    }
    about = null;
    rerest(); // keeps the visitor's turn and zoom
  }

  const offResize = stage.onResize(refit);
  const offStations = stations.subscribe((to) => travel(to));
  const offPrefs = onPrefsChange(() => {
    if (!prefs.reduced) return;
    if (state === 'arrival') skipArrival();
    else if (flight) cut(flight.to);
    stopDrift();
    applyRest();
    clock.invalidate();
  });
  win.addEventListener('pointermove', onPointerMove);
  doc.documentElement.addEventListener('pointerleave', onPointerLeave);

  return {
    get state() {
      return state;
    },
    ready,
    arrived,
    get flight() {
      return flight;
    },
    get arrivalTime() {
      return arrival ? arrival.t : null;
    },
    get skippedAt() {
      return skippedAt;
    },
    get animating() {
      return offTick !== null;
    },
    get timeScale() {
      return timeScale;
    },
    set timeScale(x) {
      timeScale = x;
    },
    skipArrival,
    arrivalTimes() {
      const f = arrivalFit();
      return { reach: new Map([...f.nodes].map(([id, n]) => [id, n.reach])), links: f.links };
    },
    cancelStatusRipple() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
    flightDuration,
    get turn() {
      return turn;
    },
    turnDrag,
    turnBy(steps) {
      if (turnable()) turnTo(turnRaw - steps * tuning.turn.keyDeg);
    },
    get zoom() {
      return zoom;
    },
    get look() {
      return rest ? rest.target.clone() : new Vector3();
    },
    viewTo(z, target) {
      if (state !== 'overview') return false;
      about = null; // a turn after this starts from here
      const yaw = turn * DEG;
      zoom = Math.min(Math.max(z, tuning.zoom.min), 1);
      swing(pan.subVectors(target, framing(null, yaw).target).setY(0), -yaw);
      rerest();
      return true;
    },
    distanceAt(z) {
      const yaw = turn * DEG;
      const f = framing(null, yaw);
      const reach = f.position.distanceTo(f.target);
      return reach * zoomedReach(yaw, z, reach);
    },
    bound(k) {
      keep = k;
    },
    get home() {
      const h = homeView();
      return { zoom: h.zoom, target: overviewAt(0, h.zoom, h.pan).target };
    },
    hold(on) {
      held = on;
    },
    composeNext() {
      composed = true;
    },
    framing,
    follow(g) {
      guide = g;
    },
    closeUp(p) {
      if (state !== 'station') return;
      rest = p ?? framing(restId, turn * DEG);
      applyRest();
      clock.invalidate();
    },
    get receiptHeight() {
      return receiptHeight;
    },
    set receiptHeight(h) {
      receiptHeight = h;
    },
    onFlight(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    dispose() {
      disposed = true;
      offTick?.();
      offTick = null;
      offSkip();
      doc.documentElement.removeAttribute('data-arrival');
      offResize();
      offStations();
      offPrefs();
      win.removeEventListener('pointermove', onPointerMove);
      doc.documentElement.removeEventListener('pointerleave', onPointerLeave);
      mixer?.stopAllAction();
      listeners.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
