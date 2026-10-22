import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { Box3, Color, Group, Object3D, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, type WebGLRenderer } from 'three';
import type { Line2 } from '../../src/vendor/lines/Line2.js';
import world from '../../src/data/world.json';
import { linkCurve } from '../../src/data/layout';
import { dockPose } from '../../src/world/dock';
import type { Theme } from '../../src/stage/theme';
import { tuning } from '../../src/tuning';
import {
  BRICKS,
  CABIN,
  CABLE_CLEAR,
  CABLE_FLOOR,
  CABLE_SEGMENTS,
  CABLES,
  COIL_POINTS,
  COIL_R,
  MIN_PX,
  ROUND_PX,
  STRIPS,
  WIDTH,
  bodyGap,
  brickPose,
  cablePoints,
  createCable,
  cabinBody,
  drawnPx,
  lineColour,
  pointCount,
  roundTones,
  stripPose,
  type CableDeps,
  type CableEnd,
  type CableNodes,
  type CableStage,
} from '../../src/world/cable';
import { applyRoleMaterials, recolourRoleMaterial } from '../../src/shading';
import { ROOT } from './helpers/blender';
import { glbBounds } from './helpers/glb';

// The homelab's wiring (the owner's test notes, 2026-10-21 afternoon): the lines'
// shape, the strips' places, the hierarchy's tones, and the whole set built from the models'
// extras as exported (public/models/*.glb) at world.json's spots (the layout R1).

const floorAt = (id: string, w: { nodes: Record<string, number[]> } = world) => {
  const [x, z] = w.nodes[id]!;
  return new Vector3(x, 0, z);
};
const server = floorAt('server');
const sw = floorAt('switch');
const ends = (s = server, w = sw): [CableEnd, CableEnd] => [
  { at: s.clone().add(new Vector3(0.03338, 0.02339, 0.46235)), dir: new Vector3(-0.48481, 0, 0.87462), centre: s },
  { at: w.clone().add(new Vector3(0.24197, 0.0518, -0.00341)), dir: new Vector3(0.97437, 0, 0.22495), centre: w },
];
const flatDist = (p: Vector3, c: Vector3) => Math.hypot(p.x - c.x, p.z - c.z);

