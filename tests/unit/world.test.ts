import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { sha256File } from './helpers/glb';
import { BLENDER, BLENDER_SOURCES, ROOT, runBlender } from './helpers/blender';
import { HIDDEN, STATION_ORDER } from '../../src/nav/stations';
import { tuning } from '../../src/tuning';

type Vec3 = [number, number, number];
interface Camera {
  position: Vec3;
  target: Vec3;
  fovY: number;
  sensorFit: string;
}
interface Timing {
  clipLength: number;
  reach: Record<string, number>;
}
interface World {
  sourceHash: string;
  nodes: Record<string, [number, number]>;
  cameras: Record<string, Camera>;
  /** Each link's Bezier points, its parent's end first: [left handle xyz, point xyz, right handle xyz]. */
  links: Record<string, number[][]>;
  linkFrom?: Record<string, string>;
  dotted?: string[];
  arrival?: Timing & { portrait?: Timing };
}

// Task 6's floor plan, in Three.js space: [x, z].
const TABLE: Record<string, [number, number]> = {
  origin: [0, 0],
  fettle: [5.2, -2.6],
  idiff: [4.6, 3.4],
  notary: [-0.6, 5.6],
  'candygoogy-bot': [-5.4, 3.0],
  'dolci-eoliani': [-3.6, -4.8],
  'siel-eolie': [0.8, -6.0],
  eolietech: [5.0, -6.6],
  experiments: [-8.6, -0.8],
  homelab: [-5.2, 7.4],
  colophon: [3.6, 7.6],
  exit: [7.8, 4.2],
  // The homelab cluster (Batch B, option A) west of the hub, wired as in reality since
  // 2026-10-21 (layout R1); before, layout W2's arc, every device
  // on its own link from homelab.
  switch: [-6.55, 8.2],
  desktop: [-6.06, 9.8],
  server: [-8.05, 7.62],
  ap: [-6.8, 6.1],
  laptop: [-8.65, 5.76],
};
/** The node each cluster link leaves from, the real wiring's tree: router → switch → desktop,
 *  server, AP; AP → laptop (Wi-Fi). The rest leave the origin. */
const TREE: Record<string, string> = { switch: 'homelab', desktop: 'switch', server: 'switch', ap: 'switch', laptop: 'ap' };
const CLUSTER = Object.keys(TREE);
const parentOf = (id: string) => TREE[id] ?? 'origin';
const linkName = (id: string) => (parentOf(id) === 'origin' ? `link_${id}` : `link_${parentOf(id)}_${id}`);
const CAMERAS = ['overview', 'overviewPortrait', 'station', 'arrivalStart'];

const world = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'world.json'), 'utf8')) as World;

/** A link's cubics sampled as Blender draws them: `res` per segment from t = 0, then the last point. */
const sampled = (pts: number[][], res: number): Vec3[] => {
  const out: Vec3[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    for (let k = 0; k < res; k++) {
      const t = k / res;
      const w = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3] as const;
      out.push([0, 1, 2].map((c) => w[0] * a[3 + c]! + w[1] * a[6 + c]! + w[2] * b[c]! + w[3] * b[3 + c]!) as Vec3);
    }
  }
  const last = pts.at(-1)!;
  out.push([last[3]!, last[4]!, last[5]!]);
  return out;
};

const expectVec =(got: number[], want: number[]) => {
  expect(got).toHaveLength(want.length);
  want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 3));
};

