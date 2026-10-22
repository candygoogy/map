// Traffic (Task 6): small accent signals run the links from the origin out to the nodes, as
// often as each project is recent. A signal is an instance of public/models/signal.glb, the
// pill made in Blender, playing its own `idle` clip; code only picks when and where each one
// runs.
//
// - Rate: ratePerMinute(node.updated), 12 a minute for something updated today, halving
//   every 30 days towards 1. Gaps between signals vary ±50% around 60 / rate, so a link
//   never ticks like a metronome, and each link starts at a random point in its first gap.
//   Every signal leaves from the hub, so they leave at least tuning.hubSpacing apart: a link
//   whose turn comes while the hub is busy waits for the next slot (the most overdue first),
//   rather than five leaving in the same half second (schedule()).
// - Signals are pooled: at most tuning.signalMax alive, made on first need and reused. Each
//   rides its link at tuning.signalSpeed units/s (even in length), on the link as it's
//   drawn now (links.livePoint: a pulled link carries its signals to the lifted model),
//   pointed along it (the pill's long axis is +Z, which lookAt aims), with its idle
//   starting at a random time so no two pulse in step.
// - Its ends (footprintSpan): it comes out where the link leaves the origin's model and goes
//   in where the link enters the node's, never inside either (an open model like a wire rack
//   would show it), growing from nothing over the first tuning.signalGrow and shrinking away
//   over the last. A footprint is the model's loaded bounds on the floor (NodeView.bounds,
//   moved with its root), found on the live link, so a real model, a reshaped link or a pull
//   moves the ends with them; a model not in yet has none, and the signal runs end to end.
// - Its size on screen (nearScale): world-sized out to tuning.signalNear from the camera, the
//   overview's front edge, so the overview is as it was; nearer (a station, a flight) it
//   shrinks with its depth, so it's never bigger on screen than a signal there. A station
//   camera is 6-11 units out, where the pill (0.26 long) was 3-5 times that size: a big pill.
//   Zoomed in (the overview's zoom, director.zoom), that depth is the zoom's share of it, so
//   signals grow with the map as everything else does (the stray too), up to
//   tuning.signalZoomMax times their overview size and no further (zoomedScale: at full zoom,
//   4x, they'd be blobs); travel resets the zoom, and the depth eases back
//   out over tuning.signalUnzoom (followZoom), so a flight from a zoomed view doesn't shrink
//   them in one frame.
// - The gondola (visitor.ts) rides and docks on the same lines. A signal on its link hops
//   over the grip (hop()): up off the line as it nears the pin, over the clamp, and back
//   down, pointed along the hop. The pin is the gondola's own node (the `drop` extras), so
//   the hop follows the `dock` clip's last brake too.
// - The homelab cluster (Task 13 Batch B): signals still all leave the origin. One for a
//   sub-node rides homelab's link first, shrinks into the router's model, waits there
//   tuning.signalRelay.pause (it "routes"), then grows out on its sub-link and runs to the
//   device: relayed through homelab. Down the real wiring's tree (2026-10-21) it's relayed so
//   by every hub on the way: the router, the switch, and for the laptop the AP. Devices have no `updated` date, so each sub-node's rate
//   is tuning.signalRelay.perMinute; which device a relayed signal goes on to is whichever's
//   turn comes at the hub (random gaps, as every link's). Each leg runs between its own ends'
//   footprints and hops the grip on its own link.
// - A route only gets traffic while every link on it is fully drawn (the arrival draws them)
//   and lit (the power switch), so the cluster follows its hub. Signals already out finish
//   their run.
// - The stray (Task 17, secret 4): while a hidden node (stations.ts HIDDEN, the duck) isn't
//   found, about one signal in tuning.stray.odds goes astray instead of its own way: out of a
//   node near where the visitor is looking (the station's; in the overview or a flight, one on
//   screen), on an undrawn way of its own towards the map's edge, at tuning.stray.pace, into
//   the hidden model's footprint. It used to leave the origin down the duck's link every time
//   (the owner's test, 2026-10-21: "always in one position"). The way is StrayTo.way's, made in
//   the duck's lazy chunk (moments/stray-way.ts): while that's loading none goes, and the next
//   signal out once it's in goes astray instead. Only one at a time. `stray` is its root while
//   it rides (the duck moment lays a button over it, the only way in) and `strayWay` its way
//   (the moment's trail follows it), `holdStray` stops it where it is (hovered or focused), and
//   onStray tells when one sets out or is gone. With motion reduced no signal runs, so one
//   waits still on such a way now and then instead (parkStray, tuning.stray).
// - Off under reduced motion, live: the pool is hidden and the tick removed, so a still map
//   requests no frames. `enabled = false` does the same (and stays off whatever the
//   preference does), except that with motion the signals out on the links first shrink away
//   where they stand over tuning.signalGrow (the power switch, Task 15). burst(n) makes n links
//   due at once, so the hub sends them hubSpacing apart: the reboot's "traffic comes back".

