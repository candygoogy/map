// The hairlines (Task 6): a link from the origin to every node, a ground ring around each
// node's base, a mast at each node's centre, the turnaround round the hub, and the range rings
// around the origin. They're the one thing in the scene drawn in code, because a 1 CSS px
// screen-space line can't come from a model file. The links' shapes do come from Blender
// (layout.ts → linkCurve).
//
// Masts (2026-10-19 late): a link's ends sit tuning.linkMast over the floor, on a short
// vertical post from the floor at its node's centre (the hub's is one, shared by every link),
// so the gondola hanging under the line keeps off the floor. A mast isn't part of the ridden
// path: traffic and the visitor ride the curve only.
//
// Footprints (2026-10-21, checkpoint 4 B/C defect 3): most models are lower than the mast, so
// it stood in them as a tick and the line ran on over them to its top (the laptop's keyboard,
// the switch's lid). Once a node's model is in, map.ts gives its footprint to setFootprint:
// its bounds on the floor (the rectangle traffic's signals go in at), or, for a model you see
// through, its root's extras `open_radius` (eolietech's wire rack, 2026-10-20). Its link then
// stops where it enters the footprint, the model's edge, and its mast is hidden, at rest,
// lifted and pulled alike; a pull carries the stopped end with the model. Before the model is
// in (or if it never loads), both are drawn whole. The origin and a cluster's hub keep theirs:
// other links leave their masts' tops.
//
// Over the models (the same day): a link stopped at a low model's edge still runs at mast
// height, so from the camera's side of the model it's drawn over the model's top (the server's
// lid, the turntable). Links and masts never draw over a node's model: every node model's
// material marks the stencil where it's drawn (coverLinks, nodes.ts), and links and masts are
// drawn after the models (renderOrder 1) where it isn't marked, as if every model stood in
// front of them. The gondola, the signals and the rings don't mark it or test it.
//
// Line ends (2026-10-21 night, the owner's pick (a) "fade"): a stopped link fades out over its last
// tuning.linkEndFade before the edge instead of ending in mid-air. setFootprint gives each of the
// link's points an alpha in its vertex colour's red, and its LineMaterial multiplies alpha by it
// instead of colour, so the token's colour (hover, route, --ghost, a theme) is as ever, a pull
// carries the fade with the segments, and the stencil still keeps it off the models. The material
// goes transparent with it (drawn in the transparent pass, still after the models).
//
// The turnaround (2026-10-20, the owner's pick): a ring tuning.visitorDock round the hub's
// centre at mast height, where every link is level. The gondola rounds the hub on it from one
// link to the next, like a cable car's bull wheel (visitor.ts), so it never rides through the
// origin's model. Two tuning numbers place it, and the gondola rides that exact circle. It isn't
// drawn (tuning.turnaroundDrawn, the owner's test notes: it read as a second ground
// ring); set true, it's drawn in code like the masts, in --edge, and in the arrival it draws
// out both ways from where the first link to reach it crosses it, as fast as the links draw.
//
// Lines are Line2 + LineMaterial, never THREE.Line (fixed at one device pixel, half a CSS
// pixel on a retina screen, and it shimmers as the camera drifts). Each material's
// resolution is the drawing buffer and its linewidth tuning.hairline × the pixel ratio, so
// a line is 1 CSS px at every ratio; both follow stage.onResize (resize, rotation, zoom, a
// tier drop). On the low tier, alpha-to-coverage smooths the edges.
//
// Colours: links and ground rings in --edge, the network itself; the range rings
// in --faint, the floor's scale, a step quieter. The route is --acc, a hovered link --soft
// (a step up from --edge, never --ink: on a hairline map that reads as a black cable), and
// a link whose node is switched off fades to --ghost, quieter than the range rings, so it reads
// as dead rather than as one more ring of the floor. A mast follows its link's power state
// only: it stays --edge on hover and on the route. A ground ring follows it too, and goes
// --soft and tuning.hoverRing wide while its node is hovered (the origin's as well, which has no
// link of its own): the hover's mark now that the model no longer lifts (the owner's test
// notes: a lift moved what was being aimed at). At 1 px it barely read in the overview, where a
// ring is a few px across (map-tweaks, 2026-10-22); up close, at a station or zoomed right in,
// it tapers to tuning.hoverRingNear.px (the owner, 2026-10-22 morning: 2 px read heavy there),
// by the camera's distance as the hover starts. Colour and width changes ease from wherever
// they are, so a quick hover in and out never jumps; with motion reduced a hover's land on the
// next frame. A theme switch recolours at once, like the floor.
//
// drawProgress(id, p) draws a link from the origin end by showing p of its segments (the
// geometry's instanceCount, one instance per segment): no geometry is ever rebuilt. A node's
// mast shows once its link has landed on it (p = 1); the hub's always.
// livePoint(id, u) reads the link as it's drawn now, bent by a pull, so traffic rides it.
//
// The homelab cluster (Task 13 Batch B): the network is a tree. A cluster's links leave its
// hub's mast top, not the origin's (layout.ts parentOf, from world.json's linkFrom), so every
// "origin end" here is a link's parent end, its start. The hub has a turnaround of its own,
// the same ring as the origin's (turnaroundAt), which its own link and its sub-links cross;
// in the arrival it draws out from where the hub's link crosses it, and the sub-links from
// the hub once that link has landed (the director times it). A pulled hub bends its own link
// at its end and its sub-links at their start, so they stay on its mast; the origin's links
// keep their hub end put when the origin is pulled, as before. Since 2026-10-21 the cluster is
// the real wiring's tree (router → switch → desktop / server / AP, AP → laptop), so the switch
// and the AP are hubs too, each with its turnaround, and a pull on one carries its sub-links.
//
// Over the air (the same day): a link world.json lists in `dotted` (the laptop's, on the AP's
// Wi-Fi) is drawn in dashes tuning.linkDots apart, measured from its parent's end, so it reads
// as no cable. Everything else about it is a link's: traffic and the gondola ride it, it draws
// out, dims and stops at its model's edge (with its fade) as any other.