describe('cablePoints', () => {
  test('runs from one plug to the other', () => {
    const [a, b] = ends();
    const pts = cablePoints(a, b, 0);
    expect(pts).toHaveLength(CABLE_SEGMENTS + 1);
    expect(pts[0]!.distanceTo(a.at)).toBeLessThan(1e-9);
    expect(pts[CABLE_SEGMENTS]!.distanceTo(b.at)).toBeLessThan(1e-9);
    for (const p of pts) for (const v of p.toArray()) expect(Number.isFinite(v)).toBe(true);
  });

  test('leaves each boot along its dir, level', () => {
    const [a, b] = ends();
    const pts = cablePoints(a, b, 0, { slack: 0.07 });
    // However far apart the two stand: the leads keep their boots' height, so a longer cable's
    // longer segments don't tip its ends down.
    for (const far of [0, 0.5, 1, 2]) {
      const [fa, fb] = ends(server, sw.clone().add(sw.clone().sub(server).setLength(far)));
      const p = cablePoints(fa, fb, 0, { slack: -0.07 });
      expect(p[1]!.clone().sub(p[0]!).normalize().dot(fa.dir), `${far} further`).toBeGreaterThan(0.995);
      expect(p[CABLE_SEGMENTS - 1]!.clone().sub(p[CABLE_SEGMENTS]!).normalize().dot(fb.dir), `${far} further`).toBeGreaterThan(0.995);
    }
    // Across the floor, exactly along it for the first few segments (the straight lead).
    for (const [i, j, dir] of [[0, 2, a.dir], [CABLE_SEGMENTS, CABLE_SEGMENTS - 2, b.dir]] as const) {
      const d = pts[j]!.clone().sub(pts[i]!).setY(0).normalize();
      expect(d.dot(dir)).toBeGreaterThan(0.99999);
    }
  });

  test('lies on the floor between its ends, and never under it', () => {
    const [a, b] = ends();
    const pts = cablePoints(a, b, 0);
    for (const p of pts) expect(p.y).toBeGreaterThanOrEqual(CABLE_FLOOR - 1e-9);
    const middle = pts.slice(Math.round(CABLE_SEGMENTS * 0.35), Math.round(CABLE_SEGMENTS * 0.65));
    for (const p of middle) expect(p.y).toBeCloseTo(CABLE_FLOOR, 6);
    // From a raised floor too (the nodes' homes' height), and a cord lies lower (its radius).
    const half = (p: Vector3[]) => p.slice(Math.round(CABLE_SEGMENTS * 0.35), Math.round(CABLE_SEGMENTS * 0.65));
    for (const p of half(cablePoints(...ends(server.clone().setY(1), sw.clone().setY(1)), 1))) expect(p.y).toBeCloseTo(1 + CABLE_FLOOR, 6);
    for (const p of half(cablePoints(a, b, 0, { lie: 0.004 }))) expect(p.y).toBeCloseTo(0.004, 6);
  });

  test('hangs from a high plug down to the floor within about its height', () => {
    const [a, b] = ends();
    const high = { ...a, at: a.at.clone().setY(0.34) };
    const pts = cablePoints(high, b, 0);
    let along = 0;
    let landed = Infinity;
    for (let i = 1; i < pts.length; i++) {
      along += flatDist(pts[i]!, pts[i - 1]!);
      if (pts[i]!.y < CABLE_FLOOR + 1e-3) {
        landed = along;
        break;
      }
    }
    expect(landed).toBeLessThan(0.1 + 1.1 * 0.34 + 0.1); // the lead (bending in), then a run about its height
    for (let i = 1; i < pts.length / 2; i++) expect(pts[i]!.y).toBeLessThanOrEqual(pts[i - 1]!.y + 1e-9); // falls, never climbs
  });

  test('bows aside by its slack: a gentle sag, to the left of a → b, or the right if negative', () => {
    const [a, b] = ends();
    const straight = cablePoints(a, b, 0, { slack: 0 }, []);
    const left = cablePoints(a, b, 0, { slack: 0.08 }, []);
    const right = cablePoints(a, b, 0, { slack: -0.08 }, []);
    const chord = b.at.clone().sub(a.at).setY(0);
    const normal = new Vector3(chord.z, 0, -chord.x).normalize(); // left of a → b
    const m = CABLE_SEGMENTS / 2;
    const off = (p: Vector3[]) => p[m]!.clone().sub(straight[m]!).dot(normal);
    expect(off(left)).toBeGreaterThan(0.04);
    expect(off(right)).toBeLessThan(-0.04);
    // The sag is gentle: well under a fifth of the length either way.
    expect(Math.abs(off(left))).toBeLessThan(0.2 * chord.length());
  });

  test('keeps clear of both bodies and of the others past its leads', () => {
    const [a, b] = ends();
    const other = server.clone().lerp(sw, 0.5);
    const pts = cablePoints(a, b, 0, { avoid: [{ x: other.x, z: other.z, r: 0.2 }] });
    // Past the plugs' straight leads (a few segments at each end), out of every circle.
    for (const p of pts.slice(8, CABLE_SEGMENTS - 8)) {
      expect(flatDist(p, server)).toBeGreaterThanOrEqual(CABLE_CLEAR - 0.03); // the last smoothing may graze it by a hair (EASE_PASSES)
      expect(flatDist(p, sw)).toBeGreaterThanOrEqual(CABLE_CLEAR - 0.03);
      expect(flatDist(p, other)).toBeGreaterThanOrEqual(0.2 - 0.02);
    }
  });

  test('lays one coil of spare cable that far along, and still ends in both plugs', () => {
    const [a, b] = ends();
    const pts = cablePoints(a, b, 0, { coil: 0.3 });
    expect(pts).toHaveLength(pointCount(0.3));
    expect(pts).toHaveLength(CABLE_SEGMENTS + 1 + COIL_POINTS);
    expect(pts[0]!.distanceTo(a.at)).toBeLessThan(1e-9);
    expect(pts.at(-1)!.distanceTo(b.at)).toBeLessThan(1e-9);
    // Somewhere a run of COIL_POINTS points lies on one circle of COIL_R, round once.
    let found = false;
    for (let s = 1; s + COIL_POINTS < pts.length && !found; s++) {
      const run = pts.slice(s, s + COIL_POINTS);
      const c = run.reduce((m, p) => m.add(p), new Vector3()).divideScalar(run.length);
      found = run.every((p) => Math.abs(flatDist(p, c) - COIL_R) < 0.01);
    }
    expect(found).toBe(true);
    // No step anywhere: the coil joins the line smoothly.
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.distanceTo(pts[i - 1]!)).toBeLessThan(0.12);
  });

  test('follows a pulled end: the plug moves and lifts, the rest settles on the floor', () => {
    const lifted = sw.clone().add(new Vector3(0.6, 0.6, 0.8));
    const [a, b] = ends(server, lifted);
    const pts = cablePoints(a, b, 0);
    expect(pts[CABLE_SEGMENTS]!.distanceTo(b.at)).toBeLessThan(1e-9);
    expect(pts[0]!.distanceTo(a.at)).toBeLessThan(1e-9);
    // It hangs up to the lifted plug smoothly: no step between neighbours, and it only climbs.
    for (let i = 1; i <= CABLE_SEGMENTS; i++) expect(Math.abs(pts[i]!.y - pts[i - 1]!.y)).toBeLessThan(0.12);
    for (let i = CABLE_SEGMENTS / 2; i <= CABLE_SEGMENTS; i++) expect(pts[i]!.y).toBeGreaterThanOrEqual(pts[i - 1]!.y - 1e-9);
    expect(pts[CABLE_SEGMENTS / 4]!.y).toBeCloseTo(CABLE_FLOOR, 3);
  });

  test('passes by its waypoint, round a body the other way', () => {
    const [a, b] = ends();
    const via = server.clone().lerp(sw, 0.5).add(new Vector3(0, 0, 0.9));
    const pts = cablePoints(a, b, 0, { via });
    expect(Math.min(...pts.map((p) => flatDist(p, via)))).toBeLessThan(0.08);
    expect(pts[0]!.distanceTo(a.at)).toBeLessThan(1e-9);
    expect(pts.at(-1)!.distanceTo(b.at)).toBeLessThan(1e-9);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.distanceTo(pts[i - 1]!)).toBeLessThan(0.12);
  });

  test('keeps clear of a box (a docked cabin) lying across its way, by its margin', () => {
    const [a, b] = ends();
    const mid = server.clone().lerp(sw, 0.5);
    const u = sw.clone().sub(server).normalize();
    const box = { x: mid.x, z: mid.z, r: 0.07, ux: u.x, uz: u.z, a: 0.21, b: 0.1 };
    const pts = cablePoints(a, b, 0, { avoid: [box] });
    for (const p of pts) expect(bodyGap(box, p.x, p.z).d).toBeGreaterThan(0.07 - 0.02);
    expect(maxTurn(pts)).toBeLessThan(13);
    // Its gap: zero on the box's edge, negative inside, the way out across it.
    expect(bodyGap(box, mid.x, mid.z).d).toBeCloseTo(-0.1, 6);
    expect(bodyGap(box, mid.x + u.x * 0.3, mid.z + u.z * 0.3).d).toBeCloseTo(0.09, 6);
  });

  test('passes by a few waypoints in order', () => {
    const [a, b] = ends();
    const vias = [server.clone().lerp(sw, 0.3).add(new Vector3(0, 0, 0.6)), server.clone().lerp(sw, 0.7).add(new Vector3(0, 0, 0.6))];
    const pts = cablePoints(a, b, 0, { via: vias });
    const nearest = vias.map((v) => pts.reduce((best, p, i) => (flatDist(p, v) < flatDist(pts[best]!, v) ? i : best), 0));
    for (const [k, v] of vias.entries()) expect(flatDist(pts[nearest[k]!]!, v)).toBeLessThan(0.08);
    expect(nearest[0]).toBeLessThan(nearest[1]!);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.distanceTo(pts[i - 1]!)).toBeLessThan(0.12);
  });

  test('reuses the array it is given', () => {
    const [a, b] = ends();
    const out = cablePoints(a, b, 0);
    const again = cablePoints(...ends(server, sw.clone().add(new Vector3(0.3, 0, 0))), 0, {}, out);
    expect(again).toBe(out);
    expect(out[0]).toBe(again[0]);
  });
});

