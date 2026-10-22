// Turn it off and on again (Task 15, approved by the owner 2026-10-20 with its recommendations and
// drafted words). The origin has a power switch under a flip-up cover (its `poke_power_hit`). Flip
// it, at the origin's station or with the origin panel's button, and the whole network goes dark
// node by node, then reboots with the arrival's diagnostic ("Checking…" → "Working"). A lazy chunk
// (moments/load.ts): map.ts fetches it on the first flip.
//
// The timeline (powerTimeline, seconds from the flip):
//   0.00  the origin plays `poke_power`: the cover flips up, the toggle snaps down, the cover drops.
//   0.30  the toggle is down (SNAP): traffic stops, the signals out shrink away where they are
//         (traffic.ts), and every status line empties (no new word while dark). The origin goes
//         off (`off`, its colours) as its `poke_power` ends, so the cover isn't cut mid-drop.
//   0.35  the camera pulls back to the overview (camera option B, approved): the cascade plays
//         as it dives out, and the reboot in the overview, where every node is in view. The
//         hash clears, as after Escape. Only if you're still at the origin.
//   0.38  the nodes go dark in reverse station order, STEP apart: each plays its `off` and fades
//         its colours, and its link goes to --ghost (setLit(false)), quieter than the range
//         rings, so the network reads as dead, not as more of the floor (the owner's test notes:
//         in --faint the links "look unused"). The cluster's devices come after homelab in the
//         order, so they go before their hub. Fettle is last, at 1.58 s with the cluster's five.
//   + 1.2 s of dark (DARK). Clicks on dark models do nothing (nodes.ts); travel still works.
//   reboot  the arrival again from its step 2, without its camera (director.arrivalTimes): the
//         origin plays `on`, every status reads "Checking…" (pinned), and the links draw out from
//         the hub at the arrival's own pace. As a link lands, its node plays `on`, comes back
//         lit, and its status reads "Working".
//   end   the last link is in: traffic starts again with a burst, BURST signals out of the hub
//         hubSpacing apart (traffic.burst), "traffic comes back", and the pinned statuses let go
//         in station order, tuning.statusStaggerMs apart, as at the end of the arrival. About
//         5.7 s in all, the burst's last signal landing about a second and a half later.
// The switch and the button ignore presses until it's over; travel is never blocked.
//
// Reduced motion: no cascade and no draw. At SNAP every node, link and colour goes off at once
// (their clips jump to their ends) and the camera cuts to the overview; 1.2 s later everything
// comes back lit at once and reads "Checking…", each status turns "Working" at its usual reach
// time, and they let go together. No signals run, so no burst. It runs on timers then, so a
// still map requests no frames.
//
// The homelab's cables and power cords (a lazy chunk of their own, cable.ts) are drawn lines too:
// each goes off with the first node it plugs into and comes back with the last (a cable with the
// first of its two nodes, a cord with its device), to --ghost as the links. Not in yet, they're
// left alone.
//
// Screen readers: the labels' status lines are aria-hidden, so a polite live region by the
// button says the reboot in the same approved words: "Checking…", then "Working".
//
// Task 17's secrets ride on it (secrets 1 and 2, approved):
// - The taped-over switch: three flips within a minute, and as the third reboot ends the switch is
//   taped over (it stays for the visit). Flipped again, the cover strains against the tape
//   (`poke_power_taped`) and nothing switches; that finds the secret. The tape goes on where you
//   can see it (the owner's test notes, 2026-10-21): the flip dove to the overview, so the camera
//   goes back to the origin, and as it lands the origin plays `tape_on`, a roll that lays the
//   strip over the cover by itself and presses it down. If you went elsewhere during the reboot,
//   it waits for your next landing at the origin. Reduced motion: the tape is just there, laid
//   (the camera still cuts back to the origin from the overview).
// - Test means test: the RCD's test button at Siel Eolie (rcd()) trips the whole map. The RCD's
//   toggle drops (TRIP) and the board's pilot light sinks (to FRONT, both in its `poke_test`);
//   then the dark leaves along the links, a front at SPEED world units a second (tripTimeline):
//   down Siel Eolie's link to the hub and out along every other, each link to --ghost as the
//   front enters it and each node dark as the front reaches it (the cluster's after homelab).
//   You stay where you pressed (the owner's test notes, 2026-10-21: the dive to the overview
//   "may be impractical"): the camera eases out over WIDE_IN to a wider framing round the board
//   (widePose: its nearest neighbours and the start of its link), holds there while it's dark,
//   and eases back over WIDE_OUT as you press again. Nothing comes back by itself: the press
//   brings the board on at once (its `on`: the main switch, the RCD and the breakers back up, the
//   reset) and the reboot above runs. Leave meanwhile and the flights take over; back at the
//   board it's the station's framing. The board goes dark too, as its `poke_test` ends (RCD_OFF,
//   so the bang that knocks its door isn't cut): dark, its `off` holds every toggle down, which
//   reads as tripped wherever you come back from (lit, its `arrive` on landing would put the
//   breakers back up). A press anywhere on the dark board reaches power.ts (map.ts routes it
//   before the dark check), so the reset is easy to hit from the wider framing. While tripped the
//   switch does nothing. Reduced motion: everything goes off at once, and the camera cuts out to
//   the wider framing and back.

