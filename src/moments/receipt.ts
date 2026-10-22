// The trip receipt moment (Task 16), a lazy chunk (src/moments/load.ts): map.ts loads it once
// the arrival is over, and it records the trip from there (trip.ts).
//
// - Leaving: exit's panel gets a "Leave" button, and a click on the door (exit's
//   `poke_door_hit`, map.ts's seam) does the same: the trip ends, the receipt is drawn
//   (receipt-canvas.ts) and the visitor travels to `#receipt`. The camera director flies to
//   Fettle and rests in its `receipt` state; on landing Fettle prints (`trip`, or `arrive`
//   while the model has no `trip` clip). Leaving works on a dark map too (the RCD's trip, a
//   flip): Fettle prints once it's back on, its `on` played out, and never if it stays dark (the
//   RCD waits for its reset); the panel's receipt and "Keep the receipt" don't need the strip.
// - The receipt's panel: a section of its own (data-node="receipt", taken in by panel.add):
//   the verdict as its heading, "Keep the receipt" and the way back to the site, then the
//   receipt as leader lists, so screen readers and phones can read it all.
// - Keeping it: the canvas as candygoogy-trip.png, through the share sheet where a phone can
//   share files (so "Save image" puts it in the photo library), else a download. A polite
//   status line says it's done. Fettle plays `tear` if the model has one.
// - Under reduced motion Fettle shows the end of its print at once (nodes.ts plays nothing).
//
// Its words are src/copy-receipt.ts's; the wordmark comes with `copy`.

// three.js by type only: a value import of 'three' from a second lazy chunk makes Rolldown split
// three.core out of the runtime's chunk, 2.2 kB more on the first load (tests/unit/budget.test.ts).
// The classes come from objects the runtime already made: the bake texture, the node's home.
import type { Material, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Texture, Vector3 } from 'three';
import { copy } from '../copy';
import type { MapFeed } from '../data/feed';
import type { Director } from '../camera/director';
import { RECEIPT, type Stations } from '../nav/stations';
import type { Theme } from '../stage/theme';
import type { Panel } from '../ui/panel';
import type { Nodes } from '../world/nodes';
import { prefs } from '../motion/prefs';
import { clock, drawReceipt, duration, RECEIPT_WIDTH, receiptFontsReady, receiptLength, receiptPng, revisitsOf, TIME, verdictOf } from './receipt-canvas';
import { createTrip, type Trip, type TripSummary } from './trip';
import './receipt.css';

export const RECEIPT_FILE = 'candygoogy-trip.png';

// Fettle's paper, as the model's Blender source (not in this repo) makes it: PAPER_W wide,
// PAPER_L long from the deep end to the free end; its `print` UVs (uv1) run v from the free end
// (0) to the deep end (1). The free end's CURL_LEN stays curled over, so the print starts below
// it (a blank lead).
const PAPER_W = 0.38;
const CURL_LEN = 0.055 * 2.4; // CURL_R * CURL
const PAPER_L = 1.15 + 0.07 + CURL_LEN; // HIDDEN + RISE + CURL_LEN
// `trip`'s feed: TRIP_BURSTS bursts of TRIP_FULL / TRIP_BURSTS each, the first at TRIP_START,
// TRIP_FRAMES apart (24 fps). It stops after the burst that has fed the whole receipt out.
const TRIP_FULL = 0.07 + CURL_LEN + 1.1; // OUT_REST + FEED_MAX
const TRIP_BURSTS = 8;
const TRIP_START = 12;
const TRIP_FRAMES = 5;
/** Blank paper fed out after the print, so the tear bar cuts below it. */
const TAIL = 0.04;
/** The slot's mouth over tuning.receiptBox's floor (the cover's top, fettle.py), world units. */
const PRINT_FOOT = 0.09;

/** The bursts `trip` feeds for receipt `c`: enough for its print, its lead and its tail. */
const burstsFor = (c: HTMLCanvasElement): number =>
  Math.min(TRIP_BURSTS, Math.ceil((CURL_LEN + (receiptLength(c) / RECEIPT_WIDTH) * PAPER_W + TAIL) / (TRIP_FULL / TRIP_BURSTS)));
/** How far the strip stands out of the slot once receipt `c` is printed (the curl adds no height). */
const fedOut = (c: HTMLCanvasElement): number => (burstsFor(c) * TRIP_FULL) / TRIP_BURSTS;
/** How far up a drag on the printed strip tears it off, in world units. */
const TEAR_PULL = 0.6;
/** How far the strip itself gives under the pull at most (a rubber band), in world units. */
const TEAR_GIVE = 0.1;
/** When tear has the empty printer back in view (fettle.py TEAR_SNAP, at 24 fps): the print
 *  comes off the paper then, so the fresh stub is blank. */