import {
  AlwaysStencilFunc,
  Color,
  type Curve,
  Group,
  type InterleavedBuffer,
  type InterleavedBufferAttribute,
  type Material,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { Line2 } from '../vendor/lines/Line2.js';
import { LineGeometry } from '../vendor/lines/LineGeometry.js';
import { LineMaterial } from '../vendor/lines/LineMaterial.js';
import { linkCurve, parentOf, type World } from '../data/layout';
import type { Clock } from '../stage/clock';
import type { Stage, Viewport } from '../stage/stage';
import type { Theme, ThemeToken } from '../stage/theme';
import { easeOutCubic, smoothstep } from '../motion/ease';
import { prefs } from '../motion/prefs';
import { tuning } from '../tuning';

/** The part of the stage the links use (a stub in the unit test). */
export type LinkStage = Pick<Stage, 'scene' | 'theme' | 'viewport' | 'onResize' | 'onTheme'> & {
  renderer: Pick<WebGLRenderer, 'getDrawingBufferSize'>;
  /** For a hovered ring's width up close (tuning.hoverRingNear); without it, tuning.hoverRing. */
  camera?: Pick<Stage['camera'], 'position'>;
};
export type LinkClock = Pick<Clock, 'add' | 'invalidate'>;

/** A ring the gondola rounds a hub on (the origin's, or a cluster hub's), and the links that meet it. */
export interface Turnaround {
  /** The node it rounds. */
  readonly hub: string;
  /** Over the hub's centre, at mast height. */
  readonly centre: Vector3;
  readonly radius: number;
  /** The links that cross it: every link leaving the hub, and the hub's own (none at the origin). */
  readonly ids: readonly string[];
  /** How far along link `id` from its start (its parent's end) it meets the ring. */
  crossing(id: string): number;
}

export interface Links {
  /** The link's path, its parent's end first (for flights, traffic and the visitor). */
  curve(id: string): Curve<Vector3>;
  /** The node link `id` leaves from: 'origin', or its cluster's hub. */
  parent(id: string): string;
  /** Draws this link in --acc (null clears it). */
  setRoute(id: string | null): void;
  /** Brightens this node's link and ground ring to --soft, on hover (null clears it). */
  emphasize(id: string | null): void;
  /** Off fades the link and its ground ring to --ghost (the power switch); on brings them back. */
  setLit(id: string, lit: boolean): void;
  isLit(id: string): boolean;
  /** Shows the first p (0..1) of the link, from the origin. Links start fully drawn. */
  drawProgress(id: string, p: number): void;
  progress(id: string): number;
  /**
   * Bends the link's node end after `point` (a pulled model's base), keeping it
   * tuning.linkMast over it with the mast under it, and slides the ground ring under it on the
   * floor; the origin end stays put. A cluster's hub bends its sub-links' start ends the same
   * way, so they stay on its mast. null puts them back. For the origin, which has no link of
   * its own, only the ring moves (its mast stays with the links' hub ends).
   */
  setEnd(id: string, point: Vector3 | null): void;
  /**
   * The point `u` (0..1, even in length) along the link as it's drawn now: Blender's curve at
   * rest, and the bent line while setEnd pulls it (motion audit #9).
   */
  livePoint(id: string, u: number, out: Vector3): Vector3;
  /**
   * The origin's turnaround: its centre (over the hub's, at mast height), its radius, and how
   * far along link `id` from the hub that link meets it (visitorDock on the authored links).
   */
  readonly turnaround: Turnaround;
  /** The turnaround round node `hub`: the origin's, a cluster hub's, or null for a node with no links leaving it. */
  turnaroundAt(hub: string): Turnaround | null;
  /**
   * Node `id`'s model's footprint, standing at home: `inside` says whether a point (its x and
   * z) is over the model, or a number is a circle that far round the node's centre (an open
   * model's `open_radius`). Its link stops where it enters it and its mast is hidden, however
   * the model moves; null draws both whole again. A no-op for the origin and a cluster's hub.
   */
  setFootprint(id: string, footprint: number | ((p: Vector3) => boolean) | null): void;
  /** Shows or hides node `id`'s ground ring (a hidden node's, Task 17: no mark on the floor
   *  until it's found). Its link and mast follow drawProgress as ever. */
  showRing(id: string, shown: boolean): void;
  /** Snaps every line to the theme's colours (stage.onTheme calls it). */
  recolor(theme: Theme): void;
  dispose(): void;
}

/** Segments per line. A link's are equal lengths along it, so drawProgress is even in length. */
const LINK_SEGMENTS = 64;
const GROUND_SEGMENTS = 48;
const RANGE_SEGMENTS = 160;
/** Segments per half of the turnaround (it draws out both ways at once). */
const TURN_SEGMENTS = 32;
/** crossing() searches in steps this long, then halves the last one 20 times. */
const CROSS_STEP = 0.02;

interface Fade {
  from: Color;
  to: Color;
  p: number;
  seconds: number;
  /** Its width as it set off, CSS px (it eases to the Hairline's `px` with the colour). */
  px: number;
}

interface Hairline {
  line: Line2;
  material: LineMaterial;
  /** The token it's heading to; `fade` is the way there, null once it's arrived. */
  token: ThemeToken;
  fade: Fade | null;
  /** The width it's heading to, CSS px: tuning.hairline, a hovered ground ring's tuning.hoverRing. */
  px: number;
}

interface LinkState {
  id: string;
  /** The node it leaves from (layout.ts parentOf). */
  parent: string;
  curve: Curve<Vector3>;
  length: number;
  link: Hairline;
  ring: Hairline | null;
  /** The post under its node end, floor to tuning.linkMast. */
  mast: Hairline | null;
  lit: boolean;
  progress: number;
  /** The segments' rest positions, as the geometry holds them: [start xyz, end xyz] each. */
  rest: Float32Array;
  /** setEnd has bent it: its segments are off `rest`. */
  bent: boolean;
  /** Its node's model's footprint (setFootprint): it draws `count` segments, the last ending at `end`, `u` along it. */
  open: { count: number; end: Vector3; u: number } | null;
}

/** A turnaround as drawn: its two half rings, and where each link that meets it crosses it. */
interface Ring extends Turnaround {
  halves: Hairline[];
  /** Per link: how far along it from its start it meets the ring, and where round the hub (radians from +x toward +z). */
  at: Map<string, { cross: number; angle: number }>;
  /** The link it drew out from (null while none has reached it). */
  from: string | null;
}


/** The stencil value a node's model leaves where it's drawn: no link or mast draws there. */
const MODEL_STENCIL = 1;

/** Marks a node model's material so that no link or mast draws across it (Over the models). */
export function coverLinks(m: Material): void {
  m.stencilWrite = true;
  m.stencilRef = MODEL_STENCIL;
  m.stencilFunc = AlwaysStencilFunc;
  m.stencilZPass = ReplaceStencilOp;
}

/** A link or a mast: drawn after the models, and not where one is (Over the models). */
function underModels(h: Hairline): Hairline {
  h.line.renderOrder = 1;
  h.material.stencilWrite = true; // turns the stencil test on; the line's ops keep the buffer
  h.material.stencilRef = MODEL_STENCIL;
  h.material.stencilFunc = NotEqualStencilFunc;
  return h;
}

function lineOf(points: Vector3[], name: string): Hairline {
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const material = new LineMaterial({ worldUnits: false });
  const line = new Line2(geometry, material);
  line.name = name;
  line.matrixAutoUpdate = false; // positions are in world space already
  return { line, material, token: 'edge', fade: null, px: tuning.hairline };
}

/** The interleaved buffer behind a line's segments (LineSegmentsGeometry: 6 floats each). */
function segments(h: Hairline): InterleavedBuffer & { array: Float32Array } {
  const attr = h.line.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute;
  return attr.data as InterleavedBuffer & { array: Float32Array };
}

/** How much of a pull reaches a point `u` (0..1) along a link: smoothstep, so both ends keep their tangents. */
const pullWeight = (u: number) => smoothstep(0, 1, u);

/**
 * How far along `curve` from its start (or from its end, `fromEnd`) it first gets `radius`
 * from `centre` across the floor, `centre` being over that end: where it crosses a ring round
 * it. Bisected to a hair; the whole length if it never gets that far.
 */
export function crossing(curve: Curve<Vector3>, centre: Vector3, radius: number, fromEnd = false): number {
  const L = curve.getLength();
  const p = new Vector3();
  const out = (d: number) => {
    curve.getPointAt(Math.min(Math.max(fromEnd ? 1 - d / L : d / L, 0), 1), p);
    return Math.hypot(p.x - centre.x, p.z - centre.z) >= radius;
  };
  let lo = 0;
  let hi = Math.min(radius, L); // no sooner: the curve starts over the centre
  while (hi < L && !out(hi)) {
    lo = hi;
    hi = Math.min(hi + CROSS_STEP, L);
  }
  if (!out(hi)) return L;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (out(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * How far along `curve` from its end it first leaves `inside` (a footprint over that end):
 * stepped, then bisected to a hair; at most half its length, and 0 if the end isn't in it.
 */
export function leaving(curve: Curve<Vector3>, inside: (p: Vector3) => boolean): number {
  const L = curve.getLength();
  const p = new Vector3();
  const inAt = (d: number) => inside(curve.getPointAt(Math.min(Math.max(1 - d / L, 0), 1), p));
  const half = L / 2;
  if (!inAt(0)) return 0;
  let lo = 0;
  let hi = 0;
  while (hi < half && inAt(hi)) {
    lo = hi;
    hi = Math.min(hi + CROSS_STEP, half);
  }
  if (inAt(hi)) return hi;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inAt(mid)) lo = mid;
    else hi = mid;
  }
  return hi;
}

function ringPoints(centre: Vector3, radius: number, segments: number): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new Vector3(centre.x + radius * Math.cos(a), centre.y, centre.z + radius * Math.sin(a)));
  }
  return pts;
}