import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  Group,
  type Material,
  type Object3D,
  Vector3,
} from 'three';
import type { MapFeed } from '../data/feed';
import { onPrefsChange, prefs } from '../motion/prefs';
import { applyRoleMaterials, recolourRoleMaterial } from '../shading';
import type { Clock } from '../stage/clock';
import type { Stage } from '../stage/stage';
import { tuning } from '../tuning';
import { smoothstep } from '../motion/ease';
import type { Links } from './links';
import { loadModel } from './models';
import type { Nodes } from './nodes';
import type { Visitor } from './visitor';

const DAY_MS = 86_400_000;

/** Signals a minute on the link to a node last updated at `updated` (an ISO date). */
export function ratePerMinute(updated?: string, now = Date.now()): number {
  const { floor, extra, halfLifeDays, undatedDays } = tuning.traffic;
  const t = updated === undefined ? NaN : Date.parse(updated);
  const ageDays = Number.isFinite(t) ? Math.max(0, (now - t) / DAY_MS) : undatedDays;
  return floor + extra * 0.5 ** (ageDays / halfLifeDays);
}

/** Whether a signal leaving now goes astray: about one in `odds` (tuning.stray.odds). */
export function goesAstray(random: () => number = Math.random, odds: number = tuning.stray.odds): boolean {
  return random() * odds < 1;
}

/** When a stray may go by chance (tuning.stray `first`, `gap`; t in seconds): none until
 *  arrived(t) and `first` on, and none for `gap` after each one has ended(t). */
export function strayCooldown(first = tuning.stray.first, gap = tuning.stray.gap) {
  let from = Infinity;
  return {
    ok: (t: number) => t >= from,
    arrived: (t: number) => void (from = t + first),
    ended: (t: number) => void (from = t + gap),
  };
}

/** A link's place in the queue at the hub: mean seconds between signals, and seconds until its next one. */
export interface Due {
  readonly id: string;
  readonly gap: number;
  wait: number;
}

/**
 * Which links send a signal this frame, after dt seconds: at most one, and only once the hub
 * has been free for tuning.hubSpacing since the last. A link whose time has come waits
 * (its `wait` at or below 0) until the hub is free; the most overdue goes first. `hub.wait` is
 * the hub's own countdown. `ready` leaves out links that can't send (undrawn, switched off).
 */
export function schedule<R extends Due>(
  routes: readonly R[],
  dt: number,
  hub: { wait: number },
  random: () => number = Math.random,
  ready: (r: R) => boolean = () => true,
): R[] {
  hub.wait = Math.max(hub.wait - dt, 0);
  let next: R | null = null;
  for (const r of routes) {
    if (!ready(r)) continue;
    r.wait -= dt;
    if (r.wait <= 0 && (next === null || r.wait < next.wait)) next = r;
  }
  if (next === null || hub.wait > 0) return [];
  next.wait = next.gap * (0.5 + random());
  hub.wait = tuning.hubSpacing;
  return [next];
}

/**
 * How far a signal rises over its line `d` units from the gondola's pin (either way along the
 * link): `height` within `top` of it, easing back down onto the line (a smoothstep) by `half`,
 * so it leaves and rejoins the line level.
 */
export function hop(
  d: number,
  height = tuning.signalHop.height,
  half = tuning.signalHop.half,
  top = tuning.signalHop.top,
): number {
  return height * smoothstep(half, top, Math.abs(d));
}

/**
 * A signal's scale `depth` units in front of the camera: whole from `near` out, and in
 * proportion nearer, so on screen it never grows past its size at `near` (a hairline keeps
 * 1 px at every distance; a signal keeps at most this). Behind the camera it's nothing.
 */
