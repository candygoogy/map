// The nodes (Task 7): one Blender model per feed node, standing on the floor at its layout
// position, playing its own clips and answering hover and pull.
//
// - Models: public/models/<id>.glb when the build found one (virtual:models, so a missing
//   model is never even requested), otherwise box.glb, the Blender-made placeholder. A GLB
//   is loaded once and shared; a second user gets a clone (only the box is shared, and it
//   has no skin, which a plain clone couldn't carry). They load in NodeOptions.order (the
//   origin first, then as the arrival shows them; models.ts), and each compiles as it's in.
// - Clips: play(name) runs one once and resolves when it ends; then `idle` loops, starting
//   at a random point so no two models move in step, blended in from the clip's end pose.
//   With motion reduced, or the node switched off, nothing loops: a clip jumps to its end
//   and holds it. Nodes stand at rest until the arrival (Task 9) says otherwise: it hides a
//   root (root.visible = false) and play('appear') shows it again at its reach time.
// - Hover lifts the model tuning.hoverLift, 0 now (the owner's test notes: the node's
//   ground ring marks a hover instead, links.ts); a drag lifts it tuning.dragLift and follows the
//   pointer, held within tuning.dragRadius of home by a soft limit (it slows before the
//   edge rather than hitting a wall), and stopped at its neighbours' ground rings, rings
//   touching, never crossing (clearWith: zoom.ts's clearOf, from the first press on; the owner,
//   2026-10-22 morning: a pulled model landed on another), on its way home too. Pulls are the overview's alone now (map.ts).
//   One spring (spring.ts) carries both, so a release
//   springs home with a little overshoot and drops back onto the floor with a small bounce;
//   it never sinks through. Its damping and stiffness change with what's moving it: a
//   hover's lift is critically damped (tuning.hoverDamping), a drag follows the pointer on
//   the floor on the stiff tuning.dragFollow (its lift keeps the springy one), and only a
//   release swings past home. Under reduced motion the model snaps instead: interaction
//   feedback stays, the movement goes.
// - The contact shadow (the model's `shadow` plane) stays on the floor under the model,
//   lighter and wider as it rises (tuning.shadowFade). The widening multiplies whatever scale
//   the model's own clip gives the plane (`appear` grows it from 0.4): every mixer update
//   takes the widening off first and puts it back after (updateMixer), so a lift composes
//   with a clip still in charge of the pose. The link's node end and the ground
//   ring follow the model (links.setEnd), so a pulled node stretches its link.
// - setLit(false) plays the model's `off` clip if it has one and fades its colours toward
//   --faint, and the accent (every node's that has one is its status light) all the way to
//   --lamp, a light that is out, so a dark origin's light reads as off, not as one more grey
//   (the owner's test notes); setLit(true) plays `on` and brings them back. While
//   it's off, play() runs nothing but `off` and `on`: a dark model doesn't `arrive` when the
//   camera lands on it, and it holds its `off` pose until the power comes back. hold() too
//   (Fettle's receipt): onLit says when the model is back on, its `on` played out.
// - poke(part) (Task 14): a click on the model at its station. It plays
//   `poke`, or `poke_<part>` when the click hit that part (the Blender object
//   `poke_<part>_hit`; pointer.ts names it), crossing in from whatever has the pose over
//   BLEND_INTO_CLIP, idle crossing back after. A poke whose clip is still playing is ignored (poke
//   returns false): it plays out, since starting it over from rest moved the part under the
//   cursor and the next click hit it mid-swing (the owner's recording of the server's lid,
//   2026-10-21). The same for a part's clip (or its tidy) on the overlay while it runs; a hit
//   on another part still answers. All of it is data, from the clip names:
//   - `poke_<part>` with a `poke_<part>_tidy` leaves something behind (idiff's card on the
//     floor): it plays on a layer of its own over idle and holds its end pose, and the next
//     hit on that part plays the tidy the same way. A clip of the node's own that moves the
//     same parts (power's `off` and `on`) takes them back, and the layer lets go; a poke
//     plays around them instead (without their tracks), so the card stays on the floor.
//   - With a `poke_refuse` clip, tuning.pokeRefuse.count pokes within its seconds play that
//     instead (the notary's head shake), and pokes during it are ignored: the refusal is
//     the answer, and it plays out.
//   - A model with no `poke` clip: nothing happens (every model has one today; the parcel,
//     the `box` fallback, has `poke` and `poke_arrows`). A switched-off model doesn't react
//     either.
//   A poke plays with motion reduced too, on frames it asks for: it's the visitor's own
//   action, small and in place, and jumping to its end would show nothing at all.

