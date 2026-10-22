// The homelab's real wiring (the owner's test notes, 2026-10-21 afternoon; the layout R1): its
// network cables, its power cords and the two power strips that feed them. A lazy chunk
// (moments/load.ts): map.ts asks for it after the arrival, and the lines draw themselves out once
// it's in. It began as the server's one cable to the switch.
//
// - The table (CABLES): each line joins two ends, a node's plug, named by the glTF extras on
//   its model's root (`<at>_end`, inside the plug's boot, relative to the node, its facing
//   applied, and `<at>_dir`, the way the line leaves it), or a strip's plug of a kind (below).
//   `kind` network or power; `slack`, how far it bows aside, a share of its length; `coil`,
//   where one loop of spare cable lies, that far along from its first end. Each model carries
//   only its plug, so a line's round end hides in the boot.
//   - network: router 2.5G port → switch port 2 (with the coil by the router), switch port 3 →
//     the AP (PoE: the AP has no cord), port 1 → the desktop, the dock → port 8. Ports 1-3 in
//     the order their devices stand round the switch in R1 (the desktop on the ports' side,
//     the router ahead, the AP beyond), so the three don't cross as they leave;
//   - power: strip A → the router's adapter, the switch's brick and the desktop; strip B → the
//     Zenbook's USB-C charger and the dock's adapter; the brick's DC lead → the switch (the
//     owner, 2026-10-22 midday: the Pro XG 8 has an external power supply).
// - The strips (STRIPS, the model `strip`): they aren't stations (no label, link or ground ring,
//   and the pointer never picks them), so world.json doesn't place them: each stands at a
//   weighted mean of some of its devices' homes (and `off` that, strip A behind the switch),
//   so it keeps its place if the cluster moves a little, turned to its `facing`. Each cord takes
//   the socket its device's side of the strip puts it in (or its `socket`), and no cord follows
//   a ground ring (the owner's notes, 2026-10-22: cords led round the router's far side and the
//   PC's front hugged their rings, a second circle). A line may pass by `via` points, in order.
//   The plugs on it (the router's and the dock's adapters, the Zenbook's charger, the mains
//   plugs) are clones of the model's templates, set on those sockets.
// - The brick (BRICKS, the model `psu`): the switch's external power supply, a white brick lying on
//   the floor beside it on strip A's side, no station either. It stands off its device's home by
//   `at` (world axes), turned to its `facing`, and stays put as the strips do. Its ends are its
//   root's extras (`dc_end` and `dc_dir`, the DC lead out of one short side; `mains_end` and
//   `mains_dir`, the mains cord's plug in the other), turned with it. Its lines go out with the
//   device it powers (setLit), and count it as theirs (`ends`).
// - The docks (decided 2026-10-22 midday): riding over a floor cable is fine, but a
//   gondola docked at a station doesn't park on one. With the docks (CableDeps.dock),
//   every line keeps DOCK_CLEAR from each of its nodes' docked cabin: the cabin's plan (CABIN,
//   round visitor.glb's bounds), centred at its dock (world/dock.ts), turned along its link there.
// - The shape (cablePoints): straight out of each boot along its dir for CABLE_LEAD (on until
//   it's clear of its own node), on round an arc of BEND_R where the boot faces away from the
//   other end, then a cubic Bézier between those leads (short handles: it turns soon, as a cable
//   does), bowed aside by its slack (sin², level with the leads) and eased round the bodies near
//   it (a circle round each node, its bounds' size but inside its ground ring's band, or nearer
//   for a line's `near`; each strip and the brick; a rounded box round each docked cabin) like a
//   rope settling round posts; then smoothed alone (Taubin's pairs, which don't pinch a bend
//   shut), its points evened out along it, so no two segments turn more than a few
//   degrees (the owner's notes, 2026-10-22). Each lead keeps its boot's height, so the
//   line leaves the boot exactly along its dir; past it the line falls to the floor as a hanging
//   cable does, over a run that grows with the height (and over nine segments at least), and
//   lies there.
// - Drawn as round things lying on the floor, not as the map's line work (the owner's notes,
//   2026-10-22, on cables-quiet: at 2 px and 1 px they read as more links): Line2 +
//   LineMaterial as the links, its shader patched (roundShaders) so each point is drawn at its
//   real thickness (WIDTH) at its own distance, growing as the camera nears, never under
//   MIN_PX far off; and, once it's a few px wide (ROUND_PX), shaded as a round: darker at its
//   rims, a lighter crown along its middle (roundTones). Under a device pixel it's drawn one
//   wide, its tone toward the floor by the share it would cover. The hierarchy: a network
//   cable a mid grey a step stronger than the links' --edge, never as strong as the models'
//   --detail (its rims included); a power cord half as wide at any distance (WIDTH, MIN_PX) and
//   a lighter grey, a step quieter than --edge (TONE, lineColour); the links stay flat 1 px
//   hairlines, so round, shaded, real-width cords and cables against flat hairlines tell them
//   apart, width and tone network from power, in both themes. Set in each line's
//   onBeforeRender, so it costs no frames of its own.
// - A pull: nodes.ts calls links.setEnd on every frame a node is off its home (and once more as
//   it lands); map.ts fans that out to update(id), which redraws the lines plugged into it from
//   where their models stand. The strips stay put. At rest nothing runs.
// - None of it is one of the links: no traffic, no flights, no hover, no route. The pointer
//   doesn't pick it and it's in no node's bounds.
// - The power switch (Task 15; moments/power.ts) switches the lines off with the network:
//   setLit(isLit) puts each line out while any node it plugs into is (a cable goes off with the
//   first of its two nodes and comes back with the second; a cord with its device), fading it
//   to --ghost as the links fade (over tuning.linkLitSeconds; at once with motion reduced). The
//   strips stay as they are: the mains is still on.

// Only Vector2 and Vector3 from three as values: another value import made Rolldown split three's
// core out of the runtime into a shared chunk (tests/unit/budget.test.ts).
import { type Material, type Object3D, Vector2, Vector3, type WebGLRenderer } from 'three';
import { Line2 } from '../vendor/lines/Line2.js';
import { LineGeometry } from '../vendor/lines/LineGeometry.js';
import { LineMaterial } from '../vendor/lines/LineMaterial.js';
import { smoothstep } from '../motion/ease';
import { prefs } from '../motion/prefs';
import type { applyRoleMaterials, recolourRoleMaterial } from '../shading';
import type { Clock } from '../stage/clock';
import type { Stage } from '../stage/stage';
import type { Theme } from '../stage/theme';
import { tuning } from '../tuning';
import type { NodeView } from './nodes';

export type CableKind = 'network' | 'power';
/** Strip A by the router, the switch and the desktop; strip B by the laptop and the server. */
export type StripId = 'A' | 'B';
/** The strip's plug templates (its model's, public/models/strip.glb). */
export type PlugKind = 'adapter' | 'charger' | 'plug';
/** The switch's power brick (public/models/psu.glb). */
export type BrickId = 'psu';
/** A line's end: a node's plug (its extras `<at>_end` and `<at>_dir`), a plug on a strip, or one
 *  of a brick's leads (its extras `<at>_end` and `<at>_dir`: `dc` or `mains`). */
export type EndSpec = { node: string; at: string } | { strip: StripId; plug: PlugKind } | { brick: BrickId; at: string };

/** A point on the floor, [x, z] off a node's home (world axes). */
export interface Via {
  node: string;
  at: readonly [number, number];
}

