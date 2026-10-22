import { join } from 'node:path';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import {
  fitScale,
  fittedPose,
  groundPoints as fitGround,
  overviewCamera,
  type LabelRoom,
  scaleArrivalFrame,
  stationCamera,
  visibleRect,
  type Pose,
  type Rect,
} from '../../src/camera/fit';
import world from '../../src/data/world.json';
import { HIDDEN } from '../../src/nav/stations';
import { panelInsetFor, type PanelInset } from '../../src/stage/stage';
import { tuning } from '../../src/tuning';
import { cameraClip, glbBounds } from './helpers/glb';

const ROOT = join(import.meta.dirname, '..', '..');
const WORLD_GLB = join(ROOT, 'public', 'models', 'world.glb');
const FETTLE_GLB = join(ROOT, 'public', 'models', 'fettle.glb');
// A node still on the shared station camera, for the tests of how the fit treats it: since
// 2026-10-21 every other node has its own (cam_station_<id>), and the origin stays on the shared
// one, as would a new project's node. They keep fettle's bounds, a model's size.
const SHARED = 'origin' as const;

type Size = { width: number; height: number };
const DESKTOP: Size = { width: 1440, height: 900 };
const PHONE: Size = { width: 390, height: 844 };

/** The camera exactly as stage.ts frames it: full-canvas aspect, the inset as a view offset. */
function cameraFor(pose: Pose, vp: Size, inset: PanelInset): PerspectiveCamera {
  const cam = new PerspectiveCamera(pose.fovY, vp.width / vp.height, 0.1, 200);
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.setViewOffset(vp.width, vp.height, inset.right / 2, inset.bottom / 2, vp.width, vp.height);
  cam.updateMatrixWorld(true);
  return cam;
}

/** A point's place on the canvas in CSS px (y down), through the real projection. */
function toScreen(p: Vector3, cam: PerspectiveCamera, vp: Size): { x: number; y: number } {
  const n = p.clone().project(cam);
  return { x: ((n.x + 1) / 2) * vp.width, y: ((1 - n.y) / 2) * vp.height };
}

const EPS = 0.01; // px

function inside(s: { x: number; y: number }, r: Rect): boolean {
  return s.x >= r.x - EPS && s.x <= r.x + r.width + EPS && s.y >= r.y - EPS && s.y <= r.y + r.height + EPS;
}

/** Evenly spread directions on the unit sphere (Fibonacci), to sample each margin sphere. */
/** world.json's nodes but a hidden one's (the duck, Task 17): the overview's fit leaves it out. */
const SHOWN: Record<string, number[]> = Object.fromEntries(Object.entries(world.nodes).filter(([id]) => !HIDDEN.includes(id)));

const SAMPLES = 400;
const SPHERE = Array.from({ length: SAMPLES }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / SAMPLES;
  const r = Math.sqrt(1 - y * y);
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  return new Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
});

/** The node ids whose ground point, with a sphere of `margin` around it, leaves `rect`. */
function outsideNodes(cam: PerspectiveCamera, vp: Size, rect: Rect, margin: number): string[] {
  const out: string[] = [];
  for (const [id, xz] of Object.entries(SHOWN)) {
    const c = new Vector3(xz[0], 0, xz[1]);
    const ok = [new Vector3(), ...SPHERE].every((d) => inside(toScreen(d.clone().multiplyScalar(margin).add(c), cam, vp), rect));
    if (!ok) out.push(id);
  }
  return out;
}

const groundPoints = () => Object.values(SHOWN).map((xz) => new Vector3(xz[0], 0, xz[1]));