const TEAR_SNAP_S = 15 / 24;

export interface ReceiptDeps {
  feed: MapFeed;
  stations: Stations;
  director: Pick<Director, 'state' | 'flight' | 'onFlight' | 'receiptHeight'>;
  nodes: Pick<Nodes, 'get'>;
  panel: Pick<Panel, 'add'>;
  theme: () => Theme;
  /** The stage's canvas and camera, for the tear by drag. */
  stage: { renderer: { domElement: HTMLCanvasElement }; camera: PerspectiveCamera };
  /** Asks the clock for a frame (the strip moved). */
  invalidate: () => void;
  /** When the visit began (epoch ms): the page's start. */
  startedAt?: number;
  doc?: Document;
}

export interface Receipt {
  readonly trip: Trip;
  /** Whether #receipt has something to show: the visitor has left and not travelled on. */
  canShow(): boolean;
  /** Leaves through the door: ends the trip, draws the receipt and travels to #receipt. */
  leave(): void;
  /** A model was poked (map.ts). */
  poked(): void;
  /** The receipt as the PNG the visitor keeps, or null before a trip is left. */
  readonly canvas: Promise<HTMLCanvasElement> | null;
  /** "Keep the receipt": Fettle tears it off, and the PNG is shared or downloaded. */
  keep(): Promise<void>;
  /** Where the printed strip is on screen (CSS px: its middle, and px per unit up it), or null. */
  paperOnScreen(): { x: number; y: number; perUnit: number } | null;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(doc.createElement(tag), props);
  e.append(...kids);
  return e;
}

/** A leader list (styles.css .leaders): label, dotted leader, value flush right. */
function leaders(doc: Document, rows: [string, string][], className = ''): HTMLDListElement {
  return el(doc, 'dl', { className: `leaders ${className}`.trim() }, ...rows.map(([dt, dd]) => el(doc, 'div', {}, el(doc, 'dt', {}, dt), el(doc, 'dd', {}, dd))));
}