describe('the strips', () => {
  test('A stands south-west of the switch, behind it with the brick, the PC near; B where R1 put it', () => {
    // Moved from the cluster's middle on 2026-10-22: the PC's cable now passes there, between the
    // switch and the PC's docked cabin.
    const a = stripPose(STRIPS.A, floorAt);
    const b = stripPose(STRIPS.B, floorAt);
    const sw = floorAt('switch');
    expect(a.at.x).toBeLessThan(sw.x);
    expect(a.at.z).toBeGreaterThan(sw.z);
    for (const id of ['switch', 'desktop']) expect(flatDist(a.at, floorAt(id)), id).toBeLessThan(2.2);
    expect(flatDist(a.at, brickPose(BRICKS.psu, floorAt).at)).toBeLessThan(0.7);
    expect(b.at.x).toBeCloseTo(-8.0, 2);
    expect(b.at.z).toBeCloseTo(6.66, 2);
    expect(a.yaw).toBeCloseTo((STRIPS.A.facing * Math.PI) / 180, 9);
  });

  test('a strip keeps its place among its devices when the cluster moves together', () => {
    const shift = new Vector3(1, 0, -2);
    const a = stripPose(STRIPS.A, floorAt);
    const moved = stripPose(STRIPS.A, (id) => floorAt(id).add(shift));
    expect(moved.at.distanceTo(a.at.clone().add(shift))).toBeLessThan(1e-9);
  });
});

// The themes' tokens (src/styles.css).
const hex = (h: string) => new Color(h);
const light: Theme = {
  bg: hex('#f4f4f5'),
  ink: hex('#18181b'),
  soft: hex('#52525b'),
  edge: hex('#a1a1aa'),
  faint: hex('#d4d4d8'),
  ghost: hex('#e4e4e6'),
  acc: hex('#3651d4'),
  model: hex('#e4e4e7'),
  detail: hex('#3f3f46'),
  paper: hex('#fafafa'),
  lamp: hex('#27272a'),
  shadow: hex('#18181b'),
};
const dark: Theme = {
  ...light,
  bg: hex('#121214'),
  ink: hex('#f4f4f5'),
  soft: hex('#a1a1aa'),
  edge: hex('#52525b'),
  faint: hex('#2e2e33'),
  ghost: hex('#202023'),
  acc: hex('#8ea2ff'),
  model: hex('#46464d'),
  detail: hex('#d4d4d8'),
  shadow: hex('#000000'),
};
/** A colour's lightness as the eye sees it (sRGB, not three's linear working space). */
const lightness = (c: Color) => c.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace).l;
/** How far a colour stands from the floor, by lightness (higher reads stronger). */
const contrast = (c: Color, t: Theme) => Math.abs(lightness(c) - lightness(t.bg));

/** The round's tones, body, rims and crown, of a line of `kind`. */
const tonesOf = (kind: 'network' | 'power', t: Theme, dim = 0) => {
  const rim = new Color();
  const crown = new Color();
  roundTones(kind, t, dim, rim, crown);
  return { body: lineColour(kind, t, dim), rim, crown };
};

