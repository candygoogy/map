// The rubber duck (Task 17, secret 4, approved 2026-10-20): a hidden node off the map's far
// edge, reached only by following a stray signal.
// A lazy moment: map.ts loads it when the first stray is due (traffic.ts, about one signal in
// 20), so a visitor who never sees one never downloads it.
//
// - The way in: while a stray rides, a button lies over it, 44 px round, named from copy
//   ("Follow the stray signal") and drawn as nothing but the signal under it, so the pointer has
//   a fair target and the keyboard a stop: it's in the Tab order right after the origin's label
//   (the map's hub; where a stray sets out varies, its stop doesn't), only while one is out.
//   Hovered or focused, the stray waits where it is (traffic.holdStray). It follows the signal
//   on screen each late step; off the canvas or behind the camera it lets the pointer through,
//   and shows only while focused.
// - Following it: the secret is found (secrets.ts found('duck')), the node is revealed
//   (stations.reveal: its label, its section, the hash and Back reach it from now on), its model
//   grows in (`appear`) with its ground ring, and the camera flies there (stations.go). Its link
//   draws in as the camera travels, done as it lands; with motion reduced, at once. A keyboard
//   follow moves focus to the duck's own label, so it never drops to the page as the button goes.
// - It stays for the visit: nothing hides it again. Never in ‹ › (stations.ts): only its label,
//   its hash and Back reach it once found.
// - The stray stands out (the owner's test notes, approved 2026-10-21: "the trail and the
//   wobble"): at a signal's size the owner never saw one. It waddles, its pill swaying across its path
//   (wobble(): on the model under the root, so traffic's placing of the root never undoes it, and
//   the pooled signal is put back straight as the stray goes), and a dotted --edge trail draws in
//   behind it along its undrawn way (traffic.strayWay), under the models as the links are,
//   fading out a few seconds after it's gone or followed. With motion reduced it doesn't waddle
//   and the trail comes and goes with it, still: the trail alone marks it. Both live here, in
//   the lazy chunk, so the first load carries none of it.
// - Its way (stray-way.ts, the owner's test 2026-10-21: "always in one position"): out of a node
//   near the view, round to the duck from off the map's edge. This chunk makes it (strayWays),
//   so map.ts fetches it as the first stray is due, before that stray sets out.

import { type Camera, NotEqualStencilFunc, type Object3D, type PerspectiveCamera, Vector2, Vector3 } from 'three';
import { Line2 } from '../vendor/lines/Line2.js';
import { LineGeometry } from '../vendor/lines/LineGeometry.js';
import { LineMaterial } from '../vendor/lines/LineMaterial.js';
import { runtimeCopy as copy } from '../copy-runtime';
import type { Director } from '../camera/director';
import { prefs } from '../motion/prefs';
import type { Stations } from '../nav/stations';
import type { Clock } from '../stage/clock';
import type { Stage } from '../stage/stage';
import { tuning } from '../tuning';
import type { Links } from '../world/links';
import type { Nodes } from '../world/nodes';
import type { StrayWay, Traffic } from '../world/traffic';
import { found, type SecretId } from './secrets';
import { type Spot, strayStart, strayWay } from './stray-way';

export interface DuckOptions {
  id: string;
  stage: Pick<Stage, 'renderer' | 'scene' | 'theme' | 'onResize' | 'onTheme' | 'viewport'> & { readonly camera: PerspectiveCamera };
  clock: Pick<Clock, 'add' | 'addLate' | 'invalidate'>;
  traffic: Pick<Traffic, 'stray' | 'strayWay' | 'holdStray' | 'onStray'>;
  stations: Pick<Stations, 'go' | 'reveal' | 'revealed' | 'current'>;
  nodes: Pick<Nodes, 'get'>;
  links: Pick<Links, 'drawProgress' | 'showRing'>;
  director: Pick<Director, 'flight' | 'onFlight'>;
  /** The labels' list: the button goes in after the origin's item. */
  list: HTMLElement;
  /** The hidden node's section in the panel (hidden.ts), shown once it's found. */
  section: HTMLElement;
}

export interface Duck {
  /** Follows the stray now (the button's click). False if there's none out or it's found already. */
  follow(): boolean;
  dispose(): void;
}

/** The button's size on screen, CSS px (the WCAG target, as the labels'). */
const HIT = 44;

/** The stray's waddle: `side` units across its path (the pill is 0.26 long) and `yaw` radians
 *  turned into the sway, `hz` times a second. */
const WOBBLE = { side: 0.06, yaw: 0.4, hz: 2.2 };

/** The waddle `t` seconds into a stray's ride: its sideways offset (local x, across the path on
 *  the floor) and its turn about the vertical, heading into the sway. Nothing with motion reduced. */
export function wobble(t: number, reduced: boolean): { side: number; yaw: number } {
  if (reduced) return { side: 0, yaw: 0 };
  const a = 2 * Math.PI * WOBBLE.hz * t;
  return { side: WOBBLE.side * Math.sin(a), yaw: WOBBLE.yaw * Math.cos(a) };
}