export function nearScale(depth: number, near: number = tuning.signalNear): number {
  return Math.min(Math.max(depth, 0) / near, 1);
}

/**
 * The zoom share signalNear is scaled by, `dt` seconds on from `share`: at once down to the
 * director's `zoom` (zooming in), eased up to it over tuning.signalUnzoom (zooming out, travel).
 */
export function followZoom(share: number, zoom: number, dt: number): number {
  return Math.min(zoom, share + (zoom - share) * (1 - Math.exp(-dt / tuning.signalUnzoom)));
}

/**
 * A signal's scale `depth` from the camera with signalNear at `share` of itself (followZoom),
 * never more than signalZoomMax times that share: zoomed to `share` the camera is about that
 * share as deep, so a signal world-sized in the overview is at most signalZoomMax times its
 * size there on screen, phone or desktop.
 */
export function zoomedScale(depth: number, share: number): number {
  // Nearer the camera than that holds (a desktop's front links), signalNear's share stops at
  // 1.2 / signalZoomMax: none on screen past 1.8x a signal at signalNear.
  const max = tuning.signalZoomMax;
  return Math.min(nearScale(depth, tuning.signalNear * Math.max(share, 1.2 / max)), share * max);
}

/** footprintSpan steps in from each end this far at a time, then halves the last step 12 times. */
const FOOT_STEP = 0.05;
const foot = new Vector3();

/**
 * The stretch of a link (`length` long; `point(u)` its point at u, 0..1, even in length,
 * origin end first) that runs outside both its ends' footprints, as distances from the
 * origin end: from where it leaves `inStart` (the origin's) to where it enters `inEnd` (the
 * node's). Each end is searched from its own end, half the link in at most.
 */
export function footprintSpan(
  point: (u: number, out: Vector3) => Vector3,
  length: number,
  inStart: (p: Vector3) => boolean,
  inEnd: (p: Vector3) => boolean,
): { from: number; to: number } {
  const out = (inside: (p: Vector3) => boolean, at: (d: number) => number): number => {
    const inAt = (d: number) => inside(point(at(d) / length, foot));
    if (!inAt(0)) return 0;
    const half = length / 2;
    let lo = 0;
    let d = 0;
    while (d < half && inAt(d)) {
      lo = d;
      d = Math.min(d + FOOT_STEP, half);
    }
    if (inAt(d)) return d;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + d) / 2;
      if (inAt(mid)) lo = mid;
      else d = mid;
    }
    return d;
  };
  return { from: out(inStart, (d) => d), to: length - out(inEnd, (d) => length - d) };
}

export interface Traffic {
  /** On unless switched off or motion is reduced (signals start once their model loads). Setting it switches them. */
  enabled: boolean;
  /** Signals on the links right now. */
  readonly alive: number;
  /** Makes `n` links that can send, picked at random, due now: they leave hubSpacing apart (the reboot's burst). */
  burst(n: number): void;
  /** The stray signal's root while one is out (Task 17), else null. */
  readonly stray: Object3D | null;
  /** Stops the stray where it is (true) or lets it ride on. */
  holdStray(on: boolean): void;
  /** The way the stray rides while one is out, else null. */
  readonly strayWay: StrayWay | null;
  /** Sends a stray now, out of node `from` if given (else one near the view), if there's a
   *  hidden node to stray to and none is out (tests, the dev console). False while its way's
   *  code is still loading: ask again. */
  sendStray(from?: string): boolean;
  /** Told the stray's root as one sets out, and null once it's gone. Returns an unsubscribe. */
  onStray(cb: (root: Object3D | null) => void): () => void;
  dispose(): void;
}

/** Where strays go (Task 17): the hidden node, and whether it has been found (then none go). */
export interface StrayTo {
  id: string;
  found(): boolean;
  /** False: none go astray by chance, only sendStray() sends one (?test, so the e2e runs stay
   *  deterministic: a stray's button joins the Tab order). Default true. */
  chance?: boolean;
  /** Resolves as the arrival ends: chance strays wait tuning.stray.first from then. Default: now. */
  arrived?: Promise<void>;
  /** The way a stray takes now, out of node `from` (else one near the view), or nothing while
   *  the code that makes it is still loading (asking starts the load). */
  way(from?: string): StrayWay | undefined;
}