export interface CableSpec {
  /** The line's object name: `cable:<name>` for a network cable, `cord:<name>` for a power cord. */
  name: string;
  kind: CableKind;
  from: EndSpec;
  to: EndSpec;
  /** How far it bows aside, a share of its length (the sign picks the side). */
  slack: number;
  /** One loop of spare cable this far along from `from` (none if unset). */
  coil?: number;
  /** A point it passes by, [x, z] off a node's home (world axes), so it goes round that node
   *  on the side that crosses nothing; or a few, in order. */
  via?: Via | readonly Via[];
  /** How near it keeps to one of its nodes past its lead (that node's clearance if unset): the
   *  switch's ports face its own docked cabin, so their cables leave short and turn soon. */
  near?: { node: string; clear: number };
  /** A strip's socket (0-3 along it) for its plug, instead of the order its device stands in. */
  socket?: number;
  /** Shape.aim, .bend and .lead: where a plug faces away from the other end, how near it
   *  turns toward it first, how tight, and after how long a lead. */
  aim?: number;
  bend?: number;
  lead?: number;
}

/** The switch's ports' cables keep this near it past their short leads (its bounds give 0.42). */
const SWITCH_NEAR = { node: 'switch', clear: 0.33 };

/** The wiring (the owner's test notes, 2026-10-21 afternoon). Round the docked gondolas (decided
 *  2026-10-22 midday): the waypoints, strip A's and the brick's places and the slack, as a search
 *  over the layout found them. */
export const CABLES: readonly CableSpec[] = [
  // The switch's ports face its own docked cabin, 0.75 out toward the router: its cables leave
  // short (`near`, `lead`) and turn soon, the AP's and the router's north of it, the PC's south.
  { name: 'homelab_switch', kind: 'network', from: { node: 'homelab', at: 'cable' }, to: { node: 'switch', at: 'port2' }, slack: 0.07, coil: 0.3, via: { node: 'switch', at: [0.62, -0.7] }, near: SWITCH_NEAR, lead: 0.04 },
  { name: 'switch_ap', kind: 'network', from: { node: 'switch', at: 'port3' }, to: { node: 'ap', at: 'cable' }, slack: -0.06, via: { node: 'switch', at: [0.24, -0.65] }, near: SWITCH_NEAR, lead: 0.04 },
  // The PC's plugs face west, past its docked cabin from the switch: the cable goes round the
  // switch's south corner, between it and that cabin, and down the cabin's west side.
  { name: 'switch_desktop', kind: 'network', from: { node: 'switch', at: 'port1' }, to: { node: 'desktop', at: 'cable' }, slack: 0.06, via: { node: 'switch', at: [0.26, 0.38] }, near: SWITCH_NEAR, lead: 0.04 },
  // The dock's RJ45 faces 17 degrees off the switch (the dock turned; it faced 114 off), so the
  // cable heads straight over. Port 8 faces away from the server, so at the switch it still turns
  // tight: a short lead and a tight bend, on round until it heads within 25 degrees of the server
  // (the owner's notes, 2026-10-22, on cables-quiet).
  { name: 'server_switch', kind: 'network', from: { node: 'server', at: 'cable' }, to: { node: 'switch', at: 'cable' }, slack: -0.05, aim: 25, bend: 0.09, lead: 0.05 },
  // The router's socket faces north-west, behind the wall the switch, its docked cabin and the
  // router make: from strip A it goes up the switch's west side, between it and the server's
  // cabin, round the north well clear of the switch's ring, over the AP's cable and in from the
  // west (its plug's end of the strip, socket 3).
  {
    name: 'A_homelab', kind: 'power', from: { strip: 'A', plug: 'adapter' }, to: { node: 'homelab', at: 'power' }, slack: 0.05, socket: 3,
    via: [
      { node: 'switch', at: [-1.05, 0.25] },
      { node: 'switch', at: [-0.49, -0.16] },
      { node: 'switch', at: [-0.68, -0.32] },
      { node: 'switch', at: [-0.08, -0.82] },
      { node: 'switch', at: [0.48, -1.16] },
      { node: 'homelab', at: [-0.47, -0.59] },
    ],
  },
  // The switch's power brick (the owner, 2026-10-22 midday): strip A → its mains inlet, and its
  // DC lead → the switch's DC jack at the back.
  { name: 'A_psu', kind: 'power', from: { strip: 'A', plug: 'plug' }, to: { brick: 'psu', at: 'mains' }, slack: 0.04, socket: 1 },
  { name: 'psu_switch', kind: 'power', from: { brick: 'psu', at: 'dc' }, to: { node: 'switch', at: 'power' }, slack: 0.02 },
  { name: 'A_desktop', kind: 'power', from: { strip: 'A', plug: 'plug' }, to: { node: 'desktop', at: 'power' }, slack: -0.045, socket: 0 },
  { name: 'B_laptop', kind: 'power', from: { strip: 'B', plug: 'charger' }, to: { node: 'laptop', at: 'power' }, slack: -0.05 },
  // The dock's adapter cord goes round the server's back, away from its station's camera (the
  // owner, 2026-10-22 evening: it ran across the server's front, between it and the camera, and
  // crossed its cable by the dock): from strip B's west face down the server's west side, round
  // the dock's south end and into its plug (which faces the dock's own cabin, so it turns back).
  {
    name: 'B_server', kind: 'power', from: { strip: 'B', plug: 'adapter' }, to: { node: 'server', at: 'power' }, slack: 0.05,
    via: [
      { node: 'server', at: [-0.47, 0] },
      { node: 'server', at: [-0.3, 0.75] },
    ],
  },
];

export interface StripSpec {
  /** Where it stands: a weighted mean of these nodes' homes (the weights sum to 1). */
  at: Readonly<Record<string, number>>;
  /** Its turn: its front (where the cords leave) faces this many degrees from +z toward +x. */
  facing: number;
  /** And this far off that mean, [x, z] (world axes). */
  off?: readonly [number, number];
}

/**
 * Strip A south-west of the switch ([-7.80, 8.69] in R1), behind it with the brick, its front to
 * the north-east: the PC's plugs, the switch's DC jack and the brick are all on that side of the
 * cabins docked at the switch and the PC, so only the router's cord has far to go (it stood by
 * the cluster's middle until 2026-10-22, where the PC's cable now passes).
 * Strip B where R1 put it, between the laptop and the server ([-8.0, 6.66]), its front to the west
 * (it faced south, toward the server, until 2026-10-22 evening): the laptop's cord leaves it north
 * and the server's south, down the server's back, side by side (facing south, the server's cord had
 * to cross the laptop's or hug the server's ring to get there).
 */
export const STRIPS: Readonly<Record<StripId, StripSpec>> = {
  A: { at: { switch: 1 }, off: [-1.25, 0.49], facing: 122 },
  B: { at: { laptop: 0.3472, server: 0.4461, ap: 0.2067 }, facing: 270 },
};
/** The nodes a strip's place is taken from. */
const placedBy = (id: StripId) => Object.keys(STRIPS[id].at);

export interface BrickSpec {
  /** Its model (public/models/<model>.glb). */
  model: string;
  /** The node it powers: it lies by that node's home, and its lines go out with it. */
  powers: string;
  /** Where it lies, [x, z] off that node's home (world axes). */
  at: readonly [number, number];
  /** Its turn, as a strip's: its model's +z faces this many degrees from +z toward +x. */
  facing: number;
}