describe('world.json', () => {
  test("has every id from Task 6's table and all its cameras", () => {
    expect(Object.keys(world.nodes)).toEqual(expect.arrayContaining(Object.keys(TABLE)));
    expect(Object.keys(world.cameras)).toEqual(expect.arrayContaining(CAMERAS));
  });

  test.skipIf(!BLENDER_SOURCES)("its sourceHash equals world.blend's current SHA-256", async () => {
    expect(world.sourceHash).toBe(await sha256File(join(ROOT, 'blender', 'world', 'world.blend')));
  });

  test('node positions round-trip through Blender in Three.js space', () => {
    for (const [id, xz] of Object.entries(TABLE)) expectVec(world.nodes[id]!, xz);
    // cam_overview as recomposed for the homelab cluster (2026-10-20) and again for its wide
    // layout W2 (2026-10-21): the same 3/4 direction as before, its target moved toward the
    // cluster, and further out, so all 17 nodes and their labels fit at 1440×900 with the 460px
    // panel.
    expectVec(world.cameras.overview!.position, [3.5444, 24.6431, 33.4027]);
    expectVec(world.cameras.overview!.target, [-0.0874, 0, 2.7771]);
    // The station camera is exported relative to a node at the origin.
    expectVec(world.cameras.station!.position, [2.2, 2.4, 4.2]);
    expectVec(world.cameras.station!.target, [0, 0.4, 0]);
    expectVec(world.cameras.arrivalStart!.position, [0, 34, 0.01]);
    expectVec(world.cameras.arrivalStart!.target, [0, 0, 0]);
  });

  // A conversion that's wrong the same way on creation and on export would round-trip
  // cleanly, so also look inside world.blend: Three.js (x, y, z) must be Blender (x, -z, y).
  test.skipIf(!BLENDER || !BLENDER_SOURCES)('world.blend holds the nodes, cameras and link curves in Blender (Z-up) space', () => {
    const expr = [
      'import bpy, json',
      'o = bpy.data.objects',
      'print("WORLD" + json.dumps({n: list(o[n].matrix_world.translation) for n in ("fettle", "eolietech", "cam_overview", "cam_overview.target")}))',
      // The link curves are Blender Bezier curves the owner can reshape, one per node.
      'print("LINKS" + json.dumps({o.name: [o.type, o.data.splines[0].type] for o in o if o.name.startswith("link_")}))',
      // Their points and hooks: (node, strength, the Bezier points it holds).
      'print("HOOKS" + json.dumps({o.name: [len(o.data.splines[0].bezier_points), [[m.object.name, m.strength, sorted({i // 3 for i in m.vertex_indices})] for m in o.modifiers]] for o in o if o.name.startswith("link_")}))',
      // Each curve as Blender draws it (hooks applied, resolution_u per segment), in Three.js
      // space (x, z, -y), to check world.json's Bezier points against.
      'dg = bpy.context.evaluated_depsgraph_get()',
      'def drawn(ob):',
      '    ev = ob.evaluated_get(dg); m = ev.to_mesh(); p = [ev.matrix_world @ v.co for v in m.vertices]; ev.to_mesh_clear()',
      '    return [ob.data.resolution_u, [[v.x, v.z, -v.y] for v in p]]',
      'print("DRAWN" + json.dumps({ob.name: drawn(ob) for ob in o if ob.name.startswith("link_") and ob.type == "CURVE"}))',
      // The curves marked `dotted` (over the air), as world.py's export reads them.
      'print("DOTTED" + json.dumps(sorted(ob.name for ob in o if ob.name.startswith("link_") and ob.get("dotted"))))',
    ].join('\n');
    const r = runBlender([join(ROOT, 'blender', 'world', 'world.blend'), '--python-expr', expr]);
    expect(r.code, r.output).toBe(0);
    const got = JSON.parse(/^WORLD(.*)$/m.exec(r.output)![1]!) as Record<string, number[]>;
    expectVec(got['fettle']!, [5.2, 2.6, 0]);
    expectVec(got['eolietech']!, [5.0, 6.6, 0]);
    expectVec(got['cam_overview']!, [3.5444, -33.4027, 24.6431]);
    expectVec(got['cam_overview.target']!, [-0.0874, -2.7771, 0]);
    const links = JSON.parse(/^LINKS(.*)$/m.exec(r.output)![1]!) as Record<string, string[]>;
    for (const id of Object.keys(TABLE).filter((n) => n !== 'origin')) {
      expect(links[linkName(id)], id).toEqual(['CURVE', 'BEZIER']);
    }
    // Level cable ends (2026-10-20): five points, each end and its shoulder on that end's
    // node, the top on both at half strength, so dragging a node carries its level run. A
    // cluster's links are hooked to their hub as the others are to the origin.
    const hooks = JSON.parse(/^HOOKS(.*)$/m.exec(r.output)![1]!) as Record<string, [number, [string, number, number[]][]]>;
    for (const id of Object.keys(TABLE).filter((n) => n !== 'origin')) {
      const [points, mods] = hooks[linkName(id)]!;
      const from = parentOf(id);
      expect(points, id).toBe(5);
      expect(mods.map(([n, s, p]) => [n, +s.toFixed(3), p]).sort(), id).toEqual(
        [[from, 1, [0, 1]], [id, 1, [3, 4]], [from, 0.5, [2]], [id, 0.5, [2]]].sort(),
      );
    }
    expect(JSON.parse(/^DOTTED(.*)$/m.exec(r.output)![1]!)).toEqual(['link_ap_laptop']);
    // The runtime's curve is Blender's: world.json's cubics, sampled as Blender samples its
    // curve, land on what Blender draws (to world.json's 4 decimals).
    const drawn = JSON.parse(/^DRAWN(.*)$/m.exec(r.output)![1]!) as Record<string, [number, Vec3[]]>;
    for (const id of Object.keys(world.links)) {
      const [ox, oz] = world.nodes[parentOf(id)]!;
      const [res, want] = drawn[linkName(id)]!;
      const out = (p: Vec3) => Math.hypot(p[0] - ox, p[2] - oz);
      if (out(want[0]!) > out(want.at(-1)!)) want.reverse(); // its parent's end first, as exported
      const got = sampled(world.links[id]!, res);
      expect(got.length, id).toBe(want.length);
      const off = Math.max(...got.map((p, i) => Math.hypot(p[0] - want[i]![0], p[1] - want[i]![1], p[2] - want[i]![2])));
      expect(off, id).toBeLessThan(2e-4);
    }
  });

  // world.py's constants (LINK_SHOULDER, SHORT_LINK, the tops) shape the links: read from blender/.
  test.skipIf(!BLENDER_SOURCES)("every non-origin node has a link: Bezier points from the top of its parent's mast (the origin's, or the cluster's hub's) to the top of its own, level at each end, arcing up between", () => {
    expect(world.links).toBeDefined();
    // linkFrom names the parent of every link that doesn't leave the origin, and only those.
    expect(world.linkFrom).toEqual(TREE);
    // The laptop's link is the AP's Wi-Fi, drawn dotted; every cable is a plain line.
    expect(world.dotted).toEqual(['laptop']);
    const py = readFileSync(join(ROOT, 'blender', 'world', 'world.py'), 'utf8');
    const value = (name: string) => Number(new RegExp(`^${name} = ([0-9.]+)`, 'm').exec(py)?.[1]);
    const shoulder = value('LINK_SHOULDER');
    expect(shoulder).toBeGreaterThanOrEqual(tuning.visitorDock + 0.15);
    for (const [id, [x, z]] of Object.entries(TABLE)) {
      if (id === 'origin') continue;
      const bez = world.links[id];
      expect(bez, id).toBeDefined();
      // Five as make_link shapes them (more if the owner adds some), each a point and its two
      // handles.
      expect(bez!.length, id).toBeGreaterThanOrEqual(5);
      for (const p of bez!) expect(p, id).toHaveLength(9);
      const [fx, fz] = TABLE[parentOf(id)]!;
      expectVec(bez![0]!.slice(3, 6), [fx, tuning.linkMast, fz]);
      expectVec(bez!.at(-1)!.slice(3, 6), [x, tuning.linkMast, z]);
      const pts = sampled(bez!, 64);
      // A short link (the cluster's, under SHORT_LINK) runs level all the way (SHORT_TOP, 0).
      const short = Math.hypot(x - fx, z - fz) < value('SHORT_LINK');
      expect(short, id).toBe(CLUSTER.includes(id));
      const top = Math.max(...pts.map((p) => p[1]));
      expect(top, id).toBeCloseTo(tuning.linkMast + value(short ? 'SHORT_TOP' : 'LINK_TOP'), 3);
      if (short) {
        for (const p of pts) expect(p[1], id).toBeCloseTo(tuning.linkMast, 4);
        continue;
      }
      // Level cable ends: every point within LINK_SHOULDER of either end (along the floor) is
      // at mast height, past the gondola's dock (0.75) and its clip's last 0.1.
      for (const [px, py, pz] of pts) {
        const near = Math.min(Math.hypot(px - fx, pz - fz), Math.hypot(px - x, pz - z));
        if (near <= shoulder + 1e-4) expect(py, `${id} ${near.toFixed(3)} from an end`).toBeCloseTo(tuning.linkMast, 4);
        else expect(py, id).toBeGreaterThan(tuning.linkMast);
      }
    }
  });

  test.skipIf(!BLENDER_SOURCES)("world.py's link mast, lift and turnaround radius are tuning's", () => {
    const py = readFileSync(join(ROOT, 'blender', 'world', 'world.py'), 'utf8');
    const value = (name: string) => Number(new RegExp(`^${name} = ([0-9.]+)`, 'm').exec(py)?.[1]);
    expect(value('LINK_MAST')).toBe(tuning.linkMast);
    expect(value('LINK_LIFT')).toBe(tuning.linkLift);
    // The turnaround its review renders draw: the ring the gondola rounds the hub on (links.ts).
    expect(value('TURN_RADIUS')).toBe(tuning.visitorDock);
    // The speeds the arrival's links draw at, which time the cluster's reach markers.
    expect(value('LINK_SPEED')).toBe(tuning.linkDrawSpeed);
    expect(value('SUB_LINK_SPEED')).toBe(tuning.subLinkDrawSpeed);
  });

  test("every camera's fovY is 30 and was exported from a vertical sensor fit", () => {
    for (const name of Object.keys(world.cameras)) {
      const cam = world.cameras[name]!;
      expect(cam.fovY, name).toBeCloseTo(30, 3);
      expect(cam.sensorFit, name).toBe('VERTICAL');
    }
  });

  // Besides its four, world.json may hold station_<id>: node <id>'s own station camera
  // (world.blend's cam_station_<id>), relative to its node like station; and receipt (Task 16,
  // cam_receipt), relative to Fettle's node.
  test('every camera is one of its four or a station_<id> for a known node, shaped like the others', () => {
    for (const [name, cam] of Object.entries(world.cameras)) {
      const node = /^station_(.+)$/.exec(name)?.[1];
      if (!CAMERAS.includes(name) && name !== 'receipt') expect(node !== undefined && node in world.nodes, name).toBe(true);
      expect(Object.keys(cam).sort(), name).toEqual(['fovY', 'position', 'sensorFit', 'target']);
      for (const v of [cam.position, cam.target]) {
        expect(v, name).toHaveLength(3);
        for (const c of v) expect(Number.isFinite(c), name).toBe(true);
      }
    }
  });
});