describe('drawnPx, lineColour and roundTones (the hierarchy)', () => {
  // The overview's camera (world.json: fovY 30, about 40 from the cluster) and a station's
  // (about 3), over a 900 px tall view; a 4x zoom on the overview, about 10.
  const at = (kind: 'network' | 'power', d: number) => drawnPx(kind, d, 30, 900);

  test('a network cable at its real thickness up close, growing as the camera nears; never under 1.5 px far off', () => {
    expect(at('network', 40)).toBe(MIN_PX.network);
    expect(MIN_PX.network).toBeGreaterThanOrEqual(1.5);
    expect(at('network', 10)).toBeGreaterThan(MIN_PX.network);
    expect(at('network', 3)).toBeGreaterThan(at('network', 10));
    expect(at('network', 1.5)).toBeCloseTo(2 * at('network', 3), 6);
    // At a station, a few px: wide enough to be shaded as a round (ROUND_PX).
    expect(at('network', 3)).toBeGreaterThanOrEqual(ROUND_PX[1]);
  });

  test('a power cord about half as wide as a network cable at the same distance, near and far', () => {
    const report: string[] = [];
    for (const d of [1.5, 3, 10, 20, 40, 80]) {
      const ratio = at('power', d) / at('network', d);
      report.push(`${d}: network ${at('network', d).toFixed(2)} px, cord ${at('power', d).toFixed(2)} px`);
      expect(ratio, `at ${d}`).toBeGreaterThan(0.4);
      expect(ratio, `at ${d}`).toBeLessThan(0.6);
    }
    expect(WIDTH.power / WIDTH.network).toBeCloseTo(0.5, 6);
    console.log(`widths: ${report.join('; ')}`);
  });

  for (const [name, t] of [['light', light], ['dark', dark]] as const) {
    test(`${name}: a network cable stronger than the links' grey, never as strong as --detail; a cord lighter`, () => {
      const link = contrast(t.edge, t);
      const net = tonesOf('network', t);
      const cord = tonesOf('power', t);
      const c = (x: Color) => contrast(x, t);
      // The body, its rims and its crown: every part stronger than a link (darker on the light
      // floor, lighter on the dark), weaker than the models' --detail (its rims included).
      expect(c(net.body)).toBeGreaterThan(link);
      expect(c(net.crown)).toBeGreaterThan(link);
      expect(c(net.rim)).toBeLessThan(contrast(t.detail, t));
      expect(c(net.rim)).toBeGreaterThan(link);
      // Shaded as a round lit from above: rims darker than the body, a lighter crown.
      expect(lightness(net.rim)).toBeLessThan(lightness(net.body));
      expect(lightness(net.crown)).toBeGreaterThan(lightness(net.body));
      expect(lightness(cord.rim)).toBeLessThan(lightness(cord.body));
      expect(lightness(cord.crown)).toBeGreaterThan(lightness(cord.body));
      // A cord a lighter grey: quieter than a network cable by a clear step, and than a link;
      // clear of --ghost (switched off).
      expect(c(net.body) - c(cord.body)).toBeGreaterThan(0.1);
      expect(c(cord.body)).toBeLessThan(link);
      expect(c(cord.body) - contrast(t.ghost, t)).toBeGreaterThan(0.1);
      // Mid greys: network 0.3-0.7 lightness in both themes.
      expect(lightness(net.body)).toBeGreaterThan(0.3);
      expect(lightness(net.body)).toBeLessThan(0.7);
      const f = (x: Color) => lightness(x).toFixed(3);
      console.log(`lightness ${name}: floor ${f(t.bg)}, link ${f(t.edge)}, detail ${f(t.detail)}; network rim ${f(net.rim)} body ${f(net.body)} crown ${f(net.crown)}; cord rim ${f(cord.rim)} body ${f(cord.body)} crown ${f(cord.crown)}; ghost ${f(t.ghost)}`);
    });

    test(`${name}: switched off, a line is --ghost, its rims and crown too`, () => {
      for (const kind of ['network', 'power'] as const) {
        const off = tonesOf(kind, t, 1);
        for (const x of [off.body, off.rim, off.crown]) expect(x.getHex()).toBe(t.ghost.getHex());
      }
    });
  }
});

// --- the whole set, from the models' extras ---------------------------------------------------

interface GltfNode {
  name?: string;
  translation?: number[];
  rotation?: number[];
  children?: number[];
  extras?: Record<string, unknown>;
}
const gltfOf = (id: string) => {
  const bytes = readFileSync(join(ROOT, 'public', 'models', `${id}.glb`));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as { nodes: GltfNode[]; scenes: { nodes: number[] }[] };
};
/** A model's node tree as Object3Ds (names, transforms and extras; no meshes), as GLTFLoader makes it. */
function sceneOf(id: string): Group {
  const g = gltfOf(id);
  const make = (i: number): Object3D => {
    const n = g.nodes[i]!;
    const o = new Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.extras) Object.assign(o.userData, n.extras);
    for (const c of n.children ?? []) o.add(make(c));
    return o;
  };
  const scene = new Group();
  for (const i of g.scenes[0]!.nodes) scene.add(make(i));
  return scene;
}

/** The runtime's loader, role materials and links' curves, as map.ts hands them over (the real
 *  shading); by default the loader reads the models' GLBs (the strip, the brick). */
const deps = (load: (id: string) => Promise<{ scene: Object3D }> = async (id) => ({ scene: sceneOf(id) })): CableDeps => ({ load, roles: applyRoleMaterials, recolour: recolourRoleMaterial, dock: (id) => dockPose(curveOf(id)) });