import {
  type AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  LoopRepeat,
  type Material,
  type Mesh,
  type MeshBasicMaterial,
  type Object3D,
  PropertyBinding,
  Vector3,
} from 'three';
import type { GLTF } from '../vendor/GLTFLoader.js';
import modelIds from 'virtual:models';
import type { MapFeed } from '../data/feed';
import { easeOutCubic } from '../motion/ease';
import { onPrefsChange, prefs } from '../motion/prefs';
import { applyRoleMaterials, recolourRoleMaterial } from '../shading';
import type { Clock } from '../stage/clock';
import type { Stage } from '../stage/stage';
import type { Theme } from '../stage/theme';
import { tuning } from '../tuning';
import { coverLinks, type Links } from './links';
import { loadModel } from './models';
import { cue } from '../sound-cue';
import { type Spring3, stepSpring3 } from './spring';

export interface NodeView {
  readonly id: string;
  /** Stands at the node's floor position; hover and drag move it (y is the lift). */
  readonly root: Group;
  /** Where it stands at rest, on the floor. */
  readonly home: Vector3;
  /** The model at rest, in root space, without its floor shadow. Empty until `ready`. */
  readonly bounds: Box3;
  /** Resolves once the model is in (or has failed to load; the node then stays empty). */
  readonly ready: Promise<void>;
  /** Runs a Blender clip once; resolves when it ends (at once with motion reduced, or if the model has no such clip). */
  play(name: string): Promise<void>;
  /** The clip in charge of the pose (`idle`, `arrive`, `poke`…), or null. */
  readonly playing: string | null;
  /** Whether the model has clip `name` (false until it's in). */
  has(name: string): boolean;
  /**
   * Task 16: plays a clip once and holds its end pose (or its pose at `until` seconds), idle
   * kept off, until the next clip (Fettle's `trip`, held until `tear`). With motion reduced it
   * shows that pose at once. A dark model holds nothing (as play()).
   */
  hold(name: string, until?: number): Promise<void>;
  /** Calls `fn` with false as the model goes dark, and with true once it's back on, its `on`
   *  played out. Returns an unsubscribe. */
  onLit(fn: (lit: boolean) => void): () => void;
  /** A click on the model at its station: `poke`, or `poke_<part>` for the part hit (see above).
   *  True if the model answered it (false: dark, mid-refusal, mid-poke, no clip for it, not in yet). */
  poke(part?: string | null): boolean;
  /** Shows the model as it stands after `arrive` (the arrival's end state, reduced motion). */
  showEndOfArrive(): void;
  hover(on: boolean): void;
  /** Pulls the model towards this floor point (its y is ignored); null lets go. */
  dragTo(point: Vector3 | null): void;
  setLit(lit: boolean): void;
  /** False while switched off (the power switch, Task 15). */
  readonly lit: boolean;
}

export interface Nodes {
  get(id: string): NodeView;
  all(): NodeView[];
  /** The node lifted by hover right now (from the canvas or its label), or null. */
  readonly hovered: string | null;
  /** Every node's `ready`, then the shaders compiled (a deferred node's left out: see load()). */
  readonly ready: Promise<void>;
  /** Starts a deferred node's model loading (NodeOptions.deferred), once; its `ready` and
   *  play() wait for it. A no-op for any other node. */
  load(id: string): void;
  recolor(theme: Theme): void;
  /** The pulls' ring stop (zoom.ts, clearOf), once its chunk is in; null: none. */
  clearWith(clear: Clear | null): void;
  dispose(): void;
}

export interface NodeOptions {
  /**
   * Nodes whose model isn't fetched with the rest, only on load(id) (Task 17: the hidden duck,
   * which most visitors never find), each with its bounds as the model will have them, so its
   * framing, footprint and labels are right before it's in. The model's own bounds replace them.
   */
  deferred?: ReadonlyMap<string, { readonly min: readonly number[]; readonly max: readonly number[] }>;
  /**
   * Node ids in the order their models load (models.ts, rank): the first alone, before the rest
   * (the origin, which the arrival waits for), then the others a few at a time, then any node
   * not listed (all of them when it's unset), in feed order.
   */
  order?: readonly string[];
}

export type NodeStage = Pick<Stage, 'renderer' | 'scene' | 'camera' | 'theme' | 'onTheme'>;
export type NodeLinks = Pick<Links, 'emphasize' | 'setEnd'>;

/** How long idle takes to blend in after a clip, and a clip in over idle. */
const BLEND_IN_IDLE = 0.4;
const BLEND_INTO_CLIP = 0.15;
/** The clip a model refuses with when poked too fast (tuning.pokeRefuse). */
const REFUSE = 'poke_refuse';
/** Spring offsets this close to their target, and this slow, count as settled. */
const SETTLED = 1e-4;
/** A pulled model moves freely up to this share of dragRadius, then slows towards it. */
const FREE_PULL = 0.8;