// Task 9: the arrival, authored in world.blend. The camera clips themselves are
// checked against these numbers in glb.test.ts (world.glb).
describe('world.json → arrival', () => {
  const clips = (): [string, Timing | undefined][] => [
    ['arrival', world.arrival],
    ['arrival_portrait', world.arrival?.portrait],
  ];

  test.each(clips())('%s has a clip length and a reach time for every node, in station order, all by 2.2 s', (_, t) => {
    expect(t).toBeDefined();
    const { clipLength, reach } = t!;
    expect(clipLength).toBeGreaterThan(0);
    expect(Object.keys(reach)).toEqual(expect.arrayContaining(Object.keys(TABLE)));
    // In station order among the origin's links, and among each hub's; each of those after its hub.
    const order = STATION_ORDER.filter((id) => id in TABLE);
    for (const from of ['origin', ...new Set(Object.values(TREE))]) {
      const group = order.filter((id) => parentOf(id) === from && id !== 'origin');
      const times = group.map((id) => reach[id]!);
      for (let i = 1; i < times.length; i++) expect(times[i], group[i]).toBeGreaterThan(times[i - 1]!);
      if (from !== 'origin') expect(times[0], `${group[0]} after its hub`).toBeGreaterThan(reach[from]!);
    }
    const times = order.map((id) => reach[id]!);
    expect(order[0]).toBe('origin');
    expect(times[0]).toBeGreaterThanOrEqual(0);
    expect(Math.max(...times)).toBeLessThanOrEqual(2.2 + 1e-9);
    // Every node has risen in before the camera settles.
    expect(clipLength).toBeGreaterThanOrEqual(Math.max(...times));
  });

  // The cluster (Batch B): its links leave each hub as the hub's own lands, at the runtime's
  // tuning.subLinkDrawSpeed (world.py's SUB_LINK_SPEED), each landing its length later and
  // 0.04 s after the one from the same hub before it; the last of them (the laptop's, three
  // levels down since the real wiring's tree) lands at 2.2 s, and everything else moved earlier
  // with it (eolietech was 1.72 with twelve nodes, the last of them exit, at 2.2).
  test.each(clips())("%s lands the origin's links 0.12 s apart in station order from 0, the cluster's from its hub, the last at 2.2 s", (_, t) => {
    const reach = t!.reach;
    const top = STATION_ORDER.filter((id) => id in TABLE && id !== 'origin' && parentOf(id) === 'origin');
    const subs: string[] = STATION_ORDER.filter((id) => id in TABLE && parentOf(id) !== 'origin');
    const length = (id: string) => {
      const pts = sampled(world.links[id]!, 64);
      return pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1], p[2] - pts[i]![2]), 0);
    };
    // Its time on the cascade: its hub's (a top-level hub's marker, a sub-hub's own time on the
    // cascade, before its marker rounds it to a frame), its length at the cluster's speed, and
    // 0.04 s for each sibling before it in station order.
    const due = (id: string): number => {
      const hub = parentOf(id);
      const k = subs.filter((s) => parentOf(s) === hub).indexOf(id);
      return (parentOf(hub) === 'origin' ? reach[hub]! : due(hub)) + length(id) / tuning.subLinkDrawSpeed + k * 0.04;
    };
    const last = Math.max(...subs.map(due));
    expect(last, 'the last of them lands at 2.2 s').toBeCloseTo(2.2, 1);
    expect(reach['origin']).toBe(0);
    for (let i = 1; i < top.length; i++) expect(reach[top[i]!]! - reach[top[i - 1]!]!, top[i]).toBeCloseTo(0.12, 6);
    // Each on a frame at 50 fps, so within half of one (0.01 s) of its own time.
    for (const id of subs) expect(Math.abs(reach[id]! - due(id)), id).toBeLessThanOrEqual(0.0101);
    expect(Math.max(...Object.values(reach))).toBeCloseTo(2.2, 6);
    expect(reach['eolietech']).toBeCloseTo(1.5, 6); // after siel-eolie, before experiments
    // The tree's three levels draw faster, so homelab lands where it did with one (2026-10-21).
    expect(reach['homelab']).toBeCloseTo(1.74, 6);
  });
});

