import { describe, expect, test } from 'vitest';
import { Color, type InterleavedBufferAttribute, type Object3D, Scene, Vector2, Vector3 } from 'three';
import type { Line2 } from '../../src/vendor/lines/Line2.js';
import { LineMaterial } from '../../src/vendor/lines/LineMaterial.js';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import world from '../../src/data/world.json' with { type: 'json' };
import { withCluster } from '../../src/data/cluster';
import { parseFeed } from '../../src/data/feed';
import { layout } from '../../src/data/layout';
import type { Viewport } from '../../src/stage/stage';
import { THEME_TOKENS, type Theme } from '../../src/stage/theme';
import { tuning } from '../../src/tuning';
import { createLinks, type LinkStage } from '../../src/world/links';

/** The homelab cluster's tree (world.json's linkFrom, the real wiring since 2026-10-21), and its hubs. */
const TREE: Record<string, string> = world.linkFrom;
const HUBS = ['homelab', 'switch', 'ap'];

type Line = Line2 & { material: LineMaterial };
/** A line's drawn points in world space: each drawn segment's start, and the last one's end. */
function drawn(o: Line): Vector3[] {
  o.updateMatrixWorld();
  const a = (o.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute).data.array;
  const n = Math.min(o.geometry.instanceCount, a.length / 6);
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i++) pts.push(new Vector3(a[6 * i], a[6 * i + 1], a[6 * i + 2]).applyMatrix4(o.matrixWorld));
  if (n > 0) pts.push(new Vector3(a[6 * n - 3], a[6 * n - 2], a[6 * n - 1]).applyMatrix4(o.matrixWorld));
  return pts;
}

const light = {
  bg: '#f4f4f5', ink: '#18181b', soft: '#52525b', edge: '#a1a1aa', faint: '#d4d4d8', ghost: '#e4e4e6', acc: '#3651d4',
  model: '#e4e4e7', detail: '#3f3f46', paper: '#fafafa', lamp: '#27272a', shadow: '#18181b',
};
const theme = Object.fromEntries(THEME_TOKENS.map((t) => [t, new Color(light[t])])) as unknown as Theme;

/** Just enough stage for the links: a scene, the theme, and resize callbacks to fire by hand. */
function stubStage(v: Viewport) {
  let viewport = v;
  const resized = new Set<(v: Viewport) => void>();
  const stage: LinkStage = {
    scene: new Scene(),
    theme,
    get viewport() {
      return viewport;
    },
    // WebGLRenderer's drawing buffer: the CSS size times the pixel ratio, floored.
    renderer: {
      getDrawingBufferSize: (target: Vector2) =>
        target.set(Math.floor(viewport.width * viewport.pixelRatio), Math.floor(viewport.height * viewport.pixelRatio)),
    },
    onResize(cb) {
      resized.add(cb);
      return () => void resized.delete(cb);
    },
    onTheme: () => () => {},
  };
  const resize = (next: Viewport) => {
    viewport = next;
    for (const cb of resized) cb(next);
  };
  return { stage, resize };
}

const clock = { add: () => () => {}, invalidate: () => {} };

/** Runs `make` with tuning.turnaroundDrawn set to `drawn`. */
function drawnAs<T>(drawn: boolean, make: () => T): T {
  const t = tuning as { turnaroundDrawn: boolean };
  const was = t.turnaroundDrawn;
  t.turnaroundDrawn = drawn;
  try {
    return make();
  } finally {
    t.turnaroundDrawn = was;
  }
}

