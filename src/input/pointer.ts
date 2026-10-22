// Pointing at the map (Task 7): hover, click and drag on the canvas, with mouse, pen and touch
// handled alike through Pointer Events.
//
// - What's under the pointer: a raycast against each model's rest box (the owner's test
//   notes), NodeView.bounds measured once from the model at rest, standing at home (or where
//   a pull has it on the floor: the visitor moved it). No clip, lift or poke changes it, so a
//   hop never pulls the model out from under the pointer, and the next click lands. Then, if
//   that misses, the node whose rest box centre is within HIT_PX on screen, so a model only
//   ~25 px across in the overview is still a fair touch target. The part is named from that
//   node's meshes where they are now (not its floor shadow): no mesh hit, no part. A ray that
//   misses every box still takes a part's mesh, wherever it is: idiff's card, out on the floor
//   past its box, is clicked there to tidy it.
// - A press on a node becomes a drag (a pull) once it travels tuning.dragThresholdPx; a finger
//   must have held it tuning.pullHold first, so a tap is never a drag (the owner's test
//   notes), and its travel before that pans the map where it can (opts.canPan, the overview),
//   else does nothing. A mouse or pen pulls at once (the owner, 2026-10-22: a quick drag that
//   panned read as "can't drag stuff anymore"). Having travelled, the press isn't a click
//   either. Pulls are the overview's alone (opts.canPull; the owner, 2026-10-22 morning): at a
//   station a press on a model is a click (a poke, or travel), and a drag on one does nothing.
//   A press that never travels is a click, which selects the node (opts.onSelect), with the part it hit when that's a
//   Blender object named `poke_<name>_hit` (Task 14: map.ts pokes the current station with
//   it, and travels to any other). The pointer is captured from the
//   press, so a drag carries on off the canvas, and other pointers are ignored meanwhile
//   (a second finger can't make the model jump).
// - A drag follows the pointer across a level plane at tuning.dragLift, keeping the point
//   where it was grabbed under the pointer, so the model never jumps to it.
// - The canvas listens for `click` too, though it does nothing with it: Chrome's touch
//   adjustment moves a tap to the nearest element that responds to clicks, and pointer
//   listeners don't count, so a tap on a model went to a label beside it.
// - A press on nothing (the empty floor) that travels tuning.dragThresholdPx moves the map
//   (the owner, 2026-10-22 morning): in the overview it pans (opts.onPan: where it was pressed
//   and where it is), at a station it turns (map rotation: its horizontal travel goes to
//   opts.onTurn), mouse and one finger alike. The right button, or the left with Shift or
//   Ctrl, turns it anywhere it turns, on the floor or a model (the canvas keeps its context
//   menu to itself). Less travel is nothing, as a floor click always was. Mid-flight the
//   director refuses it (the press is the visitor's boost there).
// - Two fingers on the canvas pinch, twist and pan (the overview's zoom, turn and move;
//   zoom.ts): while opts.canPinch, a second touch ends the first finger's press without a
//   click (its pan or turn lets go; a pull already under way keeps the second finger out, as
//   before), and both fingers go to opts.onPinch on every move, then null as one lifts. The
//   other finger then does nothing until it lifts too.
// - Mouse hover marks a node (its ground ring goes --soft, links.ts; it no longer lifts) and
//   shows `pointer`, empty floor `grab` while the map can move; a press shows `grabbing`.
//   Touch has no hover, so a press marks the node and letting go clears it. The canvas has
//   `touch-action: none` (styles.css), so a drag on a phone doesn't scroll the page.

import { Box3, type Intersection, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Stage } from '../stage/stage';
import { tuning } from '../tuning';
import type { NodeView, Nodes } from '../world/nodes';

export interface Pointer {
  dispose(): void;
}

export interface PointerOptions {
  /** A click or tap on a node (not a drag); `part` is the `<name>` of the `poke_<name>_hit` object hit, or null. */
  onSelect(id: string, part: string | null): void;
  /** A drag on the empty floor: CSS px of horizontal travel since the press, then null as it ends. False: the map can't turn now. */
  onTurn?(dx: number | null): boolean;
  /** Whether the map can turn now (for the `grab` cursor). */
  canTurn?(): boolean;
  /** A drag that pans the map: where it was pressed and where it is now (client px), on each move; null as it lets go. */
  onPan?(from: Point | null, to?: Point): void;
  /** Whether a floor drag pans the map now (the overview) rather than turning it. */
  canPan?(): boolean;
  /** Whether a press on node `id` may pull it (false: at a station, or mid-flight). */
  canPull?(id: string): boolean;
  /** Two fingers on the canvas, in client px, on each move; null as one lifts. */
  onPinch?(a: Point | null, b?: Point): void;
  /** Whether two fingers may pinch now (the overview). */
  canPinch?(): boolean;
  /** The labels' nav, over the canvas: a touch that starts on a label's target pans, turns and
   *  pinches as one on the empty floor would; a tap there is still the label's. */
  over?: HTMLElement;
}

export type Point = { x: number; y: number };