/** A stray's way (moments/stray-way.ts): the node it leaves, its length, and its point u (0..1,
 *  even in length) along it, that node's end first. */
export interface StrayWay {
  readonly from: string;
  readonly length: number;
  point(u: number, out: Vector3): Vector3;
}

export type TrafficStage = Pick<Stage, 'renderer' | 'scene' | 'camera' | 'theme' | 'onTheme'>;

/** One link a signal rides, shared by every route over it. */
interface Leg {
  id: string;
  /** The node it leaves from (links.parent). */
  parent: string;
  length: number;
  /** Where its signals come out of its parent's model and go into its node's (footprintSpan). */
  from: number;
  to: number;
  /** What that span was found for: both roots on the floor, and whether their models were in. */
  key: number[];
  /** Its point u (0..1, even in length), parent end first: the link as drawn now, or a stray's way. */
  point(u: number, out: Vector3): Vector3;
}

/** A node's signals: the links from the origin to it, in order (one, or the hub's and a sub-link).
 *  A stray's: one leg, on its way. */
interface Route extends Due {
  legs: Leg[];
  way?: StrayWay;
}

interface Signal {
  root: Object3D;
  mixer: AnimationMixer;
  idle: AnimationAction | null;
  route: Route | null;
  /** The leg it's on, and its distance along that leg. */
  leg: number;
  s: number;
  /** Seconds left waiting in a hub's model before its next leg (0: riding). */
  pause: number;
  /** Gone astray, down the hidden node's link (Task 17). */
  stray: boolean;
}

