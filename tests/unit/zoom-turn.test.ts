// Turning while zoomed (the owner, 2026-10-22: "Right click rotation while zoomed is really buggy,
// the rotation happens as if you were never zoomed. While it should rotate the zoomed
// perspective"). Zoomed in or panned, a turn orbits the point at the centre of the view, at the
// same distance: the visitor keeps looking at the same spot from a new angle. Unzoomed and
// unpanned it turns about the network's middle with the gutters, exactly as before.
// The director itself, on a stub stage: its camera is what the screen shows.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDirector, type Director } from '../../src/camera/director';
import world from '../../src/data/world.json';
import { clampToHull, hullOf, scaleAbout } from '../../src/input/zoom';
import { HIDDEN } from '../../src/nav/stations';
import { tuning } from '../../src/tuning';
import { glbBounds } from './helpers/glb';

type Size = { width: number; height: number };
const DESKTOP: Size = { width: 1440, height: 900 };
const PHONE: Size = { width: 390, height: 844 };
const DEG = Math.PI / 180;

const positions = new Map(Object.entries(world.nodes).map(([id, [x, z]]) => [id, new Vector3(x, 0, z)]));
const MODELS = join(import.meta.dirname, '..', '..', 'public', 'models');
let bounds: Promise<Map<string, Box3>> | null = null;
/** Every node's model as nodes.ts measures it (its own GLB, or the placeholder box; no floor shadow). */
function runtimeBounds(): Promise<Map<string, Box3>> {
  bounds ??= Promise.all(
    [...positions.keys()].map(async (id) => {
      const file = existsSync(join(MODELS, `${id}.glb`)) ? id : 'box';
      const b = await glbBounds(join(MODELS, `${file}.glb`), ['shadow']);
      return [id, new Box3(new Vector3(...b.min), new Vector3(...b.max))] as const;
    }),
  ).then((e) => new Map(e));
  return bounds;
}

const off = () => () => undefined;

/** A director on a stub stage at `vp`, past its arrival (no clip: it starts at the end), in the overview, with the pan's clamp bound as zoom.ts binds it. */
async function overviewAt(vp: Size): Promise<{ director: Director; camera: PerspectiveCamera }> {
  const el = { setAttribute: off, removeAttribute: off, addEventListener: off, removeEventListener: off };
  vi.stubGlobal('document', { documentElement: el });
  vi.stubGlobal('window', { addEventListener: off, removeEventListener: off });
  const b = await runtimeBounds();
  const views = new Map(
    [...positions].map(([id, home]) => [id, { id, home, bounds: b.get(id)!, root: new Object3D(), ready: Promise.resolve(), showEndOfArrive: off, play: async () => undefined }]),
  );
  const camera = new PerspectiveCamera(40, vp.width / vp.height, 0.1, 200);
  const stage = { camera, scene: new Scene(), renderer: { compile: off, domElement: {} }, viewport: vp, onResize: () => off, setSheet: off };
  const ids = [...positions.keys()].filter((id) => !HIDDEN.includes(id));
  const director = createDirector(
    stage as never,
    { curve: () => { throw new Error('no travel here'); }, drawProgress: off, setRoute: off } as never,
    { get: (id: string) => views.get(id)!, all: () => [...views.values()], ready: Promise.resolve() } as never,
    { ids, current: null, subscribe: () => off } as never,
    { add: () => off, invalidate: off } as never,
    { world: world as never, positions, labels: { setStatus: off, room: () => 0 }, loadCamera: () => Promise.resolve(null) as never },
  );
  await director.ready;
  await director.arrived;
  let hull: ReturnType<typeof hullOf> | null = null;
  director.bound((t, points) => void clampToHull(t, (hull ??= hullOf(points)), tuning.pan.margin));
  expect(director.state).toBe('overview');
  return { director, camera };
}

/** What the screen shows: where the camera stands and what it looks at, and their distance. */
function view(d: Director, camera: PerspectiveCamera) {
  const look = d.look;
  const offset = camera.position.clone().sub(look);
  return { look, position: camera.position.clone(), offset, reach: offset.length(), yaw: Math.atan2(offset.x, offset.z) };
}

/** Radians from a to b, the short way. */
const between = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

afterEach(() => {
  vi.unstubAllGlobals();
});