/** The switch's brick: beside the switch on strip A's side. */
export const BRICKS: Readonly<Record<BrickId, BrickSpec>> = {
  psu: { model: 'psu', powers: 'switch', at: [-0.75, 0.17], facing: 222 },
};
/** Where a brick lies (by its node's home, on its floor) and its turn about Y (radians). */
export function brickPose(spec: BrickSpec, homeOf: (id: string) => Vector3): { at: Vector3; yaw: number } {
  const at = homeOf(spec.powers).clone().add(new Vector3(spec.at[0], 0, spec.at[1]));
  return { at, yaw: (spec.facing * Math.PI) / 180 };
}

/** Segments along a line (a coiled one has COIL_POINTS more): short enough that no two turn
 *  more than a few degrees from each other. */
export const CABLE_SEGMENTS = 160;
export const COIL_POINTS = 40;
/** The coil's radius. */
export const COIL_R = 0.07;
/** The real thickness, in model units: a cable about 6 mm at the switch's scale, a cord half
 *  that. Drawn so on screen at its distance (roundShaders), and it lies on the floor by its radius. */
export const WIDTH: Readonly<Record<CableKind, number>> = { network: 0.014, power: 0.007 };
/** The least it's drawn on screen, in hairlines (CSS px), far off: a cord half a cable there too. */
export const MIN_PX: Readonly<Record<CableKind, number>> = { network: 1.5, power: 0.75 };
/** Its body's tone, from the links' --edge (mixed in sRGB): a network cable this share of the way
 *  toward the models' --detail, a step stronger than a link; a cord (negative) toward the floor
 *  (--bg), a lighter grey than both, clear of --ghost (switched off). */
export const TONE: Readonly<Record<CableKind, number>> = { network: 0.4, power: -0.15 };
/** The round's shading (sRGB): its rims this share darker than its body, its crown this share
 *  of the way to white. A network cable's rims stay short of --detail, its crown of --edge. */
export const RIM = 0.25;
export const CROWN = 0.25;
/** The width it's shaded from, and fully by, in CSS px: thinner, a flat line of its body's tone. */
export const ROUND_PX: readonly [number, number] = [2.5, 5];
/** How far a line runs straight out of each boot before it turns. */
export const CABLE_LEAD = 0.1;
/** The tightest a line bends where it turns back from a lead. */
export const BEND_R = 0.11;
/** Over how many points past a lead the smoothing comes in. */
const GIVE_POINTS = 8;
/** How far it keeps from a node's centre when its bounds aren't known. */
export const CABLE_CLEAR = 0.34;
/** The most it keeps from a node's centre: inside the ground ring's band (tuning.groundRing, less
 *  0.1), so a line eased round a body never runs along its ring. */
export const CLEAR_MAX = 0.47;
/** And from a strip's centre (it's 0.44 long), for the other lines... */
export const STRIP_CLEAR = 0.25;
/** ...while its own cords drop off its front edge just past their plugs (it's 0.10 deep). */
export const STRIP_OWN = 0.06;
/** How far the other lines keep from a brick's centre (it's 0.30 long)... */
export const BRICK_CLEAR = 0.2;
/** ...and its own from its centre past their leads (it's 0.14 wide). */
export const BRICK_OWN = 0.1;
/** The docked cabin's plan, round visitor.glb's (±0.092 across, ±0.206 along its link). */
export const CABIN = { across: 0.1, along: 0.21 } as const;
/** How far every line keeps from a docked cabin's plan. */
export const DOCK_CLEAR = 0.07;
/** Its centre line's height on the floor: its radius. */
export const CABLE_FLOOR = WIDTH.network / 2;
/** How long the draw-out takes. */
const DRAW_SECONDS = 0.7;
/** Smoothing passes round the bodies (each followed by a push out of them), then smoothing
 *  alone, evened out along its length, so no corner is left where a push stopped or a lead
 *  ends (it may graze a body by a hair). */
const SETTLE_PASSES = 24;
const EASE_PASSES = 48;

/** A body a line keeps clear of: a circle on the floor, or `r` round a box (a docked cabin's plan:
 *  `a` along the unit (ux, uz) either way, `b` across it). */
export interface Body {
  x: number;
  z: number;
  r: number;
  ux?: number;
  uz?: number;
  a?: number;
  b?: number;
}

/** How far (x, z) is from a body's core (its centre, or its box: negative inside it), and the way
 *  out from there (unit; zero at a circle's centre), into `out`. */
export function bodyGap(c: Body, x: number, z: number, out = { d: 0, nx: 0, nz: 0 }): { d: number; nx: number; nz: number } {
  let dx = x - c.x;
  let dz = z - c.z;
  if (c.a || c.b) {
    const ux = c.ux ?? 1;
    const uz = c.uz ?? 0;
    const a = c.a ?? 0;
    const b = c.b ?? 0;
    const s = dx * ux + dz * uz; // along
    const t = dz * ux - dx * uz; // across
    if (Math.abs(s) <= a && Math.abs(t) <= b) {
      // Inside the box: out the nearer way, across it or past an end.
      const across = b - Math.abs(t) <= a - Math.abs(s);
      const side = (across ? t : s) < 0 ? -1 : 1;
      out.d = -(across ? b - Math.abs(t) : a - Math.abs(s));
      out.nx = (across ? -uz : ux) * side;
      out.nz = (across ? ux : uz) * side;
      return out;
    }
    const es = s - Math.max(-a, Math.min(a, s));
    const et = t - Math.max(-b, Math.min(b, t));
    dx = es * ux - et * uz;
    dz = es * uz + et * ux;
  }
  const d = Math.hypot(dx, dz);
  out.d = d;
  out.nx = d > 1e-9 ? dx / d : 0;
  out.nz = d > 1e-9 ? dz / d : 0;
  return out;
}

/** A gondola docked at `at`, its link running `dir` (world/dock.ts's dockPose): its cabin's plan
 *  as a Body, DOCK_CLEAR round it. */
export function cabinBody(at: { x: number; z: number }, dir: { x: number; z: number }): Body {
  return { x: at.x, z: at.z, r: DOCK_CLEAR, ux: dir.x, uz: dir.z, a: CABIN.along, b: CABIN.across };
}

/** A line's end: where it sits and the way it leaves (level, unit length). */
export interface CableEnd {
  at: Vector3;
  dir: Vector3;
  /** The centre of what it's plugged into, which the line keeps `clear` from past its lead. */
  centre: Vector3;
  /** That body's clearance (CABLE_CLEAR if unset). */
  clear?: number;
}

export interface Shape {
  /** The bow aside, a share of the line's length. */
  slack?: number;
  /** One loop of spare cable this far along from `a` (0: none). */
  coil?: number;
  /** The centre line's height over the floor (its radius). */
  lie?: number;
  /** Other bodies it keeps clear of (any that holds one of its ends is left out). */
  avoid?: readonly Body[];
  /** A point on the floor it passes by (round a body the other way, say), or a few in order,
   *  instead of its bow. */
  via?: Vector3 | readonly Vector3[];
  /** Where a lead faces away from the other end: how far it turns round its bend before the run
   *  takes over, the most it then heads off the other end (degrees; 60 if unset). */
  aim?: number;
  /** How tight it bends there (BEND_R if unset), and how far its leads run at the least
   *  (CABLE_LEAD if unset). */
  bend?: number;
  lead?: number;
}

/** How many points a line of this spec has. */
export const pointCount = (coil?: number): number => CABLE_SEGMENTS + 1 + (coil ? COIL_POINTS : 0);

const smoother = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * A line's points from end `a` to end `b`, on the floor at `floor` + its lie between them. Each
 * end's first stretch runs straight along its `dir` at its own height, so the line leaves the
 * boot along it at any length; between the leads it's a cubic Bézier bowed aside by `slack` and
 * eased out of the bodies' clearance circles; past each lead it falls to the floor like a
 * hanging cable (over a run that grows with the height), smoothly, so it leaves the lead level.
 * With `coil`, one loop of spare cable lies that far along from `a`.
 */