export function createLinks(
  stage: LinkStage,
  positions: Map<string, Vector3>,
  world: World,
  clock: LinkClock,
): Links {
  let theme = stage.theme;
  const group = new Group();
  group.name = 'links';
  const all: Hairline[] = [];
  const links = new Map<string, LinkState>();
  let route: string | null = null;
  let hovered: string | null = null;

  const add = (h: Hairline, token: ThemeToken): Hairline => {
    h.token = token;
    h.material.color.copy(theme[token]);
    group.add(h.line);
    all.push(h);
    return h;
  };

  const rings = new Map<string, Hairline>();
  const masts = new Map<string, Hairline>();
  const origin = positions.get('origin');
  const R = tuning.visitorDock;
  /** A link's parent, among the nodes laid out (the origin when its hub isn't). */
  const parentIn = (id: string) => {
    const p = parentOf(world, id);
    return p !== id && positions.has(p) ? p : 'origin';
  };
  for (const [id, at] of positions) {
    const ring = add(lineOf(ringPoints(at, tuning.groundRing, GROUND_SEGMENTS), `ring:${id}`), 'edge');
    rings.set(id, ring);
    const mast = add(underModels(lineOf([at, new Vector3(at.x, at.y + tuning.linkMast, at.z)], `mast:${id}`)), 'edge');
    masts.set(id, mast);
    if (id === 'origin') continue;
    const curve = linkCurve(id, positions, world);
    const length = curve.getLength();
    const link = add(underModels(lineOf(curve.getSpacedPoints(LINK_SEGMENTS), `link:${id}`)), 'edge');
    if (world.dotted?.includes(id)) {
      // Over the air (the laptop's Wi-Fi): dashes along it, measured from its parent's end.
      Object.assign(link.material, { dashed: true, dashSize: tuning.linkDots.on, gapSize: tuning.linkDots.off });
      link.line.computeLineDistances();
    }
    const rest = segments(link).array.slice();
    links.set(id, { id, parent: parentIn(id), curve, length, link, ring, mast, lit: true, progress: 1, rest, bent: false, open: null });
  }

  // The turnarounds: the origin's, and one round every other node a link leaves. Each is two
  // half rings from local angle 0, one each way, turned (drawTurn) so that they start where the
  // first link to reach the ring crosses it.
  const turns = new Map<string, Ring>();
  for (const id of ['origin', ...new Set([...links.values()].map((s) => s.parent))]) {
    const at = positions.get(id) ?? (id === 'origin' ? new Vector3() : null);
    if (!at || turns.has(id)) continue;
    const centre = at.clone().setY(at.y + tuning.linkMast);
    const meets = [...links.values()].filter((s) => s.parent === id).map((s) => s.id);
    if (id !== 'origin' && links.has(id)) meets.push(id); // the hub's own link, at its far end
    const where = new Map<string, { cross: number; angle: number }>();
    for (const m of meets) {
      const s = links.get(m)!;
      const cross = m === id ? s.length - crossing(s.curve, centre, R, true) : crossing(s.curve, centre, R);
      const p = s.curve.getPointAt(Math.min(Math.max(cross / s.length, 0), 1));
      where.set(m, { cross, angle: Math.atan2(p.z - centre.z, p.x - centre.x) });
    }
    const halves = [1, -1].map((side, i) => {
      const pts: Vector3[] = [];
      for (let k = 0; k <= TURN_SEGMENTS; k++) {
        const a = (side * Math.PI * k) / TURN_SEGMENTS;
        pts.push(new Vector3(R * Math.cos(a), 0, R * Math.sin(a)));
      }
      // The origin's keep their names from before the cluster (`turnaround:0`, `:1`).
      const h = add(lineOf(pts, id === 'origin' ? `turnaround:${i}` : `turnaround:${id}:${i}`), 'edge');
      h.line.position.copy(centre);
      h.line.updateMatrix();
      return h;
    });
    const crossOf = (m: string) => {
      const c = where.get(m);
      if (!c) throw new Error(`links: link "${m}" doesn't meet the turnaround at "${id}"`);
      return c.cross;
    };
    turns.set(id, { hub: id, centre, radius: R, ids: meets, crossing: crossOf, halves, at: where, from: null });
  }
  for (const r of tuning.rangeRings) {
    add(lineOf(ringPoints(origin ?? new Vector3(), r, RANGE_SEGMENTS), `range:${r}`), 'faint');
  }
  stage.scene.add(group);

  // --- what's drawn: a link's share, its mast, the turnaround --------------------------------

  function drawLink(s: LinkState): void {
    const landed = Math.round(s.progress * LINK_SEGMENTS);
    const shown = s.open ? Math.min(landed, s.open.count) : landed;
    s.link.line.geometry.instanceCount = shown;
    s.link.line.visible = shown > 0;
    if (s.mast) s.mast.line.visible = landed === LINK_SEGMENTS && !s.open; // once the link has landed
  }

  /** The link's segments at rest: Blender's curve, stopped at its model's edge. */
  function restShape(s: LinkState): void {
    const buffer = segments(s.link);
    buffer.array.set(s.rest);
    if (s.open) s.open.end.toArray(buffer.array, (s.open.count - 1) * 6 + 3);
    buffer.needsUpdate = true;
  }

  function drawTurn(t: Ring): void {
    // How far past the ring the farthest-drawn link is: each half has drawn as far. (A link
    // draws from its start, so the hub's own link passes its ring as it comes in to land.)
    let lead: string | null = null;
    let past = 0;
    for (const [id, c] of t.at) {
      const s = links.get(id)!;
      const d = s.progress * s.length - c.cross;
      if (d > past) {
        past = d;
        lead = id;
      }
    }
    if (!lead) t.from = null;
    else if (t.from === null) {
      t.from = lead;
      for (const h of t.halves) {
        h.line.rotation.y = -t.at.get(lead)!.angle; // local angle 0 onto its crossing
        h.line.updateMatrix();
      }
    }
    const shown = Math.round(Math.min(past / (Math.PI * R), 1) * TURN_SEGMENTS);
    for (const h of t.halves) {
      h.line.geometry.instanceCount = shown;
      h.line.visible = shown > 0 && tuning.turnaroundDrawn;
    }
  }
  for (const t of turns.values()) drawTurn(t);

  // --- size: 1 CSS px at every pixel ratio ---------------------------------------------------

  const buffer = new Vector2();
  let ratio = 1;
  function fit(v: Viewport): void {
    stage.renderer.getDrawingBufferSize(buffer);
    ratio = v.pixelRatio;
    for (const { material, px } of all) {
      material.resolution = buffer; // copied
      material.linewidth = px * ratio;
      material.alphaToCoverage = v.tier === 'low';
    }
  }
  fit(stage.viewport);
  const offResize = stage.onResize(fit);

  // --- colour --------------------------------------------------------------------------------

  let offFade: (() => void) | null = null;
  function fadeTick(dt: number): boolean {
    let running = false;
    for (const h of all) {
      const f = h.fade;
      if (!f) continue;
      f.p = Math.min(f.p + dt / f.seconds, 1);
      const e = easeOutCubic(f.p);
      h.material.color.lerpColors(f.from, f.to, e);
      h.material.linewidth = (f.px + (h.px - f.px) * e) * ratio;
      if (f.p < 1) running = true;
      else h.fade = null;
    }
    if (!running) {
      offFade?.();
      offFade = null;
    }
    return running;
  }

  function head(h: Hairline, token: ThemeToken, seconds: number, px: number = tuning.hairline): void {
    if (h.token === token) return;
    h.token = token;
    // From the colour and width it shows now, so an interrupted fade turns around without a jump.
    h.fade = { from: h.material.color.clone(), to: theme[token], p: 0, seconds, px: h.material.linewidth / ratio };
    h.px = px;
    offFade ??= clock.add(fadeTick);
  }

  function restyle(s: LinkState, seconds: number): void {
    const off = s.lit ? null : 'ghost';
    const hover = hovered === s.id ? 'soft' : null;
    head(s.link, route === s.id ? 'acc' : (hover ?? off ?? 'edge'), seconds);
    ringTo(s.id, seconds);
    if (s.mast) head(s.mast, off ?? 'edge', seconds);
  }

  /** Node `id`'s ground ring: --soft and tuning.hoverRing wide while hovered, else as its link's power has it. */
  function ringTo(id: string, seconds: number): void {
    const ring = rings.get(id);
    const on = hovered === id;
    if (ring) head(ring, on ? 'soft' : links.get(id)?.lit === false ? 'ghost' : 'edge', seconds, on ? hoverPx(id) : tuning.hairline);
  }

  /** A hovered ring's width: tuning.hoverRing, tapered to hoverRingNear.px as the camera comes close. */
  function hoverPx(id: string): number {
    const at = positions.get(id);
    if (!stage.camera || !at) return tuning.hoverRing;
    const { px, from, to } = tuning.hoverRingNear;
    const k = Math.min(Math.max((stage.camera.position.distanceTo(at) - from) / (to - from), 0), 1);
    return px + (tuning.hoverRing - px) * k;
  }

  function get(id: string): LinkState {
    const s = links.get(id);
    if (!s) throw new Error(`links: no link to "${id}"`);
    return s;
  }

  function recolor(t: Theme): void {
    theme = t;
    for (const h of all) {
      h.fade = null;
      h.material.color.copy(t[h.token]);
      h.material.linewidth = h.px * ratio;
    }
    clock.invalidate();
  }
  const offTheme = stage.onTheme(recolor);

  /** How far each node has been moved off its home by setEnd (absent: at home). */
  const moved = new Map<string, Vector3>();
  const bendPoint = new Vector3();
  const liveA = new Vector3();
  const liveB = new Vector3();

  /**
   * The link bent after its two ends' moves: its node's (`moved`), and its hub's when it leaves
   * one (a cluster's; the origin's links keep their hub end put). Each segment point moves by
   * each end's offset times that end's pull weight, so both ends keep their tangents and stay
   * on their masts.
   */
  /** Adds to `out` how far the pulls have moved link `s`'s point `u` along it. */
  function pulled(s: LinkState, u: number, out: Vector3): Vector3 {
    const end = moved.get(s.id);
    const start = s.parent === 'origin' ? undefined : moved.get(s.parent);
    if (end) out.addScaledVector(end, pullWeight(u));
    if (start) out.addScaledVector(start, pullWeight(1 - u));
    return out;
  }

  function bend(s: LinkState): void {
    const buffer = segments(s.link);
    if (!moved.has(s.id) && !(s.parent !== 'origin' && moved.has(s.parent))) {
      restShape(s);
      s.bent = false;
    } else {
      const a = buffer.array;
      const { rest } = s;
      const put = (o: number, u: number, from: ArrayLike<number> = rest, at = o) =>
        pulled(s, u, bendPoint.fromArray(from, at)).toArray(a, o);
      for (let i = 0; i < LINK_SEGMENTS; i++) {
        put(i * 6, i / LINK_SEGMENTS);
        put(i * 6 + 3, (i + 1) / LINK_SEGMENTS);
      }
      // A footprint's stopped end goes with the pull too, by its own share of it.
      if (s.open) put((s.open.count - 1) * 6 + 3, s.open.u, s.open.end.toArray(), 0);
      s.bent = true;
    }
    drawLink(s);
    buffer.needsUpdate = true;
    // For frustum culling. Both reuse the geometry's box and sphere: no allocation.
    s.link.line.geometry.computeBoundingBox();
    s.link.line.geometry.computeBoundingSphere();
  }

  return {
    curve: (id) => get(id).curve,
    parent: (id) => get(id).parent,
    setRoute(id) {
      const was = route;
      route = id;
      for (const changed of new Set([was, id])) if (changed !== null && links.has(changed)) restyle(get(changed), tuning.linkFadeSeconds);
    },
    emphasize(id) {
      const was = hovered;
      hovered = id;
      const seconds = prefs.reduced ? 1e-6 : tuning.linkFadeSeconds; // reduced: the next frame
      for (const changed of new Set([was, id])) {
        if (changed === null) continue;
        if (links.has(changed)) restyle(get(changed), seconds);
        else ringTo(changed, seconds);
      }
    },
    setLit(id, lit) {
      const s = get(id);
      if (s.lit === lit) return;
      s.lit = lit;
      restyle(s, tuning.linkLitSeconds);
    },
    isLit: (id) => get(id).lit,
    drawProgress(id, p) {
      const s = get(id);
      const progress = Math.min(Math.max(p, 0), 1);
      if (progress === s.progress) return;
      s.progress = progress;
      drawLink(s);
      for (const t of turns.values()) if (t.at.has(id)) drawTurn(t);
      clock.invalidate();
    },
    progress: (id) => get(id).progress,
    showRing(id, shown) {
      const ring = rings.get(id);
      if (!ring || ring.line.visible === shown) return;
      ring.line.visible = shown;
      clock.invalidate();
    },
    setEnd(id, point) {
      const home = positions.get(id);
      const ring = rings.get(id);
      if (!home || !ring) throw new Error(`links: no node "${id}"`);
      // The ring stays on the floor, under the model.
      ring.line.position.set(point ? point.x - home.x : 0, 0, point ? point.z - home.z : 0);
      ring.line.updateMatrix();
      if (point) moved.set(id, (moved.get(id) ?? new Vector3()).subVectors(point, home));
      else moved.delete(id);
      const s = links.get(id);
      if (s) {
        // The mast goes with the model, so the link's end stays on its top: each point moves
        // by the pull times its weight, the last as far as the model has (bend).
        s.mast?.line.position.set(point ? point.x - home.x : 0, point ? point.y - home.y : 0, point ? point.z - home.z : 0);
        s.mast?.line.updateMatrix();
        bend(s);
      }
      // A cluster's hub carries its sub-links' start ends with it.
      if (id !== 'origin') for (const sub of links.values()) if (sub.parent === id) bend(sub);
      clock.invalidate();
    },
    livePoint(id, u, out) {
      const s = get(id);
      const t = Math.min(Math.max(u, 0), 1);
      if (!s.bent) return s.curve.getPointAt(t, out);
      // The segments are equal lengths along the link, so u picks one and a share of it: the
      // whole link as bend() bends it, past a footprint's stopped end too.
      const f = t * LINK_SEGMENTS;
      const i = Math.min(Math.floor(f), LINK_SEGMENTS - 1);
      const a = pulled(s, i / LINK_SEGMENTS, liveA.fromArray(s.rest, i * 6));
      const b = pulled(s, (i + 1) / LINK_SEGMENTS, liveB.fromArray(s.rest, i * 6 + 3));
      return out.lerpVectors(a, b, f - i);
    },
    turnaround: turns.get('origin')!,
    turnaroundAt: (hub) => turns.get(hub) ?? null,
    setFootprint(id, footprint) {
      const home = positions.get(id);
      if (!home) throw new Error(`links: no node "${id}"`);
      const s = links.get(id);
      // The origin and a cluster's hub: other links leave their mast's top, so it stays.
      if (!s || [...links.values()].some((l) => l.parent === id)) return;
      if (footprint === null) s.open = null;
      else {
        const inside =
          typeof footprint === 'number' ? (p: Vector3) => Math.hypot(p.x - home.x, p.z - home.z) < footprint : footprint;
        // Where the link, from its node end, leaves the footprint: its segments are equal
        // lengths along it, so that's in segment i, which becomes the last one drawn and ends there.
        const u = 1 - leaving(s.curve, inside) / s.length;
        const i = Math.min(Math.floor(u * LINK_SEGMENTS), LINK_SEGMENTS - 1);
        s.open = { count: i + 1, end: s.curve.getPointAt(Math.max(u, 0)), u };
      }
      // Line ends: each point's alpha, in its vertex colour's red (whole: all 1).
      const alpha: number[] = [];
      for (let k = 0; k <= LINK_SEGMENTS; k++) {
        const a = s.open ? smoothstep(0, tuning.linkEndFade, (s.open.u - k / LINK_SEGMENTS) * s.length) : 1;
        alpha.push(a, a, a);
      }
      const m = s.link.material;
      s.link.line.geometry.setColors(alpha);
      m.fragmentShader = m.fragmentShader.replace('#include <color_fragment>', 'alpha *= vColor.r;');
      m.vertexColors = m.transparent = true;
      bend(s);
      clock.invalidate();
    },
    recolor,
    dispose() {
      offFade?.();
      offResize();
      offTheme();
      group.removeFromParent();
      for (const { line, material } of all) {
        line.geometry.dispose();
        material.dispose();
      }
    },
  };
}