/** Screen radius, in CSS px, around a model's centre that still counts as pointing at it. */
const HIT_PX = 22;
/** A model part a click can poke on its own (Task 14): the `<name>` of its poke_<name> clip. */
const POKE_PART = /^poke_(.+)_hit$/;

interface Press {
  pointerId: number;
  /** Null: the empty floor (a pan or a turn of the map), or the right button. */
  node: NodeView | null;
  /** What its travel does once it's a drag: pull the node, pan or turn the map, or nothing. */
  drag: 'pull' | 'pan' | 'turn' | 'none' | null;
  /** The right button, or Shift or Ctrl with the left: its travel turns the map. */
  turns: boolean;
  part: string | null;
  x: number;
  y: number;
  /** When it was pressed (the event's timeStamp, ms), for tuning.pullHold (touch only). */
  t: number;
  /** It has travelled tuning.dragThresholdPx: no longer a click. */
  far: boolean;
  /** From the grab point on the drag plane to the model's position, on the floor. */
  grab: Vector3;
}

export function createPointer(
  stage: Pick<Stage, 'renderer' | 'camera' | 'viewport'>,
  nodes: Pick<Nodes, 'all'>,
  opts: PointerOptions,
): Pointer {
  const canvas = stage.renderer.domElement;
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const plane = new Plane(new Vector3(0, 1, 0), -tuning.dragLift);
  const onPlane = new Vector3();
  const centre = new Vector3();
  const box = new Box3();
  const hits: Intersection[] = [];
  let press: Press | null = null;
  /** The touches down on the canvas, and whether two of them are pinching. */
  const touches = new Map<number, Point>();
  let pinching = false;
  let hovered: NodeView | null = null;
  /** The poke part the last pick() hit, if any. */
  let picked: string | null = null;

  /** The `<name>` of the nearest `poke_<name>_hit` object from `o` up to its node's root, or null. */
  const partOf = (o: Object3D | null, root: Object3D): string | null => {
    for (; o && o !== root; o = o.parent) {
      const m = POKE_PART.exec(o.name);
      if (m) return m[1]!;
    }
    return null;
  };

  /** Points the ray through the event's position on the canvas. */
  function aim(e: PointerEvent): void {
    const box = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - box.left) / box.width) * 2 - 1, 1 - ((e.clientY - box.top) / box.height) * 2);
    raycaster.setFromCamera(ndc, stage.camera);
  }

  /** Node `n`'s rest box in the world: at home, or where a pull has it on the floor, never lifted. */
  const restBox = (n: NodeView) => box.copy(n.bounds).translate(centre.set(n.root.position.x, n.home.y, n.root.position.z));

  /** The part of node `n` the ray hits, from its meshes as they are now (its floor shadow isn't the model), or null. */
  function partHit(n: NodeView): string | null {
    hits.length = 0;
    const hit = raycaster.intersectObject(n.root, true, hits).find((h) => (h.object as { material?: { name?: string } }).material?.name !== 'shadow');
    return hit ? partOf(hit.object, n.root) : null;
  }

  function pick(e: PointerEvent): NodeView | null {
    aim(e);
    picked = null;
    const shown = nodes.all().filter((n) => n.root.visible && !n.bounds.isEmpty());
    let best: NodeView | null = null;
    let room = Infinity;
    for (const n of shown) {
      if (!raycaster.ray.intersectBox(restBox(n), onPlane)) continue;
      const d = onPlane.distanceTo(raycaster.ray.origin);
      if (d < room) {
        room = d;
        best = n;
      }
    }
    if (best) {
      picked = partHit(best);
      return best;
    }
    // A part that ends outside its box and stays there (idiff's card on the floor) is still hit where it lies.
    for (const n of shown) if ((picked = partHit(n))) return n;
    // Nothing hit: the nearest model centre on screen, if it's close enough.
    const { width, height } = stage.viewport;
    room = HIT_PX;
    for (const n of shown) {
      restBox(n).getCenter(centre).project(stage.camera);
      if (centre.z > 1) continue; // behind the camera
      const dx = ((centre.x - ndc.x) / 2) * width;
      const dy = ((centre.y - ndc.y) / 2) * height;
      const d = Math.hypot(dx, dy);
      if (d < room) {
        room = d;
        best = n;
      }
    }
    return best;
  }

  function setHover(node: NodeView | null): void {
    if (node === hovered) return;
    hovered?.hover(false);
    hovered = node;
    node?.hover(true);
  }

  function cursor(): void {
    const turn = opts.canTurn?.() || opts.canPan?.();
    canvas.style.cursor = press ? (press.node || turn ? 'grabbing' : '') : hovered ? 'pointer' : turn ? 'grab' : '';
  }

  /** Both fingers to opts.onPinch. */
  const pinch = () => {
    const [a, b] = [...touches.values()];
    opts.onPinch!({ ...a! }, { ...b! });
  };

  /** `label`: a touch landing on a label's target (opts.over): a floor press, never captured, so a tap is still the label's click. */
  function onDown(e: PointerEvent, label?: boolean): void {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && opts.onPinch && opts.canPinch?.() && press?.drag !== 'pull') {
        // A floor press (turning, panning or not) or a model press not yet pulling: no click,
        // no turn. Its capture stays: releasing it would end it again (lostpointercapture) mid-pinch.
        letGo(press);
        press = null;
        setHover(null);
        cursor();
        pinching = true;
        pinch();
        return;
      }
    }
    if (pinching || press || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
    const turns = e.button === 2 || e.shiftKey || e.ctrlKey;
    const node = e.button === 2 || label ? null : pick(e);
    if (!node && !opts.onTurn && !opts.onPan) return;
    press = { pointerId: e.pointerId, node, drag: null, turns, part: picked, x: e.clientX, y: e.clientY, t: e.timeStamp, far: false, grab: new Vector3() };
    if (!label) canvas.setPointerCapture(e.pointerId);
    setHover(node);
    cursor();
  }

  function onMove(e: PointerEvent): void {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinching) {
      if (touches.size === 2) pinch();
      return;
    }
    if (!press) {
      if (e.pointerType !== 'touch') setHover(pick(e));
      cursor();
      return;
    }
    if (e.pointerId !== press.pointerId) return;
    if (!press.drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < tuning.dragThresholdPx) return;
      press.far = true;
      const pan = opts.onPan && opts.canPan?.() ? 'pan' : null;
      if (press.turns) press.drag = 'turn';
      else if (!press.node) press.drag = pan ?? 'turn';
      // A model: a pull; a finger's travelled before the hold pans the map (or nothing moves).
      else if (e.pointerType === 'touch' && e.timeStamp - press.t < tuning.pullHold * 1000) press.drag = pan ?? 'none';
      else press.drag = opts.canPull?.(press.node.id) === false ? 'none' : 'pull';
      if (press.drag !== 'pull') setHover(null);
    }
    if (press.drag === 'turn') return void opts.onTurn?.(e.clientX - press.x);
    if (press.drag === 'pan') return opts.onPan!({ x: press.x, y: press.y }, { x: e.clientX, y: e.clientY });
    if (press.drag !== 'pull' || !press.node) return;
    if (press.grab.y === 0) {
      aim(e);
      if (!raycaster.ray.intersectPlane(plane, onPlane)) return;
      const at = press.node.root.position;
      press.grab.set(at.x - onPlane.x, 1, at.z - onPlane.z); // y 1: taken (the offset is x and z)
    }
    aim(e);
    if (!raycaster.ray.intersectPlane(plane, onPlane)) return; // a ray above the horizon: hold still
    press.node.dragTo(onPlane.add(press.grab).setY(0));
  }

  /** Ends the press: a drag lets go, and a press that never became one is a click unless cancelled. */
  function end(e: PointerEvent, select: boolean): void {
    if (touches.delete(e.pointerId) && pinching) {
      if (touches.size === 1) opts.onPinch?.(null); // the other finger does nothing until it lifts
      else if (touches.size === 0) pinching = false;
      return;
    }
    if (!press || e.pointerId !== press.pointerId) return;
    const was = press;
    const { node, part, far } = was;
    press = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    letGo(was);
    if (e.pointerType === 'touch') setHover(null);
    if (select && !far && node) opts.onSelect(node.id, part);
    cursor();
  }

  /** A press's drag lets go: a pull drops, a pan glides on, a turn stays. */
  function letGo(p: Press | null): void {
    if (p?.drag === 'turn') opts.onTurn?.(null);
    else if (p?.drag === 'pan') opts.onPan?.(null);
    else if (p?.drag === 'pull' && p.node) {
      p.node.dragTo(null);
      setHover(null); // it drops to the floor; the next move finds what's under the pointer
    }
  }

  const onUp = (e: PointerEvent) => end(e, true);
  const onCancel = (e: PointerEvent) => end(e, false);
  const tappable = () => {};
  const noMenu = (e: Event) => e.preventDefault(); // the right button turns the map
  const onLeave = () => {
    if (press) return;
    setHover(null);
    cursor();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', tappable);
  canvas.addEventListener('contextmenu', noMenu);
  // A touch on a label (a quiet one's target is most of the phone's overview between its models,
  // polish-2): its finger stays the label's (a touch's implicit capture), so its moves bubble here.
  const touch = (f: (e: PointerEvent) => void) => (e: PointerEvent) => void (e.pointerType === 'touch' && f(e));
  const overs: [string, (e: PointerEvent) => void][] = [
    ['pointerdown', touch((e) => (e.target as Element).closest('button.label') && onDown(e, true))],
    ['pointermove', touch(onMove)],
    ['pointerup', touch(onUp)],
    ['pointercancel', touch(onCancel)],
  ];
  for (const [type, f] of overs) opts.over?.addEventListener(type, f as EventListener);

  return {
    dispose() {
      for (const [type, f] of overs) opts.over?.removeEventListener(type, f as EventListener);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('lostpointercapture', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', tappable);
      canvas.removeEventListener('contextmenu', noMenu);
      canvas.style.cursor = '';
    },
  };
}