export function cablePoints(a: CableEnd, b: CableEnd, floor: number, shape: Shape = {}, out: Vector3[] = []): Vector3[] {
  const n = CABLE_SEGMENTS;
  const coil = shape.coil ?? 0;
  const count = pointCount(coil);
  for (let i = out.length; i < count; i++) out.push(new Vector3());
  const path = coil ? Array.from({ length: n + 1 }, () => new Vector3()) : out;
  // Across the floor first (y = 0), the height after.
  const flat = (v: Vector3) => new Vector3(v.x, 0, v.z);
  const a0 = flat(a.at);
  const b0 = flat(b.at);
  const span = a0.distanceTo(b0);
  const clearA = a.clear ?? CABLE_CLEAR;
  const clearB = b.clear ?? CABLE_CLEAR;
  // Each lead runs at least CABLE_LEAD, and on until it's clear of its own body's circle (a
  // plug inside it, like the switch's ports, would otherwise turn back into it).
  const leadOf = (p: Vector3, d: Vector3, c: Vector3, r: number) => {
    const o = p.clone().sub(flat(c));
    const along = o.dot(d);
    const need = Math.sqrt(Math.max((r + 0.03) ** 2 - (o.lengthSq() - along * along), 0)) - along;
    return Math.min(Math.max(shape.lead ?? CABLE_LEAD, need), span / 4);
  };
  const ad = flat(a.dir).normalize();
  const bd = flat(b.dir).normalize();
  const la = leadOf(a0, ad, a.centre, clearA);
  const lb = leadOf(b0, bd, b.centre, clearB);
  // Where a lead points away from the other end, it turns on round an arc of BEND_R (or the
  // line's `bend`) toward it, as a cable does, until it heads within 60 degrees of it (or its
  // `aim`); the Bézier carries on from there.
  const aim = Math.cos(((shape.aim ?? 60) * Math.PI) / 180);
  const R = shape.bend ?? BEND_R;
  const bend = (p0: Vector3, d: Vector3, l: number, q: Vector3) => {
    const p1 = p0.clone().addScaledVector(d, l);
    const side = new Vector3(d.z, 0, -d.x);
    if (side.dot(q.clone().sub(p1)) < 0) side.negate();
    const c = p1.clone().addScaledVector(side, R);
    const on = (phi: number, o: Vector3) => o.copy(c).addScaledVector(side, -R * Math.cos(phi)).addScaledVector(d, R * Math.sin(phi));
    const heading = (phi: number) => d.clone().multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi));
    const o = new Vector3();
    let phi = 0;
    while (phi < Math.PI && heading(phi).dot(q.clone().sub(on(phi, o)).normalize()) < aim) phi += Math.PI / 90;
    return {
      len: l + R * phi,
      end: on(phi, new Vector3()),
      dir: heading(phi),
      at: (s: number, out: Vector3) => (s <= l ? out.copy(p0).addScaledVector(d, s) : on((s - l) / R, out)),
    };
  };
  const vias = (shape.via === undefined ? [] : Array.isArray(shape.via) ? shape.via : [shape.via as Vector3]).map(flat);
  // Each lead turns toward the next point the line passes: the other end's lead, or a waypoint.
  const A = bend(a0, ad, la, vias[0] ?? b0.clone().addScaledVector(bd, lb));
  const B = bend(b0, bd, lb, vias.at(-1) ?? a0.clone().addScaledVector(ad, la));
  const a1 = A.end;
  const b1 = B.end;
  const chord = a1.distanceTo(b1);
  // Short handles: the line turns soon after its lead, as a cable does, instead of swinging
  // wide when its plug faces away from the other end.
  const h = Math.min(Math.max(chord * 0.3, 0.15), 0.4);
  const p1 = a1.clone().addScaledVector(A.dir, h);
  const p2 = b1.clone().addScaledVector(B.dir, h);
  // Points per lead (at least one segment), the rest on the Bézier.
  const ka0 = Math.max(1, Math.round((n * A.len) / (A.len + B.len + chord * 1.3)));
  const kb0 = Math.max(1, Math.round((n * B.len) / (A.len + B.len + chord * 1.3)));
  const mid = n - ka0 - kb0;
  for (let i = 0; i <= ka0; i++) A.at((A.len * i) / ka0, path[i]!);
  for (let i = 0; i <= kb0; i++) B.at((B.len * i) / kb0, path[n - i]!);
  // The slack: a bow to the left of a → b (to the right if negative).
  const left = chord > 1e-9 ? new Vector3(b1.z - a1.z, 0, a1.x - b1.x).divideScalar(chord) : new Vector3();
  const bow = (shape.slack ?? 0) * chord;
  const cubic = (o: Vector3, q0: Vector3, q1: Vector3, q2: Vector3, q3: Vector3, t: number) => {
    const s = 1 - t;
    return o.set(0, 0, 0).addScaledVector(q0, s * s * s).addScaledVector(q1, 3 * s * s * t).addScaledVector(q2, 3 * s * t * t).addScaledVector(q3, t * t * t);
  };
  if (vias.length) {
    // A cubic from each point to the next (the leads' ends and the waypoints), level through
    // each waypoint along the way the line bends there; its points shared by their lengths.
    const w = [a1, ...vias, b1];
    const d = w.slice(1).map((p, k) => Math.max(p.distanceTo(w[k]!), 1e-9));
    const tan = w.map((p, k) => (k === 0 || k === w.length - 1 ? A.dir : p.clone().sub(w[k - 1]!).divideScalar(d[k - 1]!).add(w[k + 1]!.clone().sub(p).divideScalar(d[k]!)).normalize()));
    const handle = (x: number) => Math.min(Math.max(x * 0.3, 0.15), 0.4);
    const total = d.reduce((t, x) => t + x, 0);
    const at = [0];
    for (let k = 0, run = 0; k < d.length; k++) at.push(k === d.length - 1 ? mid : Math.max(at[k]! + 1, Math.min(mid - (d.length - 1 - k), Math.round((mid * (run += d[k]!)) / total))));
    const q1 = new Vector3();
    const q2 = new Vector3();
    for (let k = 0, i = 1; k < d.length; k++) {
      if (k === 0) q1.copy(a1).addScaledVector(A.dir, handle(d[0]!));
      else q1.copy(w[k]!).addScaledVector(tan[k]!, d[k]! * 0.35);
      if (k === d.length - 1) q2.copy(b1).addScaledVector(B.dir, handle(d[k]!));
      else q2.copy(w[k + 1]!).addScaledVector(tan[k + 1]!, -d[k]! * 0.35);
      for (; i < mid && i <= at[k + 1]!; i++) cubic(path[ka0 + i]!, w[k]!, q1, q2, w[k + 1]!, (i - at[k]!) / (at[k + 1]! - at[k]!));
    }
  } else {
    for (let i = 1; i < mid; i++) {
      const t = i / mid;
      // sin² so the bow starts and ends level with the leads: no corner where they join.
      cubic(path[ka0 + i]!, a1, p1, p2, b1, t).addScaledVector(left, bow * Math.sin(Math.PI * t) ** 2);
    }
  }
  // Eased round the bodies: smooth it a little, push the free points out of each circle, again;
  // then smooth it alone, evened out along its length, so it bends everywhere as a cable does.
  const gap = { d: 0, nx: 0, nz: 0 };
  const inside = (c: Body, p: Vector3) => bodyGap(c, p.x, p.z, gap).d < c.r;
  const bodies: Body[] = [
    { x: a.centre.x, z: a.centre.z, r: clearA },
    { x: b.centre.x, z: b.centre.z, r: clearB },
    ...(shape.avoid ?? []).filter((c) => !inside(c, a0) && !inside(c, b0)),
  ];
  // How freely each point gives in the smoothing: not at all along its leads (`ka`, `kb`
  // points: it leaves each boot exactly along its dir), more and more past them, so the run
  // bends on from the lead with no corner where it ends.
  let ka = ka0;
  let kb = kb0;
  let give = (i: number) => smoother(Math.min(i - ka, n - kb - i) / GIVE_POINTS);
  const m = new Vector3();
  const smooth = (f = 0.5) => {
    for (let i = 1; i < n; i++) {
      const g = give(i);
      if (g <= 0) continue;
      m.addVectors(path[i - 1]!, path[i + 1]!).multiplyScalar(0.5);
      path[i]!.lerp(m, f * g);
    }
  };
  // Its points spaced evenly along it (the leads' and the run's alike); returns its length.
  const was = Array.from({ length: n + 1 }, () => new Vector3());
  const acc: number[] = new Array<number>(n + 1).fill(0);
  const even = () => {
    for (let i = 0; i <= n; i++) was[i]!.copy(path[i]!);
    for (let i = 1; i <= n; i++) acc[i] = acc[i - 1]! + was[i]!.distanceTo(was[i - 1]!);
    const total = acc[n]!;
    let j = 0;
    for (let i = 1; i < n; i++) {
      const at = (total * i) / n;
      while (j < n - 1 && acc[j + 1]! < at) j++;
      path[i]!.lerpVectors(was[j]!, was[j + 1]!, (at - acc[j]!) / Math.max(acc[j + 1]! - acc[j]!, 1e-12));
    }
    ka = Math.max(2, Math.round((A.len / total) * n));
    kb = Math.max(2, Math.round((B.len / total) * n));
  };
  // Out of each circle, as far as the point gives (none just past a lead: its corner would stay).
  const push = () => {
    for (let i = ka + 1; i < n - kb; i++) {
      const p = path[i]!;
      const g = give(i);
      for (const c of bodies) {
        const { d, nx, nz } = bodyGap(c, p.x, p.z, gap);
        if (d < c.r && (nx || nz)) {
          p.x += nx * (c.r - d) * g;
          p.z += nz * (c.r - d) * g;
        }
      }
    }
  };
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    smooth();
    push();
  }
  even();
  // Taubin's pairs (a step in, a slightly longer one back out): kinks smooth away, while a
  // bend, a U-turn round a post, keeps its size instead of pinching shut; pushed out of the
  // bodies all along, then a last few alone, so no corner is left where a push stopped.
  for (let pass = 0; pass < EASE_PASSES; pass++) {
    smooth(0.5);
    smooth(-0.53);
    if (pass < EASE_PASSES - 8) push();
    if (pass % 8 === 7) even();
  }
  // Last, the leads too, all but two segments out of each boot: whatever corner is left where
  // a lead ends rounds off.
  give = (i: number) => smoother((Math.min(i, n - i) - 2) / GIVE_POINTS);
  for (let pass = 0; pass < 12; pass++) {
    smooth(0.5);
    smooth(-0.53);
  }
  even();
  // The coil: past the lead, once round a circle beside the line, the way it's heading, and on.
  let loop: [number, number] | null = null;
  if (coil) {
    let along = 0;
    let at = ka + 1;
    for (; at < n - kb - 1 && along < coil; at++) along += path[at]!.distanceTo(path[at - 1]!);
    const p = path[at]!;
    const tan = path[at + 1]!.clone().sub(path[at - 1]!).normalize();
    const side = new Vector3(tan.z, 0, -tan.x); // the line's right
    const c = p.clone().addScaledVector(side, COIL_R);
    const start = Math.atan2(p.z - c.z, p.x - c.x);
    // Round the way it's heading: d/dθ (cos θ, sin θ) at the start lies along the tangent.
    const turn = -Math.sin(start) * tan.x + Math.cos(start) * tan.z > 0 ? 1 : -1;
    const ring: Vector3[] = [];
    for (let j = 1; j <= COIL_POINTS; j++) {
      const ang = start + (turn * 2 * Math.PI * j) / (COIL_POINTS + 1);
      ring.push(new Vector3(c.x + Math.cos(ang) * COIL_R, 0, c.z + Math.sin(ang) * COIL_R));
    }
    let o = 0;
    for (let i = 0; i <= at; i++) out[o++]!.copy(path[i]!);
    loop = [o, o + COIL_POINTS - 1];
    for (const q of ring) out[o++]!.copy(q);
    for (let i = at + 1; i <= n; i++) out[o++]!.copy(path[i]!);
  }
  // The height: on the floor, falling to it from each end over the stretch past its lead, level
  // along the lead itself.
  const last = count - 1;
  const along = [0];
  for (let i = 1; i <= last; i++) along.push(along[i - 1]! + out[i]!.distanceTo(out[i - 1]!));
  const total = along[last]!;
  const startA = along[ka]!; // where a's lead ends, along the line
  const startB = total - along[last - kb]!; // and b's, from b's end
  const lie = floor + (shape.lie ?? CABLE_FLOOR);
  // A hanging cable's run to the floor: about its height, never steep off a low plug, and over
  // nine segments at least (a long line's are longer: it bends down no faster than along).
  const run = (y: number) => Math.min(Math.max(0.16, 1.1 * (y - lie), (9 * total) / last), (total - startA - startB) * 0.45);
  const ra = run(a.at.y);
  const rb = run(b.at.y);
  for (let i = 0; i <= last; i++) {
    const wa = 1 - smoother((along[i]! - startA) / ra);
    const wb = 1 - smoother((total - along[i]! - startB) / rb);
    out[i]!.y = lie + (a.at.y - lie) * wa + (b.at.y - lie) * wb;
  }
  // Where the coil comes back round, it lies over the line's own way in.
  if (loop) {
    const [l0, l1] = loop;
    const lift = 2 * (lie - floor);
    for (let i = l0; i <= l1; i++) {
      const u = (i - l0) / (l1 - l0);
      if (u > 0.6) out[i]!.y += lift * Math.sin(((u - 0.6) / 0.4) * Math.PI) ** 2;
    }
  }
  out[0]!.copy(a.at);
  out[last]!.copy(b.at);
  return out;
}