import type { Director } from '../camera/director';
import type { Pose } from '../camera/fit';
import { runtimeCopy as copy } from '../copy-runtime';
import { prefs } from '../motion/prefs';
import { cue } from '../sound-cue';
import type { Stations } from '../nav/stations';
import type { Clock } from '../stage/clock';
import { tuning } from '../tuning';
import { found } from './secrets';
import type { Labels } from '../ui/labels';
import type { Cables } from '../world/cable';
import type { Links } from '../world/links';
import type { Nodes } from '../world/nodes';
import type { Traffic } from '../world/traffic';

/** When the toggle snaps down in `poke_power`: frame 7 at 24 fps in the origin's Blender source
 *  (not in this repo). */
export const SNAP = 0.3;
/** Between one node going dark and the next. */
export const STEP = 0.08;
/** How long the network stays dark once the last node is off. */
export const DARK = 1.2;
/** When the camera leaves for the overview (option B), as the toggle snaps. */
export const DIVE = 0.35;
/** When the RCD trips in Siel Eolie's `poke_test` (frame 3 at 24 fps). */
export const TRIP = 0.125;
/** The taped switch: this many flips within TAPE_WINDOW seconds tape it over. */
export const TAPE_FLIPS = 3;
export const TAPE_WINDOW = 60;
/** The origin's clip that puts the tape on. */
export const TAPE_ON = 'tape_on';
/** nodes.ts crosses a clip in from idle over this long (its BLEND_INTO_CLIP): the tape is shown
 *  once that's done, or the strip would show laid through the cross. The roll covers the wait. */
const TAPE_SHOW = 0.15;
/** The close look while the tape goes on (the owner's test notes, 2026-10-21: it couldn't be seen
 *  well): the camera eases in to the switch over LOOK_IN, tape_on starts at TAPE_AT, the look
 *  holds until LOOK_HOLD after it ends (TAPE_LEN, 20 frames at 24 fps) and eases back over
 *  LOOK_OUT. With motion reduced it cuts in for LOOK_REDUCED, then cuts back. */
const LOOK_IN = 0.6;
const TAPE_AT = 0.45;
const TAPE_LEN = 20 / 24;
const LOOK_HOLD = 0.6;
const LOOK_OUT = 0.7;
const LOOK_REDUCED = 1.6;
/** The switch spans this share of the visible height in the close look (270 px of 900), at
 *  most LOOK_WIDE of the visible width (a phone). */
const LOOK_SHARE = 0.3;
const LOOK_WIDE = 0.6;

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** When the tripped board itself goes dark: as its `poke_test` ends (frame 20 at 24 fps). */
export const RCD_OFF = 20 / 24;
/** Signals sent at once as the reboot ends (traffic.burst): a handful, about a second's worth. */
export const BURST = 6;
/** The node whose RCD trips the map, and its part. */
export const RCD = 'siel-eolie';
/** The trip's dark front: it leaves the board as its pilot light has sunk (frame 9 of
 *  `poke_test`), and runs along the links at SPEED world units a second. */