const CLUSTER = ['homelab', 'switch', 'ap', 'desktop', 'server', 'laptop'];
/** Each model's bounds as nodes.ts measures them (NodeView.bounds: its GLB without the shadow). */
const BOUNDS = new Map<string, Box3>();
beforeAll(async () => {
  for (const id of CLUSTER) {
    const b = await glbBounds(join(ROOT, 'public', 'models', `${id}.glb`), ['shadow']);
    BOUNDS.set(id, new Box3(new Vector3(...b.min), new Vector3(...b.max)));
  }
});
const positions = new Map(Object.entries(world.nodes).map(([id, [x, z]]) => [id, new Vector3(x, 0, z)]));
/** A node's link as authored, where its gondola docks (map.ts hands links.curve over). */
const curveOf = (id: string) => linkCurve(id, positions, world);
function cluster() {
  const views = new Map(
    CLUSTER.map((id) => {
      const home = floorAt(id);
      const root = new Group();
      root.position.copy(home);
      root.add(sceneOf(id));
      return [id, { id, root, home, ready: Promise.resolve(), bounds: BOUNDS.get(id)!.clone() }];
    }),
  );
  const nodes: CableNodes = { get: (id) => views.get(id)!, all: () => [...views.values()] };
  type Tick = (dt: number, t: number) => boolean | void;
  const ticks = new Set<Tick>();
  const clock = {
    add: (fn: Tick) => (ticks.add(fn), () => void ticks.delete(fn)),
    invalidate: () => {},
    run(seconds: number) {
      for (let t = 0; t < seconds; t += 1 / 60) for (const fn of [...ticks]) if (!fn(1 / 60, t)) ticks.delete(fn);
    },
  };
  const camera = new PerspectiveCamera(30, 1.6, 0.1, 100);
  camera.position.set(-6.5, 3, 12);
  const stage = { scene: new Scene(), camera, theme: light, onTheme: () => () => {}, viewport: { pixelRatio: 1 } } as unknown as CableStage;
  return { views, nodes, clock, stage };
}
const plugAt = (v: { root: Object3D }, key: string) => {
  let e: number[] | undefined;
  v.root.traverse((o) => void (e ??= o.userData[key] as number[] | undefined));
  return v.root.position.clone().add(new Vector3(...(e as [number, number, number])));
};
const endsOf = (line: Line2) => {
  const s = line.geometry.getAttribute('instanceStart');
  const e = line.geometry.getAttribute('instanceEnd');
  return [new Vector3(s.getX(0), s.getY(0), s.getZ(0)), new Vector3(e.getX(e.count - 1), e.getY(e.count - 1), e.getZ(e.count - 1))] as const;
};
/** A line's points as drawn. */
const pointsOf = (line: Line2) => {
  const s = line.geometry.getAttribute('instanceStart');
  const e = line.geometry.getAttribute('instanceEnd');
  const pts = Array.from({ length: s.count }, (_, i) => new Vector3(s.getX(i), s.getY(i), s.getZ(i)));
  pts.push(new Vector3(e.getX(e.count - 1), e.getY(e.count - 1), e.getZ(e.count - 1)));
  return pts;
};
/** The most it sweeps round `c` (degrees) in one stretch within ±0.1 of the ground ring's radius. */
const ringArc = (pts: Vector3[], c: Vector3, r = tuning.groundRing) => {
  const band = (p: Vector3) => Math.abs(flatDist(p, c) - r) < 0.1;
  let best = 0;
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    if (!band(pts[i - 1]!) || !band(pts[i]!)) {
      run = 0;
      continue;
    }
    let d = Math.atan2(pts[i]!.z - c.z, pts[i]!.x - c.x) - Math.atan2(pts[i - 1]!.z - c.z, pts[i - 1]!.x - c.x);
    d = ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    run += d;
    best = Math.max(best, Math.abs(run));
  }
  return (best * 180) / Math.PI;
};
/** The most it turns (degrees) from one segment to the next. */
const maxTurn = (pts: Vector3[]) => {
  let worst = 0;
  let prev: Vector3 | null = null;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i]!.clone().sub(pts[i - 1]!);
    if (d.length() < 1e-6) continue;
    d.normalize();
    if (prev) worst = Math.max(worst, Math.acos(Math.min(1, prev.dot(d))));
    prev = d;
  }
  return (worst * 180) / Math.PI;
};
const render = (line: Line2) =>
  (line.onBeforeRender as (r: WebGLRenderer) => void)({ getDrawingBufferSize: (v: { set(x: number, y: number): unknown }) => v.set(1440, 900) } as unknown as WebGLRenderer);