// The labels' room, as the director passes it to overviewCamera (director.ts labelRooms). At
// runtime it's measured in the DOM (labels.room: labels.ts's 6px gap plus the wider of the
// button and its status line), so these are nominal: what Chromium measured on /?test with the
// web fonts in, the same at 1440×900 and 390×844 (the label's type doesn't change size on
// phones). First the name alone: the gap and the button's offsetWidth.
const NAME_PX: Record<string, number> = {
  origin: 122, // candygoogy.dev
  fettle: 51,
  idiff: 80, // Install diff
  notary: 59,
  'candygoogy-bot': 122,
  'dolci-eoliani': 94,
  'siel-eolie': 73,
  eolietech: 74,
  experiments: 97,
  homelab: 73,
  colophon: 78,
  exit: 39,
  // The homelab cluster's sub-nodes keep their labels quiet in every overview (labels.ts), so
  // they take no room there.
  ap: 0,
  desktop: 0,
  server: 0,
  switch: 0,
  laptop: 0,
};
// Then the status line under the name, in the widest words it shows, the arrival's
// "Checking…" (70.8 px): the gap, the button's 4px padding either side, and the words.
const STATUS_PX = 6 + 4 + 71 + 4;
const LABEL_PX: Record<string, number> = Object.fromEntries(
  Object.entries(NAME_PX).map(([id, px]) => [id, px > 0 ? Math.max(px, STATUS_PX) : 0]),
);
// And each model's bounds in root space as nodes.ts takes them (its floor shadow left out),
// also measured in the page: fettle's own, and the placeholder box every other node stands as.
const MODEL_BOUNDS: Record<string, Box3> = {
  fettle: new Box3(new Vector3(-0.35, 0, -0.275), new Vector3(0.35, 0.529, 0.28)),
};
const BOX_BOUNDS = new Box3(new Vector3(-0.36, 0, -0.31), new Vector3(0.36, 0.5, 0.333));

/** director.ts's labelRooms for world.json's nodes: the model's centre, half-width and label px. */
function labelRooms(px: Record<string, number> = LABEL_PX): LabelRoom[] {
  return Object.entries(SHOWN).map(([id, xz]) => {
    const b = MODEL_BOUNDS[id] ?? BOX_BOUNDS;
    const centre = new Vector3(xz[0], 0, xz[1]).add(b.getCenter(new Vector3()));
    const halfWidth = Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
    const room = px[id];
    if (room === undefined) throw new Error(`fit.test: no nominal label width for ${id}`);
    return { centre, halfWidth, px: room };
  });
}

/** The ids whose label (`px` of room), placed as labels.ts places it, leaves `rect`. */
function labelsOutside(cam: PerspectiveCamera, vp: Size, rect: Rect, px: Record<string, number> = LABEL_PX): string[] {
  const out: string[] = [];
  for (const [id, xz] of Object.entries(SHOWN)) {
    const b = MODEL_BOUNDS[id] ?? BOX_BOUNDS;
    const home = new Vector3(xz[0], 0, xz[1]);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let c = 0; c < 8; c++) {
      const p = new Vector3(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z).add(home);
      const x = toScreen(p, cam, vp).x;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    const centre = toScreen(b.getCenter(new Vector3()).add(home), cam, vp);
    const right = centre.x + (maxX - minX) / 2 + px[id]!; // the gap is in px
    if (right > rect.x + rect.width + 0.5 || centre.y < rect.y || centre.y > rect.y + rect.height) out.push(id);
  }
  return out;
}

describe('visibleRect', () => {
  test('is the canvas less the right panel, or less the bottom sheet', () => {
    expect(visibleRect(DESKTOP, panelInsetFor(1440, 900, 'peek'))).toEqual({ x: 0, y: 0, width: 980, height: 900 });
    expect(visibleRect(PHONE, panelInsetFor(390, 844, 'open'))).toEqual({ x: 0, y: 0, width: 390, height: 844 - 844 * tuning.sheetOpen });
  });
});

