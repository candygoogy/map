// The labels: a real button beside every model, with the node's name from the feed. HTML in the
// page's own type, never text drawn into the canvas.
//
// - One <button class="label" data-go="<id>"> per node, in a <nav> named from copy, in
//   station order, so Tab walks the stations in travel order. A click (and so Enter or Space)
//   travels: controls.ts handles every button.label[data-go]. The current one is
//   aria-current="location" and takes --acc.
// - Placement: just right of the model, its name's middle level with the model's middle. The
//   model's bounds are projected to the screen and the label starts past their right edge,
//   which is the projected point plus the projected half-size. Rounded to whole pixels. Where
//   that would lay the name or its status line over another model's box, or past an edge of the
//   free area, in a phone's quiet overview (focused Experiments over candygoogy-bot, focused
//   Exit's status past the right edge), it takes the first clear place of left, under, over;
//   shown, the clear place nearest its own model, with every other model farther.
//   A label kept quiet (not shown) stays on the right: only its tap target is there.
//   Where labels are on (a desktop, a landscape phone; the owner's rule), the right is
//   kept unless its name there would lie as near another model as its own (Dolci Eoliani's on
//   Siel Eolie's model, landscape): then the clear place nearest its own model where its name
//   reads as its own, off the other names (right or left level with the model's top or bottom,
//   left, under, over); none: the right. A label moved off it holds its place (STICK, HOLD) so
//   the pointer drift doesn't flip it, and none moves while hovered, focused or lifted. At a
//   station on a landscape phone (a touch screen under the column's width, its strip thin under
//   the open sheet), where none of those is clear, a place off the names already placed (not
//   the later ones' guessed rights), or its name flush left of its model under the header's band,
//   where it reads as its own (polish-2, item 6: at homelab Switch's lay on the router, Server's
//   between the server and the AP).
// - When: a late step on the clock, after the render, and only when the camera, the view
//   offset, the viewport, the panel's inset or a node moved. It never asks for frames itself.
// - Out of sight: a label whose node is behind the camera, or whose name or status line would
//   run off the canvas, under the panel or over the header's band (Eolietech's, at Fettle on a
//   landscape phone), fades out over tuning.labelFadeMs (styles.css; it blinked as labels
//   crossed edges in flight) and lets the pointer through. One whose model reaches below the
//   header is pushed down under it instead. It stays in the Tab order (the stations are always
//   reachable); while it has focus, or it's the current station's, it shows, held inside the
//   free part of the canvas.
// - The docked gondola: the current station's label keeps off the visitor's cabin where it docks
//   on the station's link (dock.ts's dockDistance, the cabin's own size about its pin, turned
//   with the link), which is beside the model, where the label is held (it lay on the cabin at
//   homelab). Only where the usual place would lie on it: on the right still, just under or over
//   the cabin (the nearer), else right past it, else the other sides as above; where all of
//   those lie on other models (a landscape phone's strip), the usual place if only its status
//   line's room (shown on hover) meets the cabin. The origin's park depends on the link last
//   ridden, so it isn't kept off there (nor is the fit's). Picked afresh while the camera flies
//   and as it lands; after that a side taken off the cabin is held while it stays usable (inside,
//   off the cabin, its name on no other model, nor nearer one, by more than HOLD; a close look
//   or a turn at rest left switch's over the cabin, nearer homelab's), whether the right still meets
//   the cabin or not: the pointer drift flipped it at homelab, desktop and switch (under and
//   over, under and the right, past the cabin and the left).
// - Touch target: 44 px tall and at least as wide (styles.css: the button's ::after takes the
//   pointer, not the button), cut back from any other model's box on screen, so a tap on that
//   model reaches the canvas and can drag it, and off the header's link and the panel. Never
//   under 24 px square (WCAG 2.5.8); a label keeping quiet (below) whose 24 px square would
//   still lie over another model has no target at all (data-nohit), so that model takes the
//   tap, and its own node still takes its own. In a phone's quiet overview no two targets meet
//   and none lies on a name on show: the names on show are placed first, then the rest keep
//   their names off them; each name keeps its LEAST band (its core) clear for itself, the
//   targets are cut off the cores and the targets placed before them too, on whole pixels, and
//   one that still meets another model, core or target has none (data-nohit).
// - Hover: pointing at or focusing a label hovers its node (it lifts, its link brightens),
//   and a node hovered on the canvas marks its label. Either way the label shows its status.
// - Status: a soft line under the name. It reads copy.working, the state
//   the arrival ends in, until setStatus says otherwise; it shows on hover and focus, or all
//   the time while pinned (the arrival's "Checking…" → "Working"). A change of words while
//   it shows crossfades over tuning.statusFadeMs. It's aria-hidden: the network's mood, not
//   part of the button's name.
// - Room (room()): the gap and the wider of the button and its status line, in the widest
//   words it shows ("Checking…"), so the overview keeps room for both lines (without it,
//   exit's status line lay under the panel) and the same room before and after the arrival lets go.
// - A phone's overview: on a touch screen in the portrait
//   layout the nav has data-quiet, and styles.css hides every label's text from the eye only,
//   through the arrival too, until it's focused, its node is hovered or it's the current
//   station. Still a named button in the Tab order and the accessibility tree, and still
//   taking its tap. Hidden, it takes no room (room() is 0), so the overview's fit keeps none;
//   a narrow window with a mouse shows its labels and keeps their room. The inner ring's six
//   (NAMED, the phone pass's labels (a)) show their names there (data-named), with no status
//   line, each only where its name and LEAST band lie on no other model or name on show, within
//   NEAR px of its own model and nearer it than any other's: turned, panned or zoomed, one that
//   can't is hidden like the rest.
// - The homelab cluster's sub-nodes (Task 13 Batch B): their five labels
//   would crowd the fan, so in the overview, on every screen, each keeps quiet the same way
//   (data-quiet on its own item) and takes no room, until focused, hovered or current. At a
//   station they show like any other.

import { Box3, Vector3 } from 'three';
import type { Director } from '../camera/director';
import { isPortrait } from '../camera/fit';
import { runtimeCopy as copy } from '../copy-runtime';
import { clamp01 } from '../motion/ease';
import { prefs } from '../motion/prefs';
import { tuning } from '../tuning';
import type { MapFeed } from '../data/feed';
import { stationNode, type Stations } from '../nav/stations';
import type { Clock } from '../stage/clock';
import { panelInsetFor, type Stage } from '../stage/stage';
import { dockDistance } from '../world/dock';
import type { Links } from '../world/links';
import type { Nodes } from '../world/nodes';