describe('createCable', () => {
  test('every line of the table resolves, its ends in the models\' plugs and on the strips', async () => {
    const { views, nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    expect(cables).not.toBeNull();
    expect(cables.lines.map((l) => l.name).sort()).toEqual(CABLES.map((c) => c.name).sort());
    expect(cables.strips.map((s) => s.name).sort()).toEqual(['strip:A', 'strip:B']);
    for (const c of CABLES) {
      const l = cables.get(c.name)!;
      expect(l.line.name).toBe(`${c.kind === 'network' ? 'cable' : 'cord'}:${c.name}`);
      expect(stage.scene.getObjectByName(l.line.name)).toBe(l.line);
      const [first, last] = endsOf(l.line);
      for (const [e, p] of [[c.from, first], [c.to, last]] as const) {
        if ('node' in e) expect(p.distanceTo(plugAt(views.get(e.node)!, `${e.at}_end`)), `${c.name} at ${e.node}`).toBeLessThan(1e-5);
        else if ('brick' in e) {
          // In its lead's tail, out of the brick's end.
          const brick = cables.bricks.find((s) => s.name === `brick:${e.brick}`)!;
          const end = gltfOf('psu').nodes.find((n) => n.name === 'psu')!.extras![`${e.at}_end`] as [number, number, number];
          // (Its scale is the grow-in's: the ends are where it lies at full size.)
          expect(p.distanceTo(new Vector3(...end).applyQuaternion(brick.quaternion).add(brick.position)), `${c.name} at the brick`).toBeLessThan(1e-5);
        } else {
          // On its strip, in a clone of the plug template its cord needs.
          const strip = cables.strips.find((s) => s.name === `strip:${e.strip}`)!;
          expect(p.distanceTo(strip.position)).toBeLessThan(0.3);
        }
      }
    }
    // Strip A carries the router's adapter and two mains plugs, strip B the charger and the dock's adapter.
    const plugs = (id: string) => cables.strips.find((s) => s.name === `strip:${id}`)!.children.map((o) => o.name).filter((n) => ['adapter', 'charger', 'plug'].includes(n)).sort();
    expect(plugs('A')).toEqual(['adapter', 'plug', 'plug']);
    expect(plugs('B')).toEqual(['adapter', 'charger']);
    // The AP has no cord (PoE), and no line runs to the laptop but its charger's.
    expect(cables.lines.filter((l) => l.ends.includes('ap')).map((l) => l.kind)).toEqual(['network']);
    expect(cables.lines.filter((l) => l.ends.includes('laptop')).map((l) => l.name)).toEqual(['B_laptop']);
  });

  test("the router's cord crosses the AP's and the server's cables; nothing else crosses", async () => {
    // The owner's notes (2026-10-22): no cord round the router's far side or the PC's front (they
    // hugged the ground ring); a crossing or two is the price. Round the docked gondolas
    // (2026-10-22 midday): the switch, its cabin and the router make a wall, and the router's
    // socket faces north-west behind it, so from strip A (south-west, with the brick and the PC's
    // plugs) its cord goes round the switch's west and north, over the server's cable and the AP's
    // (it crossed the three cables leaving the switch's ports, between them and where the cabin now
    // docks). The server's cord ran round the server's front and crossed its cable just off the
    // dock; round its back it crosses nothing.
    const { nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    type P = [number, number];
    const plan = (l: { line: Line2 }) => {
      const s = l.line.geometry.getAttribute('instanceStart');
      return Array.from({ length: s.count }, (_, i) => [s.getX(i), s.getZ(i)] as P);
    };
    const o = (p: P, q: P, r: P) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const cross = (p: P[], q: P[]) => {
      let n = 0;
      for (let i = 1; i < p.length; i++)
        for (let j = 1; j < q.length; j++)
          if (o(p[i - 1]!, p[i]!, q[j - 1]!) * o(p[i - 1]!, p[i]!, q[j]!) < 0 && o(q[j - 1]!, q[j]!, p[i - 1]!) * o(q[j - 1]!, q[j]!, p[i]!) < 0) n++;
      return n;
    };
    const found: string[] = [];
    const lines = cables.lines.map((l) => ({ name: l.name, pts: plan(l) }));
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++)
        if (cross(lines[i]!.pts, lines[j]!.pts)) found.push(`${lines[i]!.name} × ${lines[j]!.name}`);
    expect(found).toEqual(['switch_ap × A_homelab', 'server_switch × A_homelab']);
  });

  test('no line runs along a ground ring, and every one bends smoothly', async () => {
    // The owner's notes (2026-10-22): a cord eased round the router hugged its ring, a second
    // circle; and the runs had kinks.
    const { nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    const report: string[] = [];
    for (const l of cables.lines) {
      const pts = pointsOf(l.line);
      for (const id of CLUSTER) {
        const arc = ringArc(pts, nodes.get(id).home);
        if (arc > 45) report.push(`${l.name} along ${id}'s ring for ${arc.toFixed(0)}°`);
      }
      const turn = maxTurn(pts);
      if (turn > 13) report.push(`${l.name} turns ${turn.toFixed(1)}° at once`);
    }
    expect(report).toEqual([]);
  });

  test('drawn round at their real thickness, never under the least width, in their tones', async () => {
    const { nodes, clock, stage } = cluster();
    (stage.viewport as { pixelRatio: number }).pixelRatio = 2;
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    for (const l of cables.lines) {
      render(l.line);
      const m = l.line.material as unknown as { linewidth: number; color: Color; vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: { x: number; y: number } & Color & number }> };
      // The least width and the real one (the shader takes the one it's drawn at from them), in
      // drawing-buffer px: the links' resolution at the pixel ratio.
      expect(m.linewidth, l.name).toBe(MIN_PX[l.kind] * 2);
      expect(m.uniforms['realWidth']!.value, l.name).toBe(WIDTH[l.kind]);
      expect([m.uniforms['roundAt']!.value.x, m.uniforms['roundAt']!.value.y], l.name).toEqual([ROUND_PX[0] * 2, ROUND_PX[1] * 2]);
      expect(m.vertexShader, l.name).toContain('realWidth * projectionMatrix');
      expect(m.fragmentShader, l.name).toContain('mix( rim, diffuseColor.rgb');
      const t = tonesOf(l.kind, light);
      expect(m.color.getHex(), l.name).toBe(t.body.getHex());
      expect(m.uniforms['rim']!.value.getHex(), l.name).toBe(t.rim.getHex());
      expect(m.uniforms['crown']!.value.getHex(), l.name).toBe(t.crown.getHex());
      expect(m.uniforms['floorTone']!.value.getHex(), l.name).toBe(light.bg.getHex());
    }
  });

  test("the server's cable leaves the dock toward the switch and runs over in a gentle curve", async () => {
    // The owner's notes (2026-10-22, on cables-quiet): it swung out in a wide loop round the server
    // before heading over. The dock's RJ45 faced 114 degrees off the switch, so it had to turn back
    // (tightened in cables-look: out 0.135 past its plug). The dock turned since: its rear faces
    // the switch's side, so the cable heads over from its plug and never runs back toward the
    // server.
    const { views, nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    const pts = pointsOf(cables.get('server_switch')!.line);
    const plug = plugAt(views.get('server')!, 'cable_end');
    let dir: number[] | undefined;
    views.get('server')!.root.traverse((o) => void (dir ??= o.userData['cable_dir'] as number[] | undefined));
    const d = new Vector3(...(dir as [number, number, number]));
    const sw = nodes.get('switch').home;
    const deg = (a: Vector3, b: Vector3) => (Math.acos(Math.min(1, a.clone().setY(0).normalize().dot(b.clone().setY(0).normalize()))) * 180) / Math.PI;
    // The RJ45 faces the switch's side.
    const off = deg(d, sw.clone().sub(plug));
    // Over its first third (past it, it goes round the switch to port 8, on the switch's far
    // side), the most a segment heads off the switch and how far it turns all told.
    let most = 0;
    let turned = 0;
    const third = Math.round(pts.length / 3);
    for (let i = 1; i < third; i++) {
      const seg = pts[i]!.clone().sub(pts[i - 1]!);
      most = Math.max(most, deg(seg, sw.clone().sub(pts[i - 1]!)));
      if (i > 1) turned += deg(seg, pts[i - 1]!.clone().sub(pts[i - 2]!));
    }
    // And it never runs back toward the server: each point is further from its home than the last.
    const home = nodes.get('server').home;
    let back = 0;
    for (let i = 1; i < third; i++) back = Math.max(back, flatDist(pts[i - 1]!, home) - flatDist(pts[i]!, home));
    console.log(`server's cable: RJ45 ${off.toFixed(1)}° off the switch; its first third heads at most ${most.toFixed(1)}° off it and turns ${turned.toFixed(1)}° all told`);
    expect(off).toBeLessThan(25); // 17.1
    expect(most).toBeLessThan(30); // 23.8
    expect(turned).toBeLessThan(50); // 47: the slack's bow, a gentle S, round the server's docked cabin (37.5 before it)
    expect(back).toBeLessThan(1e-6);
  });

  test("the server's cord runs round the server's back, never across its front as its station sees it", async () => {
    // The owner (2026-10-22 evening, at #server): the cord from strip B ran across the server's
    // front, between it and the camera. Seen from the server's station camera (in plan): no
    // point of it lies in front of the server, nearer the camera than its centre and within its
    // width across the view, but its plug's own turn back off the dock (its plug faces the
    // dock's cabin); and it passes behind the server's back edge on its way.
    const { views, nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    const pts = pointsOf(cables.get('B_server')!.line);
    const home = views.get('server')!.home;
    const cam = world.cameras.station_server.position;
    const view = new Vector3(cam[0]!, 0, cam[2]!).normalize(); // from the server toward the camera
    const across = new Vector3(-view.z, 0, view.x);
    const b = BOUNDS.get('server')!;
    const corners = [b.min.x, b.max.x].flatMap((x) => [b.min.z, b.max.z].map((z) => new Vector3(x, 0, z)));
    const wide = [Math.min(...corners.map((c) => c.dot(across))), Math.max(...corners.map((c) => c.dot(across)))];
    const back = Math.min(...corners.map((c) => c.dot(view)));
    const plug = plugAt(views.get('server')!, 'power_end').setY(0);
    let front = -Infinity; // the nearest the camera it comes while in front of the server
    let behind = Infinity;
    for (const p of pts) {
      const o = p.clone().setY(0).sub(home.clone().setY(0));
      const s = o.dot(view);
      const t = o.dot(across);
      behind = Math.min(behind, s);
      if (flatDist(p, plug) < 0.2) continue;
      if (t > wide[0]! && t < wide[1]!) front = Math.max(front, s);
    }
    console.log(`server's cord: within the server's width, ${front.toFixed(3)} at the nearest toward its camera; ${behind.toFixed(3)} at the farthest (its back edge ${back.toFixed(3)})`);
    expect(front).toBeLessThan(0); // -0.38; across the front it came 0.47 toward the camera
    expect(behind).toBeLessThan(back); // -0.49, past the back edge at -0.39 (it reached -0.10)
  });

  test("strip A's cords take the sockets the table gives them: the PC's at one end, the brick's next, the router's at the far end", async () => {
    // Strip A's three go three ways (the PC east, the brick north-east, the router round the
    // switch's west), so they leave in that order along it and none crosses another off the strip.
    const { clock, stage, nodes } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    const strip = cables.strips.find((s) => s.name === 'strip:A')!;
    const axis = new Vector3(1, 0, 0).applyQuaternion(strip.quaternion);
    const along = (n: string) => endsOf(cables.get(n)!.line)[0].clone().sub(strip.position).dot(axis);
    expect(along('A_desktop')).toBeLessThan(along('A_psu'));
    expect(along('A_psu')).toBeLessThan(along('A_homelab'));
    for (const c of CABLES.filter((x) => 'strip' in x.from && x.from.strip === 'A')) expect(c.socket, c.name).toBeDefined();
  });

  // The switch's external power supply (the owner, 2026-10-22 midday): a brick on the floor by
  // the switch, strip A's mains cord into it and its DC lead out to the switch's DC jack.
  test('the brick: by the switch on strip A\'s side, strip A → its mains inlet, its DC lead → the switch\'s DC jack', async () => {
    const mains = CABLES.filter((c) => 'brick' in c.to);
    const dc = CABLES.filter((c) => 'brick' in c.from);
    expect(mains.map((c) => [c.name, c.kind, c.from, c.to])).toEqual([['A_psu', 'power', { strip: 'A', plug: 'plug' }, { brick: 'psu', at: 'mains' }]]);
    expect(dc.map((c) => [c.name, c.kind, c.from, c.to])).toEqual([['psu_switch', 'power', { brick: 'psu', at: 'dc' }, { node: 'switch', at: 'power' }]]);
    // No other cord feeds the switch: its mains is the brick's.
    expect(CABLES.filter((c) => 'node' in c.to && c.to.node === 'switch' && c.kind === 'power').map((c) => c.name)).toEqual(['psu_switch']);
    const { views, nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    expect(cables.bricks.map((b) => b.name)).toEqual(['brick:psu']);
    const brick = cables.bricks[0]!;
    const sw = nodes.get('switch').home;
    const strip = cables.strips.find((s) => s.name === 'strip:A')!.position;
    // Beside the switch, clear of its box, nearer it than strip A is, on strip A's side.
    expect(flatDist(brick.position, sw)).toBeLessThan(0.8);
    expect(flatDist(brick.position, sw)).toBeGreaterThan(0.45);
    expect(flatDist(brick.position, strip)).toBeLessThan(flatDist(sw, strip));
    expect(brick.position.y).toBe(sw.y);
    // The DC lead ends in the switch's jack, and goes out with the switch (the mains cord too:
    // the brick is the switch's).
    expect(endsOf(cables.get('psu_switch')!.line)[1].distanceTo(plugAt(views.get('switch')!, 'power_end'))).toBeLessThan(1e-5);
    expect(cables.get('psu_switch')!.ends).toEqual(['switch']);
    expect(cables.get('A_psu')!.ends).toEqual(['switch']);
    // Short and gentle, both.
    for (const n of ['psu_switch', 'A_psu']) {
      const pts = pointsOf(cables.get(n)!.line);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += pts[i]!.distanceTo(pts[i - 1]!);
      expect(len, n).toBeLessThan(0.7);
      expect(maxTurn(pts), n).toBeLessThan(13);
    }
  });

  // Decided 2026-10-22 midday: riding over floor cables is fine, but a gondola docked at a station
  // doesn't park on one. Every cluster station's docked cabin (its plan from visitor.glb, at its
  // dock on the authored link, turned along it) keeps every line DOCK_MARGIN off.
  test('no cable or cord passes within any cluster station\'s docked gondola footprint, with a margin', async () => {
    const DOCK_MARGIN = 0.05;
    const v = await glbBounds(join(ROOT, 'public', 'models', 'visitor.glb'), ['shadow']);
    const across = Math.max(-v.min[0]!, v.max[0]!);
    const along = Math.max(-v.min[2]!, v.max[2]!);
    // cable.ts's cabin covers the model's.
    expect(CABIN.across).toBeGreaterThanOrEqual(across);
    expect(CABIN.along).toBeGreaterThanOrEqual(along);
    const { nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    expect(cables.docks.map((d) => d.id).sort()).toEqual(CLUSTER.map((id) => `dock:${id}`).sort());
    const report: string[] = [];
    for (const id of CLUSTER) {
      const pose = dockPose(curveOf(id));
      const d = cabinBody(pose.at, pose.dir);
      // The cabin as the model has it: its plan, centred on the dock, along the link.
      const cabin = { ...d, r: 0, a: along, b: across };
      for (const l of cables.lines) {
        const least = Math.min(...pointsOf(l.line).map((p) => bodyGap(cabin, p.x, p.z).d));
        if (least < DOCK_MARGIN) report.push(`${l.name} ${least.toFixed(3)} from ${id}'s docked cabin`);
      }
    }
    expect(report).toEqual([]);
  });

  test('follows a pulled node: only its lines move, and they come back with it', async () => {
    const { views, nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    const desktop = views.get('desktop')!;
    const before = new Map(cables.lines.map((l) => [l.name, endsOf(l.line)[1].clone()]));
    desktop.root.position.add(new Vector3(0.5, 0.4, 0.3));
    cables.update('desktop');
    for (const l of cables.lines) {
      const moved = endsOf(l.line)[1].distanceTo(before.get(l.name)!) > 0.1;
      expect(moved, l.name).toBe(l.ends.includes('desktop'));
    }
    expect(endsOf(cables.get('switch_desktop')!.line)[1].distanceTo(plugAt(desktop, 'cable_end'))).toBeLessThan(1e-5);
    desktop.root.position.copy(desktop.home);
    cables.update('desktop');
    for (const l of cables.lines) expect(endsOf(l.line)[1].distanceTo(before.get(l.name)!)).toBeLessThan(1e-6);
  });

  test("power off: each line goes to --ghost with the first node it plugs into, and comes back with the last", async () => {
    const { nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps()))!;
    clock.run(1); // drawn out
    const colour = (l: { line: Line2 }) => (render(l.line), (l.line.material as unknown as { color: Color }).color.getHex());
    const lit = new Map(cables.lines.map((l) => [l.name, colour(l)]));
    const off = new Set(['desktop', 'switch']);
    cables.setLit((id) => !off.has(id));
    for (const l of cables.lines) expect(l.lit, l.name).toBe(!l.ends.some((id) => off.has(id)));
    clock.run(tuning.linkLitSeconds + 0.1);
    for (const l of cables.lines) expect(colour(l), l.name).toBe(l.lit ? lit.get(l.name) : light.ghost.getHex());
    // The switch back on: the cable to the desktop waits for its other end.
    off.delete('switch');
    cables.setLit((id) => !off.has(id));
    expect(cables.get('switch_desktop')!.lit).toBe(false);
    expect(cables.get('server_switch')!.lit).toBe(true);
    off.clear();
    cables.setLit(() => true);
    clock.run(tuning.linkLitSeconds + 0.1);
    for (const l of cables.lines) expect(colour(l), l.name).toBe(lit.get(l.name));
  });

  test('without the strip model it still draws the network cables', async () => {
    const { nodes, clock, stage } = cluster();
    const cables = (await createCable(stage, nodes, clock, deps(() => Promise.reject(new Error('offline')))))!;
    expect(cables.lines.map((l) => l.kind)).toEqual(['network', 'network', 'network', 'network']);
    expect(cables.strips).toEqual([]);
  });
});