describe('fit', () => {
  // cam_overview is composed in world.blend for the 460px panel and every label beside its model
  // (plan, Task 9: recompose in Blender rather than let code push the camera back). Recomposed for
  // the homelab cluster (2026-10-20), and again for its wide layout W2 (2026-10-21): the outer
  // rings start at the page's 72px gutter, in line with the wordmark, and the labels' room (status
  // lines included) ends 40px short of the panel, so the fit keeps it as authored.
  test('at 1440×900 with the right panel, the authored overview holds every node and every label’s room, the cluster’s too', () => {
    const inset = panelInsetFor(1440, 900, 'peek');
    const rect = visibleRect(DESKTOP, inset);
    const fit = overviewCamera(world, DESKTOP, inset, groundPoints(), labelRooms(NAME_PX));
    expect(fit.camera).toBe('overview');
    expect(fit.s).toBe(1);
    const authored = cameraFor(fittedPose(world.cameras.overview, 1), DESKTOP, inset);
    expect(outsideNodes(authored, DESKTOP, rect, tuning.fitMargin)).toEqual([]);
    expect(labelsOutside(authored, DESKTOP, rect, NAME_PX)).toEqual([]);
    // Every node's margin sphere on screen: the leftmost (the cluster's) at the gutter, and room
    // to spare at the top and bottom (the network is wider than tall at this pitch).
    let [l, r, t, b] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of groundPoints()) {
      for (const d of SPHERE) {
        const s = toScreen(d.clone().multiplyScalar(tuning.fitMargin).add(p), authored, DESKTOP);
        [l, r, t, b] = [Math.min(l, s.x), Math.max(r, s.x), Math.min(t, s.y), Math.max(b, s.y)];
      }
    }
    expect(l).toBeGreaterThan(70);
    expect(l).toBeLessThan(74);
    expect(r).toBeLessThan(rect.width - 100);
    expect(Math.abs(t - (rect.height - b))).toBeLessThan(1);
    expect(t).toBeGreaterThan(200);
    // The nodes alone would let it come about 13% closer: the labels' room is what sets it.
    expect(fitScale(world.cameras.overview, groundPoints(), DESKTOP, inset, tuning.fitMargin, { minScale: 0 })).toBeLessThan(0.9);
  });

  // Task 17, secret 4: the duck stands off the map's far edge and never joins the overview's fit,
  // before it's found or after (the overview is the owner's composition). On a desktop it already
  // stands inside the authored frame, its label's room too, so once found it shows there; on a
  // phone it's off the far edge (the left), and the portrait overview stays as composed.
  test('the hidden duck: inside the desktop overview as authored, label and all; off the phone’s; never in the fit', () => {
    const duck = new Vector3(world.nodes.duck[0], 0, world.nodes.duck[1]);
    const inset = panelInsetFor(1440, 900, 'peek');
    const rect = visibleRect(DESKTOP, inset);
    const authored = cameraFor(fittedPose(world.cameras.overview, 1), DESKTOP, inset);
    for (const d of [new Vector3(), ...SPHERE]) {
      const at = toScreen(d.clone().multiplyScalar(tuning.fitMargin).add(duck), authored, DESKTOP);
      expect(inside(at, rect), 'the duck in the desktop overview').toBe(true);
    }
    // Under the header's band, and its label (a name about as wide as its status line) inside.
    const centre = toScreen(BOX_BOUNDS.getCenter(new Vector3()).add(duck), authored, DESKTOP);
    expect(centre.y).toBeGreaterThan(120);
    expect(centre.x + 60 + STATUS_PX).toBeLessThan(rect.width);
    // Counting it changes nothing on a desktop; the fit leaves it out all the same.
    expect(overviewCamera(world, DESKTOP, inset, [...groundPoints(), duck]).s).toBe(1);
    expect(fitGround(world).some((p) => p.distanceTo(duck) < 1e-9)).toBe(false);
    // The phone: off the far edge.
    const peek = panelInsetFor(PHONE.width, PHONE.height, 'peek');
    const portrait = cameraFor(fittedPose(world.cameras.overviewPortrait, overviewCamera(world, PHONE, peek).s), PHONE, peek);
    expect(inside(toScreen(duck, portrait, PHONE), visibleRect(PHONE, peek))).toBe(false);
  });

  // The status line hangs under the name and is wider than a short one: Exit's "Working" poked
  // about 16 px under the panel while the room was the name's alone. labels.room now gives the
  // wider of the two, and the fit holds it. Since the cluster's recompose the authored camera keeps
  // that room itself, with some to spare.
  test('at 1440×900 the overview keeps room for every label’s status line too', () => {
    const inset = panelInsetFor(1440, 900, 'peek');
    const rect = visibleRect(DESKTOP, inset);
    const fit = overviewCamera(world, DESKTOP, inset, groundPoints(), labelRooms());
    const cam = cameraFor(fit, DESKTOP, inset);
    expect(fit.s).toBe(1);
    expect(labelsOutside(cam, DESKTOP, rect)).toEqual([]);
    expect(outsideNodes(cam, DESKTOP, rect, tuning.fitMargin)).toEqual([]);
    // With room to spare: 30px more on every label still fits.
    const wider = Object.fromEntries(Object.entries(LABEL_PX).map(([id, px]) => [id, px > 0 ? px + 30 : 0]));
    expect(labelsOutside(cam, DESKTOP, rect, wider)).toEqual([]);
  });

  test('at 1440×900 with the right panel, the fitted overview holds every node inside visibleRect, and only just', () => {
    const inset = panelInsetFor(1440, 900, 'peek');
    const rect = visibleRect(DESKTOP, inset);
    const fit = overviewCamera(world, DESKTOP, inset);
    expect(fit.camera).toBe('overview');
    expect(fit.s).toBeGreaterThanOrEqual(1);
    expect(outsideNodes(cameraFor(fit, DESKTOP, inset), DESKTOP, rect, tuning.fitMargin)).toEqual([]);
    // Tight: a hair closer and some node's margin leaves the visible area.
    if (fit.s > 1) {
      const closer = fittedPose(world.cameras.overview, fit.s * 0.995);
      expect(outsideNodes(cameraFor(closer, DESKTOP, inset), DESKTOP, rect, tuning.fitMargin)).not.toEqual([]);
    }
  });

  // cam_overview_portrait is composed in world.blend for a phone, whose labels take no room
  // (Phase 2): the network centred in the visible area, the outer nodes' ground rings (fitMargin)
  // ending at the page's 20px gutter, so the fit keeps it at s = 1.
  // The phone pass (2026-10-22) recomposed it as P3c: the rings now end about 8 px from the sides
  // at 390 (7 at 360), by design, for models 7% bigger, so the gutter window moved from 18–22 to
  // 6–10 px.
  // The homelab cluster lies inside that width, below the twelve: still s = 1, centred across,
  // but no longer down (it was composed before the cluster; checked 2026-10-20 and left: the
  // network clears the header and the sheet by 185 and 129 px at 390×844).
  test.each([
    [390, 844],
    [360, 780],
  ])('at %i×%i with the peek sheet and no label room, the portrait overview is authored, centred across and fills the width to the gutter', (width, height) => {
    const vp = { width, height };
    const inset = panelInsetFor(width, height, 'peek');
    expect(inset).toEqual({ right: 0, bottom: height * tuning.sheetPeek });
    const rect = visibleRect(vp, inset);
    const none = Object.fromEntries(Object.keys(SHOWN).map((id) => [id, 0]));
    const fit = overviewCamera(world, vp, inset, groundPoints(), labelRooms(none));
    expect(fit.camera).toBe('overviewPortrait');
    expect(fit.s).toBe(1);
    const cam = cameraFor(fit, vp, inset);
    expect(outsideNodes(cam, vp, rect, tuning.fitMargin)).toEqual([]);
    // Every node's margin sphere, on screen: centred both ways, 20 px in from either side.
    let [l, r, t, b] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of groundPoints()) {
      for (const d of SPHERE) {
        const s = toScreen(d.clone().multiplyScalar(tuning.fitMargin).add(p), cam, vp);
        [l, r, t, b] = [Math.min(l, s.x), Math.max(r, s.x), Math.min(t, s.y), Math.max(b, s.y)];
      }
    }
    expect(Math.abs(l - (rect.width - r))).toBeLessThan(1);
    expect(t).toBeGreaterThan(0);
    expect(b).toBeLessThan(rect.height);
    expect(l).toBeGreaterThan(6);
    expect(l).toBeLessThan(10);
  });

  // A phone's overview shows no label text (labels.ts: visually hidden on a touch screen in the
  // portrait layout until focused, hovered or current), so there labels.room gives 0 and the
  // network has the whole width (Phase 2, a phone's overview). A narrow window with a mouse
  // shows its labels, so they keep their room in the portrait overview as in the landscape one.
  test('the portrait overview keeps the room its labels give: none on a touch screen, theirs with a mouse', () => {
    const inset = panelInsetFor(390, 844, 'peek');
    const bare = overviewCamera(world, PHONE, inset);
    const none = Object.fromEntries(Object.keys(SHOWN).map((id) => [id, 0]));
    const touch = overviewCamera(world, PHONE, inset, groundPoints(), labelRooms(none));
    expect(touch.camera).toBe('overviewPortrait');
    expect(touch.s).toBe(bare.s);
    expect(touch.position.toArray()).toEqual(bare.position.toArray());
    const mouse = overviewCamera(world, PHONE, inset, groundPoints(), labelRooms());
    expect(mouse.camera).toBe('overviewPortrait');
    expect(mouse.s).toBeGreaterThan(bare.s);
    expect(labelsOutside(cameraFor(mouse, PHONE, inset), PHONE, visibleRect(PHONE, inset))).toEqual([]);
  });

  test("at 390×844 a station uses the 45% sheet, and the node's model is fully above it", async () => {
    const inset = panelInsetFor(390, 844, 'open');
    expect(inset).toEqual({ right: 0, bottom: 844 * tuning.sheetOpen });
    const rect = visibleRect(PHONE, inset);
    const b = await glbBounds(FETTLE_GLB);
    const bounds = new Box3(new Vector3(...b.min), new Vector3(...b.max));
    const home = new Vector3(world.nodes.fettle[0], 0, world.nodes.fettle[1]);
    const fit = stationCamera(world, 'fettle', home, bounds, PHONE, inset);
    const cam = cameraFor(fit, PHONE, inset);
    let right = -Infinity;
    for (let c = 0; c < 8; c++) {
      const p = new Vector3(c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]).add(home);
      const s = toScreen(p, cam, PHONE);
      expect(inside(s, rect), `corner ${c} at ${s.x.toFixed(1)}, ${s.y.toFixed(1)}`).toBe(true);
      expect(s.y).toBeLessThan(PHONE.height - inset.bottom); // above the sheet
      right = Math.max(right, s.x);
    }
    // And the label has its room to the model's right, inside the visible area.
    expect(right + tuning.stationLabelPx).toBeLessThanOrEqual(rect.x + rect.width + EPS);
  });

  test('at 1440×900 with the side panel a station comes closer than authored, to about stationFill of the visible height', () => {
    const inset = panelInsetFor(1440, 900, 'open');
    const rect = visibleRect(DESKTOP, inset);
    const bounds = MODEL_BOUNDS.fettle!;
    const home = new Vector3(world.nodes[SHARED][0], 0, world.nodes[SHARED][1]);
    const fit = stationCamera(world, SHARED, home, bounds, DESKTOP, inset);
    expect(fit.s).toBeLessThan(1);
    expect(fit.s).toBeGreaterThanOrEqual(tuning.stationSideMinScale);
    const cam = cameraFor(fit, DESKTOP, inset);
    let top = Infinity;
    let bottom = -Infinity;
    let right = -Infinity;
    for (let c = 0; c < 8; c++) {
      const p = new Vector3(c & 1 ? bounds.max.x : bounds.min.x, c & 2 ? bounds.max.y : bounds.min.y, c & 4 ? bounds.max.z : bounds.min.z).add(home);
      const s = toScreen(p, cam, DESKTOP);
      expect(inside(s, rect), `corner ${c} at ${s.x.toFixed(1)}, ${s.y.toFixed(1)}`).toBe(true); // nothing cropped
      top = Math.min(top, s.y);
      bottom = Math.max(bottom, s.y);
      right = Math.max(right, s.x);
    }
    // The model spans about stationFill of the visible height (about a third at s 1), never more;
    // a little less here, where the capsule-side margin stops it first.
    const share = (bottom - top) / rect.height;
    expect(share).toBeLessThanOrEqual(tuning.stationFill + 1e-3);
    expect(share).toBeGreaterThan(tuning.stationFill - 0.05);
    expect(right + tuning.stationLabelPx).toBeLessThanOrEqual(rect.x + rect.width + EPS);
  });

  test('on the bottom-sheet layout a station stays at s ≥ 1, as before the side-panel rule', () => {
    const home = new Vector3(world.nodes[SHARED][0], 0, world.nodes[SHARED][1]);
    const bounds = MODEL_BOUNDS.fettle!;
    const st = world.cameras.station;
    const cam = { position: st.position.map((v, i) => v + home.getComponent(i)), target: st.target.map((v, i) => v + home.getComponent(i)), fovY: st.fovY };
    const points = Array.from({ length: 8 }, (_, c) =>
      new Vector3(c & 1 ? bounds.max.x : bounds.min.x, c & 2 ? bounds.max.y : bounds.min.y, c & 4 ? bounds.max.z : bounds.min.z).add(home),
    );
    for (const vp of [PHONE, { width: 899, height: 900 }, { width: 800, height: 1200 }]) {
      const inset = panelInsetFor(vp.width, vp.height, 'open');
      const fit = stationCamera(world, SHARED, home, bounds, vp, inset, 0);
      expect(fit.s, `${vp.width}×${vp.height}`).toBeGreaterThanOrEqual(tuning.stationMinScale);
      expect(fit.s).toBe(fitScale(cam, points, vp, inset, tuning.stationMargin, { labelPx: 0, minScale: tuning.stationMinScale }));
    }
  });

  test("fitting never changes the camera's direction, target or fovY", async () => {
    const dir = (p: Pose | { position: Vector3; target: Vector3 }) => p.position.clone().sub(p.target).normalize();
    const b = await glbBounds(FETTLE_GLB);
    const bounds = new Box3(new Vector3(...b.min), new Vector3(...b.max));
    const home = new Vector3(world.nodes[SHARED][0], 0, world.nodes[SHARED][1]);
    for (const [vp, w, h] of [
      [DESKTOP, 1440, 900],
      [PHONE, 390, 844],
      [{ width: 800, height: 1200 }, 800, 1200],
      [{ width: 2560, height: 1080 }, 2560, 1080],
    ] as const) {
      for (const sheet of ['peek', 'open'] as const) {
        const inset = panelInsetFor(w, h, sheet);
        const o = overviewCamera(world, vp, inset);
        const cam = world.cameras[o.camera];
        const authored = { position: new Vector3(...cam.position), target: new Vector3(...cam.target) };
        expect(o.target.toArray()).toEqual(cam.target);
        expect(o.fovY).toBe(cam.fovY);
        expect(dir(o).distanceTo(dir(authored))).toBeLessThan(1e-12);

        const st = stationCamera(world, SHARED, home, bounds, vp, inset);
        const sc = world.cameras.station;
        const sAuthored = {
          position: new Vector3(...sc.position).add(home),
          target: new Vector3(...sc.target).add(home),
        };
        expect(st.target.distanceTo(sAuthored.target)).toBeLessThan(1e-12);
        expect(st.fovY).toBe(sc.fovY);
        expect(dir(st).distanceTo(dir(sAuthored))).toBeLessThan(1e-12);
      }
    }
    // And the scale itself only ever moves the camera along its line.
    const pts = groundPoints();
    const s = fitScale(world.cameras.overview, pts, DESKTOP, panelInsetFor(1440, 900, 'peek'));
    const p = fittedPose(world.cameras.overview, s);
    expect(p.target.toArray()).toEqual(world.cameras.overview.target);
    expect(p.fovY).toBe(world.cameras.overview.fovY);
  });

  // A node's own station camera (world.blend's cam_station_<id>, world.json's station_<id>), for
  // a station that wants another view: it frames that node, and every other node keeps station.
  describe('a station_<id> camera', () => {
    const own = { position: [-3.1, 1.8, 2.6], target: [0.1, 0.3, -0.2], fovY: 30 };
    const withOwn = { ...world, cameras: { ...world.cameras, station_idiff: own } };
    const inset = panelInsetFor(1440, 900, 'open');
    const at = (id: keyof typeof world.nodes) => new Vector3(world.nodes[id][0], 0, world.nodes[id][1]);
    /** The camera's line of sight, from the target out, and its target, less the node's home. */
    const offset = (p: Pose, home: Vector3) => ({
      dir: p.position.clone().sub(p.target).normalize(),
      target: p.target.clone().sub(home),
    });
    const line = (cam: { position: readonly number[]; target: readonly number[] }) =>
      new Vector3(...(cam.position as [number, number, number])).sub(new Vector3(...(cam.target as [number, number, number]))).normalize();

    test('frames its own node', () => {
      const home = at('idiff');
      const got = offset(stationCamera(withOwn, 'idiff', home, BOX_BOUNDS, DESKTOP, inset), home);
      expect(got.target.distanceTo(new Vector3(...own.target))).toBeLessThan(1e-12);
      expect(got.dir.distanceTo(line(own))).toBeLessThan(1e-12);
    });

    test('leaves every other node on the shared station camera', () => {
      // The origin, and a node world.json doesn't know yet (a new project), at fettle's spot.
      for (const id of [SHARED, 'a-new-project'] as const) {
        const home = id === SHARED ? at(id) : at('fettle');
        const got = stationCamera(withOwn, id, home, BOX_BOUNDS, DESKTOP, inset);
        expect(got).toEqual(stationCamera(world, id, home, BOX_BOUNDS, DESKTOP, inset));
        const o = offset(got, home);
        expect(o.target.distanceTo(new Vector3(...world.cameras.station.target))).toBeLessThan(1e-12);
        expect(o.dir.distanceTo(line(world.cameras.station))).toBeLessThan(1e-12);
      }
    });
  });

  test.each([
    ['arrival', PHONE, 'peek'],
    ['arrival', DESKTOP, 'peek'],
    ['arrival_portrait', PHONE, 'peek'],
  ] as const)("the scaled arrival clip's last frame equals the fitted overview pose (%s at %o)", async (clip, vp, sheet) => {
    const inset = panelInsetFor(vp.width, vp.height, sheet);
    const fit = overviewCamera(world, vp, inset);
    const end = clip === 'arrival' ? 'overview' : 'overviewPortrait';
    const s = fit.camera === end ? fit.s : fitScale(world.cameras[end], groundPoints(), vp, inset, tuning.fitMargin, { minScale: 1 });
    const pose = fittedPose(world.cameras[end], s);
    const target = new Vector3(...world.cameras[end].target);
    const c = await cameraClip(WORLD_GLB, clip);
    const frames = c.positions.map((p) => scaleArrivalFrame(new Vector3(...p), target, s));
    // Every frame keeps its place on the authored line from the target, s times as far.
    c.positions.forEach((p, i) => {
      const authored = new Vector3(...p).sub(target);
      expect(frames[i]!.clone().sub(target).distanceTo(authored.multiplyScalar(s))).toBeLessThan(1e-9);
    });
    expect(frames.at(-1)!.distanceTo(pose.position)).toBeLessThan(1e-3); // the clip's own float32 samples
  });
});