/** The trail: segments along the stray's way, its dashes and gaps (world units), how far it
 *  keeps behind the stray (so it never runs through the pill), and its seconds after the stray
 *  is gone: held, then faded. */
export const TRAIL = { segments: 128, dash: 0.05, gap: 0.08, behind: 0.2, hold: 1.5, fade: 2.5 };

/** What makes the stray's ways (traffic's StrayTo.way): out of node `from`, else out of the
 *  station's node at a station, else a node in view (stray-way.ts). */
export function strayWays(o: {
  id: string;
  camera: Camera;
  nodes: Pick<Nodes, 'all'>;
  stations: Pick<Stations, 'current'>;
  director: Pick<Director, 'state'>;
}): (from?: string) => StrayWay {
  const p = new Vector3();
  return (from) => {
    const spots = o.nodes.all().map((n): Spot => {
      const { x, z } = n.root.position;
      const { min, max } = n.bounds;
      p.copy(n.root.position).project(o.camera);
      return {
        id: n.id,
        x,
        z,
        box: n.bounds.isEmpty() ? undefined : [x + min.x, z + min.z, x + max.x, z + max.z],
        seen: p.z < 1 && Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9,
      };
    });
    const duck = spots.find((s) => s.id === o.id)!;
    const at = o.director.state === 'station' ? o.stations.current : null;
    const start = from ?? strayStart(at, spots, duck);
    return strayWay(spots.find((s) => s.id === start) ?? spots.find((s) => s.id === 'origin')!, duck, spots, tuning.linkMast);
  };
}