export interface Labels {
  /** The <nav>; map.ts places it, and the travel controls go in it too. */
  readonly element: HTMLElement;
  /** A node's status text (null clears it). Pinned, it shows without hover. Now: there in this
   *  frame, words and showing, with no crossfade or fade (a skipped arrival's end). */
  setStatus(id: string, text: string | null, opts?: { pinned?: boolean; now?: boolean }): void;
  /** The CSS px a label takes to its model's right: its gap and the wider of its button and
   *  its status line; 0 while it keeps quiet (a phone's overview, a sub-node's in any overview). */
  room(id: string): number;
  /** The camera's flights: while one flies, the current label's side off the gondola isn't held. */
  follow(flights: Pick<Director, 'flight'>): void;
  dispose(): void;
}

export type LabelStage = Pick<Stage, 'camera' | 'viewport' | 'inset'>;

/** Room between the model's right edge and its label, in CSS px. */
const GAP = 6;
/** The inner ring's six, named in a phone's overview (the phone pass, labels (a), 2026-10-22). */
const NAMED = new Set(['fettle', 'idiff', 'notary', 'candygoogy-bot', 'dolci-eoliani', 'siel-eolie']);
/** How far, in CSS px, a named label's box may lie from its model's (the options measured 10–12
 *  on P3; decided 2026-10-22). */
const NEAR = 13;
/** A label's touch target, and the least it's cut back to, in CSS px (styles.css). */
const TARGET = 44;
const LEAST = 24;
/** The docked cabin about its pin on the line, world units: half its length along the link (prow to
 *  tail, 0.23), half its width across, and the grip over the line; it hangs tuning.visitorDrop
 *  below. A little over the model, for the dock's swing. */
const CABIN_ALONG = 0.24;
const CABIN_ACROSS = 0.11;
const CABIN_TOP = 0.07;
/** How much nearer, in CSS px, the side a label has off the gondola counts (it doesn't flip);
 *  and how much clearer the right must read for a label on show moved off it to go back. */
const STICK = 24;
/** How much less clear, in CSS px, a label on show moved off the right may read where it is
 *  before it's placed afresh: a little, for the drift, not so much that the place it found in
 *  flight outlives its reading as its own. And how far the current station's name, held off
 *  the docked gondola, may reach onto another model's box before it moves. */
const HOLD = 4;
/** The sides (place()'s `sides`) such a label tries, the right's own first: right level with
 *  the model's top, its bottom, left, left level with the top, the bottom, under, over. */
const ASIDE = [9, 10, 1, 11, 12, 2, 3, 4, 5];
/** place()'s side for a landscape phone's crowded station: left, its name (not its status line's
 *  room) flush with the model's left edge, level with its middle or just under the header. */
const FLUSH = 17;

/** A box on screen: left, top, right, bottom, CSS px. */
type Rect = [number, number, number, number];

interface Label {
  id: string;
  item: HTMLLIElement;
  button: HTMLButtonElement;
  status: HTMLSpanElement;
  width: number;
  height: number;
  x: number;
  y: number;
  off: boolean | null;
  /** Keeping quiet, and crowded onto another model: no touch target (data-nohit). */
  nohit: boolean | null;
  /** Named in a phone's overview (one of NAMED, its name clear): data-named. */
  named: boolean | null;
  cut: string;
  /** Where it sits by its model: right, left, under, over (where the right reads as another's). */
  side: number;
  /** Where it was placed (left, top) while it shows; null while it doesn't. */
  box: readonly [number, number] | null;
  /** Whether it showed when last placed: a label that starts to show takes its nearest side. */
  shown: boolean;
  /** The current station's, its side taken off the docked gondola once the camera had come to
   *  rest: kept while it stays usable (keeps()), not picked afresh. */
  hold: boolean;
}