export const FRONT = 9 / 24;
export const SPEED = 12;
/** The wider framing at the board: the ease out from the trip, and back from the reset press. */
const WIDE_IN = 1;
const WIDE_OUT = 1.2;
/** It holds the board, its WIDE_NEAR nearest nodes and its link's first WIDE_LINK, WIDE_MARGIN
 *  world units clear of the visible edges; if the board would be under WIDE_MIN_PX wide (a phone),
 *  the neighbours are left out. */
const WIDE_NEAR = 2;
const WIDE_LINK = 0.45;
const WIDE_MARGIN = 0.9;
const WIDE_MIN_PX = 50;

const ORIGIN = 'origin';

export interface PowerTimeline {
  snap: number;
  /** When each node goes dark. */
  dark: Map<string, number>;
  /** When the reboot starts. */
  reboot: number;
}

/** The dark half of the moment for stations `ids` (in station order, the origin first). */
export function powerTimeline(ids: readonly string[], reduced: boolean): PowerTimeline {
  const dark = new Map<string, number>([[ORIGIN, SNAP]]);
  ids
    .filter((id) => id !== ORIGIN)
    .reverse()
    .forEach((id, i) => dark.set(id, reduced ? SNAP : SNAP + STEP * (i + 1)));
  return { snap: SNAP, dark, reboot: Math.max(...dark.values()) + DARK };
}

export interface TripTimeline {
  /** When each node goes dark (the source's own entry: when the front leaves it). */
  nodes: Map<string, number>;
  /** When each link goes to --ghost (by its node's id): as the front enters it. */
  links: Map<string, number>;
}

/** The RCD at `source` trips: a front leaves it at FRONT and runs along the network (each node's
 *  link to `parent`, `length` long; the hub's parent null) at SPEED. A node goes dark as the front
 *  reaches it, a link as the front enters it, from whichever end it reaches first. All at TRIP
 *  with motion reduced. */
export function tripTimeline(
  ids: readonly string[],
  source: string,
  parent: (id: string) => string | null,
  length: (id: string) => number,
  reduced: boolean,
): TripTimeline {
  // Each node's way up to the hub, with the distance to every node on it.
  const up = (id: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let c = id, d = 0; ; ) {
      m.set(c, d);
      const p = parent(c);
      if (p === null || m.has(p)) return m;
      d += length(c);
      c = p;
    }
  };
  const from = up(source);
  const dist = (id: string): number => {
    for (const [a, d] of up(id)) if (from.has(a)) return d + from.get(a)!;
    return 0;
  };
  const when = (d: number) => (reduced ? TRIP : FRONT + d / SPEED);
  const nodes = new Map(ids.map((id): [string, number] => [id, when(dist(id))]));
  const links = new Map<string, number>();
  for (const id of ids) {
    const p = parent(id);
    if (p !== null) links.set(id, when(Math.min(dist(id), dist(p))));
  }
  return { nodes, links };
}

export interface PowerOptions {
  clock: Pick<Clock, 'add'> & Partial<Pick<Clock, 'invalidate'>>;
  nodes: Pick<Nodes, 'get'>;
  links: Pick<Links, 'setLit' | 'drawProgress'> & Partial<Pick<Links, 'parent' | 'curve' | 'emphasize'>>;
  traffic: Pick<Traffic, 'enabled' | 'burst'>;
  director: Pick<Director, 'arrivalTimes' | 'cancelStatusRipple'> & Partial<Pick<Director, 'state' | 'framing' | 'closeUp' | 'turn' | 'composeNext'>>;
  labels: Pick<Labels, 'setStatus'>;
  stations: Pick<Stations, 'ids' | 'current' | 'overview'> & Partial<Pick<Stations, 'go' | 'subscribe'>>;
  /** The homelab's cables and cords, if their lazy chunk is in by then (else they're left alone). */
  cable?: () => Pick<Cables, 'setLit'> | null;
  /** Where the live region goes (the origin's section, by its button). */
  speak?: HTMLElement | null;
  /** Called as each reboot completes, the RCD's included (Task 16's trip counts them). */
  onReboot?: () => void;
}