describe('links', () => {
  test('link materials are LineMaterial, and their linewidth and resolution follow the pixel ratio after a resize', () => {
    const { stage, resize } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
    const feed = parseFeed(fixture);
    createLinks(stage, layout(feed, world), world, clock);

    const lines: Object3D[] = [];
    stage.scene.traverse((o) => {
      if ((o as { isLine2?: boolean }).isLine2 || o.type === 'Line' || o.type === 'LineLoop' || o.type === 'LineSegments') {
        lines.push(o);
      }
    });
    // Every link, ground ring, mast, range ring and the turnaround's two halves is a Line2: never
    // THREE.Line, which is stuck at one device pixel.
    const nodes = feed.nodes.length;
    expect(lines.length).toBe(nodes - 1 + nodes + nodes + tuning.rangeRings.length + 2);
    const materials = lines.map((o) => (o as unknown as { material: unknown }).material);
    for (const [i, o] of lines.entries()) {
      expect((o as { isLine2?: boolean }).isLine2, o.name).toBe(true);
      expect(materials[i], o.name).toBeInstanceOf(LineMaterial);
    }
    const check = (width: number, height: number, alphaToCoverage: boolean) => {
      for (const m of materials as LineMaterial[]) {
        expect(m.linewidth).toBeCloseTo(tuning.hairline * stage.viewport.pixelRatio, 9);
        expect(m.resolution.toArray()).toEqual([width, height]);
        expect(m.worldUnits).toBe(false);
        expect(m.alphaToCoverage).toBe(alphaToCoverage);
      }
    };
    check(1440, 900, false);

    resize({ width: 1440, height: 900, pixelRatio: 2, tier: 'high' });
    check(2880, 1800, false);

    resize({ width: 390, height: 844, pixelRatio: 1.5, tier: 'high' });
    check(585, 1266, false);

    // A tier drop lowers the pixel ratio and leans on alpha-to-coverage for smooth edges.
    resize({ width: 390, height: 844, pixelRatio: 1, tier: 'low' });
    check(390, 844, true);
  });

  // Signals ride the link as it's drawn, so a pulled link carries them to the lifted model
  // (motion audit #9), and at rest they ride Blender's curve exactly.
  test('livePoint follows a pulled link to its new end, and the curve itself at rest', () => {
    const { stage } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
    const feed = parseFeed(fixture);
    const positions = layout(feed, world);
    const links = createLinks(stage, positions, world, clock);
    const curve = links.curve('idiff');
    const p = new Vector3();
    for (const u of [0, 0.25, 0.5, 1]) {
      expect(links.livePoint('idiff', u, p).distanceTo(curve.getPointAt(u)), `rest at ${u}`).toBeLessThan(1e-9);
    }
    const pulled = positions.get('idiff')!.clone().add(new Vector3(1.2, 0.6, -0.8));
    links.setEnd('idiff', pulled);
    // The end stays on top of its mast, over the pulled model; the hub end on the origin's.
    const mast = new Vector3(0, tuning.linkMast, 0);
    expect(links.livePoint('idiff', 1, p).distanceTo(pulled.clone().add(mast))).toBeLessThan(1e-6);
    expect(links.livePoint('idiff', 0, p).distanceTo(positions.get('origin')!.clone().add(mast))).toBeLessThan(1e-6);
    // In between it's off the rest curve, towards the pull, and continuous.
    expect(links.livePoint('idiff', 0.75, p).distanceTo(curve.getPointAt(0.75))).toBeGreaterThan(0.3);
    const a = links.livePoint('idiff', 0.5, new Vector3());
    const b = links.livePoint('idiff', 0.5 + 1e-4, new Vector3());
    expect(a.distanceTo(b)).toBeLessThan(0.01);
    links.setEnd('idiff', null);
    expect(links.livePoint('idiff', 0.75, p).distanceTo(curve.getPointAt(0.75))).toBeLessThan(1e-9);
  });

  // Each link's ends sit on masts: a post from the floor at its node's centre (and one at the
  // hub) to tuning.linkMast. A node's shows once its link has landed, goes with a pulled model,
  // and follows its link's power like the ground ring (not hover or the route).
  test('masts: floor to linkMast at each node, shown once the link lands, carried by a pull, faded when off', () => {
    const { stage } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
    const positions = layout(parseFeed(fixture), world);
    let fade: ((dt: number) => unknown) | null = null;
    const run: Parameters<typeof createLinks>[3] = { add: (tick) => ((fade = (dt) => tick(dt, 0)), () => void (fade = null)), invalidate: () => {} };
    const links = createLinks(stage, positions, world, run);
    type Mast = Line2 & { material: LineMaterial };
    const mastOf = (id: string) => stage.scene.getObjectByName(`mast:${id}`) as Mast;
    const ends = (id: string) => {
      const o = mastOf(id);
      o.updateMatrixWorld();
      const a = (o.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute).data.array;
      return [new Vector3(a[0], a[1], a[2]).applyMatrix4(o.matrixWorld), new Vector3(a[3], a[4], a[5]).applyMatrix4(o.matrixWorld)] as const;
    };
    for (const [id, home] of positions) {
      const [foot, top] = ends(id);
      expect(foot.distanceTo(home), id).toBeLessThan(1e-6);
      expect(top.distanceTo(home.clone().setY(tuning.linkMast)), id).toBeLessThan(1e-6);
      if (id !== 'origin') expect(top.distanceTo(links.curve(id).getPointAt(1)), `${id}: its link ends on it`).toBeLessThan(1e-3);
    }
    expect(ends('origin')[1].distanceTo(links.curve('idiff').getPointAt(0)), 'the links leave the hub from its top').toBeLessThan(1e-3);

    links.drawProgress('idiff', 0.5);
    expect(mastOf('idiff').visible).toBe(false);
    expect(mastOf('origin').visible).toBe(true);
    links.drawProgress('idiff', 1);
    expect(mastOf('idiff').visible).toBe(true);

    links.setEnd('idiff', positions.get('idiff')!.clone().add(new Vector3(1.2, 0.6, -0.8)));
    expect(ends('idiff')[1].distanceTo(links.livePoint('idiff', 1, new Vector3()))).toBeLessThan(1e-6);
    links.setEnd('idiff', null);
    expect(ends('idiff')[0].distanceTo(positions.get('idiff')!)).toBeLessThan(1e-6);

    const settle = () => {
      for (let i = 0; i < 10 && fade; i++) fade(1);
    };
    links.emphasize('idiff');
    links.setRoute('idiff');
    settle();
    expect(mastOf('idiff').material.color.getHexString(), 'hovered, on the route').toBe(theme.edge.getHexString());
    links.setLit('idiff', false);
    settle();
    expect(mastOf('idiff').material.color.getHexString(), 'off').toBe(theme.ghost.getHexString());
    expect(mastOf('origin').material.color.getHexString(), 'the hub').toBe(theme.edge.getHexString());
  });

  // The turnaround: the gondola rounds the hub on a ring visitorDock out at mast height, where
  // every link is level, so it never rides through the origin's model.
  test('the turnaround: a ring visitorDock round the hub at linkMast, where every link crosses it level, drawn out as the first link reaches it', () =>
    drawnAs(true, () => {
      const { stage } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
      const positions = layout(parseFeed(fixture), world);
      const links = createLinks(stage, positions, world, clock);
      const { centre, radius } = links.turnaround;
      const origin = positions.get('origin')!;
      expect(centre.distanceTo(origin.clone().setY(origin.y + tuning.linkMast))).toBeLessThan(1e-9);
      expect(radius).toBe(tuning.visitorDock);
      const ids = [...positions.keys()].filter((id) => id !== 'origin');
      for (const id of ids) {
        const c = links.curve(id);
        const d = links.turnaround.crossing(id);
        const p = c.getPointAt(d / c.getLength());
        expect(Math.hypot(p.x - centre.x, p.z - centre.z), id).toBeCloseTo(radius, 5);
        // The authored links (an unplaced id gets the runtime's plain arc, rising from the hub).
        if (!(id in world.links)) continue;
        expect(d, `${id}: straight out of the hub`).toBeCloseTo(radius, 4);
        expect(p.y, `${id}: at mast height`).toBeCloseTo(centre.y, 4);
      }
      const halves = [0, 1].map((i) => stage.scene.getObjectByName(`turnaround:${i}`) as Line);
      for (const h of halves) {
        expect(h.material.color.getHexString()).toBe(theme.edge.getHexString());
        for (const p of drawn(h)) {
          expect(Math.hypot(p.x - centre.x, p.z - centre.z)).toBeCloseTo(radius, 6);
          expect(p.y).toBeCloseTo(centre.y, 9);
        }
      }
      // The arrival: nothing drawn, then one link out past the ring draws both halves from its
      // crossing, one each way, as far round as the link has run past it.
      for (const id of ids) links.drawProgress(id, 0);
      expect(halves.every((h) => !h.visible)).toBe(true);
      const c = links.curve('notary');
      const L = c.getLength();
      links.drawProgress('notary', (links.turnaround.crossing('notary') + 0.5) / L);
      const cross = c.getPointAt(links.turnaround.crossing('notary') / L);
      for (const h of halves) {
        expect(h.visible).toBe(true);
        const pts = drawn(h);
        expect(pts[0]!.distanceTo(cross), 'from its crossing').toBeLessThan(1e-3);
        const run = pts.slice(1).reduce((s, p, i) => s + p.distanceTo(pts[i]!), 0);
        expect(run).toBeGreaterThan(0.4);
        expect(run).toBeLessThan(0.6);
      }
      const sides = halves.map((h) => drawn(h).at(-1)!.sub(cross));
      expect(sides[0]!.dot(sides[1]!), 'one each way').toBeLessThan(0);
      for (const id of ids) links.drawProgress(id, 1);
      for (const h of halves) expect(drawn(h).length).toBe(33);
    }));

  // The owner's test notes: drawn, the ring read as a second ground ring. It isn't
  // drawn (tuning.turnaroundDrawn false), at rest or as the links draw: the arrival, the power
  // switch and the RCD trip (drawProgress and setLit) never bring it back.
  test('the turnaround rings are never drawn: not at rest, the arrival, or power off and on', () => {
    const { stage } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
    const positions = layout(withCluster(parseFeed(fixture), world), world);
    const links = drawnAs(false, () => createLinks(stage, positions, world, clock));
    // The origin's, and one round every hub of the cluster's tree.
    const names = ['turnaround:0', 'turnaround:1', ...HUBS.flatMap((h) => [`turnaround:${h}:0`, `turnaround:${h}:1`])];
    const hidden = () => names.every((n) => stage.scene.getObjectByName(n)!.visible === false);
    expect(hidden(), 'at rest').toBe(true);
    const ids = [...positions.keys()].filter((n) => n !== 'origin');
    drawnAs(false, () => {
      for (const id of ids) links.drawProgress(id, 0);
      for (const id of ids) links.drawProgress(id, 0.5);
      expect(hidden(), 'drawing out').toBe(true);
      for (const id of ids) links.setLit(id, false);
      for (const id of ids) links.drawProgress(id, 1);
      for (const id of ids) links.setLit(id, true);
    });
    expect(hidden(), 'drawn back').toBe(true);
    // The gondola still rides them: the rings and their crossings are there.
    expect(links.turnaroundAt('switch')!.crossing('desktop')).toBeCloseTo(tuning.visitorDock, 1);
    expect(links.turnaroundAt('ap')!.crossing('laptop')).toBeCloseTo(tuning.visitorDock, 1);
  });

  // The homelab cluster (Batch B), wired as in reality since 2026-10-21: a tree, router → switch →
  // desktop / server / AP, AP → laptop. Each sub-link leaves its parent's mast top, every hub has
  // a turnaround of its own that its link and its sub-links cross level, drawn out as the hub's
  // own link reaches it, and a pulled hub carries its sub-links' starts.
  test("the cluster's tree: each sub-link leaves its hub, which has its own turnaround, drawn as its link comes in; a pull bends them", () =>
    drawnAs(true, () => {
      const { stage } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
      const positions = layout(withCluster(parseFeed(fixture), world), world);
      const links = createLinks(stage, positions, world, clock);
      const top = (id: string) => positions.get(id)!.clone().setY(tuning.linkMast);
      for (const [id, hub] of Object.entries(TREE)) {
        expect(links.parent(id)).toBe(hub);
        expect(links.curve(id).getPointAt(0).distanceTo(top(hub)), `${id} leaves ${hub}'s mast top`).toBeLessThan(1e-3);
        expect(links.curve(id).getPointAt(1).distanceTo(top(id)), `${id} ends on its own`).toBeLessThan(1e-3);
      }
      expect(links.parent('homelab')).toBe('origin');
      expect(links.turnaround.ids).not.toContain('switch');
      expect(links.turnaroundAt('fettle')).toBeNull();
      expect(links.turnaroundAt('desktop')).toBeNull(); // nothing hangs off it
      for (const hub of HUBS) {
        const ring = links.turnaroundAt(hub)!;
        expect(ring.hub).toBe(hub);
        expect(ring.centre.distanceTo(top(hub))).toBeLessThan(1e-9);
        const subs = Object.keys(TREE).filter((id) => TREE[id] === hub);
        expect([...ring.ids].sort(), hub).toEqual([...subs, hub].sort());
        for (const id of ring.ids) {
          const c = links.curve(id);
          const p = c.getPointAt(ring.crossing(id) / c.getLength());
          expect(Math.hypot(p.x - ring.centre.x, p.z - ring.centre.z), `${hub}: ${id}`).toBeCloseTo(ring.radius, 4);
          expect(p.y, `${hub}: ${id} level there`).toBeCloseTo(tuning.linkMast, 3);
        }
        // The hub's own link meets it visitorDock short of its end.
        expect(links.curve(hub).getLength() - ring.crossing(hub), hub).toBeCloseTo(tuning.visitorDock, 3);
      }

      // The arrival: each hub's ring draws as its own link comes in past its crossing.
      for (const id of [...positions.keys()].filter((n) => n !== 'origin')) links.drawProgress(id, 0);
      for (const hub of HUBS) {
        const ring = links.turnaroundAt(hub)!;
        const halves = [0, 1].map((i) => stage.scene.getObjectByName(`turnaround:${hub}:${i}`) as Line);
        expect(halves.every((h) => !h.visible), hub).toBe(true);
        const L = links.curve(hub).getLength();
        links.drawProgress(hub, (ring.crossing(hub) + 0.3) / L);
        const cross = links.curve(hub).getPointAt(ring.crossing(hub) / L);
        for (const h of halves) {
          expect(h.visible, hub).toBe(true);
          expect(drawn(h)[0]!.distanceTo(cross), `${hub}: from its crossing`).toBeLessThan(1e-3);
        }
      }

      // Pulling a hub: its link's end and every sub-link's start stay on its mast's top, and the
      // links below them keep theirs.
      const p = new Vector3();
      for (const hub of HUBS) {
        const pulled = positions.get(hub)!.clone().add(new Vector3(0.4, 0.3, -0.2));
        links.setEnd(hub, pulled);
        const mast = pulled.clone().setY(pulled.y + tuning.linkMast);
        expect(links.livePoint(hub, 1, p).distanceTo(mast), hub).toBeLessThan(1e-6);
        for (const id of Object.keys(TREE)) {
          if (TREE[id] === hub) {
            expect(links.livePoint(id, 0, p).distanceTo(mast), `${hub}: ${id}`).toBeLessThan(1e-6);
            expect(links.livePoint(id, 1, p).distanceTo(links.curve(id).getPointAt(1)), `${id}: its own end stays`).toBeLessThan(1e-6);
          } else if (id !== hub) {
            expect(links.livePoint(id, 0.5, p).distanceTo(links.curve(id).getPointAt(0.5)), `${hub}: ${id} unmoved`).toBeLessThan(1e-9);
          }
        }
        links.setEnd(hub, null);
      }
      // Both ends pulled at once (the switch and the AP): each end follows its own node.
      const sw = positions.get('switch')!.clone().add(new Vector3(0.3, 0.2, 0));
      const ap = positions.get('ap')!.clone().add(new Vector3(0, 0.3, 0.2));
      links.setEnd('switch', sw);
      links.setEnd('ap', ap);
      expect(links.livePoint('ap', 0, p).distanceTo(sw.clone().setY(sw.y + tuning.linkMast))).toBeLessThan(1e-6);
      expect(links.livePoint('ap', 1, p).distanceTo(ap.clone().setY(ap.y + tuning.linkMast))).toBeLessThan(1e-6);
      expect(links.livePoint('laptop', 0, p).distanceTo(ap.clone().setY(ap.y + tuning.linkMast))).toBeLessThan(1e-6);
      links.setEnd('switch', null);
      links.setEnd('ap', null);
      for (const id of Object.keys(TREE)) expect(links.livePoint(id, 0.5, p).distanceTo(links.curve(id).getPointAt(0.5)), id).toBeLessThan(1e-9);
    }));

  // The laptop is on the AP's Wi-Fi (the owner's test notes, 2026-10-21): its link is drawn
  // dotted (world.json's `dotted`, from world.blend's curve), every cable a plain line, and it's
  // drawn out, dimmed and stopped at its model like any link.
  test('a link over the air is drawn dotted, tuning.linkDots apart along it, and is otherwise a link like any', () => {
    const { stage } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
    const positions = layout(withCluster(parseFeed(fixture), world), world);
    const links = createLinks(stage, positions, world, clock);
    expect(world.dotted).toEqual(['laptop']);
    for (const id of [...positions.keys()].filter((n) => n !== 'origin')) {
      const line = stage.scene.getObjectByName(`link:${id}`) as Line;
      const m = line.material as LineMaterial;
      expect(m.dashed, id).toBe(id === 'laptop');
      if (id !== 'laptop') continue;
      expect(m.dashSize).toBe(tuning.linkDots.on);
      expect(m.gapSize).toBe(tuning.linkDots.off);
      // The dashes are measured along it from the AP's end, to its whole length.
      const d = (line.geometry.getAttribute('instanceDistanceEnd') as InterleavedBufferAttribute).data.array;
      expect(d[0]).toBe(0);
      expect(d.at(-1)!).toBeCloseTo(links.curve(id).getLength(), 2);
      // Dotted at the overview's scale: a dash about 2 px and a gap about 3 (the overview is
      // about 40 units from its target at 30 degrees on 900 px: some 42 px a unit there).
      const cam = world.cameras.overview;
      const far = Math.hypot(...cam.position.map((v, i) => v - cam.target[i]!));
      const pxPerUnit = 900 / (2 * far * Math.tan((15 * Math.PI) / 180));
      expect(tuning.linkDots.on * pxPerUnit).toBeGreaterThan(1.5);
      expect(tuning.linkDots.off * pxPerUnit).toBeLessThan(4);
      // Still a link: it draws out, dims with the power and stops at its model's edge, dashed.
      links.drawProgress(id, 0.5);
      expect(line.geometry.instanceCount).toBe(32);
      links.drawProgress(id, 1);
      links.setLit(id, false);
      expect(links.isLit(id)).toBe(false);
      links.setLit(id, true);
      links.setFootprint(id, 0.3);
      expect(m.dashed).toBe(true);
      expect(m.vertexColors).toBe(true);
    }
  });

  // A model's footprint (checkpoint 4 B/C defect 3): the mast stood in a model lower than it
  // and the line ran over the model to its top. Open models (eolietech's wire rack) give a
  // circle; every other model its bounds on the floor (map.ts).
  test("setFootprint: the link stops where it enters the model's footprint and its mast hides, lifted and pulled too", () => {
    const { stage } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
    const positions = layout(parseFeed(fixture), world);
    const links = createLinks(stage, positions, world, clock);
    const id = 'eolietech';
    const home = positions.get(id)!;
    const link = stage.scene.getObjectByName(`link:${id}`) as Line;
    const mast = stage.scene.getObjectByName(`mast:${id}`) as Line;
    const out = (p: Vector3, c = home) => Math.hypot(p.x - c.x, p.z - c.z);
    links.setFootprint(id, 0.3);
    let pts = drawn(link);
    expect(out(pts.at(-1)!), 'its end on the footprint').toBeCloseTo(0.3, 4);
    expect(pts.at(-1)!.y).toBeCloseTo(tuning.linkMast, 4);
    for (const p of pts) expect(out(p)).toBeGreaterThan(0.3 - 1e-4);
    expect(pts[0]!.distanceTo(links.curve(id).getPointAt(0))).toBeLessThan(1e-6);
    expect(mast.visible).toBe(false);
    // Riders keep the whole curve: traffic and the gondola ride it, not the drawing.
    expect(links.livePoint(id, 1, new Vector3()).distanceTo(links.curve(id).getPointAt(1))).toBeLessThan(1e-9);
    // The arrival draws it out to the footprint, never past it.
    links.drawProgress(id, 0.5);
    expect(mast.visible).toBe(false);
    links.drawProgress(id, 1);
    expect(out(drawn(link).at(-1)!)).toBeCloseTo(0.3, 4);
    // Lifted (a hover): still stopped at the edge, which rises with the model; no mast.
    const lifted = home.clone().add(new Vector3(0, 0.12, 0));
    links.setEnd(id, lifted);
    expect(mast.visible).toBe(false);
    pts = drawn(link);
    expect(out(pts.at(-1)!)).toBeCloseTo(0.3, 3);
    expect(pts.at(-1)!.y).toBeGreaterThan(tuning.linkMast + 0.11);
    // Riders still reach the mast's top over the lifted model.
    expect(links.livePoint(id, 1, new Vector3()).distanceTo(lifted.clone().setY(lifted.y + tuning.linkMast))).toBeLessThan(1e-6);
    // Pulled across the floor: the stopped end goes with the model.
    const pulled = home.clone().add(new Vector3(0.5, 0.12, -0.3));
    links.setEnd(id, pulled);
    expect(mast.visible).toBe(false);
    expect(out(drawn(link).at(-1)!, pulled)).toBeCloseTo(0.3, 1);
    links.setEnd(id, null);
    expect(mast.visible).toBe(false);
    expect(out(drawn(link).at(-1)!)).toBeCloseTo(0.3, 4);
    links.setFootprint(id, null);
    expect(mast.visible).toBe(true);
    expect(drawn(link).at(-1)!.distanceTo(links.curve(id).getPointAt(1))).toBeLessThan(1e-6);
  });

  test("setFootprint: a model's bounds on the floor stop its link at their edge; the origin and a hub keep theirs", () => {
    const { stage } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
    const positions = layout(withCluster(parseFeed(fixture), world), world);
    const links = createLinks(stage, positions, world, clock);
    for (const id of ['desktop', 'laptop']) {
      const home = positions.get(id)!;
      const link = stage.scene.getObjectByName(`link:${id}`) as Line;
      // A box 0.5 by 0.8 on the floor, off centre like a laptop's screen.
      const box = (p: Vector3) => Math.max(Math.abs(p.x - home.x - 0.05) / 0.25, Math.abs(p.z - home.z + 0.1) / 0.4);
      links.setFootprint(id, (p) => box(p) <= 1);
      const pts = drawn(link);
      expect(box(pts.at(-1)!), `${id}: its end on the box's edge`).toBeCloseTo(1, 3);
      for (const p of pts) expect(box(p), id).toBeGreaterThan(1 - 1e-3);
      expect((stage.scene.getObjectByName(`mast:${id}`) as Line).visible, id).toBe(false);
      // The gondola docks visitorDock out, on the part that's drawn.
      const dock = links.curve(id).getPointAt(1 - tuning.visitorDock / links.curve(id).getLength());
      expect(box(dock), `${id}: the dock is outside the box`).toBeGreaterThan(1);
    }
    // Every hub of the tree keeps its mast and its whole link: other links leave its mast's top.
    for (const id of ['origin', ...HUBS]) {
      links.setFootprint(id, 0.5);
      expect((stage.scene.getObjectByName(`mast:${id}`) as Line).visible, id).toBe(true);
    }
    for (const id of HUBS) {
      const hub = stage.scene.getObjectByName(`link:${id}`) as Line;
      expect(drawn(hub).at(-1)!.distanceTo(links.curve(id).getPointAt(1)), id).toBeLessThan(1e-6);
    }
  });

  // Line ends (a) fade (the owner's pick, 2026-10-21 night): a stopped link fades out
  // over its last tuning.linkEndFade before the model's edge instead of ending in mid-air.
  test('setFootprint: a stopped link fades out over its last linkEndFade, pulled too; whole again, no fade', () => {
    const { stage } = stubStage({ width: 1440, height: 900, pixelRatio: 1, tier: 'high' });
    const positions = layout(parseFeed(fixture), world);
    const links = createLinks(stage, positions, world, clock);
    const id = 'eolietech';
    const home = positions.get(id)!;
    const link = stage.scene.getObjectByName(`link:${id}`) as Line;
    const L = links.curve(id).getLength();
    /** Each drawn point's alpha (the vertex colour's red), as drawn() gives the points. */
    const alphas = () => {
      const a = (link.geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data.array;
      const n = link.geometry.instanceCount;
      return [...Array.from({ length: n }, (_, i) => a[6 * i]!), a[6 * n - 3]!];
    };
    links.setFootprint(id, 0.3);
    expect(link.material.vertexColors && link.material.transparent).toBe(true);
    expect(link.material.fragmentShader).toContain('alpha *= vColor.r;');
    expect(link.material.fragmentShader).not.toContain('#include <color_fragment>');
    const check = (at: Vector3) => {
      const pts = drawn(link);
      const a = alphas();
      expect(a.at(-1), 'gone at the edge').toBe(0);
      // By length back along the link from its stopped end: whole before the stretch, then down.
      let back = 0;
      for (let i = pts.length - 1; i >= 0; i--) {
        if (i < pts.length - 1) back += pts[i]!.distanceTo(pts[i + 1]!);
        if (back > tuning.linkEndFade + 0.05) expect(a[i], `${i}: whole`).toBe(1);
        if (i > 0) expect(a[i - 1]!, `${i}: fading out toward the edge`).toBeGreaterThanOrEqual(a[i]!);
      }
      expect(a.filter((v) => v > 0 && v < 1).length, 'a few points on the way down').toBeGreaterThanOrEqual(3);
      expect(Math.hypot(pts.at(-1)!.x - at.x, pts.at(-1)!.z - at.z)).toBeCloseTo(0.3, 1);
    };
    check(home);
    expect(L).toBeGreaterThan(tuning.linkEndFade * 3);
    // A pull carries the fade with the stopped end: the alphas ride the segments.
    const pulled = home.clone().add(new Vector3(0.5, 0.12, -0.3));
    links.setEnd(id, pulled);
    check(pulled);
    links.setEnd(id, null);
    // Drawn whole again: nothing fades.
    links.setFootprint(id, null);
    expect(alphas().every((v) => v === 1)).toBe(true);
  });
});