export function createLabels(
  stage: LabelStage,
  nodes: Pick<Nodes, 'get' | 'hovered'>,
  stations: Pick<Stations, 'ids' | 'current' | 'subscribe'> & Partial<Pick<Stations, 'hidden' | 'revealed' | 'onReveal'>>,
  feed: Pick<MapFeed, 'nodes'>,
  clock: Pick<Clock, 'addLate' | 'invalidate'>,
  doc: Document = document,
  /** The links, for where the gondola docks: without them the labels don't keep off it. */
  links?: Pick<Links, 'curve'>,
): Labels {
  const names = new Map(feed.nodes.map((n) => [n.id, n.name]));
  /** The cluster's sub-nodes: quiet in the overview. */
  const subs = new Set(feed.nodes.filter((n) => n.parent !== undefined).map((n) => n.id));
  const subQuiet = (id: string) => subs.has(id) && stations.current === null;
  const element = doc.createElement('nav');
  element.className = 'stations-nav';
  element.setAttribute('aria-label', copy.stationsNav.text);
  const list = doc.createElement('ul');
  list.className = 'labels';
  element.append(list);
  // The fades' lengths, from tuning (styles.css reads them).
  element.style.setProperty('--label-fade', `${tuning.labelFadeMs}ms`);
  element.style.setProperty('--status-fade', `${tuning.statusFadeMs}ms`);
  // A phone's hidden label shows and hides as the panel's text swaps.
  element.style.setProperty('--label-show', `${tuning.panelInMs}ms`);
  element.style.setProperty('--label-hide', `${tuning.panelOutMs}ms`);
  element.style.setProperty('--label-ease', tuning.panelEase);

  const labels: Label[] = [];
  const byId = new Map<string, Label>();
  const cleanups: (() => void)[] = [];

  // A hidden node's label (Task 17, the duck) comes last, after exit's, and stays `hidden` (out
  // of sight, the Tab order and the accessibility tree) until the node is found.
  const hidden = stations.hidden ?? [];
  for (const id of [...stations.ids, ...hidden]) {
    const item = doc.createElement('li');
    if (hidden.includes(id)) item.hidden = !stations.revealed?.(id);
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'label';
    button.dataset.go = id;
    const name = doc.createElement('span');
    name.className = 'name';
    name.textContent = names.get(id) ?? id;
    const status = doc.createElement('span');
    status.className = 'status';
    status.setAttribute('aria-hidden', 'true');
    status.textContent = copy.working.text;
    button.append(name, status);
    item.append(button);
    list.append(item);
    const label: Label = { id, item, button, status, width: 0, height: 0, x: NaN, y: NaN, off: null, nohit: null, named: null, cut: '', side: 0, shown: false, box: null, hold: false };
    labels.push(label);
    byId.set(id, label);

    // The label hovers its node; leaving or blurring lets go (unless the other still holds it).
    let pointing = false;
    let focused = false;
    const sync = () => nodes.get(id).hover(pointing || focused);
    const on = (type: string, fn: () => void) => {
      button.addEventListener(type, fn);
      cleanups.push(() => button.removeEventListener(type, fn));
    };
    on('pointerenter', () => {
      pointing = true;
      sync();
    });
    on('pointerleave', () => {
      pointing = false;
      sync();
    });
    on('focus', () => {
      focused = true;
      sync();
      dirty = true; // a hidden label shows while focused: place it inside the free area
      clock.invalidate();
    });
    on('blur', () => {
      focused = false;
      sync();
    });
  }

  function markCurrent(): void {
    for (const l of labels) {
      if (l.id === stations.current) l.button.setAttribute('aria-current', 'location');
      else l.button.removeAttribute('aria-current');
      if (subs.has(l.id)) l.item.toggleAttribute('data-quiet', subQuiet(l.id));
    }
  }
  markCurrent();
  if (stations.onReveal) {
    cleanups.push(
      stations.onReveal((id) => {
        const l = byId.get(id);
        if (!l) return;
        l.item.hidden = false;
        measured = false; // its width, now that it has one
        dirty = true;
        clock.invalidate();
      }),
    );
  }
  cleanups.push(
    stations.subscribe(() => {
      markCurrent();
      dirty = true; // a sub-node's label keeps quiet only in the overview: its target too
      clock.invalidate();
    }),
  );

  // What the placement depends on, compared each late step: camera (16 + 16), viewport and
  // inset (4), and per node its position, visibility and bounds (10).
  const PER = 10;
  let seen = new Float64Array(36 + labels.length * PER);
  let next = new Float64Array(seen.length);
  let dirty = true;
  let measured = false;
  /** The view's size and the panel's inset as at the last late step (snapshot()). */
  let framed = false;
  /** The camera's flights (follow()), and whether one flew at the last late step. */
  let flights: Pick<Director, 'flight'> | null = null;
  let flew = true;

  function snapshot(): boolean {
    const { camera } = stage;
    const { width, height } = stage.viewport;
    const inset = stage.inset;
    next.set(camera.matrixWorld.elements, 0);
    next.set(camera.projectionMatrix.elements, 16);
    next[32] = width;
    next[33] = height;
    next[34] = inset.right;
    next[35] = inset.bottom;
    for (let i = 0; i < labels.length; i++) {
      const n = nodes.get(labels[i]!.id);
      const o = 36 + i * PER;
      const p = n.root.position;
      next[o] = p.x;
      next[o + 1] = p.y;
      next[o + 2] = p.z;
      next[o + 3] = n.root.visible ? 1 : 0;
      next[o + 4] = n.bounds.min.x;
      next[o + 5] = n.bounds.min.y;
      next[o + 6] = n.bounds.min.z;
      next[o + 7] = n.bounds.max.x;
      next[o + 8] = n.bounds.max.y;
      next[o + 9] = n.bounds.max.z;
    }
    framed = next[32] === seen[32] && next[33] === seen[33] && next[34] === seen[34] && next[35] === seen[35];
    let changed = false;
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== seen[i]) {
        changed = true;
        break;
      }
    }
    [seen, next] = [next, seen];
    return changed;
  }

  function measure(): void {
    for (const l of labels) {
      l.width = l.button.offsetWidth;
      // Unrounded (a line is 19.6 px): offsetHeight's 20 left the target 0.4 px short of 44.
      l.height = l.button.getBoundingClientRect().height;
    }
    measured = true;
  }

  /** The words a status line shows: the arrival's and the rest's (statusRoom adds its own). */
  const STATUS_WORDS = [copy.checking.text, copy.working.text];
  /** CSS px a status line takes from its button's left edge, in its widest words: its inset
   *  (the button's padding), the words, and the same padding after. The same for every label
   *  (one type, one padding), so measured once; null until it can be. */
  let statusPx: number | null = null;
  function statusRoom(): number {
    if (statusPx !== null) return statusPx;
    const l = labels[0];
    if (!l?.status.isConnected) return 0;
    const { status, button } = l;
    const now = status.textContent ?? '';
    let words = 0;
    for (const text of [...STATUS_WORDS, now]) {
      status.textContent = text;
      words = Math.max(words, status.getBoundingClientRect().width);
    }
    status.textContent = now; // in the same task: never painted
    const after = parseFloat(getComputedStyle(button).paddingRight) || 0;
    statusPx = Math.ceil(status.offsetLeft + words + after);
    return statusPx;
  }

  /** A touch screen in the portrait layout (the peek inset, as the director fits the overview,
   *  not the sheet's state): its labels keep quiet. */
  const coarse = doc.defaultView?.matchMedia?.('(pointer: coarse)') ?? null;
  function quiet(): boolean {
    const { width, height } = stage.viewport;
    return !!coarse?.matches && isPortrait(stage.viewport, panelInsetFor(width, height, 'peek'));
  }
  const pointerChanged = () => {
    dirty = true;
    clock.invalidate();
  };
  element.toggleAttribute('data-quiet', quiet()); // before it's on the page: no fade in from shown
  coarse?.addEventListener('change', pointerChanged);
  cleanups.push(() => coarse?.removeEventListener('change', pointerChanged));

  const box = new Box3();
  const corner = new Vector3();
  const centre = new Vector3();
  const view = new Vector3();
  /** Each model's box on screen, as left, top, right, bottom (NaN: not on screen). */
  const rects = new Float64Array(labels.length * 4);
  /** Each model's projected centre and half-size on screen, and 1 if it's behind the camera. */
  const spots = new Float64Array(labels.length * 5);
  /** 1 where a model's box reaches behind the camera: its box on screen is no measure of it
   *  (switch's, at candygoogy-bot, took the whole screen). */
  const wide = new Uint8Array(labels.length);
  /** The docked gondola's box on screen at the current station (NaN: none, or not on screen). */
  const gondola = new Float64Array(4);
  /** Per station, its dock on the authored link: the pin, and the way along it, level. */
  const docks = new Map<string, { at: Vector3; along: Vector3 }>();
  function dockOf(id: string): { at: Vector3; along: Vector3 } | null {
    if (!links || id === 'origin') return null;
    let d = docks.get(id);
    if (!d) {
      const c = links.curve(id);
      const L = c.getLength();
      const u = clamp01((L - dockDistance(c, 'node')) / L);
      const along = c.getTangentAt(u, new Vector3()).setY(0);
      if (along.lengthSq() < 1e-9) along.set(1, 0, 0);
      d = { at: c.getPointAt(u, new Vector3()), along: along.normalize() };
      docks.set(id, d);
    }
    return d;
  }

  /** The docked gondola's box on screen into `gondola`: its cabin's corners, projected. */
  function placeGondola(width: number, height: number): void {
    gondola.fill(NaN);
    const id = stations.current;
    const d = id === null ? null : dockOf(stationNode(id)); // the receipt docks at Fettle
    if (!d) return;
    const { camera } = stage;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let c = 0; c < 8; c++) {
      const a = c & 1 ? CABIN_ALONG : -CABIN_ALONG;
      const b = c & 2 ? CABIN_ACROSS : -CABIN_ACROSS;
      const up = c & 4 ? CABIN_TOP : -tuning.visitorDrop;
      corner.set(d.at.x + a * d.along.x - b * d.along.z, d.at.y + up, d.at.z + a * d.along.z + b * d.along.x);
      view.copy(corner).applyMatrix4(camera.matrixWorldInverse);
      if (view.z > -camera.near) return; // behind the camera
      corner.project(camera);
      const sx = ((corner.x + 1) / 2) * width;
      const sy = ((1 - corner.y) / 2) * height;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    gondola.set([minX, minY, maxX, maxY]);
  }

  let hovered: string | null = null;
  /** The header, across the top: labels keep under its band, and their targets off its link. */
  const header = doc.querySelector('header.top');
  const back = header?.querySelector('.back');

  /** `fresh`: in flight, or just landed, or the view's size or the panel's inset moved: the
   *  current label's side off the gondola is picked afresh, not held, and on a phone the current
   *  label's side too. `flying`: in flight, where the side it has counts STICK px nearer. */
  function place(fresh: boolean, flying = false): void {
    const { camera } = stage;
    const { width, height } = stage.viewport;
    const inset = stage.inset;
    const freeRight = width - inset.right;
    const freeBottom = height - inset.bottom;
    const band = Math.ceil(header?.getBoundingClientRect().bottom ?? 0); // all reads before any write
    const link = back?.getBoundingClientRect();
    const q = quiet();
    if (q !== element.hasAttribute('data-quiet')) element.toggleAttribute('data-quiet', q);
    // Every model's box on screen first: a label keeps off the others'.
    for (const [i, l] of labels.entries()) {
      const n = nodes.get(l.id);
      n.root.updateWorldMatrix(true, false);
      if (n.bounds.isEmpty()) box.set(corner.set(0, 0, 0), corner);
      else box.copy(n.bounds);
      box.getCenter(centre);
      n.root.localToWorld(centre);
      view.copy(centre).applyMatrix4(camera.matrixWorldInverse);
      const behind = view.z > -camera.near;

      // The model's screen extent: its bounds' corners, projected.
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      wide[i] = 0;
      for (let c = 0; c < 8; c++) {
        corner.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z);
        n.root.localToWorld(corner);
        if (view.copy(corner).applyMatrix4(camera.matrixWorldInverse).z > -camera.near) wide[i] = 1;
        corner.project(camera);
        const sx = ((corner.x + 1) / 2) * width;
        const sy = ((1 - corner.y) / 2) * height;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
      rects.set(behind || !n.root.visible ? [NaN, NaN, NaN, NaN] : [minX, minY, maxX, maxY], i * 4);
      centre.project(camera);
      // The projected point, and the projected half-size.
      spots.set([((centre.x + 1) / 2) * width, ((1 - centre.y) / 2) * height, (maxX - minX) / 2, (maxY - minY) / 2, +behind], i * 5);
    }
    placeGondola(width, height);
    const pad = labels[0]?.status.offsetLeft ?? 0; // the button's inset of its words
    const room = statusRoom();
    /** Quiet here: a phone's overview, or a cluster sub-node's in any overview. */
    const hushes = (l: Label) => q || subQuiet(l.id);
    // The phone's overview names the inner six (the phone pass, labels (a)): shown, not quiet,
    // unless one would lie on another's name or model (turned side-on: below).
    const naming = (l: Label) => q && stations.current === null && NAMED.has(l.id);
    /** On show for itself: labels on, or current, hovered or focused (its status line too). */
    const asked = (l: Label) =>
      !hushes(l) || l.button.hasAttribute('aria-current') || l.id === hovered || l.button === doc.activeElement;
    const showing = (l: Label) => asked(l) || naming(l);
    // Each label on show, on its right, for the ones not placed yet this time: one moved off its
    // right keeps off them (the ones placed already, where they were placed).
    const ahead = labels.map((l, j) => {
      const [cx, cy, hw, , back] = spots.subarray(j * 5, j * 5 + 5) as unknown as number[];
      if (back === 1 || !nodes.get(l.id).root.visible || !showing(l)) return null;
      return [cx! + hw! + GAP, cy! - l.height / 2] as const;
    });
    const r = LEAST / 2;
    /** A label's name box at (x, y), grown to LEAST about its middle: its touch target's least. */
    const core = (l: Label, x = l.x, y = l.y): Rect => {
      const [mx, my] = [x + l.width / 2, y + l.height / 2];
      return [Math.min(x, mx - r), Math.min(y, my - r), Math.max(x + l.width, mx + r), Math.max(y + l.height, my + r)];
    };
    const meets = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;
    const gapOf = (a: ArrayLike<number>, b: ArrayLike<number>) =>
      Math.hypot(Math.max(0, b[0]! - a[2]!, a[0]! - b[2]!), Math.max(0, b[1]! - a[3]!, a[1]! - b[3]!));
    const model = (j: number) => rects.subarray(j * 4, j * 4 + 4);
    /** The names on show placed so far this time, as core()s: on a phone's quiet overview the
     *  ones on show for themselves are placed first, then the named, then the rest, and the rest
     *  keep their names (and so their targets) off these. */
    const kept: Rect[] = [];
    const rank = (l: Label) => (asked(l) ? 0 : naming(l) ? 1 : 2);
    const turns = [...labels.keys()];
    if (q) turns.sort((a, b) => rank(labels[a]!) - rank(labels[b]!));
    for (const i of turns) {
      const l = labels[i]!;
      const n = nodes.get(l.id);
      const [cx, cy, hw, hh, back] = spots.subarray(i * 5, i * 5 + 5) as unknown as number[];
      const behind = back === 1;
      // Right of the model, its name's middle level with the model's middle. On a phone's quiet
      // overview, where that lays the name or its status line over another model, the first
      // clear of: left of the model (the wider line's end GAP from it), under it, over it (words
      // flush with the model's left edge, or shifted in from the screen's edge; under it, far
      // enough that its 44 px target clears the model). None clear: right, as before. It keeps
      // its side while that stays clear, so it doesn't jump as its model lifts on focus. Where
      // labels are always on, the fit keeps their room on the right and the right is kept unless
      // the name there would read as another model's (below). A quiet label that doesn't show
      // keeps its name alone inside, and its right side past an edge: only its target is there,
      // which mustn't move onto another's.
      const current = l.button.hasAttribute('aria-current');
      const hush = hushes(l);
      const shows = showing(l);
      // The name and the status line under it, one line each; a name shown only for naming shows
      // no status line, so it takes its name's room alone (Notary's, left of its model at the
      // phone's closer start, lay 32 px off it, past the status line's room).
      const bare = shows && !asked(l);
      const w = bare ? l.width : Math.max(l.width, room);
      const h = bare ? l.height : l.height * 2;
      const kw = shows ? w : l.width;
      const kh = shows ? h : l.height;
      const y0 = cy! - l.height / 2;
      const x0 = Math.max(Math.min(cx! - hw! - pad, freeRight - w), 0);
      // Under and over again, the words' end flush with the model's right edge: tried only when
      // none of the four is clear (focused Server's, in the homelab cluster's fan on a phone).
      const x1 = Math.max(Math.min(Math.floor(cx! + hw! + pad - w), freeRight - w), 0);
      const under = Math.ceil(cy! + hh! + Math.max(GAP, (TARGET - l.height) / 2));
      const over = Math.floor(cy! - hh! - GAP - h);
      // Under or over, moved on past each other model's box it would lie on (down, or up): tried
      // only when none of the others is clear (focused Switch's and Access point's in the homelab
      // cluster's tree on a phone, 2026-10-21: every side lay on Desktop's, Homelab's or another).
      const past = (x: number, y: number, down: boolean) => {
        for (let j = 0, k = 0; j < labels.length && k < 9; j++) {
          const [left, top, right, bottom] = rects.subarray(j * 4, j * 4 + 4) as unknown as number[];
          if (j === i || !(x < right! && x + w > left! && y < bottom! && y + h > top!)) continue;
          y = down ? Math.ceil(bottom! + 1) : Math.floor(top! - h - 1);
          j = -1;
          k++;
        }
        return y;
      };
      // The current station's, on the docked gondola's box: NaN, never or not there.
      const [gl, gt, gr, gb] = current ? gondola : [NaN, NaN, NaN, NaN];
      const onGondola = (x: number, y: number) => x < gr! && x + w > gl! && y < gb! && y + h > gt!;
      const dodge = onGondola(cx! + hw! + GAP, y0);
      const sides = [
        [cx! + hw! + GAP, y0],
        [cx! - hw! - GAP - w, y0],
        [x0, under],
        [x0, over],
        [x1, under],
        [x1, over],
        // Kept off the gondola docked beside its model (homelab's): right still, just under the
        // cabin or just over it, or right past it. Taken only where the right lies on it
        // (inside()); held, kept after (keeps()).
        [cx! + hw! + GAP, Math.ceil(gb! + GAP)],
        [cx! + hw! + GAP, Math.floor(gt! - GAP - h)],
        [Math.ceil(gr! + GAP), y0],
        // Where the labels are on and the right reads as another model's: right or left still,
        // the name's middle level with the model's top or its bottom.
        [cx! + hw! + GAP, Math.floor(cy! - hh! - l.height / 2)],
        [cx! + hw! + GAP, Math.ceil(cy! + hh! - l.height / 2)],
        [cx! - hw! - GAP - w, Math.floor(cy! - hh! - l.height / 2)],
        [cx! - hw! - GAP - w, Math.ceil(cy! + hh! - l.height / 2)],
        // A phone's quiet overview, none of the first six clear: under or over, past the others.
        [x0, past(x0, under, true)],
        [x0, past(x0, over, false)],
        [x1, past(x1, under, true)],
        [x1, past(x1, over, false)],
        // FLUSH: a landscape phone's crowded station (below).
        [cx! - hw! - GAP - l.width, Math.max(y0, band)],
      ] as const;
      // How far side s's box (w by h, or bw by bh) lies from model j's (NaN: that model's not on
      // screen).
      const far = (s: number, j: number, bw = w, bh = h) => {
        const [x, y] = sides[s]!;
        const [left, top, right, bottom] = rects.subarray(j * 4, j * 4 + 4) as unknown as number[];
        return Math.hypot(Math.max(0, left! - x - bw, x - right!), Math.max(0, top! - y - bh, y - bottom!));
      };
      // Reads as its own model's label: no other model's box under side s's box, and every other
      // model's at least `by` px farther than its own (-Infinity: only the first). Loose, a model
      // whose box reaches behind the camera doesn't count; looser, no model does (crowded()).
      const reads = (s: number, by: number, loose: boolean | 'all' = false, bw = w, bh = h) => {
        const [x, y] = sides[s]!;
        for (let j = 0; j < labels.length; j++) {
          if (j === i || loose === 'all' || (loose && wide[j])) continue;
          const [left, top, right, bottom] = rects.subarray(j * 4, j * 4 + 4) as unknown as number[];
          if (x < right! && x + bw > left! && y < bottom! && y + bh > top!) return false;
          if (far(s, j, bw, bh) < far(s, i, bw, bh) + by) return false;
        }
        return true;
      };
      // Inside the free area (shown, or not the right), and off the gondola. The places by the
      // gondola only where the right lies on it.
      const inside = (s: number) => {
        const [x, y] = sides[s]!;
        if (Number.isNaN(x + y) || onGondola(x, y) || (!dodge && s >= 6 && s <= 8)) return false;
        return !((s > 0 || shows) && (x < 0 || y < band || x + w > freeRight || y + h > freeBottom));
      };
      // Clear: inside, no other model's box under it, and, strict, every other model's at least
      // GAP farther than its own, so it reads as its own model's label (focused Exit's, under it,
      // read as Install diff's).
      const fits = (s: number, strict = false, loose: boolean | 'all' = false) =>
        inside(s) && reads(s, strict ? GAP : -Infinity, loose) && (shows || !kept.some((k) => meets(core(l, ...sides[s]!), k)));
      // Where every place off the gondola lies on some other model's box (a landscape phone's
      // thin strip, at desktop): the usual place if only its status line's room (shown on hover)
      // is on the gondola, not its name; else the one of right under, over or past the gondola,
      // inside, that covers least of the others.
      const crowded = (): number | undefined => {
        const [x, y] = sides[0];
        if (!(x < gr! && x + l.width > gl! && y < gb! && y + l.height > gt!)) return 0;
        const cover = (s: number) => {
          const [x, y] = sides[s]!;
          let a = 0;
          for (let j = 0; j < labels.length; j++) {
            const [left, top, right, bottom] = rects.subarray(j * 4, j * 4 + 4) as unknown as number[];
            if (j === i || wide[j] || !(right! > left!)) continue;
            a += Math.max(0, Math.min(x + w, right!) - Math.max(x, left!)) * Math.max(0, Math.min(y + h, bottom!) - Math.max(y, top!));
          }
          return a;
        };
        return [6, 7, 8].filter((s) => fits(s, false, 'all')).sort((a, b) => cover(a) - cover(b))[0];
      };
      // Its side taken off the gondola, held: still inside the free area and off the gondola (its
      // status line's room too), and its name on no other model's box by more than HOLD px (the
      // drift swung switch's past the gondola a pixel onto laptop's, and back), nor nearer another
      // model's by more than HOLD px: the camera moved at rest (a turn, a close look) left
      // switch's over the cabin, nearer homelab's model than its own. A model whose box reaches
      // behind the camera doesn't count.
      const keeps = (s: number) => {
        const [x, y] = sides[s]!;
        if (Number.isNaN(x + y) || onGondola(x, y)) return false;
        if (x < 0 || y < band || x + w > freeRight || y + h > freeBottom) return false;
        for (let j = 0; j < labels.length; j++) {
          if (j === i || wide[j]) continue;
          const [left, top, right, bottom] = rects.subarray(j * 4, j * 4 + 4) as unknown as number[];
          if (x + HOLD < right! && x + l.width - HOLD > left! && y + HOLD < bottom! && y + l.height - HOLD > top!) return false;
          if (far(s, j, l.width, l.height) + HOLD < far(s, i, l.width, l.height)) return false;
        }
        return true;
      };
      // A cluster sub-node's quiet label, not showing, keeps right too: moved off one model in the
      // crowded fan it lay on a neighbour's label (ap's on Experiments'); there it gives up its
      // target instead (data-nohit, below).
      // The current station's, its side off the gondola held (the camera at rest): it keeps it
      // while keeps() holds, under, over, past the gondola or another side, whether the right
      // still lies on the gondola or not, so the pointer drift doesn't flip it back and forth.
      if (l.hold && !fresh && current && !behind && keeps(l.side)) {
        // kept
      } else if (!hush && dodge && !behind) {
        // Where the labels are on (the right): right still, under or over the gondola, the
        // nearer its usual place first, or right past it; else the first clear other side;
        // reading as its own if one does. A model whose box reaches behind the camera doesn't
        // count. Picked afresh every time in flight (one taken in flight, over candygoogy-bot,
        // outlived the nearer one's coming clear), and held once the camera is at rest (above);
        // the one it has counts STICK px nearer.
        const pick = (group: number[]) => group.find((s) => fits(s, true, true)) ?? group.find((s) => fits(s, false, true));
        const near = (s: number) => Math.abs(sides[s]![1] - y0) - (s === l.side ? STICK : 0);
        const right = [6, 7].sort((a, b) => near(a) - near(b));
        l.side = pick(right) ?? pick([8]) ?? pick([1, 2, 3, 4, 5]) ?? crowded() ?? 0;
      } else if (!hush && !behind && n.root.visible) {
        // Where the labels are on (a desktop's, a landscape phone's): right, unless there its name
        // would read as another model's (Dolci Eoliani's, on Siel Eolie's model in the landscape
        // overview); then the clear side nearest its own model where its name reads as its own
        // and keeps off the other labels' names, as on a phone's; none: right still. Its status
        // line (on hover, focus) doesn't count, so neither moves it. A model whose box reaches
        // behind the camera doesn't count either, and one hidden past an edge on the right stays
        // there (hidden). While its node is hovered, it has focus, or its model is off the floor
        // or pulled, it keeps its side: its model lifts, and a label moved out from under the
        // pointer would let go of the hover and come back (and switch's, at server, flashed on
        // the left as its model came down). Back to the right only once that reads as its own by
        // STICK px to spare (the drift moves a station's models tens of px), and its other side
        // kept while that reads as its own by GAP less HOLD; in flight it moves when its side
        // stops reading, as a phone's does.
        const own = (s: number, by: number) => reads(s, by, true, l.width, l.height);
        const [rx, ry] = sides[0];
        const gone =
          !current && (rx < 0 || rx + l.width > freeRight || ry + kh > freeBottom || (ry < band && band >= cy! + hh!));
        // Its name off the other labels' names on show: the ones placed already, where they were
        // placed, and the rest on their right. Not their status lines (on hover, focus), nor its
        // own: in the landscape overview, kept off those too, hardly any label could move.
        const apart = (s: number) => {
          const [x, y] = sides[s]!;
          return labels.every((o, j) => {
            const p = j < i ? o.box : ahead[j];
            return j === i || !p || !(x < p[0] + o.width && x + l.width > p[0] && y < p[1] + o.height && y + l.height > p[1]);
          });
        };
        const other = ASIDE.includes(l.side) || l.side === FLUSH;
        const moved = n.root.position.distanceToSquared(n.home) > 1e-8; // lifted or pulled
        const held = (moved || l.id === hovered || l.button === doc.activeElement) && (other || l.side === 0);
        if (!held && (gone || own(0, other ? GAP + STICK : GAP))) l.side = 0;
        else if (!held && (!other || !inside(l.side) || !own(l.side, GAP - HOLD) || !apart(l.side))) {
          const near = (a: number, b: number) => far(a, i, l.width, l.height) - far(b, i, l.width, l.height);
          const clear = ASIDE.filter((s) => inside(s) && own(s, GAP) && apart(s));
          // A landscape phone's thin strip at a station (the homelab cluster's), none clear: off the
          // names placed so far only (each later one keeps off it in turn), or FLUSH, inside with
          // its name and off the docked gondola, reading as its own; else the right, as before.
          const strip = !!coarse?.matches && !q && current !== null && width < tuning.panelMinViewportPx;
          const placedApart = (s: number) => {
            const [x, y] = sides[s]!;
            return labels.every((o, j) => j >= i || !o.box || !(x < o.box[0] + o.width && x + l.width > o.box[0] && y < o.box[1] + o.height && y + l.height > o.box[1]));
          };
          const within = (s: number) => {
            const [x, y] = sides[s]!;
            return !Number.isNaN(x + y) && !onGondola(x, y) && x >= 0 && y >= band && x + l.width <= freeRight && y + kh <= freeBottom;
          };
          const crowd = clear.length || !strip ? [] : [...ASIDE, FLUSH].filter((s) => within(s) && own(s, GAP) && placedApart(s));
          l.side = clear.sort(near)[0] ?? crowd.sort(near)[0] ?? 0;
        }
      } else if (!hush || behind || (subQuiet(l.id) && !shows)) l.side = 0;
      else if ((shows && !l.shown) || (shows && current && fresh) || (l.side > 8 && l.side < 13) || !fits(l.side, shows)) {
        // The first clear side, or, shown, the clear side nearest its own model: one that
        // reads as its own if there is one. Off the gondola, right still first. (Past 8: a side
        // only the labels on show take, from before the layout turned quiet.) The current
        // station's is picked afresh in flight and as it lands, like the labels that are on: one
        // picked early in flight was kept while it stayed clear, so the landing never put it
        // back beside its model (ap's, desktop's, switch's, over them in empty space).
        let clear: number[] = [];
        for (const group of [[0, 6, 7, 8, 1, 2, 3], [4, 5], [13, 14, 15, 16]]) {
          const pick = (strict: boolean) => group.filter((s) => fits(s, strict));
          clear = shows ? pick(true) : [];
          if (!clear.length) clear = pick(false);
          if (clear.length) break;
        }
        if (!clear.length && dodge) clear = [0, 6, 7, 8, 1, 2, 3].filter((s) => fits(s, false, true));
        if (!clear.length && dodge) clear = [crowded() ?? 0];
        // Nearest by its name, not its name and status line: over the model, the status line's
        // room lies between the two and counted the name 20 px nearer than it reads, so over tied
        // with or beat the right. And beside the model first, its name level with some of the
        // model's box and within a target's reach of it, its right before its left (the left
        // was 3 px nearer ap's box); under or over only where neither is (origin's, both past the
        // screen's edges). In flight, the side it has counts STICK px nearer, so it doesn't flip
        // back and forth.
        const [, top, , bottom] = rects.subarray(i * 4, i * 4 + 4) as unknown as number[];
        const order = (s: number) => {
          const d = far(s, i, l.width, l.height);
          const y = sides[s]![1];
          const beside = y < bottom! && y + l.height > top! && d < TARGET;
          const rank = beside ? (sides[s]![0] > cx! ? 0 : 1) : 2;
          return rank * 1e4 + d - (flying && l.shown && s === l.side ? STICK : 0);
        };
        if (shows) clear.sort((a, b) => order(a) - order(b));
        l.side = clear[0] ?? 0;
      }
      // Held from here on where it's off the gondola (so off its right): picked in flight it's
      // picked afresh again, and the first pick at rest is where it stays.
      l.hold = current && !behind && l.side !== 0 && (dodge || (l.hold && !fresh && keeps(l.side)));
      l.shown = shows;
      let [x, y] = sides[l.side]!;
      // Over the header's band, but its model reaches below it: pushed down, still beside it.
      if (y < band && band < cy! + hh!) y = band;
      // The current station's label is never hidden for an edge (idiff's ran past the right one
      // on a phone): it's held inside, against the model's side. Another is hidden only when its
      // name crosses the right edge; a status line that runs past it is moved in with it below.
      const outside =
        behind || !n.root.visible || (!current && (x < 0 || y < band || x + l.width > freeRight || y + kh > freeBottom));
      // Held inside the free area, for when it has focus.
      x = Math.round(Math.min(Math.max(x, 0), Math.max(freeRight - kw, 0)));
      y = Math.round(Math.min(Math.max(y, band), Math.max(freeBottom - kh, band)));
      l.box = shows && !outside ? [x, y] : null;
      if (x !== l.x || y !== l.y) {
        l.x = x;
        l.y = y;
        l.item.style.transform = `translate(${x}px, ${y}px)`;
      }
      if (outside !== l.off) {
        l.off = outside;
        l.item.toggleAttribute('data-off', outside);
      }
      // The named six on a phone: each shown only where its name, with its LEAST band about its
      // middle, lies on no other model's box nor another name on show (turned side-on, Dolci
      // Eoliani's lay on Siel Eolie's), within NEAR px of its own model and nearer it than any
      // other's; else hidden (turned, panned, zoomed).
      let named = naming(l) && l.box !== null;
      if (named && !asked(l)) {
        const mine = core(l);
        const name = [x, y, x + l.width, y + l.height];
        const own = gapOf(name, model(i));
        named =
          own <= NEAR &&
          !kept.some((k) => meets(mine, k)) &&
          !labels.some((_, j) => j !== i && !wide[j] && (meets(mine, model(j)) || gapOf(name, model(j)) <= own));
      }
      if (named !== l.named) {
        l.named = named;
        l.item.toggleAttribute('data-named', named);
      }
      if (q && l.box !== null && (named || asked(l))) kept.push(core(l));
    }
    // The touch targets: each cut back, from whichever side loses least, off every other model
    // and the header's link. On a phone's quiet overview, off every name on show (its LEAST band
    // too) and every target placed before it as well, the ones on show placed first, so no two
    // targets ever meet and none lies on a name: at the phone's closer start the hidden origin's
    // lay on Dolci Eoliani's, and Install diff's on the origin's.
    // There, every box is taken out to whole pixels, and the other labels' a pixel more: the
    // browser's hit test took Install diff's target a pixel past its edge, onto the origin's.
    const whole = (b: ArrayLike<number>, by = 0): Rect =>
      q ? [Math.floor(b[0]!) - by, Math.floor(b[1]!) - by, Math.ceil(b[2]!) + by, Math.ceil(b[3]!) + by] : [b[0]!, b[1]!, b[2]!, b[3]!];
    const boxes = [...labels.keys()].map((j) => whole(model(j)));
    if (link) boxes.push(whole([link.left, link.top, link.right, link.bottom]));
    // Each one's core() kept clear for it, in the same order: the names on show, then each
    // other's whose LEAST square lies on no other model and no core kept before it.
    const cores: (Rect | null)[] = labels.map(() => null);
    const placed: Rect[] = [];
    if (q) {
      for (const i of turns) {
        const l = labels[i]!;
        const c = core(l);
        const least: Rect = [l.x + l.width / 2 - r, l.y + l.height / 2 - r, l.x + l.width / 2 + r, l.y + l.height / 2 + r];
        const clear = (l.box !== null && (asked(l) || !!l.named)) || !labels.some((_, j) => j !== i && meets(least, model(j)));
        if (!l.off && clear && !cores.some((k) => k && meets(c, k))) cores[i] = whole(c, 1);
      }
    }
    for (const i of turns) {
      const l = labels[i]!;
      const mx = l.x + l.width / 2;
      const my = l.y + l.height / 2;
      const half = Math.max(l.width, TARGET) / 2;
      // Its edges, as top, right, bottom, left.
      const hit: [number, number, number, number] = [my - TARGET / 2, mx + half, my + TARGET / 2, mx - half];
      const others: ArrayLike<number>[] = [...boxes.filter((_, j) => j !== i), ...cores.filter((c, j): c is Rect => !!c && j !== i), ...placed];
      for (const o of others) {
        const [left, top, right, bottom] = [o[0]!, o[1]!, o[2]!, o[3]!];
        if (!(left < hit[1] && right > hit[3] && top < hit[2] && bottom > hit[0])) continue;
        const loss = [bottom - hit[0], hit[1] - left, hit[2] - top, right - hit[3]];
        const k = loss.indexOf(Math.min(...loss));
        hit[k] = [bottom, left, top, right][k]!;
      }
      // Never under LEAST square, about the label's middle, but never under the panel or the
      // sheet either.
      let top = Math.min(hit[0], my - r);
      let right = Math.min(Math.max(hit[1], mx + r), freeRight);
      let bottom = Math.min(Math.max(hit[2], my + r), freeBottom);
      let left = Math.max(Math.min(hit[3], mx - r), 0);
      // Still off the header's link: the LEAST square about the middle of a label just under the
      // band reached a pixel into it (ap's at switch on a landscape phone), and a model's box
      // that took the whole screen (its corners behind the camera) cut the target past it, so
      // the link went uncut (Exit's at idiff). Its top starts under the link, LEAST still kept.
      if (link && left < link.right && right > link.left && top < link.bottom && bottom > link.top) {
        top = Math.ceil(link.bottom);
        bottom = Math.max(bottom, top + LEAST);
      }
      // A label keeping quiet (hidden from the eye) whose LEAST square would still lie over
      // another model gives up its target there, so a tap on that model reaches it: in the
      // homelab cluster on a phone, ap's label lay over homelab's model. Its node still takes
      // the tap, and it stays focusable. On a phone's quiet overview, likewise where its target
      // as kept would meet another model, a name on show or a target placed before it; and a
      // name that can't keep its target isn't shown.
      [left, top, right, bottom] = whole([left, top, right, bottom]);
      const mine: Rect = [left, top, right, bottom];
      const crowded =
        (q || subQuiet(l.id)) &&
        !l.button.hasAttribute('aria-current') &&
        (labels.some((_, j) => j !== i && meets([mx - r, my - r, mx + r, my + r], model(j))) ||
          (q &&
            (labels.some((_, j) => j !== i && !wide[j] && meets(mine, model(j))) ||
              others.slice(boxes.length - 1).some((o) => meets(mine, o)))));
      if (crowded !== l.nohit) {
        l.nohit = crowded;
        l.item.toggleAttribute('data-nohit', crowded);
      }
      if (crowded && l.named) {
        l.named = false;
        l.item.toggleAttribute('data-named', false);
      }
      // Kept, it's in the way of the ones after it.
      if (q && !crowded && !l.off) placed.push(whole(mine, 1));
      // Whole pixels, a little over (44 px, not 43.6); on a phone's quiet overview its edges on
      // whole pixels (the box's own edges are on 1/64 px).
      const inset = [top - l.y, l.x + l.width - right, l.y + l.height - bottom, left - l.x]
        .map((v) => `${q ? Math.round(v * 64) / 64 : Math.floor(v)}px`)
        .join(' ');
      if (inset !== l.cut) {
        l.cut = inset;
        l.button.style.setProperty('--hit', inset);
      }
    }
  }

  function syncHover(): void {
    const h = nodes.hovered;
    if (h === hovered) return;
    if (hovered) byId.get(hovered)?.item.classList.remove('is-hover');
    if (h) byId.get(h)?.item.classList.add('is-hover');
    hovered = h;
    dirty = true; // a quiet label shows while hovered: place it so
  }

  cleanups.push(
    clock.addLate(() => {
      syncHover();
      if (!element.isConnected) return;
      if (!measured) measure();
      const flying = flights?.flight != null;
      const moved = snapshot();
      if (moved || dirty) {
        dirty = false;
        place(flying || flew || !framed, flying);
      }
      flew = flying;
    }),
  );

  // The models' bounds arrive with their GLBs (each in its own time: the arrival doesn't wait for
  // them all), and the label widths with the web fonts.
  let disposed = false;
  const again = () => {
    if (disposed) return;
    measured = false;
    statusPx = null;
    dirty = true;
    clock.invalidate();
  };
  for (const id of byId.keys()) void nodes.get(id).ready.then(again);
  void doc.fonts?.ready.then(again);

  return {
    element,
    setStatus(id, text, opts) {
      const l = byId.get(id);
      if (!l) return;
      const words = text ?? '';
      const pinned = !!opts?.pinned && text !== null;
      if (opts?.now) {
        // A crossfade's ghost and fade-in go, and the line takes its words and its showing in this
        // frame: a skip once crossfaded "Checking…" to "Working" and let go of it 40 ms later, so
        // "Working" faded in and dropped out (the fade-in held it over the let-go's fade-out).
        for (const ghost of l.button.querySelectorAll('.status')) if (ghost !== l.status) ghost.remove();
        for (const a of l.status.getAnimations?.() ?? []) a.cancel();
        l.status.textContent = words;
        l.status.style.transition = 'none';
        l.item.toggleAttribute('data-pinned', pinned);
        void getComputedStyle(l.status).opacity; // its showing settles here, with no transition
        l.status.style.transition = '';
        return;
      }
      if (l.status.textContent !== words) {
        // Showing: the old words fade out where they are while the new ones fade in.
        if (!prefs.reduced && l.status.isConnected && getComputedStyle(l.status).opacity !== '0') {
          const ghost = l.status.cloneNode(true) as HTMLSpanElement;
          l.status.after(ghost);
          const timing = { duration: tuning.statusFadeMs, easing: 'ease', fill: 'forwards' as const };
          ghost.animate([{ opacity: 1 }, { opacity: 0 }], timing);
          l.status.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, fill: 'none' });
          // On a timer, not the finish event: a page rendering on demand may not have one coming.
          setTimeout(() => ghost.remove(), tuning.statusFadeMs + 50);
        }
        l.status.textContent = words;
      }
      l.item.toggleAttribute('data-pinned', pinned);
    },
    room(id) {
      const l = byId.get(id);
      if (!l || quiet() || subQuiet(id)) return 0;
      return GAP + Math.max(l.button.offsetWidth || l.width, statusRoom());
    },
    follow(f) {
      flights = f;
    },
    dispose() {
      disposed = true;
      for (const fn of cleanups) fn();
      element.remove();
    },
  };
}