export function createDuck(o: DuckOptions): Duck {
  const { id, stage, clock, traffic, stations, nodes, links, director, list, section } = o;
  const doc = list.ownerDocument;
  const item = doc.createElement('li');
  item.className = 'stray';
  item.hidden = true;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'stray-hit';
  button.setAttribute('aria-label', copy.strayButton.text);
  item.append(button);
  const origin = list.querySelector<HTMLElement>('button.label[data-go="origin"]')?.closest('li');
  if (origin) origin.after(item);
  else list.prepend(item);

  let root: Object3D | null = traffic.stray;
  let pointing = false;
  let focused = false;
  const hold = () => traffic.holdStray(pointing || focused);
  const on = (type: string, fn: () => void) => button.addEventListener(type, fn);
  on('pointerenter', () => ((pointing = true), hold()));
  on('pointerleave', () => ((pointing = false), hold()));
  on('focus', () => ((focused = true), hold(), clock.invalidate()));
  on('blur', () => ((focused = false), hold()));

  const show = (r: Object3D | null) => {
    root = stations.revealed(id) ? null : r;
    item.hidden = root === null;
    if (root === null) {
      pointing = focused = false;
      traffic.holdStray(false);
    }
    clock.invalidate();
  };
  const offStray = traffic.onStray(show);

  // --- the stray's marks: its waddle and its trail -------------------------------------------

  const trailGeometry = new LineGeometry();
  const trailMaterial = new LineMaterial({ worldUnits: false, dashed: true, transparent: true });
  trailMaterial.dashSize = TRAIL.dash;
  trailMaterial.gapSize = TRAIL.gap;
  // Under the models, as a link is (links.ts, Over the models): not where a node's model is drawn.
  trailMaterial.stencilWrite = true;
  trailMaterial.stencilRef = 1;
  trailMaterial.stencilFunc = NotEqualStencilFunc;
  const trail = new Line2(trailGeometry, trailMaterial);
  trail.name = 'stray-trail';
  trail.renderOrder = 1;
  trail.visible = false;
  trail.frustumCulled = false;
  stage.scene.add(trail);
  /** The way's points the trail runs through, its start first (made as each stray sets out). */
  let points: Vector3[] | null = null;
  const buffer = new Vector2();
  const fit = (): void => {
    stage.renderer.getDrawingBufferSize(buffer);
    trailMaterial.resolution = buffer;
    trailMaterial.linewidth = tuning.hairline * stage.viewport.pixelRatio;
    trailMaterial.alphaToCoverage = stage.viewport.tier === 'low';
  };
  fit();
  const offResize = stage.onResize(fit);
  const colour = () => void trailMaterial.color.copy(stage.theme.edge);
  colour();
  const offTheme = stage.onTheme(colour);

  /** The stray being marked, its model (the root's child, which the waddle moves), that model's rest, and seconds riding. */
  let marked: { root: Object3D; model: Object3D | null; x: number; yaw: number; t: number } | null = null;
  /** Segments of the trail drawn so far, and seconds since its stray went (-1: riding or none). */
  let drawn = 0;
  let gone = -1;
  let offMarks: (() => void) | null = null;

  function trailTo(p: Vector3): void {
    if (!points) {
      const way = traffic.strayWay;
      if (!way) return;
      points = [];
      for (let i = 0; i <= TRAIL.segments; i++) points.push(way.point(i / TRAIL.segments, new Vector3()));
      trailGeometry.setPositions(points.flatMap((q) => [q.x, q.y, q.z]));
      trail.computeLineDistances();
    }
    // The point nearest the stray, then back from it by TRAIL.behind (it only ever draws on).
    let near = 0;
    for (let i = 1; i < points.length; i++) if (points[i]!.distanceToSquared(p) < points[near]!.distanceToSquared(p)) near = i;
    const step = points[0]!.distanceTo(points[1]!) || 1;
    drawn = Math.max(drawn, Math.min(near - Math.ceil(TRAIL.behind / step), TRAIL.segments));
    trailGeometry.instanceCount = drawn;
    trail.visible = drawn > 0;
  }

  /** Puts the pooled signal's model back straight: it carries the next ordinary signal. */
  function unmark(): void {
    if (marked?.model) {
      marked.model.position.x = marked.x;
      marked.model.rotation.y = marked.yaw;
    }
    marked = null;
  }

  function endTrail(): void {
    trail.visible = false;
    trailMaterial.opacity = 1;
    drawn = 0;
    gone = -1;
  }

  /** Each frame while a stray rides or its trail fades (never with motion reduced: nothing moves). */
  function marks(dt: number): boolean {
    if (marked) {
      marked.t += dt;
      const w = wobble(marked.t, prefs.reduced);
      if (marked.model) {
        marked.model.position.x = marked.x + w.side;
        marked.model.rotation.y = marked.yaw + w.yaw;
      }
      trailTo(marked.root.position); // the root rides the line; the waddle is its model's
      return true;
    }
    if (trail.visible && !prefs.reduced) {
      gone = Math.max(gone, 0) + dt;
      trailMaterial.opacity = Math.max(1 - Math.max(gone - TRAIL.hold, 0) / TRAIL.fade, 0);
      if (gone < TRAIL.hold + TRAIL.fade) return true;
    }
    endTrail();
    offMarks = null;
    clock.invalidate();
    return false;
  }

  /** A stray sets out (r) or is gone (null): marks it, or lets its trail fade. */
  function mark(r: Object3D | null): void {
    if (r !== (marked?.root ?? null)) {
      unmark();
      if (r) {
        endTrail();
        points = null; // its own way
        const model = r.children[0] ?? null;
        marked = { root: r, model, x: model?.position.x ?? 0, yaw: model?.rotation.y ?? 0, t: 0 };
        trailTo(r.position);
      }
    }
    if (prefs.reduced) {
      // Still: the trail shows with a parked stray and goes with it, one frame each way.
      if (!r) endTrail();
      clock.invalidate();
      return;
    }
    offMarks ??= clock.add(marks);
  }

  const offMark = traffic.onStray((r) => mark(stations.revealed(id) ? null : r));
  show(root);
  mark(root);

  // Over the signal, each late step while it rides. (Its scratch vector is the signal's own
  // position's clone: no three.js value import, so this chunk shares the map's.)
  let at: Vector3 | null = null;
  const offLate = clock.addLate(() => {
    if (!root || item.hidden) return;
    at ??= root.position.clone();
    root.getWorldPosition(at).project(stage.camera);
    const { width, height } = stage.viewport;
    const x = ((at.x + 1) / 2) * width;
    const y = ((1 - at.y) / 2) * height;
    const off = at.z > 1 || x < 0 || y < 0 || x > width || y > height;
    item.toggleAttribute('data-off', off);
    item.style.transform = `translate(${Math.round(x - HIT / 2)}px, ${Math.round(y - HIT / 2)}px)`;
  });

  // The link draws in with the flight there, and is whole as it lands.
  let drawing: (() => void) | null = null;
  function drawIn(): void {
    if (prefs.reduced) {
      links.drawProgress(id, 1);
      return;
    }
    // Whole once the flight there is over, or was turned elsewhere (it's found either way).
    const tick = (): boolean => {
      const f = director.flight;
      if (f && f.to === id) {
        links.drawProgress(id, f.t);
        return true;
      }
      links.drawProgress(id, 1);
      drawing?.();
      drawing = null;
      return false;
    };
    drawing = clock.add(tick);
  }

  function follow(): boolean {
    if (stations.revealed(id) || !root) return false;
    const keyboard = focused;
    found(id as SecretId);
    stations.reveal(id);
    section.hidden = false;
    links.showRing(id, true);
    const view = nodes.get(id);
    void view.play('appear').then(() => {
      if (!view.root.visible) view.showEndOfArrive();
    });
    show(null);
    mark(null); // followed: its trail fades as the duck's link draws in
    stations.go(id);
    drawIn();
    if (keyboard) doc.querySelector<HTMLElement>(`button.label[data-go="${id}"]`)?.focus({ preventScroll: true });
    return true;
  }
  button.addEventListener('click', (e) => {
    if (e.detail) button.blur();
    follow();
  });

  return {
    follow,
    dispose() {
      offStray();
      offMark();
      offLate();
      drawing?.();
      offMarks?.();
      unmark();
      offResize();
      offTheme();
      trail.removeFromParent();
      trailGeometry.dispose();
      trailMaterial.dispose();
      item.remove();
    },
  };
}