/** A pull's way from `from` towards `to` (floor points), kept `r` clear of `others`: into `to` (zoom.ts, clearOf). */
export type Clear = (from: Vector3, to: Vector3, others: readonly Vector3[], r: number, round?: boolean, v?: Vector3) => Vector3;

/** Scratch for a pull kept clear of its neighbours' rings (Clear). */
const fromAt = new Vector3();
const wantAt = new Vector3();

const KNOWN_MODELS = new Set(modelIds);

/** A pull of `d` from home, softened past FREE_PULL × dragRadius so it never reaches dragRadius. */
function softLimit(d: number): number {
  const r = tuning.dragRadius;
  const free = r * FREE_PULL;
  if (d <= free) return d;
  const room = r - free;
  return free + room * (1 - Math.exp(-(d - free) / room));
}

interface NodeState {
  view: NodeView;
  root: Group;
  file: string;
  model: Object3D | null;
  mixer: AnimationMixer | null;
  clips: Map<string, AnimationClip>;
  /** The action in charge of the pose: idle, a clip playing, or a clip held at its end. */
  current: AnimationAction | null;
  shot: { action: AnimationAction; done: () => void } | null;
  /** A poke clip that leaves something behind, or its tidy: on top of `current`, held at its end. */
  overlay: AnimationAction | null;
  /** Copies of clips: a poke restarted mid-play, or played around a held overlay (see play). */
  twins: Map<string, AnimationClip>;
  /** When the recent pokes came, in wall-clock seconds, for tuning.pokeRefuse. */
  pokes: number[];
  /** A held clip (hold): idle stays off until the next clip. */
  held: boolean;
  /** Where a held clip stops short of its end (seconds), or null. */
  stopAt: number | null;
  /** Actions fading out, stopped once they're silent. */
  fading: Set<AnimationAction>;
  materials: Material[];
  /** `widened`: the factor the lift has multiplied the clip's own scale by, right now. */
  shadow: { object: Object3D; y: number; widened: number; material: MeshBasicMaterial; opacity: number } | null;
  /** Offset from home: x and z the pull, y the lift. */
  spring: Spring3;
  target: Vector3;
  moving: boolean;
  stretched: boolean;
  hovered: boolean;
  dragging: boolean;
  /** Let go after a drag, and not yet settled: the release's springy return, not a hover's. */
  released: boolean;
  lit: boolean;
  /** onLit's listeners, and which setLit is the latest (an `on` cut short by `off` tells no one). */
  litFns: Set<(lit: boolean) => void>;
  litGen: number;
  /** 0 lit, 1 fully off; `dimFade` is the way between. */
  dim: number;
  dimFade: { from: number; to: number; p: number } | null;
  /** The theme with this node's dimming applied, reused for every recolour. */
  dimTheme: Theme;
}