/** Where a strip stands (its nodes' homes weighted), on the lowest of their floors, and its
 *  turn about Y (radians), so its front (the model's +z) faces its `facing`. */
export function stripPose(spec: StripSpec, homeOf: (id: string) => Vector3): { at: Vector3; yaw: number } {
  const at = new Vector3();
  let floor = Infinity;
  for (const [id, w] of Object.entries(spec.at)) {
    const h = homeOf(id);
    at.addScaledVector(h, w);
    floor = Math.min(floor, h.y);
  }
  at.y = floor;
  if (spec.off) at.add(new Vector3(spec.off[0], 0, spec.off[1]));
  return { at, yaw: (spec.facing * Math.PI) / 180 };
}

type Colour = Theme['edge'];

/**
 * A line's body colour in the hierarchy (above): from the links' --edge its TONE of the way
 * toward --detail (a network cable) or the floor (a cord), mixed as the eye sees it, in sRGB;
 * then toward --ghost by `dim` (switched off).
 */
export function lineColour(kind: CableKind, theme: Theme, dim: number, out = theme.edge.clone()): typeof out {
  const mix = (scratch ??= theme.edge.clone());
  const t = TONE[kind];
  out.copy(theme.edge).convertLinearToSRGB().lerp(mix.copy(t > 0 ? theme.detail : theme.bg).convertLinearToSRGB(), Math.abs(t));
  return out.lerp(mix.copy(theme.ghost).convertLinearToSRGB(), dim).convertSRGBToLinear();
}
let scratch: Colour | undefined;