export function createTraffic(
  stage: TrafficStage,
  links: Links,
  feed: MapFeed,
  clock: Clock,
  nodes?: Pick<Nodes, 'get'>,
  visitor?: Pick<Visitor, 'root' | 'at' | 'ready'>,
  strayTo?: StrayTo,
  /** The view's zoom: the overview's (director.zoom), 1 as composed, down to tuning.zoom.min;
   *  1 at a station (map.ts). */
  zoom: () => number = () => 1,
): Traffic {
  const group = new Group();
  group.name = 'traffic';
  stage.scene.add(group);

  const now = Date.now();
  const parent = (id: string) => links.parent(id);
  const legs = new Map<string, Leg>();
  const legOf = (id: string): Leg => {
    let leg = legs.get(id);
    if (!leg) {
      const length = links.curve(id).getLength();
      const point = (u: number, out: Vector3) => links.livePoint(id, u, out);
      legs.set(id, (leg = { id, parent: parent(id), length, from: 0, to: length, key: [], point }));
    }
    return leg;
  };
  const routes: Route[] = feed.nodes
    .filter((n) => n.id !== 'origin')
    .map((n) => {
      const chain: Leg[] = [];
      for (let id = n.id; id !== 'origin' && chain.length < 16; id = parent(id)) chain.unshift(legOf(id));
      const perMinute = chain.length > 1 ? tuning.signalRelay.perMinute : ratePerMinute(n.updated, now);
      const gap = 60 / perMinute;
      return { id: n.id, legs: chain, gap, wait: Math.random() * gap };
    });
  const byChance = strayTo?.chance ?? true;
  let stray: Signal | null = null;
  let strayHeld = false;
  /** A stray came due while its way's code was loading: the next signal out goes astray instead. */
  let owed = false;
  /** A stray's route, one leg on its way, or null while its way isn't known. */
  const strayRoute = (from?: string): Route | null => {
    const way = strayTo!.way(from);
    if (!way) return null;
    const { length, point } = way;
    const leg: Leg = { id: strayTo!.id, parent: way.from, length, from: 0, to: length, key: [], point };
    return { id: leg.id, legs: [leg], gap: 0, wait: 0, way };
  };
  const secs = () => performance.now() / 1000;
  const cool = strayCooldown();
  void (strayTo?.arrived ?? Promise.resolve()).then(() => cool.arrived(secs()));
  const strayListeners = new Set<(root: Object3D | null) => void>();
  const tellStray = () => {
    for (const cb of [...strayListeners]) cb(stray?.root ?? null);
  };
  /** Whether a stray may set out now: a hidden node to go to, not found, none out already. */
  const canStray = () => !!strayTo && !strayTo.found() && stray === null && links.progress(strayTo.id) < 1;

  let template: Object3D | null = null;
  let idleClip: AnimationClip | null = null;
  let materials: Material[] = [];
  const pool: Signal[] = [];
  let alive = 0;
  let wanted = true;
  let offTick: (() => void) | null = null;
  let disposed = false;
  /** Seconds into the switch-off's fade, or -1 when not fading. */
  let fade = -1;
  /** signalNear's share now (followZoom). */
  let share = 1;

  /** A node's model's footprint on the floor: its bounds under its root, where it stands now. */
  function footprint(id: string): (p: Vector3) => boolean {
    const n = nodes?.get(id);
    if (!n || n.bounds.isEmpty()) return () => false;
    const { min, max } = n.bounds;
    const o = n.root.position;
    return (p) => p.x - o.x >= min.x && p.x - o.x <= max.x && p.z - o.z >= min.z && p.z - o.z <= max.z;
  }

  /** Finds the leg's span again if either end's model has moved on the floor or come in. */
  function span(leg: Leg): void {
    if (!nodes) return;
    const a = nodes.get(leg.parent);
    const b = nodes.get(leg.id);
    const key = [a.root.position.x, a.root.position.z, b.root.position.x, b.root.position.z, a.bounds.max.x, b.bounds.max.x];
    if (key.every((k, i) => k === leg.key[i])) return;
    leg.key = key;
    Object.assign(leg, footprintSpan(leg.point, leg.length, footprint(leg.parent), footprint(leg.id)));
  }

  function make(): Signal {
    const root = template!.clone(true); // shares the geometry and the role materials
    root.visible = false;
    group.add(root);
    const mixer = new AnimationMixer(root);
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    const signal: Signal = { root, mixer, idle, route: null, leg: 0, s: 0, pause: 0, stray: false };
    pool.push(signal);
    return signal;
  }

  /** Sends a stray out of `from` (else near the view): false if none went. */
  function goAstray(from?: string): boolean {
    const route = strayRoute(from);
    if (route) launch(route, true);
    return stray !== null;
  }

  function launch(route: Route, astray = false): void {
    if (alive >= tuning.signalMax) return;
    for (const leg of route.legs) span(leg);
    // Its ends' models all but meet on some leg: nothing to show there.
    if (route.legs.some((leg) => leg.to - leg.from <= tuning.signalGrow)) return;
    const signal = pool.find((p) => p.route === null) ?? make();
    signal.route = route;
    signal.leg = 0;
    signal.pause = 0;
    signal.stray = astray;
    signal.s = route.legs[0]!.from;
    if (signal.idle) {
      signal.idle.reset().play();
      signal.idle.time = Math.random() * signal.idle.getClip().duration;
    }
    place(signal);
    signal.root.visible = true;
    alive++;
    if (astray) {
      stray = signal;
      tellStray();
    }
  }

  function land(signal: Signal): void {
    signal.route = null;
    signal.root.visible = false;
    signal.idle?.stop();
    alive--;
    if (signal === stray) {
      stray = null;
      strayHeld = false;
      cool.ended(secs());
      tellStray();
    }
  }

  const at = new Vector3();
  const ahead = new Vector3();
  const behind = new Vector3();
  /** The tangent's half-span along the link, in world units. */
  const LOOK = 0.05;

  /** The gondola's pin (the node carrying its `drop`), once its model is in. */
  let pin: Object3D | null = null;
  void visitor?.ready.then(() => {
    visitor.root.traverse((o) => void (pin ??= typeof o.userData['drop'] === 'number' ? o : null));
  });
  /** Where the pin is this frame: on link `id`, `at` units from its origin end (id null: on none). */
  const grip = { id: null as string | null, at: 0 };
  function findGrip(): void {
    grip.id = null;
    const where = visitor?.at;
    if (!visitor || !pin || !visitor.root.visible || !where?.id || !legs.has(where.id)) return; // not on a turnaround
    const L = links.curve(where.id).getLength();
    // A clip may carry the pin off the group's point (`dock` brakes it the last 0.1): along the line, by this much.
    links.livePoint(where.id, (where.at + LOOK) / L, ahead).sub(links.livePoint(where.id, (where.at - LOOK) / L, behind));
    pin.getWorldPosition(at).sub(visitor.root.position);
    grip.id = where.id;
    grip.at = where.at + at.dot(ahead.normalize());
  }

  function place(signal: Signal): void {
    const route = signal.route!.legs[signal.leg]!;
    const { id, length } = route;
    const s = signal.s;
    // The link as drawn now (or the stray's way), lifted over the gondola's grip when it's on this one.
    const lifted = (d: number, out: Vector3) => {
      route.point(Math.min(Math.max(d / length, 0), 1), out);
      if (grip.id === id) out.y += hop(d - grip.at);
      return out;
    };
    lifted(s, at);
    // Along the path it rides: the chord through its neighbours either side.
    lifted(s + LOOK, ahead).sub(lifted(s - LOOK, behind));
    signal.root.position.copy(at);
    signal.root.lookAt(ahead.add(at)); // +Z along the link, away from the origin
    // Out of the origin's model from nothing, and back to nothing into the node's; near the
    // camera, no bigger on screen than at signalNear (nearScale), nor zoomed in past signalZoomMax.
    const g = tuning.signalGrow;
    const depth = ahead.subVectors(at, stage.camera.position).dot(stage.camera.getWorldDirection(behind));
    signal.root.scale.setScalar(
      Math.max(smoothstep(0, g, s - route.from) * smoothstep(0, g, route.to - s) * zoomedScale(depth, share), 1e-3),
    );
  }

  const hub = { wait: 0 };
  const sending = (r: Route) => r.legs.every((leg) => links.progress(leg.id) >= 1 && links.isLit(leg.id));

  function tick(dt: number): boolean {
    // Switched off by another tick earlier in this frame (the power switch): update() has handed
    // over to the fade, which this tick's re-adding itself below would undo.
    if (!on()) return false;
    share = followZoom(share, zoom(), dt);
    findGrip();
    for (const signal of pool) {
      const route = signal.route;
      if (!route) continue;
      if (signal.pause > 0) {
        // Inside a hub's model, routing: out on the next leg once the pause is up.
        signal.pause -= dt;
        if (signal.pause > 0) continue;
        signal.leg++;
        const next = route.legs[signal.leg]!;
        span(next);
        signal.s = next.from - signal.pause * tuning.signalSpeed; // the time it overran, ridden on
        signal.pause = 0;
        signal.root.visible = true;
      } else if (signal.stray) signal.s += strayHeld ? 0 : tuning.signalSpeed * tuning.stray.pace * dt;
      else signal.s += tuning.signalSpeed * dt;
      const leg = route.legs[signal.leg]!;
      span(leg); // a pull moves its end
      if (signal.s >= leg.to) {
        if (signal.leg < route.legs.length - 1) {
          signal.pause = tuning.signalRelay.pause;
          signal.root.visible = false; // shrunk into the hub's model already
          continue;
        }
        land(signal);
        continue;
      }
      place(signal);
      signal.mixer.update(dt);
    }
    // After the move, so a new signal's first frame is at its start, not yet grown.
    for (const route of schedule(routes, dt, hub, Math.random, sending)) {
      // Astray instead, once its way is known (until then it's owed to the next signal out).
      if (byChance && cool.ok(secs()) && canStray() && (owed || goesAstray()) && !(owed = !goAstray())) continue;
      launch(route);
    }
    // Back to the end of the clock's ticks: the gondola's comes and goes with its flights, and
    // a hop on its last frame's pin trails it by a flight's step (up to 0.3 at full speed).
    offTick?.();
    offTick = clock.add(tick);
    return true; // always moving or waiting for the next signal
  }

  const on = () => wanted && !prefs.reduced && !disposed;

  /** Switched off with motion: the signals stop and shrink where they are, then land. */
  function fadeOut(dt: number): boolean {
    const g = tuning.signalGrow;
    const was = 1 - fade / g;
    fade = Math.min(fade + dt, g);
    const k = Math.max((1 - fade / g) / was, 1e-3);
    for (const signal of pool) if (signal.route) signal.root.scale.multiplyScalar(k);
    if (fade < g) return true;
    fade = -1;
    offTick?.();
    offTick = null;
    update(); // lands them
    return false;
  }

  function update(): void {
    if (on() && template) {
      if (fade >= 0) {
        fade = -1; // back on mid-fade: they ride on, and place() gives them their size again
        offTick?.();
        offTick = null;
      }
      offTick ??= clock.add(tick);
      return;
    }
    if (fade >= 0 && !disposed) return; // the fade lands them as it ends
    // Riding until now: they fade first.
    const fading = offTick !== null && !wanted && !prefs.reduced && !disposed && alive > 0;
    offTick?.();
    offTick = null;
    fade = -1;
    if (fading) {
      fade = 0;
      offTick = clock.add(fadeOut);
      return;
    }
    let hid = false;
    for (const signal of pool) {
      if (signal.route) {
        land(signal);
        hid = true;
      }
    }
    if (hid) clock.invalidate(); // one frame to clear them off the screen
  }

  // The stray with motion reduced: no signal runs, so now and then one waits, still, on a
  // stray's way (out of a node near the view, as a moving one's), tuning.stray.at units out of
  // its node's model, for tuning.stray.parkSeconds (longer while it's held), then it's gone.
  // One frame each way: nothing moves.
  let parkTimer: ReturnType<typeof setTimeout> | null = null;
  const parkLater = (seconds: number) => {
    if (parkTimer !== null) clearTimeout(parkTimer);
    parkTimer = setTimeout(() => {
      parkTimer = null;
      if (stray) unpark();
      else parkStray();
    }, seconds * 1000);
  };
  function parkStray(from?: string): boolean {
    if (disposed || !template || !prefs.reduced || !wanted || !canStray()) return false;
    const route = strayRoute(from);
    if (!route) {
      if (byChance) parkLater(1); // its way's code still loading
      return false;
    }
    const signal = pool.find((p) => p.route === null) ?? make();
    const leg = route.legs[0]!;
    span(leg);
    signal.route = route;
    signal.leg = 0;
    signal.pause = 0;
    signal.stray = true;
    signal.s = leg.from + Math.min(tuning.stray.at, (leg.to - leg.from) / 2); // in view, out of its node
    share = zoom();
    place(signal);
    signal.root.visible = true;
    alive++;
    stray = signal;
    tellStray();
    clock.invalidate();
    parkLater(tuning.stray.parkSeconds);
    return true;
  }
  function unpark(): void {
    if (!stray) return;
    if (strayHeld) {
      parkLater(1); // held (hovered, focused): it waits for you
      return;
    }
    land(stray);
    clock.invalidate();
    if (byChance) parkLater(tuning.stray.parkEvery * (0.5 + Math.random()));
  }
  const parkWatch = () => {
    if (byChance && prefs.reduced && template && !disposed) parkLater(tuning.stray.parkEvery * (0.5 + Math.random()));
    else if (parkTimer !== null) {
      clearTimeout(parkTimer);
      parkTimer = null;
    }
  };

  const offPrefs = onPrefsChange(() => {
    update();
    parkWatch();
  });
  const offTheme = stage.onTheme((t) => {
    for (const m of materials) recolourRoleMaterial(m, t); // shading.ts's default is tuning.shadeStrength
  });

  loadModel('signal')
    .then((gltf) => {
      if (disposed) return;
      materials = applyRoleMaterials(gltf.scene, stage.theme);
      template = gltf.scene;
      idleClip = gltf.animations.find((c) => c.name === 'idle') ?? null;
      // Compile its shader now, while nothing moves, rather than on the first signal out.
      const first = make();
      first.root.visible = true;
      stage.renderer.compile(group, stage.camera, stage.scene);
      first.root.visible = false;
      update();
      parkWatch();
    })
    .catch((err: unknown) => console.error('traffic: no signal model', err)); // the map works without traffic

  return {
    get enabled() {
      return on();
    },
    set enabled(on) {
      wanted = on;
      update();
    },
    get alive() {
      return alive;
    },
    burst(n) {
      for (const r of routes.filter(sending).sort(() => Math.random() - 0.5).slice(0, n)) r.wait = -Math.random();
    },
    get stray() {
      return stray?.root ?? null;
    },
    get strayWay() {
      return stray?.route?.way ?? null;
    },
    holdStray(on) {
      strayHeld = on && stray !== null;
    },
    sendStray(from) {
      if (!canStray() || !template) return false;
      if (prefs.reduced) return parkStray(from);
      return on() && goAstray(from);
    },
    onStray(cb) {
      strayListeners.add(cb);
      return () => void strayListeners.delete(cb);
    },
    dispose() {
      disposed = true;
      if (parkTimer !== null) clearTimeout(parkTimer);
      update();
      offPrefs();
      offTheme();
      group.removeFromParent();
    },
  };
}