export function createNodes(
  stage: NodeStage,
  feed: MapFeed,
  positions: Map<string, Vector3>,
  clock: Pick<Clock, 'add' | 'invalidate'>,
  links?: NodeLinks,
  opts: NodeOptions = {},
): Nodes {
  const group = new Group();
  group.name = 'nodes';
  stage.scene.add(group);
  let theme = stage.theme;
  let disposed = false;
  let hovered: string | null = null;
  const states = new Map<string, NodeState>();

  // --- the tick: springs, clips and colour fades, only while something moves --------------

  let offTick: (() => void) | null = null;
  const wake = () => {
    offTick ??= clock.add(tick);
  };

  function tick(dt: number): boolean {
    let running = false;
    for (const s of states.values()) {
      if (s.moving) {
        const { k, c } = tuning.spring;
        const { x, v } = s.spring;
        fromAt.set(s.view.home.x + x.x, 0, s.view.home.z + x.z);
        if (s.dragging) stepSpring3(s.spring, s.target, dt, k, c, tuning.dragFollow.k, tuning.dragFollow.c);
        else stepSpring3(s.spring, s.target, dt, k, s.released ? c : tuning.hoverDamping);
        if (clear && (s.dragging || s.released)) {
          // Out of its neighbours' rings on its way from fromAt (where the step started): round
          // one rather than through, its speed into the ring taken off.
          const { home } = s.view;
          const to = clear(fromAt, wantAt.set(home.x + x.x, 0, home.z + x.z), neighbours(s), 2 * tuning.groundRing, s.released, v);
          x.x = to.x - home.x;
          x.z = to.z - home.z;
        }
        if (x.y < 0) {
          // The floor: it bounces back a little rather than sinking through.
          x.y = 0;
          if (v.y < 0) v.y *= -tuning.dropBounce;
        }
        if (x.distanceTo(s.target) < SETTLED && v.length() < SETTLED) {
          x.copy(s.target);
          v.set(0, 0, 0);
          s.spring.carry = 0;
          s.moving = false;
          s.released = false;
        } else running = true;
        place(s);
      }
      if (s.mixer && (s.current || s.overlay || s.fading.size > 0)) {
        updateMixer(s, dt);
        for (const a of s.fading) {
          if (!a.enabled) {
            a.stop();
            s.fading.delete(a);
          }
        }
        // A held end pose needs no frames; idle, a clip playing or a blend does.
        if (s.shot || s.fading.size > 0 || (s.current && s.current === idleAction(s))) running = true;
        if (s.overlay && !s.overlay.paused) running = true;
      }
      if (s.dimFade) {
        const f = s.dimFade;
        f.p = Math.min(f.p + dt / tuning.linkLitSeconds, 1);
        s.dim = f.from + (f.to - f.from) * easeOutCubic(f.p);
        if (f.p >= 1) s.dimFade = null;
        else running = true;
        colour(s);
      }
    }
    if (!running) {
      offTick?.();
      offTick = null;
    }
    return running;
  }

  /** The other shown nodes' homes: the rings a pull stops at. */
  let clear: Clear | null = null;
  const neighbours = (s: NodeState) => [...states.values()].filter((o) => o !== s && o.view.root.visible).map((o) => o.view.home);


  // --- placement: the spring's offset onto the root, the shadow and the link ----------------

  /** The shadow as the lift has it: on the floor, and wider and lighter the higher the model is. */
  function shade(s: NodeState): void {
    if (!s.shadow) return;
    const sh = s.shadow;
    const lift = s.spring.x.y;
    const f = Math.min(Math.max(lift / tuning.dragLift, 0), 1);
    const widen = 1 + (tuning.shadowFade.scale - 1) * f;
    sh.object.position.y = sh.y - lift; // stays on the floor
    sh.object.scale.multiplyScalar(widen / sh.widened); // on top of the clip's own scale
    sh.widened = widen;
    sh.material.opacity = sh.opacity * (1 + (tuning.shadowFade.opacity - 1) * f);
  }

  /** Runs the clips by dt: the shadow's widening comes off for the mixer and goes back on after. */
  function updateMixer(s: NodeState, dt: number): void {
    if (!s.mixer) return;
    const sh = s.shadow;
    if (sh && sh.widened !== 1) {
      sh.object.scale.divideScalar(sh.widened);
      sh.widened = 1;
    }
    s.mixer.update(dt);
    const shot = s.shot?.action;
    if (s.stopAt !== null && shot && shot.time >= s.stopAt) {
      shot.time = s.stopAt; // a held clip stops where it was asked to, and holds
      shot.paused = true;
      s.stopAt = null;
      s.mixer.update(0);
      settle(s);
    }
    shade(s);
  }

  function place(s: NodeState): void {
    const { root, home } = s.view;
    const { x } = s.spring;
    root.position.copy(home).add(x);
    shade(s);
    const away = x.lengthSq() > 0;
    if (links && (away || s.stretched)) links.setEnd(s.view.id, away ? root.position : null);
    s.stretched = away;
    clock.invalidate();
  }

  function aim(s: NodeState): void {
    if (!s.dragging) s.target.set(0, s.hovered ? tuning.hoverLift : 0, 0);
    if (prefs.reduced) {
      // Snap: the feedback without the movement.
      s.spring.x.copy(s.target);
      s.spring.v.set(0, 0, 0);
      s.moving = false;
      s.released = false;
      place(s);
      return;
    }
    s.moving = true;
    wake();
  }

  // --- clips ----------------------------------------------------------------------------------

  const idleAction = (s: NodeState) => {
    const clip = s.clips.get('idle');
    return clip && s.mixer ? s.mixer.clipAction(clip) : null;
  };
  const idleAllowed = (s: NodeState) => !prefs.reduced && s.lit && !s.held && s.clips.has('idle');

  /** Hands the pose (or the overlay) to `next`, blending from whatever had it (cut when motion is reduced). */
  function take(s: NodeState, next: AnimationAction, blend: number, layer: 'current' | 'overlay' = 'current'): void {
    const prev = s[layer];
    s[layer] = next;
    s.fading.delete(next);
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (!prev || prev === next) return;
    if (blend > 0 && !prefs.reduced) {
      prev.crossFadeTo(next, blend, false);
      s.fading.add(prev);
    } else {
      prev.stop();
    }
    wake();
  }

  function release(s: NodeState, blend: number): void {
    const prev = s.current;
    s.current = null;
    letGo(s, prev, blend);
  }

  function letGo(s: NodeState, prev: AnimationAction | null, blend: number): void {
    if (!prev) return;
    if (blend > 0 && !prefs.reduced) {
      prev.fadeOut(blend);
      s.fading.add(prev);
      wake();
    } else {
      prev.stop();
      clock.invalidate();
    }
  }

  function startIdle(s: NodeState, blend: number): void {
    const idle = idleAction(s);
    if (!idle || !idleAllowed(s) || s.shot || s.current === idle) return;
    idle.reset();
    idle.setLoop(LoopRepeat, Infinity);
    idle.time = Math.random() * idle.getClip().duration;
    take(s, idle, blend);
  }

  /** After a clip ends: idle takes over if it may, otherwise the clip holds its end pose. */
  function settle(s: NodeState): void {
    const shot = s.shot;
    if (!shot) return;
    s.shot = null;
    if (idleAllowed(s)) startIdle(s, BLEND_IN_IDLE);
    clock.invalidate();
    shot.done();
  }

  /** The node names a clip's tracks move. */
  const partsOf = (clip: AnimationClip) => new Set(clip.tracks.map((t) => PropertyBinding.parseTrackName(t.name).nodeName));

  /**
   * Runs a clip once, in charge of the pose. `blend` crosses into it from whatever had the
   * pose; by default only idle is crossed from (the arrival's clips follow each other on
   * cuts). A `feedback` clip, one the visitor asked for, plays even with motion reduced.
   */
  function play(s: NodeState, name: string, blend?: number, feedback = false): Promise<void> {
    const clip = s.clips.get(name);
    if (!s.mixer || !clip) return Promise.resolve();
    s.held = false;
    s.stopAt = null;
    s.view.root.visible = true;
    s.shot?.done(); // an interrupted clip's promise still resolves
    s.shot = null;
    let source = clip;
    let key = name;
    if (s.overlay) {
      // A clip that moves the overlay's parts takes them back (idiff's `off` and its card),
      // except a poke: it plays around them, so what a poke left behind stays (idiff's trays
      // slide apart and the card stays on the floor). Only its tidy, or off/on, put it back.
      const held = s.overlay.getClip();
      const theirs = partsOf(held);
      if ([...partsOf(clip)].some((p) => theirs.has(p))) {
        if (name.startsWith('poke')) {
          key = `${name} around ${held.name}`;
          let around = s.twins.get(key);
          if (!around) {
            const tracks = clip.tracks.filter((t) => !theirs.has(PropertyBinding.parseTrackName(t.name).nodeName));
            s.twins.set(key, (around = new AnimationClip(name, clip.duration, tracks)));
          }
          source = around;
        } else {
          letGo(s, s.overlay, BLEND_INTO_CLIP);
          s.overlay = null;
        }
      }
    }
    const into = blend ?? (s.current === idleAction(s) ? BLEND_INTO_CLIP : 0);
    let action = s.mixer.clipAction(source);
    if (action === s.current && into > 0) {
      // Started over mid-play: an action can't cross into itself, so its twin does.
      let twin = s.twins.get(`${key} twin`);
      if (!twin) s.twins.set(`${key} twin`, (twin = source.clone()));
      action = s.mixer.clipAction(twin);
    }
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    take(s, action, into);
    cue(s.view.id, name); // its sounds, if it has any (Task 17)
    return new Promise((done) => {
      s.shot = { action, done };
      if (prefs.reduced && !feedback) jumpToEnd(s);
      else wake();
    });
  }

  /** Plays a clip that leaves something behind (or its tidy) on the overlay, over whatever has the pose; it holds its end there. */
  function playOver(s: NodeState, name: string): void {
    const clip = s.clips.get(name);
    if (!s.mixer || !clip) return;
    const action = s.mixer.clipAction(clip);
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    take(s, action, BLEND_INTO_CLIP, 'overlay'); // the tidy starts where its clip ends: the blend only shows mid-hop
    cue(s.view.id, name);
    wake();
  }

  function poke(s: NodeState, part: string | null): boolean {
    if (!s.mixer || !s.lit) return false;
    if (s.shot && s.shot.action.getClip().name === REFUSE) return false; // it's refusing: that plays out
    if (s.clips.has(REFUSE)) {
      const now = performance.now() / 1000;
      s.pokes = s.pokes.filter((t) => now - t < tuning.pokeRefuse.seconds);
      s.pokes.push(now);
      if (s.pokes.length >= tuning.pokeRefuse.count) {
        s.pokes = [];
        void play(s, REFUSE, BLEND_INTO_CLIP, true);
        return true;
      }
    }
    // A poke plays out: the clip a poke would play, still playing, ignores it (the hit still
    // counts toward a refusal above). Another part's clip still answers.
    const playingNow = (name: string) => s.shot?.action.getClip().name === name;
    const named = part ? `poke_${part}` : null;
    if (named && s.clips.has(named)) {
      const tidy = `${named}_tidy`;
      if (!s.clips.has(tidy)) {
        if (playingNow(named)) return false;
        void play(s, named, BLEND_INTO_CLIP, true);
      } else {
        const over = s.overlay;
        const mine = over?.getClip().name === named || over?.getClip().name === tidy;
        if (mine && !over!.paused) return false; // on its way out (or back): it gets there
        playOver(s, over?.getClip().name === named ? tidy : named); // out: put it back
      }
      return true;
    }
    if (!s.clips.has('poke') || playingNow('poke')) return false;
    void play(s, 'poke', BLEND_INTO_CLIP, true);
    return true;
  }

  /** The clip playing goes straight to its end pose and settles (update(0) never fires 'finished'). */
  function jumpToEnd(s: NodeState): void {
    if (!s.shot || !s.mixer) return;
    const { action } = s.shot;
    action.time = action.getClip().duration;
    action.paused = true; // held there, as clampWhenFinished would
    updateMixer(s, 0);
    settle(s);
  }

  function showEndOfArrive(s: NodeState): void {
    s.view.root.visible = true;
    const clip = s.clips.get('arrive');
    if (!s.mixer || !clip) return;
    s.shot?.done();
    s.shot = null;
    if (idleAllowed(s)) {
      // Idle's loop picks up from arrive's end pose, the model's rest.
      release(s, 0);
      startIdle(s, 0);
      return;
    }
    const action = s.mixer.clipAction(clip);
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    take(s, action, 0);
    action.time = clip.duration;
    action.paused = true;
    updateMixer(s, 0);
    clock.invalidate();
  }

  // --- colour ---------------------------------------------------------------------------------

  function colour(s: NodeState): void {
    const t = s.dimTheme;
    const d = s.dim;
    t.model.copy(theme.model).lerp(theme.faint, d * tuning.unlitMix);
    t.detail.copy(theme.detail).lerp(theme.faint, d * tuning.unlitMix);
    t.paper.copy(theme.paper).lerp(theme.faint, d * tuning.unlitMix);
    t.acc.copy(theme.acc).lerp(theme.lamp, d); // the accent goes all the way off: a light that is out
    t.shadow.copy(theme.shadow);
    for (const m of s.materials) recolourRoleMaterial(m, t); // shading.ts's default is tuning.shadeStrength
    clock.invalidate();
  }

  function setLit(s: NodeState, lit: boolean): void {
    if (s.lit === lit) return;
    s.lit = lit;
    s.dimFade = { from: s.dim, to: lit ? 0 : 1, p: 0 };
    wake();
    const gen = ++s.litGen;
    let on: Promise<void> | undefined;
    if (!s.mixer) {
      // The model isn't in yet: it'll start as it should.
    } else if (s.clips.has(lit ? 'on' : 'off')) {
      on = play(s, lit ? 'on' : 'off');
    } else if (lit) {
      startIdle(s, BLEND_IN_IDLE);
    } else if (s.current === idleAction(s)) {
      release(s, BLEND_IN_IDLE); // parts settle to rest
    }
    const tell = (): void => {
      if (s.lit === lit && s.litGen === gen) for (const fn of [...s.litFns]) fn(lit);
    };
    if (lit) void (on ?? Promise.resolve()).then(tell);
    else tell();
  }

  // --- the models -------------------------------------------------------------------------------

  function attach(s: NodeState, gltf: GLTF, scene: Object3D): void {
    s.materials = applyRoleMaterials(scene, theme);
    // No link or mast draws across the model (links.ts, Over the models); its floor shadow is the floor's.
    for (const m of s.materials) if (m.name !== 'shadow') coverLinks(m);
    let shadow: Mesh | null = null;
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && (mesh.material as Material).name === 'shadow') shadow = mesh;
    });
    const plane = shadow as Mesh | null;
    if (plane) {
      // The model's bounds without its floor shadow, in root space (the scene sits at its origin).
      plane.removeFromParent();
      s.view.bounds.setFromObject(scene, true);
      scene.add(plane);
      const material = plane.material as MeshBasicMaterial;
      s.shadow = { object: plane, y: plane.position.y, widened: 1, material, opacity: material.opacity };
    } else {
      s.view.bounds.setFromObject(scene, true);
    }
    s.model = scene;
    s.mixer = new AnimationMixer(scene);
    s.mixer.addEventListener('finished', (e) => {
      if (s.shot && e.action === s.shot.action) settle(s);
    });
    for (const clip of gltf.animations) s.clips.set(clip.name, clip);
    s.view.root.add(scene);
    if (s.dim > 0 || s.dimFade) colour(s);
    place(s);
    if (!s.lit && s.clips.has('off')) void play(s, 'off');
    else startIdle(s, 0);
  }

  const loads = new Map<string, Promise<GLTF>>();
  const load = (file: string, rank: number) => {
    let p = loads.get(file);
    if (!p) loads.set(file, (p = loadModel(file, rank)));
    return p;
  };

  /** Loads `file` for these nodes: the first takes the scene, the rest clones made before any change to it. */
  async function populate(file: string, users: NodeState[], rank: number, fresh = false): Promise<void> {
    let gltf: GLTF;
    try {
      gltf = await (fresh ? loadModel(file, rank) : load(file, rank));
    } catch (err) {
      if (file === 'box') {
        console.error('nodes: no placeholder model', err);
        return;
      }
      console.error(`nodes: ${file}.glb didn't load; showing the placeholder`, err);
      // A fresh parse: the shared one's scene already belongs to the nodes that wanted a box.
      return populate('box', users, rank, true);
    }
    if (disposed) return;
    const scenes = users.map((_, i) => (i === 0 ? gltf.scene : null));
    for (let i = 1; i < users.length; i++) scenes[i] = gltf.scene.clone(true);
    users.forEach((s, i) => attach(s, gltf, scenes[i]!));
  }

  /** Compiles the shaders of these nodes' models, now they're in (hidden ones shown for it:
   *  compile skips the hidden), so a model that comes in during the arrival doesn't stall it. */
  function compileFor(users: NodeState[]): void {
    if (disposed) return;
    const shown = users.map((u) => u.root.visible);
    for (const u of users) u.root.visible = true;
    stage.renderer.compile(group, stage.camera, stage.scene);
    users.forEach((u, i) => (u.root.visible = shown[i]!));
    clock.invalidate();
  }

  // --- the nodes --------------------------------------------------------------------------------

  const byFile = new Map<string, NodeState[]>();
  const idOf = new Map<NodeState, string>();
  for (const { id } of feed.nodes) {
    const at = positions.get(id);
    if (!at) throw new Error(`nodes: no position for "${id}"`);
    const root = new Group();
    root.name = `node:${id}`;
    root.position.copy(at);
    group.add(root);
    const file = KNOWN_MODELS.has(id) ? id : 'box';
    const s: NodeState = {
      view: null as unknown as NodeView, // made below, once the loads have started
      root,
      file,
      model: null,
      mixer: null,
      clips: new Map(),
      current: null,
      shot: null,
      overlay: null,
      twins: new Map(),
      pokes: [],
      held: false,
      stopAt: null,
      fading: new Set(),
      materials: [],
      shadow: null,
      spring: { x: new Vector3(), v: new Vector3() },
      target: new Vector3(),
      moving: false,
      stretched: false,
      hovered: false,
      dragging: false,
      released: false,
      lit: true,
      litFns: new Set(),
      litGen: 0,
      dim: 0,
      dimFade: null,
      dimTheme: Object.fromEntries(Object.entries(theme).map(([k, c]) => [k, c.clone()])) as unknown as Theme,
    };
    states.set(id, s);
    idOf.set(s, id);
    byFile.set(file, [...(byFile.get(file) ?? []), s]);
  }

  // A deferred node's file (one only it uses) loads on load(id); every other file now, in
  // opts.order (a file's rank is its first user's place there).
  const deferred = opts.deferred ?? new Map();
  const deferredFiles = new Set(
    [...byFile].filter(([, users]) => users.every((u) => deferred.has(idOf.get(u)!))).map(([file]) => file),
  );
  const order = opts.order ?? [];
  const rankOf = (users: NodeState[]) =>
    Math.min(...users.map((u) => (order.includes(idOf.get(u)!) ? order.indexOf(idOf.get(u)!) : order.length + 1)));
  const loaded = new Map<string, Promise<void>>();
  const starts = new Map<string, () => void>();
  for (const [file, users] of byFile) {
    if (!deferredFiles.has(file)) {
      loaded.set(file, populate(file, users, rankOf(users)).then(() => compileFor(users)));
      continue;
    }
    let start = (): void => undefined;
    const gate = new Promise<void>((resolve) => (start = resolve));
    starts.set(file, () => {
      starts.delete(file);
      start();
    });
    loaded.set(file, gate.then(() => populate(file, users, Infinity)).then(() => compileFor(users)));
  }

  for (const [id, s] of states) {
    const home = s.root.position.clone();
    const ready = loaded.get(s.file)!;
    const whenIn = (fn: () => void) => (s.model ? fn() : void ready.then(() => !disposed && fn()));
    s.view = {
      id,
      root: s.root,
      home,
      bounds: (() => {
        const b = deferred.get(id);
        return b ? new Box3(new Vector3(b.min[0], b.min[1], b.min[2]), new Vector3(b.max[0], b.max[1], b.max[2])) : new Box3();
      })(),
      ready,
      play: (name) => ready.then(() => (disposed || (!s.lit && name !== 'off' && name !== 'on') ? undefined : play(s, name))),
      get playing() {
        return s.current?.getClip().name ?? null;
      },
      poke: (part) => !!s.model && !disposed && poke(s, part ?? null),
      has: (name) => s.clips.has(name),
      hold(name, until) {
        const clip = s.clips.get(name);
        if (!s.model || disposed || !clip || !s.lit) return Promise.resolve();
        const stop = until !== undefined && until < clip.duration ? until : null;
        const p = play(s, name, BLEND_INTO_CLIP);
        s.held = true;
        if (stop === null) return p;
        if (!prefs.reduced) s.stopAt = stop;
        else if (s.current && s.mixer) {
          // Motion reduced, play() went straight to the end: back to the stop.
          s.current.time = stop;
          updateMixer(s, 0);
          clock.invalidate();
        }
        return p;
      },
      showEndOfArrive: () => whenIn(() => showEndOfArrive(s)),
      hover(on) {
        if (on) {
          if (hovered !== id && hovered !== null) states.get(hovered)?.view.hover(false);
          hovered = id;
          links?.emphasize(id);
        } else if (hovered === id) {
          hovered = null;
          links?.emphasize(null);
        }
        if (s.hovered === on) return;
        s.hovered = on;
        aim(s);
      },
      dragTo(point) {
        if (s.dragging && point === null) s.released = true;
        s.dragging = point !== null;
        if (s.dragging) s.released = false;
        if (point) {
          const dx = point.x - home.x;
          const dz = point.z - home.z;
          const d = Math.hypot(dx, dz);
          const k = d > 0 ? softLimit(d) / d : 0;
          // It stops at its neighbours' ground rings (rings touching, never crossing), from where it is.
          const want = wantAt.set(home.x + dx * k, 0, home.z + dz * k);
          const to = clear ? clear(fromAt.set(home.x + s.target.x, 0, home.z + s.target.z), want, neighbours(s), 2 * tuning.groundRing) : want;
          s.target.set(to.x - home.x, tuning.dragLift, to.z - home.z);
        }
        aim(s);
      },
      setLit: (lit) => setLit(s, lit),
      onLit(fn) {
        s.litFns.add(fn);
        return () => void s.litFns.delete(fn);
      },
      get lit() {
        return s.lit;
      },
    };
  }

  const ready = Promise.all([...loaded].filter(([file]) => !deferredFiles.has(file)).map(([, p]) => p)).then(() => {
    if (disposed) return;
    stage.renderer.compile(group, stage.camera, stage.scene); // now, while nothing moves
    clock.invalidate();
  });

  function recolor(t: Theme): void {
    theme = t;
    for (const s of states.values()) colour(s);
  }
  const offTheme = stage.onTheme(recolor);

  // Live: reduced motion stops the loops (a clip mid-play jumps to its end) and lands the
  // springs; back again, idle resumes.
  const offPrefs = onPrefsChange(() => {
    for (const s of states.values()) {
      if (!s.mixer) continue;
      if (prefs.reduced) {
        for (const a of s.fading) a.stop();
        s.fading.clear();
        const over = s.overlay;
        if (over && !over.paused) {
          // An overlay mid-hop lands where it was going.
          over.setEffectiveWeight(1);
          over.time = over.getClip().duration;
          over.paused = true;
          updateMixer(s, 0);
        }
        jumpToEnd(s);
        if (s.current === idleAction(s)) release(s, 0);
        if (s.moving) aim(s);
      } else if (idleAllowed(s) && !s.shot) {
        startIdle(s, BLEND_IN_IDLE);
      }
    }
    clock.invalidate();
  });

  const get = (id: string): NodeView => {
    const s = states.get(id);
    if (!s) throw new Error(`nodes: no node "${id}"`);
    return s.view;
  };

  return {
    get,
    all: () => [...states.values()].map((s) => s.view),
    get hovered() {
      return hovered;
    },
    ready,
    load(id) {
      const s = states.get(id);
      if (s) starts.get(s.file)?.();
    },
    recolor,
    clearWith(c) {
      clear = c;
    },
    dispose() {
      disposed = true;
      offTick?.();
      offTick = null;
      offTheme();
      offPrefs();
      for (const s of states.values()) s.mixer?.stopAllAction();
      group.removeFromParent();
    },
  };
}