export function createReceipt(deps: ReceiptDeps): Receipt {
  const { feed, stations, director, nodes, panel } = deps;
  const doc = deps.doc ?? document;
  const win = doc.defaultView ?? window;
  const names = new Map(feed.nodes.map((n) => [n.id, n.name]));
  const trip = createTrip(stations, { name: (id) => names.get(id) ?? id, startedAt: deps.startedAt });
  const main = doc.getElementById('stations');
  const exit = main?.querySelector<HTMLElement>('section.station[data-node="exit"]') ?? null;

  // Exit's "Leave", after its words.
  const leaveButton = el(doc, 'button', { type: 'button', className: 'receipt-action', textContent: copy.leave.text });
  const leaveRow = el(doc, 'p', { className: 'receipt-leave' }, leaveButton);
  leaveButton.addEventListener('click', () => leave());
  if (exit) {
    (exit.querySelector('.body') ?? exit).append(leaveRow);
    panel.add(leaveRow);
  }

  // The receipt's own section, hidden until there's a trip to show.
  const title = el(doc, 'h2', { id: 'receipt-title' });
  const sub = el(doc, 'p', { className: 'blurb' });
  const body = el(doc, 'div', { className: 'body' });
  const keepButton = el(doc, 'button', { type: 'button', className: 'receipt-action', textContent: copy.keepReceipt.text });
  keepButton.addEventListener('click', () => void keep());
  const status = el(doc, 'p', { className: 'receipt-status' });
  status.setAttribute('role', 'status');
  const home = el(doc, 'a', { href: new URL('/', feed.site.url).href, textContent: copy.backToSite.text });
  const section = el(
    doc,
    'section',
    { className: 'station receipt', id: RECEIPT, hidden: true },
    el(doc, 'div', { className: 'head' }, title, sub),
    // The way to keep it comes before the receipt's details, so it's in view without scrolling
    // on the desktop column and in a phone's open sheet; the reading order is the same.
    el(doc, 'div', { className: 'receipt-actions' }, keepButton, el(doc, 'ul', { className: 'links' }, el(doc, 'li', {}, home))),
    status,
    body,
  );
  section.dataset.node = RECEIPT;
  section.setAttribute('aria-labelledby', 'receipt-title');
  if (exit) exit.after(section);
  else main?.append(section);
  panel.add(section);

  let canvas: Promise<HTMLCanvasElement> | null = null;

  function fillPanel(s: TripSummary): void {
    const v = verdictOf(s, copy);
    title.textContent = v.title;
    sub.textContent = v.sub;
    const part = (name: string) => el(doc, 'h3', { className: 'receipt-section' }, name);
    const again = revisitsOf(s.route);
    const numbers: [string, string][] = [[copy.receiptStops.text, String(s.route.length)]];
    if (again.length) numbers.push([copy.receiptRevisits.text, again.join(', ')]);
    numbers.push([copy.receiptPokes.text, String(s.pokes)]);
    if (s.powerCycles) numbers.push([copy.receiptPower.text, String(s.powerCycles)]);
    const found = s.secretsFound.length;
    numbers.push([copy.receiptSecrets.text, found ? copy.receiptSecretsCount.text.replace('{n}', String(found)) : copy.receiptSecretsNone.text]);
    for (const f of s.secretsFound) numbers.push([f.name, clock(f.at)]);
    body.replaceChildren(
      leaders(doc, [
        [copy.receiptStarted.text, TIME.format(s.startedAt)],
        [copy.receiptLeft.text, TIME.format(s.endedAt)],
        [copy.receiptDuration.text, duration(s.endedAt - s.startedAt)],
      ]),
      part(`${copy.receiptStations.text} · ${s.visited.length} of ${s.total}`),
      leaders(
        doc,
        s.visited.map((v) => [v.name, clock(v.at)]),
        'receipt-visited',
      ),
      part(copy.receiptRoute.text),
      el(doc, 'p', { className: 'receipt-route' }, s.route.join(' → ')),
      part(copy.receiptNumbers.text),
      leaders(doc, numbers),
    );
    status.textContent = '';
    section.hidden = false;
    panel.add(section); // re-fits its leaders if it's showing
  }

  function leave(): void {
    kept = false;
    const s = trip.leave();
    fillPanel(s);
    // Drawn now if the site's faces are in (they are, once the page has painted its words), so
    // the camera is framed for this receipt's length before it travels.
    const draw = () => drawReceipt(s, deps.theme(), copy, doc);
    const ready = doc.fonts?.check?.('15px "Schibsted Grotesk"') && doc.fonts.check('24px "Newsreader"');
    const drawn = ready ? draw() : null;
    canvas = drawn ? Promise.resolve(drawn) : receiptFontsReady().catch(() => undefined).then(draw);
    director.receiptHeight = drawn ? PRINT_FOOT + fedOut(drawn) : null;
    stations.go(RECEIPT);
  }

  // The print on Fettle's paper: the receipt canvas on the paper's uv1, through the role
  // material's aoMap (MeshBasicMaterial multiplies by its red channel: the inks are grey, and
  // the paper's own colour and bake stay as they are). A plain Texture, not a CanvasTexture.
  let print: Texture | null = null;
  let torn = true; // no strip stands out of the slot
  let kept = true; // this receipt has been torn off or kept (or there's none): nothing to print
  function paperMaterial(): MeshBasicMaterial | null {
    let found: Material | null = null;
    nodes.get('fettle').root.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined;
      if (!found && m && !Array.isArray(m) && m.name === 'paper') found = m;
    });
    return found;
  }
  function setPrint(texture: Texture | null): void {
    const m = paperMaterial();
    if (!m) return;
    m.aoMap = texture;
    m.aoMapIntensity = 1;
    m.needsUpdate = true;
  }
  function printOn(c: HTMLCanvasElement): void {
    // Fed out, the strip leaves the bounds its rest pose was culled by.
    nodes.get('fettle').root.traverse((o) => {
      if (((o as Mesh).material as Material | undefined)?.name === 'paper') o.frustumCulled = false;
    });
    print?.dispose();
    const m = paperMaterial();
    if (!m?.map) return;
    print = new (m.map.constructor as typeof Texture)(c);
    print.colorSpace = 'srgb'; // SRGBColorSpace
    print.flipY = false; // glTF's v runs down, as the canvas's rows do
    print.channel = 1;
    // The canvas is RECEIPT_WIDTH units across the paper's width; v covers PAPER_L of paper,
    // and the print starts CURL_LEN down from the free end.
    const long = (receiptLength(c) / RECEIPT_WIDTH) * PAPER_W;
    print.repeat.set(1, PAPER_L / long);
    print.offset.set(0, -CURL_LEN / long);
    print.needsUpdate = true;
    setPrint(print);
  }

  // Fettle prints as the camera lands at the receipt (or cuts there, motion reduced): its
  // `trip`, held fully fed out until it's torn (or `arrive`'s feed while the model has none).
  const offFlight = director.onFlight((f) => {
    if (f === null) printNow();
  });
  const offCut = stations.subscribe((to) => {
    if (to === RECEIPT) queueMicrotask(printNow); // after the director has moved
  });
  // Dark, it prints nothing (nodes.ts): it prints once it's back on. Its `off` takes the held
  // `trip` back (a flip just as you left): the strip is in again, untorn, so it prints again too,
  // and the stub left out is blank meanwhile.
  const offLit = nodes.get('fettle').onLit((lit) => {
    if (lit) printNow();
    else if (!torn) {
      torn = true;
      setPrint(null);
    }
  });
  function printNow(): void {
    if (director.state !== 'receipt' || director.flight || !canvas || !torn || kept || !nodes.get('fettle').lit) return;
    torn = false;
    void canvas.then((c) => {
      const fettle = nodes.get('fettle');
      if (director.state !== 'receipt' || kept || !fettle.lit) return void (torn = true);
      printOn(c);
      if (fettle.has('trip')) void fettle.hold('trip', tripStop(c));
      else void fettle.play('arrive');
    });
  }

  /** When `trip` has fed the receipt out (seconds into the clip): the end of its last burst. */
  function tripStop(c: HTMLCanvasElement): number {
    const bursts = burstsFor(c);
    return bursts >= TRIP_BURSTS ? Infinity : (TRIP_START + bursts * TRIP_FRAMES) / 24;
  }

  /** Fettle tears the receipt off; the print comes off the paper once the strip is gone. */
  function tear(): void {
    kept = true;
    if (torn) return;
    torn = true;
    void nodes.get('fettle').play('tear');
    win.setTimeout(() => setPrint(null), prefs.reduced ? 0 : TEAR_SNAP_S * 1000);
  }

  // Leaving the receipt without keeping it: it's torn off all the same, so Fettle is back to rest.
  const offStations = stations.subscribe((to, from) => {
    if (from === RECEIPT && to !== RECEIPT) tear();
    // The map's labels step back at the receipt (receipt.css): it's framed square on, and the
    // nodes behind Fettle (eolietech) would put their names on the paper.
    doc.documentElement.toggleAttribute('data-receipt', to === RECEIPT);
  });

  // Tearing it off by hand: a drag that starts on the printed strip pulls it up through the
  // slot against a rubber band (the paper's rig moves, out of the clips' reach); let go past
  // TEAR_PULL it tears and is kept, short of it it springs back. Elsewhere a drag still pulls
  // the model (pointer.ts): this listens first, in the capture phase, and keeps the drags it
  // takes to itself.
  const canvasEl = deps.stage.renderer.domElement;
  const top = nodes.get('fettle').home.clone();
  const foot = top.clone();
  const side = top.clone();
  let rig: Object3D | null = null;
  let rigY = 0;
  function paperRig(): Object3D | null {
    rig ??= nodes.get('fettle').root.getObjectByName('paper_rig') ?? null;
    if (rig && rigY === 0) rigY = rig.position.y;
    return rig;
  }
  function toScreen(v: Vector3): Vector3 {
    v.project(deps.stage.camera);
    const r = canvasEl.getBoundingClientRect();
    return v.set(r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height, v.z);
  }
  function paperOnScreen(): { x: number; y: number; perUnit: number; half: number; height: number } | null {
    if (director.state !== 'receipt' || torn) return null;
    const fettle = nodes.get('fettle');
    const end = fettle.root.getObjectByName('paper_curl_12');
    if (!end) return null;
    fettle.root.updateWorldMatrix(true, true);
    end.getWorldPosition(top);
    foot.set(0, 0.45, 0);
    fettle.root.localToWorld(foot);
    side.set(0.19, 0.45, 0);
    fettle.root.localToWorld(side);
    const height = top.distanceTo(foot);
    toScreen(top);
    toScreen(foot);
    toScreen(side);
    const px = Math.hypot(foot.x - top.x, foot.y - top.y);
    return { x: (top.x + foot.x) / 2, y: (top.y + foot.y) / 2, perUnit: px / height, half: Math.abs(side.x - foot.x), height: px };
  }
  function onPaper(e: PointerEvent): boolean {
    const p = paperOnScreen();
    if (!p) return false;
    return Math.abs(e.clientX - p.x) <= p.half && Math.abs(e.clientY - p.y) <= p.height / 2;
  }
  function give(units: number): void {
    const r = paperRig();
    if (!r) return;
    r.position.y = rigY + TEAR_GIVE * (1 - Math.exp(-Math.max(0, units) / TEAR_PULL));
    deps.invalidate();
  }
  let pull: { id: number; y: number; perUnit: number; units: number } | null = null;
  const stop = (e: Event) => {
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  function onDown(e: PointerEvent): void {
    if (pull || e.button !== 0 || !onPaper(e)) return;
    stop(e);
    pull = { id: e.pointerId, y: e.clientY, perUnit: paperOnScreen()!.perUnit, units: 0 };
    canvasEl.setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent): void {
    if (!pull) {
      // Over the strip, it's something to take hold of (pointer.ts has the cursor elsewhere).
      if (e.pointerType === 'mouse' && onPaper(e)) {
        e.stopImmediatePropagation();
        canvasEl.style.cursor = 'grab';
      }
      return;
    }
    if (e.pointerId !== pull.id) return;
    stop(e);
    canvasEl.style.cursor = 'grabbing';
    pull.units = (pull.y - e.clientY) / pull.perUnit;
    give(pull.units);
  }
  function onUp(e: PointerEvent): void {
    if (!pull || e.pointerId !== pull.id) return;
    stop(e);
    const done = pull.units >= TEAR_PULL && e.type === 'pointerup';
    pull = null;
    canvasEl.style.cursor = '';
    if (canvasEl.hasPointerCapture(e.pointerId)) canvasEl.releasePointerCapture(e.pointerId);
    if (done) {
      give(0); // the tear takes the strip from where trip holds it
      void keep();
      return;
    }
    springBack();
  }
  function springBack(): void {
    const r = paperRig();
    if (!r) return;
    const from = r.position.y;
    const t0 = performance.now();
    const step = () => {
      const k = prefs.reduced ? 1 : Math.min((performance.now() - t0) / 220, 1);
      r.position.y = from + (rigY - from) * (1 - (1 - k) ** 3);
      deps.invalidate();
      if (k < 1 && !pull) requestAnimationFrame(step);
    };
    step();
  }
  // A click that ends a pull isn't a select (pointer.ts travels on clicks).
  const onClick = (e: MouseEvent) => {
    if (pulled) stop(e);
    pulled = false;
  };
  let pulled = false;
  const onUpMark = (e: PointerEvent) => {
    if (pull && e.pointerId === pull.id) pulled = true;
  };
  const opts = { capture: true };
  canvasEl.addEventListener('pointerdown', onDown, opts);
  canvasEl.addEventListener('pointermove', onMove, opts);
  canvasEl.addEventListener('pointerup', onUpMark, opts);
  canvasEl.addEventListener('pointerup', onUp, opts);
  canvasEl.addEventListener('pointercancel', onUp, opts);
  canvasEl.addEventListener('click', onClick, opts);

  async function keep(): Promise<void> {
    if (!canvas) return;
    tear();
    const blob = await receiptPng(await canvas);
    const file = new File([blob], RECEIPT_FILE, { type: 'image/png' });
    const nav = win.navigator;
    const phone = win.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (phone && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file] });
      } catch {
        return; // the visitor closed the sheet
      }
    } else {
      const url = URL.createObjectURL(blob);
      const a = el(doc, 'a', { href: url, download: RECEIPT_FILE });
      doc.body.append(a);
      a.click();
      a.remove();
      win.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    status.textContent = copy.receiptKept.text;
  }

  return {
    trip,
    canShow: () => trip.left,
    leave,
    poked: () => trip.poke(),
    get canvas() {
      return canvas;
    },
    keep,
    paperOnScreen() {
      const p = paperOnScreen();
      return p && { x: p.x, y: p.y, perUnit: p.perUnit };
    },
    dispose() {
      canvasEl.removeEventListener('pointerdown', onDown, opts);
      canvasEl.removeEventListener('pointermove', onMove, opts);
      canvasEl.removeEventListener('pointerup', onUpMark, opts);
      canvasEl.removeEventListener('pointerup', onUp, opts);
      canvasEl.removeEventListener('pointercancel', onUp, opts);
      canvasEl.removeEventListener('click', onClick, opts);
      give(0);
      offFlight();
      offCut();
      offLit();
      offStations();
      doc.documentElement.removeAttribute('data-receipt');
      setPrint(null);
      print?.dispose();
      trip.dispose();
      leaveRow.remove();
      section.remove();
    },
  };
}