for (const [name, vp] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  describe(`turning the overview at ${name}`, () => {
    test('zoomed 2x and panned onto homelab, a turn orbits the view centre: the same target and distance, only the angle moves', async () => {
      const { director, camera } = await overviewAt(vp);
      director.viewTo(0.5, positions.get('homelab')!.clone());
      const a = view(director, camera);
      expect(director.zoom).toBe(0.5);
      expect(a.look.distanceTo(positions.get('homelab')!)).toBeLessThan(1e-9);
      for (const steps of [-18, 9, 27]) {
        director.turnBy(steps); // 5° a step: to +90°, back to +45°, on round to −90°
        const b = view(director, camera);
        expect(b.look.distanceTo(a.look), `${steps} steps: target`).toBeLessThan(1e-6);
        expect(Math.abs(b.reach - a.reach), `${steps} steps: distance`).toBeLessThan(1e-6);
        expect(Math.abs(b.offset.y - a.offset.y), `${steps} steps: height`).toBeLessThan(1e-6);
        expect(Math.abs(between(a.yaw, b.yaw) - between(0, director.turn * DEG)), `${steps} steps: angle`).toBeLessThan(1e-6);
        expect(director.zoom).toBe(0.5);
      }
      // And all the way back, exactly where it was.
      director.turnBy(-18);
      expect(director.turn).toBe(0);
      expect(view(director, camera).position.distanceTo(a.position)).toBeLessThan(1e-6);
    });

    test('panned only (not zoomed), a turn orbits the view centre too', async () => {
      const { director, camera } = await overviewAt(vp);
      director.viewTo(1, positions.get('fettle')!.clone());
      const a = view(director, camera);
      director.turnBy(-12);
      const b = view(director, camera);
      expect(b.look.distanceTo(a.look)).toBeLessThan(1e-6);
      expect(Math.abs(between(a.yaw, b.yaw) - 60 * DEG)).toBeLessThan(1e-6);
    });

    test("unzoomed and unpanned it turns about the network's middle exactly as before: the turned framing, gutters and all", async () => {
      const { director, camera } = await overviewAt(vp);
      if (director.home.zoom < 1) director.viewTo(1, director.framing(null).target); // the phone starts closer: back to the composed overview
      expect(director.zoom).toBe(1);
      for (const steps of [-18, 9, 30, -21]) {
        director.turnBy(steps);
        const f = director.framing(null, director.turn * DEG);
        const b = view(director, camera);
        expect(b.look.distanceTo(f.target), `${director.turn}°`).toBeLessThan(1e-9);
        expect(b.position.distanceTo(f.position), `${director.turn}°`).toBeLessThan(1e-9);
      }
      expect(director.turn).toBe(0);
      expect(view(director, camera).position.distanceTo(director.framing(null).position)).toBeLessThan(1e-9);
    });

    test('between the two it never jumps: a hair zoomed turns almost as unzoomed, and every degree is a small step', async () => {
      const { director, camera } = await overviewAt(vp);
      const middle = director.framing(null).target;
      const turnedAt = (z: number) => {
        director.viewTo(z, middle.clone());
        const p: Vector3[] = [];
        for (let i = 0; i < 90; i++) {
          director.turnBy(-0.2); // 1° a step
          p.push(view(director, camera).position);
        }
        director.turnBy(18);
        return p;
      };
      const flat = turnedAt(1);
      const hair = turnedAt(0.9999);
      expect(flat.at(-1)!.distanceTo(hair.at(-1)!)).toBeLessThan(0.01);
      for (const z of [0.98, 0.9, 0.8, 0.5]) {
        const p = turnedAt(z);
        const reach = p[0]!.distanceTo(middle);
        for (let i = 1; i < p.length; i++) expect(p[i]!.distanceTo(p[i - 1]!), `zoom ${z}, ${i}°`).toBeLessThan(reach * 2 * DEG);
      }
    });

    test('turned, zooming about a floor point (zoom.ts) keeps it where it is on the screen, even where the turned fit pulled back', async () => {
      const { director, camera } = await overviewAt(vp);
      director.viewTo(1, director.framing(null).target);
      director.turnBy(-18);
      const about = positions.get('notary')!.clone();
      for (const [z, z2] of [
        [1, 0.95],
        [0.95, 0.85],
        [0.85, 0.6],
        [0.6, 0.9],
      ] as const) {
        director.viewTo(z, director.look);
        const sight = about.clone().sub(camera.position).normalize();
        const ahead = director.look.sub(camera.position).normalize();
        director.viewTo(z2, scaleAbout(director.look, about, director.distanceAt(z), director.distanceAt(z2)));
        expect(about.clone().sub(camera.position).normalize().distanceTo(sight), `${z} → ${z2}`).toBeLessThan(1e-9);
        expect(director.look.sub(camera.position).normalize().distanceTo(ahead), `${z} → ${z2}`).toBeLessThan(1e-9);
        expect(camera.position.distanceTo(director.look)).toBeCloseTo(director.distanceAt(z2), 9);
      }
    });

    test('at the edge of the pan clamp, a turn keeps the target inside it', async () => {
      const { director } = await overviewAt(vp);
      director.viewTo(0.4, new Vector3(-30, 0, 30)); // far off: the clamp holds it at the hull's edge
      const hull = hullOf([...positions].filter(([id]) => !HIDDEN.includes(id)).map(([, p]) => p));
      for (let i = 0; i < 36; i++) {
        director.turnBy(-2);
        const t = director.look;
        expect(clampToHull(t.clone(), hull, tuning.pan.margin + 1e-6).distanceTo(t)).toBeLessThan(1e-6);
      }
    });
  });
}