/** Its round's two other tones, from its body (sRGB): the rims RIM darker, the crown CROWN of
 *  the way to white; each toward --ghost by `dim` as the body is. */
export function roundTones(kind: CableKind, theme: Theme, dim: number, rim: Colour, crown: Colour): void {
  const ghost = (ghostScratch ??= theme.edge.clone()).copy(theme.ghost).convertLinearToSRGB();
  lineColour(kind, theme, 0, rim).convertLinearToSRGB();
  crown.copy(rim);
  crown.r += (1 - crown.r) * CROWN;
  crown.g += (1 - crown.g) * CROWN;
  crown.b += (1 - crown.b) * CROWN;
  rim.multiplyScalar(1 - RIM);
  rim.lerp(ghost, dim).convertSRGBToLinear();
  crown.lerp(ghost, dim).convertSRGBToLinear();
}
let ghostScratch: Colour | undefined;

/**
 * How wide a line of `kind` is drawn (CSS px) at `distance` from a camera of vertical `fov`
 * (degrees) over a view `height` CSS px tall: its real thickness there, never under MIN_PX. The
 * shader works it out so for each of its points (roundShaders); this is its arithmetic.
 */
export function drawnPx(kind: CableKind, distance: number, fov: number, height: number): number {
  const perUnit = height / (2 * Math.max(distance, 1e-4) * Math.tan((fov * Math.PI) / 360));
  return Math.max(WIDTH[kind] * perUnit, MIN_PX[kind] * tuning.hairline);
}

/**
 * LineMaterial's shaders, patched for a cable (above): `linewidth` is the least width (drawing
 * buffer px) and `realWidth` the thickness in world units, drawn at each point's own distance;
 * under one px, drawn one wide and toward `floorTone` by the share it covers; from `roundAt`
 * px (drawing buffer), shaded across its width as a round, `rim` at its edges, `crown` along
 * its middle, its round caps as the segment they end (shaded as balls, its joints read as
 * beads on a string). Cached: one program for all.
 */
let patched: { vertexShader: string; fragmentShader: string } | undefined;
function roundShaders(m: LineMaterial): { vertexShader: string; fragmentShader: string } {
  if (patched) return patched;
  const swap = (src: string, from: string, to: string) => {
    if (!src.includes(from)) throw new Error(`cable: LineMaterial's shader has no "${from}" to patch`);
    return src.replace(from, to);
  };
  let vertexShader = swap(m.vertexShader, 'uniform float linewidth;', 'uniform float linewidth;\nuniform float realWidth;\nuniform vec2 roundAt;\nvarying float vCover;\nvarying float vRound;');
  vertexShader = swap(vertexShader, 'offset *= linewidth;', /* glsl */ `
    vec4 own = ( position.y < 0.5 ) ? clipStart : clipEnd;
    float px = max( realWidth * projectionMatrix[ 1 ][ 1 ] * 0.5 * resolution.y / max( own.w, 1e-4 ), linewidth );
    vCover = min( px, 1.0 );
    vRound = smoothstep( roundAt.x, roundAt.y, px );
    offset *= max( px, 1.0 );`);
  let fragmentShader = swap(m.fragmentShader, 'uniform float linewidth;', 'uniform float linewidth;\nuniform vec3 rim;\nuniform vec3 crown;\nuniform vec3 floorTone;\nvarying float vCover;\nvarying float vRound;');
  fragmentShader = swap(fragmentShader, 'gl_FragColor = vec4( diffuseColor.rgb, alpha );', /* glsl */ `
    float facing = sqrt( max( 1.0 - vUv.x * vUv.x, 0.0 ) );
    vec3 tone = mix( rim, diffuseColor.rgb, smoothstep( 0.0, 0.8, facing ) );
    tone = mix( tone, crown, smoothstep( 0.82, 1.0, facing ) );
    tone = mix( floorTone, mix( diffuseColor.rgb, tone, vRound ), vCover );
    gl_FragColor = vec4( tone, alpha );`);
  return (patched = { vertexShader, fragmentShader });
}

/** roundShaders' own uniforms. */
interface RoundUniforms {
  realWidth: { value: number };
  roundAt: { value: Vector2 };
  rim: { value: Colour };
  crown: { value: Colour };
  floorTone: { value: Colour };
}
type RoundMaterial = LineMaterial & { uniforms: RoundUniforms };

/** A cable's material: LineMaterial with roundShaders and their uniforms. */
function roundMaterial(theme: Theme): RoundMaterial {
  const m = new LineMaterial({ worldUnits: false });
  Object.assign(m, roundShaders(m));
  const own: RoundUniforms = {
    realWidth: { value: 0 },
    roundAt: { value: new Vector2() },
    rim: { value: theme.edge.clone() },
    crown: { value: theme.edge.clone() },
    floorTone: { value: theme.bg.clone() },
  };
  Object.assign(m.uniforms, own);
  return m as RoundMaterial;
}

/** The root's glTF extras `key` as a Vector3, from the model in `root` (null if it has none). */
function extra(root: Object3D, key: string): Vector3 | null {
  let v: unknown;
  root.traverse((o) => void (v ??= o.userData[key]));
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? new Vector3(...(v as [number, number, number])) : null;
}

/** A body's clearance from its bounds (root space): between its half-diagonal and its longer half side. */
function clearOf(n: { bounds?: { isEmpty(): boolean; min: Vector3; max: Vector3 } }): number {
  const b = n.bounds;
  if (!b || b.isEmpty()) return CABLE_CLEAR;
  const hx = Math.max(-b.min.x, b.max.x);
  const hz = Math.max(-b.min.z, b.max.z);
  return Math.min(Math.max(0.5 * Math.hypot(hx, hz) + 0.5 * Math.max(hx, hz), 0.2) + 0.03, CLEAR_MAX);
}

export interface CableLine {
  readonly name: string;
  readonly kind: CableKind;
  /** The line (named `cable:<name>` or `cord:<name>`). */
  readonly line: Line2;
  /** The nodes it plugs into (a cord's strip isn't one; a brick's lines count the node it powers). */
  readonly ends: readonly string[];
  readonly lit: boolean;
}

export interface Cables {
  readonly lines: readonly CableLine[];
  /** The line named `name` (`server_switch`, `A_desktop`...), if it's drawn. */
  get(name: string): CableLine | undefined;
  /** The strips, as placed (named `strip:A`, `strip:B`). */
  readonly strips: readonly Object3D[];
  /** The bricks, as placed (named `brick:psu`). */
  readonly bricks: readonly Object3D[];
  /** The docked cabins the lines keep clear of (none without CableDeps.curve). */
  readonly docks: readonly (Body & { id: string })[];
  /** Node `id` has moved (a pull, its spring home): redraws the lines plugged into it. */
  update(id: string): void;
  /** Puts each line out while any node it plugs into isn't lit (the power switch), or back. */
  setLit(isLit: (id: string) => boolean): void;
  dispose(): void;
}