export interface Power {
  /** Flips the switch: false (and nothing happens) while the last flip is still playing. */
  flip(): boolean;
  /** True from a flip until the statuses have let go. */
  readonly busy: boolean;
  /** Reboots completed, for Task 16's receipt and Task 17's taped switch. */
  readonly reboots: number;
  /** Siel Eolie's RCD pressed (Task 17): trips the map, or resets it once tripped. False (and
   * nothing happens, not even the model's press) while a flip, a trip or a reboot plays. */
  rcd(): boolean;
  /** From the RCD's trip until its reset. */
  readonly tripped: boolean;
  /** The origin's switch is taped over (Task 17). */
  readonly taped: boolean;
  dispose(): void;
}

type Step = [at: number, run: () => void];

export function createPower(opts: PowerOptions): Power {
  const { clock, nodes, links, traffic, director, labels, stations } = opts;
  const ids = stations.ids;
  const linked = ids.filter((id) => id !== ORIGIN);

  let live: HTMLElement | null = null;
  if (opts.speak) {
    live = document.createElement('p');
    live.className = 'power-live';
    live.setAttribute('aria-live', 'polite');
    opts.speak.append(live);
  }

  let steps: Step[] = [];
  let t = 0;
  let timed = false; // reduced motion: on timers, not frames
  let draw: { at: number; links: Map<string, { start: number; span: number }> } | null = null;
  let offTick: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reboots = 0;
  let flips: number[] = []; // wall-clock seconds of the recent flips, for the tape
  let taped = false;
  let tapeDue = false; // taped, but `tape_on` not played yet: it waits for a landing at the origin
  let tapeTick: (() => void) | null = null;
  let lookTimer: ReturnType<typeof setTimeout> | null = null;
  let tripped = false;
  let originOff = false; // from SNAP until the origin has gone off, once its `poke_power` is over

  const at = (when: number, run: () => void): void => {
    steps.push([when, run]);
    steps.sort((a, b) => a[0] - b[0]);
  };

  function due(): void {
    while (steps.length > 0 && steps[0]![0] <= t + 1e-9) steps.shift()![1]();
  }

  function tick(dt: number): boolean {
    t += dt;
    due();
    if (originOff && nodes.get(ORIGIN).playing !== 'poke_power') {
      originOff = false;
      darken(ORIGIN);
    }
    if (draw) for (const [id, l] of draw.links) links.drawProgress(id, (t - draw.at - l.start) / l.span);
    if (steps.length > 0) return true;
    offTick?.();
    offTick = null;
    return false;
  }

  function wait(): void {
    timer = null;
    const next = steps[0];
    if (!next) return;
    timer = setTimeout(() => {
      t = next[0];
      due();
      wait();
    }, (next[0] - t) * 1000);
  }

  const say = (text: string): void => {
    if (live) live.textContent = text;
  };

  /** Every status line empties, the arrival's let-go still to come included (it'd say "Working"
   *  on a dark label: a flip just as the arrival ended). */
  function hush(): void {
    director.cancelStatusRipple();
    for (const id of ids) labels.setStatus(id, null);
    say('');
  }

  /** Each line goes off with the first node it plugs into, and comes back with the last. */
  function cable(): void {
    opts.cable?.()?.setLit((id) => nodes.get(id).lit);
  }

  function darken(id: string): void {
    nodes.get(id).setLit(false);
    if (id !== ORIGIN) links.setLit(id, false);
    cable();
  }

  /** Unfolds the origin's tape (folded out of sight in the model, its `unfold` the scale), about
   *  its true origin `unfold_at`: the GLB's quantization moved the node by an offset times the fold. */
  function unfold(): void {
    const o = nodes.get(ORIGIN).root.getObjectByName('tape');
    const k = o?.userData['unfold'];
    const at = o?.userData['unfold_at'];
    if (!o || typeof k !== 'number') return;
    o.scale.multiplyScalar(k);
    if (Array.isArray(at) && at.length === 3) {
      const [x, y, z] = at as number[];
      o.position.set(x! + (o.position.x - x!) * k, y! + (o.position.y - y!) * k, z! + (o.position.z - z!) * k);
    }
    clock.invalidate?.();
  }

  /** The switch is taped over, as the third reboot ends: back to the origin from the overview,
   *  and the tape goes on as you land (with motion reduced it's just there). */
  function tape(): void {
    taped = true;
    if (stations.current === null) stations.go?.(ORIGIN);
    if (prefs.reduced || !nodes.get(ORIGIN).has(TAPE_ON)) {
      unfold();
      // a close look, cut in and back, once the cut to the origin has landed
      lookTimer = setTimeout(() => {
        const p = closePose();
        if (!p || stations.current !== ORIGIN) return;
        director.closeUp?.(p);
        lookTimer = setTimeout(() => stations.current === ORIGIN && director.closeUp?.(null), LOOK_REDUCED * 1000);
      }, 100);
    } else {
      tapeDue = true;
      watchTape();
    }
  }

  /** The camera's close look at the switch: the station framing's direction, aimed at the
   *  switch's middle, near enough that it spans LOOK_SHARE of the visible height. */
  function closePose(): Pose | null {
    const node = nodes.get(ORIGIN);
    const sw = node.root.getObjectByName('poke_power_hit');
    if (!sw || !director.framing) return null;
    const at = director.framing(ORIGIN);
    // (Box3 and Vector3 by cloning the node's: importing three here would split the first load)
    const box = node.bounds.clone().setFromObject(sw);
    const size = box.getSize(node.home.clone());
    const w = innerWidth;
    const h = innerHeight;
    const side = w >= tuning.panelMinViewportPx; // the panel on the right, else a sheet below
    const visW = side ? w - tuning.panelWidthPx : w;
    const visH = side ? h : h * (1 - tuning.sheetOpen);
    const px = Math.min(LOOK_SHARE * visH, LOOK_WIDE * visW);
    const d = (Math.max(size.x, size.z) * h) / (2 * Math.tan((at.fovY * Math.PI) / 360) * px);
    const target = box.getCenter(node.home.clone());
    const position = at.position.clone().sub(at.target).setLength(d).add(target);
    return { position, target, fovY: at.fovY };
  }

  /** At the origin (or on the way there), waits for the landing, then looks in close, plays
   *  `tape_on` and looks back out. */
  function watchTape(): void {
    if (!tapeDue || tapeTick || stations.current !== ORIGIN) return;
    let t = -1; // seconds since the landing
    let shown = Infinity; // when the tape is shown (TAPE_SHOW after tape_on starts, from idle)
    const end = TAPE_AT + TAPE_LEN + LOOK_HOLD + LOOK_OUT;
    tapeTick = clock.add((dt) => {
      const here = stations.current === ORIGIN && (director.state ?? 'station') === 'station';
      if (t < 0 && !here) {
        if (stations.current === ORIGIN) return true; // still flying in
      } else if (here || tapeDue) {
        t = t < 0 ? 0 : t + dt;
        if (tapeDue && t >= (director.closeUp ? TAPE_AT : 0)) {
          const node = nodes.get(ORIGIN);
          // From idle it crosses in, so the strip waits that out (the roll covers it); and play()
          // starts a microtask late, so never this frame: it'd show laid for a frame.
          shown = t + (node.playing === 'idle' ? TAPE_SHOW : 1e-6);
          tapeDue = false;
          void node.play(TAPE_ON);
        }
        if (t >= shown) {
          unfold();
          shown = Infinity;
        }
        const close = here && director.closeUp ? closePose() : null;
        if (close) {
          const k = t < LOOK_IN ? ease(t / LOOK_IN) : t < end - LOOK_OUT ? 1 : ease(Math.max(0, (end - t) / LOOK_OUT));
          const at = director.framing!(ORIGIN);
          director.closeUp!({ position: at.position.lerp(close.position, k), target: at.target.lerp(close.target, k), fovY: at.fovY });
        }
        if (here && t < end) return true;
        if (here) director.closeUp?.(null);
      }
      if (shown !== Infinity) unfold(); // left before it was shown: shown now
      tapeTick?.();
      tapeTick = null;
      return false;
    });
  }
  const unwatch = opts.stations.subscribe?.(() => {
    watchTape();
    unwiden(); // travel: the flights take over from wherever the camera is
  });

  // --- the RCD's wider framing --------------------------------------------------------------------

  let wideK = 0; // 0: the station's framing, 1: the wider one
  let wideTurn = 0; // the visitor's turn as it widened: turned since, the director's framing stands
  let wideTick: (() => void) | null = null;
  let wideTimer: ReturnType<typeof setTimeout> | null = null;
  const atBoard = () => stations.current === RCD && (director.state ?? 'station') === 'station';

  function unwiden(): void {
    wideTick?.();
    wideTick = null;
    wideK = 0;
  }

  /** The wider framing round the board: the station framing's direction, aimed at the middle of
   *  the board, its WIDE_NEAR nearest nodes and its link's first WIDE_LINK, far enough back that
   *  they're all WIDE_MARGIN inside the visible area (left of the panel, above the sheet). */
  function widePose(): Pose | null {
    if (!director.framing) return null;
    const at = director.framing(RCD);
    const home = nodes.get(RCD).home;
    type P = { x: number; y: number; z: number };
    const box = (id: string): P[] => {
      const { home: h, bounds: b } = nodes.get(id);
      if (b.isEmpty()) return [h];
      return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        x: h.x + (i & 1 ? b.max.x : b.min.x),
        y: h.y + (i & 2 ? b.max.y : b.min.y),
        z: h.z + (i & 4 ? b.max.z : b.min.z),
      }));
    };
    const own = box(RCD);
    const c = links.curve?.(RCD);
    if (c) {
      // from its own end (the curve may run either way)
      const a = c.getPoint(0);
      const far = Math.hypot(a.x - home.x, a.z - home.z) < 1;
      for (let i = 1; i <= 3; i++) own.push(c.getPoint(far ? (WIDE_LINK * i) / 3 : 1 - (WIDE_LINK * i) / 3));
    }
    const d2 = (id: string) => (nodes.get(id).home.x - home.x) ** 2 + (nodes.get(id).home.z - home.z) ** 2;
    const near = linked.filter((id) => id !== RCD).sort((a, b) => d2(a) - d2(b)).slice(0, WIDE_NEAR);
    // The camera's basis (Object3D.lookAt's, up +y): f forward, r right, u up.
    const len = at.position.distanceTo(at.target);
    const f = at.target.clone().sub(at.position).normalize();
    const r = f.clone().set(-f.z, 0, f.x).normalize();
    const u = r.clone().cross(f);
    const w = innerWidth;
    const h = innerHeight;
    const side = w >= tuning.panelMinViewportPx;
    const t = Math.tan((at.fovY * Math.PI) / 360);
    // The visible window's slopes, centred on the view axis at the whole canvas's scale (fit.ts).
    const sx = (t * (side ? w - tuning.panelWidthPx : w)) / h;
    const sy = (t * (side ? h : h * (1 - tuning.sheetOpen))) / h;
    const fit = (pts: P[]) => {
      const target = at.target.clone();
      // aimed at the middle of their spread across and up the view
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const p of pts) {
        const q = target.clone().set(p.x, p.y, p.z).sub(at.target);
        [x0, x1, y0, y1] = [Math.min(x0, q.dot(r)), Math.max(x1, q.dot(r)), Math.min(y0, q.dot(u)), Math.max(y1, q.dot(u))];
      }
      target.addScaledVector(r, (x0 + x1) / 2).addScaledVector(u, (y0 + y1) / 2);
      let d = len; // never nearer than the station's framing
      for (const p of pts) {
        const q = target.clone().set(p.x, p.y, p.z).sub(target);
        d = Math.max(d, (Math.abs(q.dot(r)) + WIDE_MARGIN) / sx - q.dot(f), (Math.abs(q.dot(u)) + WIDE_MARGIN) / sy - q.dot(f));
      }
      return { position: target.clone().addScaledVector(f, -d), target, fovY: at.fovY, d };
    };
    const b = nodes.get(RCD).bounds;
    const size = b.isEmpty() ? 0 : Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    const wide = fit([...own, ...near.flatMap(box)]);
    return (size * h) / (2 * t * wide.d) >= WIDE_MIN_PX ? wide : fit(own);
  }

  /** The camera at `k` of the way from the station's framing to the wider one (eased). */
  function wideAt(k: number): void {
    const p = k > 0 ? widePose() : null;
    if (!p || !atBoard()) return void director.closeUp?.(null);
    const s = director.framing!(RCD);
    const e = ease(k);
    director.closeUp?.({ position: s.position.lerp(p.position, e), target: s.target.lerp(p.target, e), fovY: s.fovY });
  }

  /** Eases out to the wider framing (`out`), or back to the station's; cuts with motion reduced. */
  function widen(out: boolean): void {
    wideTick?.();
    wideTick = null;
    if (!director.closeUp || !atBoard()) return void (wideK = 0);
    if (out) wideTurn = director.turn ?? 0;
    else if (wideK === 0 || (director.turn ?? 0) !== wideTurn) return void (wideK = 0); // the director's own framing stands
    if (timed) return wideAt((wideK = out ? 1 : 0));
    const span = out ? WIDE_IN : WIDE_OUT;
    wideTick = clock.add((dt) => {
      if (!atBoard()) {
        unwiden();
        return false;
      }
      wideK = Math.min(Math.max(wideK + (out ? dt : -dt) / span, 0), 1);
      wideAt(wideK);
      if (out ? wideK < 1 : wideK > 0) return true;
      wideTick?.();
      wideTick = null;
      return false;
    });
  }

  /** A resize or a turn of the phone: the director refits to the station's framing (after this,
   *  from its ResizeObserver), so the wider one is put back once that's done. */
  function rewiden(): void {
    if (wideTimer !== null) clearTimeout(wideTimer);
    wideTimer = setTimeout(() => {
      wideTimer = null;
      if (wideK > 0 && !wideTick && (director.turn ?? 0) === wideTurn) wideAt(wideK);
    }, 100);
  }
  globalThis.addEventListener?.('resize', rewiden);

  function reboot(tapeAfter = false): void {
    if (originOff) darken(ORIGIN); // its poke never ended (the model came late): off, then on
    originOff = false;
    const times = director.arrivalTimes();
    const reach = (id: string) => times.reach.get(id) ?? 0;
    const start = t;
    say(copy.checking.text);
    for (const id of ids) labels.setStatus(id, copy.checking.text, { pinned: true });
    for (const id of linked) links.setLit(id, true);
    if (timed) {
      for (const id of ids) nodes.get(id).setLit(true); // the colours come back at once
      cable();
    } else {
      nodes.get(ORIGIN).setLit(true);
      for (const id of linked) links.drawProgress(id, 0);
      draw = { at: start, links: times.links };
    }
    // The origin has no link of its own: it reads "Working" as the first link lands from it.
    const first = Math.min(...linked.map(reach));
    let end = start;
    for (const id of ids) {
      const when = start + (id === ORIGIN && linked.length > 0 ? Math.max(reach(id), first) : reach(id));
      end = Math.max(end, when);
      at(when, () => {
        if (!timed) {
          nodes.get(id).setLit(true);
          cable();
        }
        labels.setStatus(id, copy.working.text, { pinned: true });
      });
    }
    for (const l of times.links.values()) end = Math.max(end, start + l.start + l.span);
    at(end, () => {
      if (draw) for (const id of linked) links.drawProgress(id, 1);
      draw = null;
      traffic.enabled = true;
      if (!timed) traffic.burst(BURST);
      say(copy.working.text);
      cue('power', 'post'); // one short POST beep (Task 17)
      reboots++;
      opts.onReboot?.();
      if (tapeAfter) tape();
      // The statuses let go in station order (motion audit #14), all at once with motion reduced.
      const stagger = timed ? 0 : tuning.statusStaggerMs / 1000;
      ids.forEach((id, i) => at(end + i * stagger, () => labels.setStatus(id, copy.working.text)));
    });
  }

  /** Starts the steps' clock: frames, or timers with motion reduced. */
  function run(): void {
    if (timed) wait();
    else offTick ??= clock.add(tick);
  }

  function flip(): boolean {
    if (steps.length > 0 || tripped) return false;
    if (taped) {
      if (tapeDue || nodes.get(ORIGIN).playing === TAPE_ON) return false; // it's going on: that plays out
      nodes.get(ORIGIN).poke('power_taped'); // the cover strains against the tape; nothing switches
      found('taped-switch');
      return false;
    }
    const now = performance.now() / 1000;
    flips = [...flips.filter((f) => now - f < TAPE_WINDOW), now];
    const tapeAfter = flips.length >= TAPE_FLIPS;
    timed = prefs.reduced;
    t = 0;
    const plan = powerTimeline(ids, timed);
    void nodes.get(ORIGIN).play('poke_power');
    at(plan.snap, () => {
      traffic.enabled = false;
      hush();
      // The origin goes off as its `poke_power` ends (tick), not across it: `off` would cut the
      // cover's drop. With motion reduced the clip is at its end already.
      if (timed) darken(ORIGIN);
      else originOff = true;
    });
    at(timed ? plan.snap : DIVE, () => {
      // Every node in frame as it goes dark: the overview as composed, not a phone's closer start.
      if (stations.current === ORIGIN) {
        director.composeNext?.();
        stations.overview();
      }
    });
    for (const [id, when] of plan.dark) if (id !== ORIGIN) at(when, () => darken(id));
    at(plan.reboot, () => reboot(tapeAfter));
    run();
    return true;
  }

  function rcd(): boolean {
    if (steps.length > 0 || !ids.includes(RCD)) return false;
    timed = prefs.reduced;
    t = 0;
    if (tripped) {
      tripped = false;
      nodes.get(RCD).setLit(true); // reset: its toggles back up, now
      cue('power', 'reset'); // their clunks, timed to its `on` (sound.ts)
      at(TRIP, () => reboot());
      widen(false); // back to the station's framing as the map comes back
    } else {
      nodes.get(RCD).poke('test'); // the press, the trip and the bang
      tripped = true;
      found('test-means-test');
      // Along the links (links.ts's parents and curves; without them, straight to the hub).
      const hub = nodes.get(ORIGIN).home;
      const trip = tripTimeline(
        ids,
        RCD,
        (id) => (id === ORIGIN ? null : (links.parent?.(id) ?? ORIGIN)),
        (id) => links.curve?.(id).getLength() ?? Math.hypot(nodes.get(id).home.x - hub.x, nodes.get(id).home.z - hub.z),
        timed,
      );
      at(TRIP, () => {
        traffic.enabled = false;
        hush();
        widen(true); // out to the wider framing as it trips, to see the dark leave
      });
      for (const [id, when] of trip.links)
        at(when, () => {
          links.setLit(id, false);
          // Its link was --soft under the pointer (or the focused label) that pressed it: hover
          // outranks off in links.ts, so it's let go to show the --ghost. Hovered again, it's --soft.
          if (id === RCD) links.emphasize?.(null);
        });
      for (const [id, when] of trip.nodes)
        if (id !== RCD)
          at(when, () => {
            nodes.get(id).setLit(false);
            cable();
          });
      at(timed ? TRIP : RCD_OFF, () => darken(RCD)); // as its poke_test ends
    }
    run();
    return true;
  }

  return {
    flip,
    rcd,
    get busy() {
      return steps.length > 0 || tripped;
    },
    get tripped() {
      return tripped;
    },
    get taped() {
      return taped;
    },
    get reboots() {
      return reboots;
    },
    dispose() {
      steps = [];
      draw = null;
      offTick?.();
      offTick = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      tapeTick?.();
      tapeTick = null;
      if (lookTimer !== null) clearTimeout(lookTimer);
      wideTick?.();
      wideTick = null;
      if (wideTimer !== null) clearTimeout(wideTimer);
      globalThis.removeEventListener?.('resize', rewiden);
      unwatch?.();
      live?.remove();
    },
  };
}