// The fit scale Task 9's fit.ts applies to an authored camera: the factor s that puts the
// camera at target + (position - target) * s with every point inside the part of the canvas
// the panel leaves visible. stage.ts centres the projection on that part with setViewOffset
// (without zooming), so the visible area spans (1 - right/W) and (1 - bottom/H) of the
// frame's half-width and half-height either side of the projection centre.
function fitScale(cam: Camera, points: Vec3[], W: number, H: number, inset: { right: number; bottom: number }): number {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a: Vec3): Vec3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = norm(sub(cam.target, cam.position));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = Math.hypot(...sub(cam.position, cam.target));
  const tan = Math.tan(((cam.fovY / 2) * Math.PI) / 180);
  const kx = (1 - inset.right / W) * tan * (W / H);
  const ky = (1 - inset.bottom / H) * tan;
  let s = 0;
  for (const p of points) {
    const q = sub(p, cam.target);
    const depth = dot(q, f);
    s = Math.max(s, (Math.abs(dot(q, r)) / kx - depth) / d, (Math.abs(dot(q, u)) / ky - depth) / d);
  }
  return s;
}

/** Each node's ground point, grown by `margin` in every direction (model footprints, labels). */
function nodePoints(margin: number): Vec3[] {
  const out: Vec3[] = [];
  // A hidden node (the duck, Task 17) is left out of the overview's fit.
  for (const [x, z] of Object.entries(world.nodes).filter(([id]) => !HIDDEN.includes(id)).map(([, xz]) => xz)) {
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        for (const dz of [-1, 0, 1]) {
          const l = Math.hypot(dx, dy, dz) || 1;
          out.push([x + (dx / l) * margin, (dy / l) * margin, z + (dz / l) * margin]);
        }
      }
    }
  }
  return out;
}

describe('world.json → cameras.overviewPortrait', () => {
  // Composed in Blender for a 9:19.5 phone with the peek sheet over the bottom (10% since the
  // phone pass's P3c), so the runtime keeps it nearly as authored (plan, Task 9: if not,
  // recompose it in Blender).
  test('frames every node, with 0.6 of margin, in the top 85% of a 390×844 phone at a fit scale within 1 ± 0.1', () => {
    const cam = world.cameras.overviewPortrait;
    expect(cam).toBeDefined();
    const s = fitScale(cam!, nodePoints(0.6), 390, 844, { right: 0, bottom: tuning.sheetPeek * 844 });
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThan(1.1);
  });
});