export type CableStage = Pick<Stage, 'scene' | 'camera' | 'theme' | 'onTheme' | 'viewport'>;
export type CableNodes = {
  get(id: string): Pick<NodeView, 'root' | 'home' | 'ready'> & Partial<Pick<NodeView, 'bounds'>>;
  all(): Pick<NodeView, 'id'>[];
};
/**
 * What it takes from the runtime: the model loader (models.ts) and the role materials
 * (shading.ts), handed over by map.ts. Imported here, they made Rolldown split three's core out
 * of the runtime into a shared chunk, 0.3 kB more on the first load (tests/unit/budget.test.ts).
 * Stand-ins in the unit tests.
 */
export interface CableDeps {
  load(id: string): Promise<{ scene: Object3D }>;
  roles: typeof applyRoleMaterials;
  recolour: typeof recolourRoleMaterial;
  /** Where a node's gondola docks and the way its link runs there (world/dock.ts's dockPose on
   *  links.curve; handed over, as imported here it split three's core out of the runtime);
   *  without it, no dock is kept clear. */
  dock?(id: string): { at: Vector3; dir: Vector3 };
}

/**
 * Builds the lines once their models are in. A line whose node isn't on the map, or whose model
 * carries no such end, is left out, as are the cords if the strip's model doesn't load, and the
 * brick's lines if its model doesn't. Resolves null when there's nothing to draw.
 */
export async function createCable(
  stage: CableStage,
  nodes: CableNodes,
  clock: Pick<Clock, 'add' | 'invalidate'>,
  deps: CableDeps,
): Promise<Cables | null> {
  const ids = new Set(nodes.all().map((n) => n.id));
  /** The nodes an end needs on the map: its own, its strip's, or the one its brick powers. */
  const needs = (e: EndSpec) => ('node' in e ? [e.node] : 'strip' in e ? placedBy(e.strip) : [BRICKS[e.brick].powers]);
  const specs = CABLES.filter((c) => [c.from, c.to].every((e) => needs(e).every((id) => ids.has(id))));
  const used = new Set(specs.flatMap((c) => [c.from, c.to].flatMap(needs)));
  const wantsStrips = specs.some((c) => 'strip' in c.from || 'strip' in c.to);
  const brickIds = [...new Set(specs.flatMap((c) => [c.from, c.to]).flatMap((e) => ('brick' in e ? [e.brick] : [])))];
  const failed = (what: string) => (err: unknown) => (console.error(`cable: the ${what} model didn't load`, err), null);
  const [gltf, ...brickGltfs] = await Promise.all([
    wantsStrips ? deps.load('strip').catch(failed('strip')) : null,
    ...brickIds.map((id) => deps.load(BRICKS[id].model).catch(failed(id))),
    ...[...used].map((id) => nodes.get(id).ready.then(() => null)),
  ]);

  // The strips: placed between their devices, the templates taken out to clone.
  const group: Object3D[] = []; // what goes into the scene: the strips, the bricks and the lines
  let theme = stage.theme;
  const materials: Material[] = [];
  const strips = new Map<StripId, { root: Object3D; sockets: Vector3[]; templates: Map<string, Object3D>; free: number[] }>();
  if (gltf) {
    materials.push(...deps.roles(gltf.scene, theme));
    const needed = [...new Set(specs.flatMap((c) => [c.from, c.to]).flatMap((e) => ('strip' in e ? [e.strip] : [])))];
    // The clones first, while the scene still has its templates.
    const roots = needed.map((_, i) => (i === 0 ? gltf.scene : gltf.scene.clone(true)));
    for (const [i, id] of needed.entries()) {
      const root = roots[i]!;
      const pose = stripPose(STRIPS[id], (n) => nodes.get(n).home);
      root.name = `strip:${id}`;
      root.position.copy(pose.at);
      root.rotation.y = pose.yaw;
      let flat: unknown;
      root.traverse((o) => void (flat ??= o.userData['sockets']));
      const sockets: Vector3[] = [];
      if (Array.isArray(flat)) for (let i = 0; i + 2 < flat.length; i += 3) sockets.push(new Vector3(flat[i] as number, flat[i + 1] as number, flat[i + 2] as number));
      const templates = new Map<string, Object3D>();
      for (const kind of ['adapter', 'charger', 'plug'] as const) {
        const t = root.getObjectByName(kind);
        if (t) {
          templates.set(kind, t);
          t.removeFromParent();
        }
      }
      group.push(root);
      root.updateMatrixWorld(true);
      strips.set(id, { root, sockets, templates, free: [] });
    }
  }

  // The bricks: by the nodes they power.
  const bricks = new Map<BrickId, Object3D>();
  for (const [i, id] of brickIds.entries()) {
    const g = brickGltfs[i];
    if (!g) continue;
    materials.push(...deps.roles(g.scene, theme));
    const root = g.scene;
    const pose = brickPose(BRICKS[id], (n) => nodes.get(n).home);
    root.name = `brick:${id}`;
    root.position.copy(pose.at);
    root.rotation.y = pose.yaw;
    root.updateMatrixWorld(true);
    group.push(root);
    bricks.set(id, root);
  }

  // Each strip's cords take its sockets in the order their devices stand along it (a brick where it lies).
  const plugs = new Map<CableSpec, { at: Vector3; dir: Vector3 }>();
  const deviceAt = (e: EndSpec) => ('node' in e ? nodes.get(e.node).home : 'brick' in e ? brickPose(BRICKS[e.brick], (n) => nodes.get(n).home).at : new Vector3());
  for (const [id, s] of strips) {
    const mine = specs.filter((c) => 'strip' in c.from && c.from.strip === id);
    const axis = new Vector3(1, 0, 0).applyQuaternion(s.root.quaternion);
    mine.sort((p, q) => deviceAt(p.to).clone().sub(s.root.position).dot(axis) - deviceAt(q.to).clone().sub(s.root.position).dot(axis));
    const slots = mine.length === 2 ? [0, 2] : [0, 1, 2, 3];
    mine.forEach((c, i) => {
      const kind = (c.from as { plug: PlugKind }).plug;
      const template = s.templates.get(kind);
      const socket = s.sockets[c.socket ?? slots[i]!];
      if (!template || !socket) return;
      const p = template.clone(true);
      p.position.copy(socket);
      s.root.add(p);
      p.updateMatrixWorld(true);
      const end = extra(p, 'cord_end');
      const dir = extra(p, 'cord_dir');
      if (!end || !dir) return;
      plugs.set(c, { at: p.localToWorld(end), dir: dir.applyQuaternion(s.root.quaternion).normalize() });
    });
  }

  // The bodies the lines keep clear of: every node in the table, the strips, the bricks, and
  // each of those nodes' docked cabins (at rest: a dock is on the authored link).
  const bodies: (Body & { id?: string })[] = [];
  const clear = new Map<string, number>();
  for (const id of used) clear.set(id, clearOf(nodes.get(id)));
  const docks: (Body & { id: string })[] = [];
  if (deps.dock) {
    for (const id of used) {
      try {
        const d = deps.dock(id);
        docks.push({ id: `dock:${id}`, ...cabinBody(d.at, d.dir) });
      } catch {
        // no link to dock on
      }
    }
  }
  const placeBodies = () => {
    bodies.length = 0;
    for (const id of used) {
      const p = nodes.get(id).root.position;
      bodies.push({ id, x: p.x, z: p.z, r: clear.get(id)! });
    }
    for (const s of strips.values()) bodies.push({ x: s.root.position.x, z: s.root.position.z, r: STRIP_CLEAR });
    for (const [id, b] of bricks) bodies.push({ id: `brick:${id}`, x: b.position.x, z: b.position.z, r: BRICK_CLEAR });
    bodies.push(...docks);
  };
  placeBodies();

  interface Live extends CableLine {
    spec: CableSpec;
    draw(): void;
    material: RoundMaterial;
    geometry: LineGeometry;
    count: number;
    dim: number;
    lit: boolean;
  }
  const lines: Live[] = [];
  const size = new Vector2();
  // Its tones: the body, its rims and crown, and the floor it fades into under a pixel.
  const tone = (l: Pick<Live, 'kind' | 'dim' | 'material'>, t: Theme) => {
    const u = l.material.uniforms;
    lineColour(l.kind, t, l.dim, l.material.color);
    roundTones(l.kind, t, l.dim, u.rim.value, u.crown.value);
    u.floorTone.value.copy(t.bg);
  };
  for (const spec of specs) {
    const resolve = (e: EndSpec): (() => CableEnd) | null => {
      if ('strip' in e) {
        const p = plugs.get(spec);
        const s = strips.get(e.strip);
        if (!p || !s) return null;
        const end: CableEnd = { at: p.at, dir: p.dir, centre: s.root.position, clear: STRIP_OWN };
        return () => end;
      }
      if ('brick' in e) {
        const b = bricks.get(e.brick);
        const at = b && extra(b, `${e.at}_end`);
        const dir = b && extra(b, `${e.at}_dir`);
        if (!b || !at || !dir) return null;
        const end: CableEnd = { at: b.localToWorld(at), dir: dir.applyQuaternion(b.quaternion).setY(0).normalize(), centre: b.position, clear: BRICK_OWN };
        return () => end;
      }
      const n = nodes.get(e.node);
      const at = extra(n.root, `${e.at}_end`);
      const dir = extra(n.root, `${e.at}_dir`);
      if (!at || !dir) return null;
      const end: CableEnd = { at: new Vector3(), dir, centre: new Vector3(), clear: spec.near?.node === e.node ? spec.near.clear : clear.get(e.node) };
      return () => (end.centre.copy(n.root.position), end.at.copy(n.root.position).add(at), end);
    };
    const from = resolve(spec.from);
    const to = resolve(spec.to);
    if (!from || !to) continue;
    const count = pointCount(spec.coil);
    const points = Array.from({ length: count }, () => new Vector3());
    const geometry = new LineGeometry();
    geometry.setPositions(new Float32Array(count * 3)); // draw() places them
    const material = roundMaterial(theme);
    const line = new Line2(geometry, material);
    line.name = `${spec.kind === 'network' ? 'cable' : 'cord'}:${spec.name}`;
    line.matrixAutoUpdate = false; // positions are in world space
    const homes = [spec.from, spec.to].flatMap((e) => ('strip' in e ? [] : [nodes.get(needs(e)[0]!).home.y]));
    const floor = Math.min(...homes);
    // The nodes it plugs into (a brick's lines, the one it powers), and the bodies that hold its ends.
    const devices = new Set([spec.from, spec.to].flatMap((e) => ('strip' in e ? [] : needs(e))));
    const own = new Set([spec.from, spec.to].flatMap((e) => ('node' in e ? [e.node] : 'brick' in e ? [`brick:${e.brick}`] : [])));
    const draw = () => {
      const avoid = bodies.filter((c) => !c.id || !own.has(c.id)); // its own ends' bodies are cablePoints' own
      const via = (spec.via === undefined ? [] : 'node' in spec.via ? [spec.via] : spec.via).map((v) => nodes.get(v.node).root.position.clone().add(new Vector3(v.at[0], 0, v.at[1])));
      cablePoints(from(), to(), floor, { slack: spec.slack, coil: spec.coil, lie: WIDTH[spec.kind] / 2, avoid, via, aim: spec.aim, bend: spec.bend, lead: spec.lead }, points);
      const data = (geometry.getAttribute('instanceStart') as unknown as { data: { array: Float32Array; needsUpdate: boolean } }).data;
      const a = data.array;
      for (let i = 0; i < count - 1; i++) {
        points[i]!.toArray(a, i * 6);
        points[i + 1]!.toArray(a, i * 6 + 3);
      }
      data.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    };
    const live: Live = {
      name: spec.name,
      kind: spec.kind,
      line,
      ends: [...devices],
      spec,
      draw,
      material,
      geometry,
      count,
      dim: 0,
      lit: true,
    };
    // Its widths in the links' drawing-buffer px (the least, MIN_PX; the real one, the shader's
    // at each point), and its tones.
    material.uniforms.realWidth.value = WIDTH[spec.kind];
    line.onBeforeRender = (renderer: WebGLRenderer) => {
      renderer.getDrawingBufferSize(size);
      material.resolution = size;
      const ratio = stage.viewport.pixelRatio;
      material.linewidth = MIN_PX[spec.kind] * tuning.hairline * ratio;
      material.uniforms.roundAt.value.set(ROUND_PX[0] * ratio, ROUND_PX[1] * ratio);
      tone(live, theme);
    };
    tone(live, theme);
    draw();
    group.push(line);
    lines.push(live);
  }
  if (lines.length === 0) {
    for (const m of materials) m.dispose();
    return null;
  }
  stage.scene.add(...group);
  clock.invalidate();

  const offTheme = stage.onTheme((t) => {
    theme = t;
    for (const m of materials) deps.recolour(m, t);
    for (const l of lines) tone(l, t);
    clock.invalidate();
  });

  // Drawn out from their first ends, the strips growing in (at once with motion reduced).
  let shown = 0;
  const reveal = (p: number) => {
    for (const l of lines) {
      l.geometry.instanceCount = Math.round(p * (l.count - 1));
      l.line.visible = l.geometry.instanceCount > 0;
    }
    const s = smoothstep(0, 0.5, p);
    for (const st of [...[...strips.values()].map((x) => x.root), ...bricks.values()]) st.scale.set(0.6 + 0.4 * s, Math.max(s, 0.05), 0.6 + 0.4 * s);
    clock.invalidate();
  };
  reveal(prefs.reduced ? 1 : 0);
  let offDraw: (() => void) | null = prefs.reduced
    ? null
    : clock.add((dt) => {
        shown = Math.min(shown + dt / DRAW_SECONDS, 1);
        reveal(smoothstep(0, 1, shown));
        if (shown < 1) return true;
        offDraw?.();
        offDraw = null;
        return false;
      });

  let offFade: (() => void) | null = null;
  const fade = () => {
    if (prefs.reduced) {
      for (const l of lines) l.dim = l.lit ? 0 : 1;
      clock.invalidate();
      return;
    }
    offFade ??= clock.add((dt) => {
      let moving = false;
      for (const l of lines) {
        const to = l.lit ? 0 : 1;
        l.dim += Math.sign(to - l.dim) * Math.min(dt / tuning.linkLitSeconds, Math.abs(to - l.dim));
        moving ||= l.dim !== to;
      }
      clock.invalidate();
      if (moving) return true;
      offFade?.();
      offFade = null;
      return false;
    });
  };

  return {
    lines,
    get(name) {
      return lines.find((l) => l.name === name);
    },
    strips: [...strips.values()].map((s) => s.root),
    bricks: [...bricks.values()],
    docks,
    update(id) {
      if (!used.has(id)) return;
      placeBodies();
      for (const l of lines) l.draw();
      clock.invalidate();
    },
    setLit(isLit) {
      let changed = false;
      for (const l of lines) {
        const on = l.ends.every(isLit);
        changed ||= on !== l.lit;
        l.lit = on;
      }
      if (changed) fade();
    },
    dispose() {
      offDraw?.();
      offFade?.();
      offTheme();
      for (const o of group) o.removeFromParent();
      for (const l of lines) {
        l.geometry.dispose();
        l.material.dispose();
      }
      for (const m of materials) m.dispose();
    },
  };
}
