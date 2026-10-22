import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { DUCK_BOUNDS } from '../../src/data/hidden';
import { tuning } from '../../src/tuning';
import { cameraClip, glbBounds, inspectGlb, readGlb, sha256File } from './helpers/glb';
import { BLENDER, BLENDER_SOURCES, ROOT, makeProbeSandbox, removeProbeSandboxes, runBlender, runBuild } from './helpers/blender';

const MODELS = join(ROOT, 'blender', 'models');
const PUBLIC = join(ROOT, 'public', 'models');
const ROLES = ['body', 'detail', 'accent', 'paper', 'lamp', 'shadow'];

// The model caps (the owner, 2026-10-21 afternoon): ceilings, not targets.
// Each model, Fettle's and colophon's raised caps folded in; the homelab's sub-nodes (ap,
// desktop, laptop, server, switch); the origin, exit and the parcel (box) have their own.
const MODEL_TRIANGLES = 18_000;
const MODEL_BYTES = 240_000;
const SUB_NODE_TRIANGLES = 9_000;
const SUB_NODE_BYTES = 130_000;
const ORIGIN_BYTES = 300_000;
const EXIT_BYTES = 180_000;
const PARCEL_BYTES = 120_000;
const DUCK_BYTES = 120_000; // a hidden node; the 4.0 MB total

const scriptIds = () =>
  readdirSync(MODELS)
    .filter((f) => f.endsWith('.py'))
    .map((f) => basename(f, '.py'));

interface ExportState {
  glb: boolean;
  raw: boolean;
  blend: boolean;
  /** Whether git has ever tracked public/models/<id>.glb; null when git can't say. */
  everCommitted: boolean | null;
}

/**
 * Whether a model owes a GLB. A model is between blockout and its first export (plan, Task 2
 * Step 2 to Step 3) when its .blend exists but it has no GLB, no raw export and no GLB in git
 * history. Once any export is recorded the model is due for good, so deleting a GLB still fails.
 */
function exportDue(s: ExportState): boolean {
  if (s.glb || s.raw || !s.blend) return true;
  return s.everCommitted !== false;
}

// This branch's history only: a GLB committed on another branch (a detail pass not merged yet)
// isn't owed here.
function everCommitted(path: string): boolean | null {
  const r = spawnSync('git', ['log', 'HEAD', '--format=%H', '-1', '--', path], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() !== '' : null;
}

const dueIds = () =>
  scriptIds().filter((id) =>
    exportDue({
      glb: existsSync(join(PUBLIC, `${id}.glb`)),
      raw: existsSync(join(PUBLIC, `${id}.raw.glb`)),
      blend: existsSync(join(MODELS, `${id}.blend`)),
      everCommitted: everCommitted(`public/models/${id}.glb`),
    }),
  );

describe('when a model owes a GLB', () => {
  const blockedOut = { glb: false, raw: false, blend: true, everCommitted: false };

  test('a blocked-out model that was never exported is not due yet', () => {
    expect(exportDue(blockedOut)).toBe(false);
  });

  test('a model with a GLB is due', () => {
    expect(exportDue({ ...blockedOut, glb: true })).toBe(true);
  });

  test('a model whose GLB was ever committed is due, even if the file is gone', () => {
    expect(exportDue({ ...blockedOut, everCommitted: true })).toBe(true);
  });

  test('a model exported but not compressed (raw GLB only) is due', () => {
    expect(exportDue({ ...blockedOut, raw: true })).toBe(true);
  });

  test('a script with no .blend at all is due (nothing explains the missing GLB)', () => {
    expect(exportDue({ ...blockedOut, blend: false })).toBe(true);
  });

  test("when git can't answer, every model is due", () => {
    expect(exportDue({ ...blockedOut, everCommitted: null })).toBe(true);
  });

  test.skipIf(!BLENDER_SOURCES)('the committed probe is due', () => {
    expect(dueIds()).toContain('_probe');
  });
});

describe('glb', () => {
  test('probe model meets the pipeline contract', async () => {
    const glb = await inspectGlb(join(PUBLIC, '_probe.glb'));

    expect(glb.clips).toEqual(expect.arrayContaining(['appear', 'arrive', 'idle']));
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toContain('shadow');
    // Roles must survive compression as separate materials, even when they look identical.
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'accent']));
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(8000);

    expect(glb.textureSizes.length).toBeGreaterThan(0);
    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(120_000);
  });

  test('fettle meets the pipeline contract, with its clips, the power switch off/on and the trip receipt', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'fettle.glb'));

    expect(glb.clips).toEqual(expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'off', 'on', 'trip', 'tear']));
    // Task 16: the paper's second UV map, the receipt's print (fettle.py, `print`).
    const bytes = readFileSync(join(PUBLIC, 'fettle.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      meshes: { name?: string; primitives: { attributes: Record<string, number> }[] }[];
      nodes: { name?: string }[];
      animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
    };
    for (const name of ['paper', 'paper_spool']) {
      const mesh = gltf.meshes.find((m) => m.name === name);
      expect(mesh?.primitives[0]?.attributes, name).toHaveProperty('TEXCOORD_1');
    }
    // A poke moves parts, not the whole printer (the owner's test notes): the feed
    // button, the light and the paper, never the root.
    const poke = gltf.animations.find((a) => a.name === 'poke')!.channels.map((c) => gltf.nodes[c.target.node]!.name);
    expect(poke).toEqual(expect.arrayContaining(['button', 'status', 'paper_root']));
    expect(poke).not.toContain('fettle');
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'accent', 'paper', 'shadow']));
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }

    // Its 175 KB cap of Task 16 (the trip and tear's paper bones) folds into the model cap.
    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  // idiff's trays and cards are body, detail and paper; it has no accent. poke_card leaves the
  // card on the floor and poke_card_tidy puts it back; off/on drop the cards flat and raise them.
  test('idiff meets the pipeline contract, with its clips and the poke card to hit', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'idiff.glb'));

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_card', 'poke_card_tidy', 'off', 'on']),
    );
    // The object a click must hit to play poke_card (plan: poke_<name>_hit), read from the GLB's JSON chunk.
    const bytes = readFileSync(join(PUBLIC, 'idiff.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string }[];
    };
    expect(gltf.nodes.map((n) => n.name)).toContain('poke_card_hit');
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  // The desktop (a homelab sub-node): the PA602 with the build behind its glass and the Steam
  // Controller beside it. poke_panel swings the glass open and holds, poke_panel_tidy shuts it;
  // poke_controller buzzes the controller and plays its sticks; the fans spin in arrive, idle,
  // poke, off and on. A poke moves parts, never the whole model (the owner's test notes):
  // the tower's poke rattles the glass on `glass_hinge`, the glass's parent, so it never
  // keys the node poke_panel holds.
  test('desktop meets the pipeline contract, with its clips, the glass and the controller to hit', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'desktop.glb'));

    expect(glb.clips).toEqual(
      expect.arrayContaining([
        'appear', 'arrive', 'idle', 'poke', 'poke_panel', 'poke_panel_tidy', 'poke_controller', 'off', 'on',
      ]),
    );
    const bytes = readFileSync(join(PUBLIC, 'desktop.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; children?: number[] }[];
      animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
    };
    expect(gltf.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['poke_panel_hit', 'poke_controller_hit']));
    const index = (name: string) => gltf.nodes.findIndex((n) => n.name === name);
    const targets = (clip: string) =>
      gltf.animations.find((a) => a.name === clip)!.channels.map((c) => `${gltf.nodes[c.target.node]!.name}.${c.target.path}`);
    expect(gltf.nodes[index('glass_hinge')]!.children).toEqual([index('poke_panel_hit')]);
    expect(targets('poke')).toContain('glass_hinge.rotation');
    expect(targets('poke_controller')).toEqual(expect.arrayContaining(['stick_l.rotation', 'stick_r.rotation']));
    for (const clip of ['poke', 'poke_controller']) {
      expect(targets(clip).filter((t) => t.startsWith('desktop.')), clip).toEqual([]);
      expect(targets(clip).filter((t) => t.startsWith('poke_panel_hit.')), clip).toEqual([]);
    }
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'shadow']));
    expect(glb.materials).not.toContain('accent'); // the cluster's one accent is the router's light
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(SUB_NODE_TRIANGLES); // a homelab sub-node

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [512, 512];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[512, 512], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(SUB_NODE_BYTES);
  });

  // The fallback for projects the map doesn't know yet: a cardboard parcel (Batch C), under the
  // runtime's fallback id `box`. No status light, so no accent. poke_arrows flips the whole
  // parcel upside down (the root) and holds it there until poke_arrows_tidy; idle never moves
  // the root, so the runtime keeps it upside down while idle plays.
  test('the parcel (box) meets the pipeline contract, with its flaps and the arrows to hit', async () => {
    const path = join(PUBLIC, 'box.glb');
    const glb = await inspectGlb(path);

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_arrows', 'poke_arrows_tidy', 'off', 'on']),
    );
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    const bytes = readFileSync(path);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string }[];
      animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
    };
    const names = gltf.nodes.map((n) => n.name);
    expect(names).toEqual(
      expect.arrayContaining(['box', 'poke_arrows_hit', 'flap_front', 'flap_back', 'flap_left', 'flap_right']),
    );
    expect(names).not.toContain('status');
    const moved = (clip: string) =>
      gltf.animations.find((a) => a.name === clip)!.channels.map((c) => `${gltf.nodes[c.target.node]!.name}.${c.target.path}`);
    for (const clip of ['poke_arrows', 'poke_arrows_tidy']) {
      expect(moved(clip)).toContain('box.rotation');
      expect(moved(clip).every((t) => t.startsWith('box.'))).toBe(true);
    }
    expect(moved('idle').some((t) => t.startsWith('box.'))).toBe(false);

    expect(glb.textureSizes.length).toBeGreaterThan(0);
    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(PARCEL_BYTES);
  });

  // Notary's tick is a debossed impression drawn by the bake, so the model has no accent.
  test('notary meets the pipeline contract, with its clips and no accent', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'notary.glb'));

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_refuse', 'off', 'on']),
    );
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  // Eolietech's lines are relief in the greys (body and detail on white paper), so it has no
  // accent. The front card flips in arrive; off/on lean the cards back and up.
  test('eolietech meets the pipeline contract, with its clips and no accent', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'eolietech.glb'));

    expect(glb.clips).toEqual(expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'off', 'on']));
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);

    // An open model (the wire rack shows the mast through it): its root's extras carry the
    // footprint's radius, where links.ts stops its link, and the model stays inside it.
    const bytes = readFileSync(join(PUBLIC, 'eolietech.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as { nodes: { name?: string; extras?: Record<string, unknown> }[] };
    const open = gltf.nodes.find((n) => n.name === 'eolietech')?.extras?.['open_radius'];
    expect(typeof open).toBe('number');
    const { min, max } = await glbBounds(join(PUBLIC, 'eolietech.glb'), ['shadow']);
    for (const k of [0, 2]) expect(Math.max(-min[k]!, max[k]!), `axis ${k}`).toBeLessThanOrEqual((open as number) + 0.002);
  });

  // The traffic signal isn't a node: it rides the links (which arc off the floor), so it has
  // no contact-shadow plane. That's this asset's exception, not a looser shared contract.
  test('the traffic signal is a small accent pill with an idle clip and no floor shadow', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'signal.glb'));

    expect(glb.clips).toContain('idle');
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toContain('accent');
    expect(glb.materials).not.toContain('shadow');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(300);

    // applyRoleMaterials (src/shading.ts) needs a bake texture on every surface material.
    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      expect(sizes.length, `${name} has a bake texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual([512, 512]);
    }

    expect(glb.bytes).toBeLessThanOrEqual(120_000);
  });

  // The visitor (Task 11) is a gondola hanging from the line: airborne like the signal, so its
  // light bake has no floor, but docked its belly hangs just over the floor, so it keeps a
  // contact shadow (its root's `shadow_reach`). The runtime codes against its nodes:
  // the root `visitor` is the grip's pin on the line, at rest at
  // the origin, with the cabin's `drop` below the pin in its extras; `grip` is a clean pivot
  // the runtime pitches, which no clip keys; `swing` carries `cabin`, and only `boost` (a held
  // pose the runtime blends by weight) keys it; `dock`'s only position track but the shadow's
  // is the root's, which the runtime reads its entry speed from.
  test('the visitor is a gondola on the line with idle, dock and boost clips and a contact shadow', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'visitor.glb'));

    const bytes = readFileSync(join(PUBLIC, 'visitor.glb'));
    interface GNode {
      name?: string;
      children?: number[];
      translation?: number[];
      rotation?: number[];
      scale?: number[];
      extras?: Record<string, unknown>;
    }
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: GNode[];
      scenes: { nodes: number[] }[];
      animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
    };
    const index = (name: string) => gltf.nodes.findIndex((n) => n.name === name);
    const node = (name: string) => gltf.nodes[index(name)]!;
    for (const name of ['visitor', 'grip', 'swing', 'cabin', 'shadow']) expect(index(name), name).toBeGreaterThanOrEqual(0);
    const roots = gltf.scenes[0]!.nodes.map((i) => gltf.nodes[i]!.name);
    expect(roots).toEqual(expect.arrayContaining(['visitor', 'shadow']));
    expect(node('visitor').children).toEqual(expect.arrayContaining([index('grip'), index('swing')]));
    expect(node('swing').children).toContain(index('cabin'));
    // The pivots rest on the pin: no offset, turn or scale (compression mustn't fold one in).
    for (const name of ['visitor', 'grip', 'swing', 'cabin']) {
      const n = node(name);
      expect(n.translation ?? [0, 0, 0], `${name} translation`).toEqual([0, 0, 0]);
      expect(n.rotation ?? [0, 0, 0, 1], `${name} rotation`).toEqual([0, 0, 0, 1]);
      expect(n.scale ?? [1, 1, 1], `${name} scale`).toEqual([1, 1, 1]);
    }
    const drop = node('visitor').extras?.['drop'];
    expect(typeof drop).toBe('number');
    expect(drop as number).toBeGreaterThan(0.2);
    expect(drop as number).toBeLessThan(0.32);
    // The shadow sits on the docked floor, a little more than `drop` under the pin.
    const shadowY = node('shadow').translation?.[1] ?? 0;
    expect(-shadowY).toBeGreaterThan(drop as number);
    expect(-shadowY).toBeLessThan((drop as number) + 0.03);
    // The runtime's copies for the station fit (src/tuning.ts): the drop, and the docked floor
    // tuning.visitorDockGap under the belly (the plane a hair over it).
    expect(drop as number).toBeCloseTo(tuning.visitorDrop, 4);
    expect(-shadowY).toBeCloseTo((drop as number) + tuning.visitorDockGap, 2);

    expect(glb.clips).toEqual(expect.arrayContaining(['appear', 'idle', 'dock', 'boost']));
    const channels = (clip: string) =>
      gltf.animations.find((a) => a.name === clip)!.channels.map((c) => `${gltf.nodes[c.target.node]!.name}.${c.target.path}`);
    for (const a of gltf.animations) {
      for (const ch of channels(a.name)) {
        expect(ch.startsWith('grip.'), `${a.name} keys the grip`).toBe(false);
        if (a.name !== 'boost') expect(ch.startsWith('swing.'), `${a.name} keys swing`).toBe(false);
      }
    }
    expect(channels('boost')).toEqual(['swing.rotation']);
    expect(channels('idle')).toEqual(['cabin.rotation']);
    expect(channels('dock').filter((c) => c.endsWith('.translation') && !c.startsWith('shadow.'))).toEqual(['visitor.translation']);
    expect(channels('dock')).toContain('cabin.rotation');
    for (const m of glb.materials) expect(['body', 'detail', 'paper', 'accent', 'shadow']).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'accent', 'shadow']));
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    expect(glb.textureSizes.length).toBeGreaterThan(0);
    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  // candygoogy-bot's paper plane, spring launcher and stand are body, detail and paper; it has
  // no accent. off ends with the nose dipped and on starts there.
  test('candygoogy-bot meets the pipeline contract, with its clips and no accent', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'candygoogy-bot.glb'));

    expect(glb.clips).toEqual(expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'off', 'on', 'poke_stand']));
    // Task 17: the stand is a part of its own (a click on it plays poke_stand), and the plane a
    // node the runtime finds by name, to fly it to the server.
    const bytes = readFileSync(join(PUBLIC, 'candygoogy-bot.glb'));
    const names = (JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as { nodes: { name?: string }[] }).nodes.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['poke_stand_hit', 'plane']));
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  // homelab, the cluster's hub: the router (a MikroTik Chateau 5G R17 ax). Its LEDs are pegs
  // the clips sink and raise, the system LED the cluster's only accent; poke_sim pops the SIM
  // card out (the `poke_sim_hit` part pointer.ts names `sim`) and holds it, the antennas
  // sagging, and poke_sim_tidy pushes it back.
  test('homelab meets the pipeline contract, with its LED clips and the SIM poke', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'homelab.glb'));

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_sim', 'poke_sim_tidy', 'off', 'on']),
    );
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'accent', 'paper', 'shadow']));
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    const bytes = readFileSync(join(PUBLIC, 'homelab.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string }[];
      animations: { name: string; channels: { target: { node: number } }[] }[];
    };
    expect(gltf.nodes.map((n) => n.name)).toContain('poke_sim_hit');
    const moved = (clip: string) =>
      gltf.animations.find((a) => a.name === clip)!.channels.map((c) => gltf.nodes[c.target.node]!.name);
    // The SIM is at the back, out of the station camera's sight: the antennas answer it on the
    // front (they sag with the SIM out, perk up with it back), and hunt in the plain poke.
    expect(moved('poke_sim').sort()).toEqual(['antenna_l', 'antenna_r', 'poke_sim_hit']);
    expect(moved('poke_sim_tidy').sort()).toEqual(['antenna_l', 'antenna_r', 'poke_sim_hit']);
    expect(moved('poke')).toEqual(expect.arrayContaining(['antenna_l', 'antenna_r', 'sig_1']));
    expect(moved('off')).not.toContain('antenna_l');
    expect(moved('off')).not.toContain('poke_sim_hit');

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  // The switch (a homelab sub-node: 9,000 triangles and 130 KB) has no accent: the router's light
  // is the cluster's only one. What a light shows when it goes out is `lamp`, dark in both
  // themes, so an out light reads against a lit one (`paper`) in the dark theme too. Its lights are Etherlighting (the lit ports' openings and plugs;
  // an empty port has no link) and the system LED, morph targets of `lights`, and port 3's,
  // whose plug is the poke cable's, of `port_3_light` under `port_3_link`: a light clip is a
  // `weights` channel on each. poke_cable moves the cable and shrinks port_3_link (the plug out,
  // no light) and never the lights, so the runtime lets off, on, idle and poke play round a
  // cable left on the floor.
  // Port 8 holds the server's Ethernet cable's boot: the cable is a line the map draws, and the
  // root's extras carry where it ends, as the server's do (`cable_end`, `cable_dir`).
  test('the switch meets the sub-node budget, with its lights as morph targets, the cable to hit and the cable end', async () => {
    const path = join(PUBLIC, 'switch.glb');
    const glb = await inspectGlb(path);

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_cable', 'poke_cable_tidy', 'off', 'on']),
    );
    const bytes = readFileSync(path);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; mesh?: number; extras?: Record<string, unknown> }[];
      meshes: { name?: string; extras?: { targetNames?: string[] }; primitives: { targets?: unknown[] }[] }[];
      animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
    };
    expect(gltf.nodes.map((n) => n.name)).toContain('poke_cable_hit');
    const extras = gltf.nodes.find((n) => n.name === 'switch')?.extras ?? {};
    const end = extras['cable_end'] as number[];
    const dir = extras['cable_dir'] as number[];
    expect(end).toHaveLength(3);
    expect(dir).toHaveLength(3);
    for (const v of [...end, ...dir]) expect(Number.isFinite(v)).toBe(true);
    expect(end[1]).toBeGreaterThan(0); // above the floor, in port 8's boot
    expect(end[1]).toBeLessThan(0.07);
    expect(Math.hypot(end[0]!, end[2]!)).toBeLessThan(0.6); // inside the ground ring
    expect(Math.hypot(...dir)).toBeCloseTo(1, 3);
    expect(dir[1]).toBeCloseTo(0, 3); // it leaves level, out of the port face
    // Out of the port face, which points 133 degrees from +z toward +x (turned from 77 for the
    // real wiring, so the cables leave the ports toward their devices).
    expect(Math.atan2(dir[0]!, dir[2]!) * (180 / Math.PI)).toBeCloseTo(133, 0);
    // Port 8 is the rightmost RJ45 seen from the front: its plug is right of the box's centre
    // (the model's right is (dir.z, -dir.x) across the floor), and the cable starts in front.
    expect(end[0]! * dir[2]! - end[2]! * dir[0]!).toBeGreaterThan(0.04);
    expect(end[0]! * dir[0]! + end[2]! * dir[2]!).toBeGreaterThan(0.2);
    // The real wiring (2026-10-21): ports 1, 2, 3 and 8 are plugged, so only they are lit.
    const lights = gltf.meshes.find((m) => m.name === 'lights');
    const names = ['light_1', 'light_2', 'light_8', 'light_system'];
    expect(lights?.extras?.targetNames).toEqual(names);
    expect(lights?.primitives[0]?.targets).toHaveLength(names.length);
    const port3 = gltf.meshes.find((m) => m.name === 'port_3_light');
    expect(port3?.extras?.targetNames).toEqual(['light_3']);
    const targets = (clip: string) =>
      gltf.animations.find((a) => a.name === clip)!.channels.map((c) => `${gltf.nodes[c.target.node]!.name}.${c.target.path}`);
    for (const clip of ['arrive', 'poke', 'off', 'on']) expect(targets(clip).sort()).toEqual(['lights.weights', 'port_3_light.weights']);
    expect(targets('idle')).toEqual(['lights.weights']);
    for (const clip of ['poke_cable', 'poke_cable_tidy']) {
      expect(targets(clip)).toContain('poke_cable_hit.rotation');
      expect(targets(clip)).toContain('port_3_link.scale');
      expect(targets(clip).some((t) => t.startsWith('lights.') || t.startsWith('port_3_light.'))).toBe(false);
    }
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'lamp', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(SUB_NODE_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [512, 512];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[512, 512], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(SUB_NODE_BYTES);
  });

  // ap, a homelab sub-node: the U7 Pro Wall installed on a cut-away wall. No accent (the
  // router's light is the cluster's only one). The Wi-Fi arcs rest folded and grow out in
  // arrive, idle and on; the LED is a peg that sinks in off; poke is the crowd: four gadgets
  // pop up from behind the wall, and only they and the LED move.
  test('ap meets the pipeline contract, with its arcs, the LED and the crowd poke', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'ap.glb'));

    expect(glb.clips).toEqual(expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'off', 'on']));
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(SUB_NODE_TRIANGLES); // a homelab sub-node

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [512, 512];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[512, 512], [128, 128]]).toContainEqual(s);

    const bytes = readFileSync(join(PUBLIC, 'ap.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; scale?: number[] }[];
      animations: { name: string; channels: { target: { node: number } }[] }[];
    };
    const node = (name: string) => gltf.nodes.find((n) => n.name === name);
    const arcs = ['arc_1', 'arc_2', 'arc_3'];
    const crowd = ['gadget_phone', 'gadget_bulb', 'gadget_speaker', 'gadget_toaster'];
    for (const name of [...arcs, ...crowd, 'light_line', 'wall']) expect(node(name), name).toBeDefined();
    for (const name of arcs) for (const s of node(name)!.scale ?? [1, 1, 1]) expect(s, `${name} rests folded`).toBeLessThan(0.01);
    const moved = (clip: string) =>
      new Set(gltf.animations.find((a) => a.name === clip)!.channels.map((c) => gltf.nodes[c.target.node]!.name));
    expect([...moved('poke')].sort()).toEqual([...crowd, 'light_line'].sort());
    expect([...moved('idle')].sort()).toEqual(arcs);
    expect([...moved('off')]).toEqual(['light_line']);
    for (const clip of ['arrive', 'on']) expect([...moved(clip)].sort()).toEqual([...arcs, 'light_line'].sort());

    expect(glb.bytes).toBeLessThanOrEqual(SUB_NODE_BYTES);
  });

  // The laptop (the homelab's Zenbook 14) is a sub-node: ≤ 9,000 triangles and ≤ 130 KB.
  // Its lid and its ErgoLift tilt move together in every clip; off ends shut and on starts there.
  test('laptop meets the sub-node contract, with its clips, the lid and the tilt', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'laptop.glb'));

    expect(glb.clips).toEqual(expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'off', 'on']));
    const bytes = readFileSync(join(PUBLIC, 'laptop.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string }[];
      animations: { name: string; channels: { target: { node: number } }[] }[];
    };
    const names = gltf.nodes.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['laptop', 'tilt', 'base', 'lid']));
    for (const clip of ['arrive', 'poke', 'off', 'on']) {
      const moved = gltf.animations.find((a) => a.name === clip)!.channels.map((c) => names[c.target.node]);
      expect(moved, clip).toEqual(expect.arrayContaining(['lid', 'tilt']));
    }
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(SUB_NODE_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [512, 512];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[512, 512], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(SUB_NODE_BYTES);
  });

  // The server (the homelab's Lenovo V15, lid shut) is a sub-node: ≤ 9,000 triangles and ≤ 130 KB.
  // It lies on a fan cooling pad with a USB-C dock beside it; the Ethernet cable to
  // the switch is a line the map draws, so the root's extras carry where it ends: `cable_end`,
  // inside the RJ45 boot in the dock's rear, and `cable_dir`, the way the cable leaves it (both
  // in the GLB's scene space, Three.js axes, the root's facing applied).
  test('server meets the sub-node contract, with its clips, the lid and the cable end', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'server.glb'));

    // blink: Task 17's plane landed on the lid with work.
    expect(glb.clips).toEqual(expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'off', 'on', 'blink']));
    const bytes = readFileSync(join(PUBLIC, 'server.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; scale?: number[]; extras?: Record<string, unknown> }[];
      animations: { name: string; channels: { target: { node: number } }[] }[];
    };
    const names = gltf.nodes.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['server', 'body', 'lid', 'screen_glow', 'backlight', 'light_activity', 'dock']));
    // The screen's glow and the keyboard's backlight rest folded away (the lid shut, the machine
    // dark); the lid is one flat top (Task 17's plane lands on it).
    for (const name of ['screen_glow', 'backlight'])
      for (const s of gltf.nodes.find((n) => n.name === name)!.scale ?? [1, 1, 1]) expect(s, name).toBeLessThan(0.01);
    const moved = (clip: string) =>
      new Set(gltf.animations.find((a) => a.name === clip)!.channels.map((c) => names[c.target.node]));
    for (const clip of ['arrive', 'poke', 'off', 'on']) expect([...moved(clip)], clip).toContain('lid');
    expect([...moved('poke')].sort()).toEqual(['backlight', 'lid', 'screen_glow']);
    expect([...moved('idle')]).toEqual(['light_activity']);
    for (const clip of ['arrive', 'off', 'on']) expect([...moved(clip)], clip).toContain('light_activity');

    const extras = gltf.nodes.find((n) => n.name === 'server')?.extras ?? {};
    const end = extras['cable_end'] as number[];
    const dir = extras['cable_dir'] as number[];
    expect(end).toHaveLength(3);
    expect(dir).toHaveLength(3);
    for (const v of [...end, ...dir]) expect(Number.isFinite(v)).toBe(true);
    expect(end[1]).toBeGreaterThan(0); // above the floor, in the boot
    expect(end[1]).toBeLessThan(0.05);
    expect(Math.hypot(end[0]!, end[2]!)).toBeLessThan(0.6); // inside the ground ring
    expect(Math.hypot(...dir)).toBeCloseTo(1, 3);
    expect(dir[1]).toBeCloseTo(0, 3); // it leaves level, along the floor
    // The end is at the model's edge, and the cable leaves outwards, away from the model.
    expect(end[0]! * dir[0]! + end[2]! * dir[2]!).toBeGreaterThan(0);

    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent'); // the cluster's one accent is the router's light
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(SUB_NODE_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [512, 512];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[512, 512], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(SUB_NODE_BYTES);
  });

  // The homelab's real wiring (the owner's test notes, 2026-10-21 afternoon): every cable and cord
  // is a line the map draws (src/world/cable.ts) between two plugs, so each model carries its
  // plugs and its root's extras say where each line ends (`<at>_end`, in the GLB's scene space,
  // the root's facing applied) and the way it leaves (`<at>_dir`, level, unit length). The AP is
  // powered over PoE (no cord); the laptop is on Wi-Fi (no cable).
  test("the cluster's models carry their cables' and cords' ends", () => {
    const ENDS: Record<string, string[]> = {
      homelab: ['cable', 'power'],
      switch: ['cable', 'port1', 'port2', 'port3', 'power'],
      ap: ['cable'],
      desktop: ['cable', 'power'],
      laptop: ['power'],
      server: ['cable', 'power'],
    };
    for (const [id, ats] of Object.entries(ENDS)) {
      const bytes = readFileSync(join(PUBLIC, `${id}.glb`));
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
        nodes: { name?: string; extras?: Record<string, unknown> }[];
      };
      const extras = gltf.nodes.find((n) => n.name === id)?.extras ?? {};
      const keys = Object.keys(extras).filter((k) => k.endsWith('_end')).sort();
      expect(keys, id).toEqual(ats.map((a) => `${a}_end`).sort());
      for (const at of ats) {
        const end = extras[`${at}_end`] as number[];
        const dir = extras[`${at}_dir`] as number[];
        expect(end, `${id} ${at}_end`).toHaveLength(3);
        expect(dir, `${id} ${at}_dir`).toHaveLength(3);
        for (const v of [...end, ...dir]) expect(Number.isFinite(v)).toBe(true);
        expect(end[1], `${id} ${at}: above the floor`).toBeGreaterThan(0);
        expect(end[1], `${id} ${at}: no higher than the desktop's rear I/O`).toBeLessThan(0.4);
        expect(Math.hypot(end[0]!, end[2]!), `${id} ${at}: by the model`).toBeLessThan(0.7);
        expect(Math.hypot(...dir), `${id} ${at}_dir`).toBeCloseTo(1, 3);
        expect(dir[1], `${id} ${at}: it leaves level`).toBeCloseTo(0, 3);
        // At the model's edge, leaving outwards, away from its middle.
        expect(end[0]! * dir[0]! + end[2]! * dir[2]!, `${id} ${at}: leaves outwards`).toBeGreaterThan(0);
      }
    }
    // The switch's ports 1-3 land on the floor (the poke cable's foot is port 3's), left of port
    // 8 seen from the front, one after another along the port face.
    const sw = JSON.parse(
      ((b) => b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'))(readFileSync(join(PUBLIC, 'switch.glb'))),
    ) as { nodes: { name?: string; extras?: Record<string, number[]> }[] };
    const x = sw.nodes.find((n) => n.name === 'switch')!.extras!;
    const right = (v: number[]) => v[0]! * x['cable_dir']![2]! - v[2]! * x['cable_dir']![0]!;
    for (const k of ['port1_end', 'port2_end', 'port3_end']) expect(x[k]![1], k).toBeLessThan(0.01);
    expect(right(x['port1_end']!)).toBeLessThan(right(x['port2_end']!));
    expect(right(x['port2_end']!)).toBeLessThan(right(x['port3_end']!));
    expect(right(x['port3_end']!)).toBeLessThan(right(x['cable_end']!));
  });

  // The power strip (strips A and B, src/world/cable.ts): not a node, so no clips, no ground ring;
  // a sub-node's caps are far more than it needs. The plugs on it are templates the runtime clones
  // onto the sockets: each says where its cord leaves (`cord_end`, `cord_dir`, its own frame), the
  // root where the four sockets are (`sockets`). The rocker's lens is lit (`paper`), no accent.
  test('the strip meets the sub-node caps, with its sockets and its plug templates', async () => {
    const path = join(PUBLIC, 'strip.glb');
    const glb = await inspectGlb(path);
    expect(glb.clips).toEqual([]);
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(3_000); // far under a sub-node's 9,000

    const bytes = readFileSync(path);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; extras?: Record<string, unknown> }[];
    };
    const node = (name: string) => gltf.nodes.find((n) => n.name === name);
    for (const name of ['strip', 'strip_body', 'rocker', 'adapter', 'charger', 'plug']) expect(node(name), name).toBeDefined();
    const sockets = node('strip')!.extras!['sockets'] as number[];
    expect(sockets).toHaveLength(12);
    for (let i = 0; i < 4; i++) {
      expect(sockets[i * 3 + 1], 'on the top').toBeGreaterThan(0.02);
      if (i) expect(sockets[i * 3]!, 'along the strip').toBeGreaterThan(sockets[(i - 1) * 3]!);
    }
    for (const name of ['adapter', 'charger', 'plug']) {
      const end = node(name)!.extras!['cord_end'] as number[];
      const dir = node(name)!.extras!['cord_dir'] as number[];
      expect(end, name).toHaveLength(3);
      expect(dir, name).toEqual([0, 0, 1]); // out of the strip's front
      expect(end[2], `${name}: out in front of its socket`).toBeGreaterThan(0.02);
      expect(end[1], `${name}: above the strip's top`).toBeGreaterThan(0);
    }

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [512, 512];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    expect(glb.bytes).toBeLessThanOrEqual(SUB_NODE_BYTES);
    expect(glb.bytes).toBeLessThanOrEqual(70_000); // far under it
  });

  // The switch's power brick (the owner, 2026-10-22 midday; src/world/cable.ts's BRICKS): not a
  // node either, so no clips and no ground ring, a sub-node's caps far more than it needs. Its
  // root says where its two leads leave it (`dc_end`/`dc_dir` out of the -x end, `mains_end`/
  // `mains_dir` out of the +x end, level), its status light is lit (`paper`), and it has no
  // accent and no logo (spec: no logos; nothing but its shell, seam, panel, light and leads).
  test("the brick meets the sub-node caps, with its two leads' ends and a lit status light", async () => {
    const path = join(PUBLIC, 'psu.glb');
    const glb = await inspectGlb(path);
    expect(glb.clips).toEqual([]);
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(500);
    expect(glb.triangles).toBeLessThanOrEqual(4_000); // far under a sub-node's 9,000

    const bytes = readFileSync(path);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; extras?: Record<string, unknown> }[];
    };
    const node = (name: string) => gltf.nodes.find((n) => n.name === name);
    for (const name of ['psu', 'brick', 'light']) expect(node(name), name).toBeDefined();
    const x = node('psu')!.extras!;
    for (const [at, sign] of [['dc', -1], ['mains', 1]] as const) {
      const end = x[`${at}_end`] as number[];
      expect(end, at).toHaveLength(3);
      expect(x[`${at}_dir`], at).toEqual([sign, 0, 0]); // out along the brick, level
      expect(end[0]! * sign, `${at}: past the brick's end`).toBeGreaterThan(0.15);
      expect(end[0]! * sign, `${at}: by it`).toBeLessThan(0.22);
      expect(end[1], `${at}: low on its end`).toBeGreaterThan(0.01);
      expect(end[1], `${at}: low on its end`).toBeLessThan(0.04);
      expect(Math.abs(end[2]!), `${at}: on its middle`).toBeLessThan(1e-3);
    }
    // About 0.6 of the switch's 0.50 long, flat.
    const b = await glbBounds(path, ['shadow']);
    expect(b.max[1]! - b.min[1]!).toBeLessThan(0.07);
    const body = await glbBounds(path, ['shadow', 'paper']);
    expect(body.max[2]! - body.min[2]!).toBeLessThan(0.16);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [512, 512];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    expect(glb.bytes).toBeLessThanOrEqual(SUB_NODE_BYTES);
    expect(glb.bytes).toBeLessThanOrEqual(70_000); // far under it
  });

  // siel-eolie, the consumer unit: the pilot light is its only accent. The moving toggles and the
  // light's lens are one mesh's morph targets, so a clip moves them on one `weights` channel; the
  // RCD is poke_test_hit (its T button a child), and poke_test / poke_test_tidy hold the trip.
  test('siel-eolie meets the pipeline contract, with its toggles as morph targets and the RCD to hit', async () => {
    const path = join(PUBLIC, 'siel-eolie.glb');
    const glb = await inspectGlb(path);

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_test', 'poke_test_tidy', 'off', 'on']),
    );
    const bytes = readFileSync(path);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; children?: number[] }[];
      meshes: { name?: string; extras?: { targetNames?: string[] }; primitives: { targets?: unknown[] }[] }[];
      animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
    };
    const names = gltf.nodes.map((n) => n.name);
    expect(names).toContain('poke_test_hit');
    const hit = gltf.nodes.find((n) => n.name === 'poke_test_hit')!;
    expect((hit.children ?? []).map((i) => gltf.nodes[i]!.name)).toContain('test_button');
    const toggles = gltf.meshes.find((m) => m.name === 'toggles');
    const keys = ['main', 'rcd', 'breaker_1', 'breaker_2', 'breaker_3', 'breaker_4', 'breaker_5', 'breaker_7', 'lamp'];
    expect(toggles?.extras?.targetNames).toEqual(keys);
    for (const p of toggles?.primitives ?? []) expect(p.targets).toHaveLength(keys.length);
    const targets = (clip: string) =>
      gltf.animations.find((a) => a.name === clip)!.channels.map((c) => `${gltf.nodes[c.target.node]!.name}.${c.target.path}`);
    for (const clip of ['poke_test_tidy', 'off', 'on']) expect(targets(clip)).toEqual(['toggles.weights']);
    // The trip's bang knocks the door on its hinges, so poke_test reads at station distance.
    expect(targets('poke_test')).toEqual(
      expect.arrayContaining(['toggles.weights', 'test_button.translation', 'door.rotation']),
    );
    expect(targets('arrive')).toEqual(expect.arrayContaining(['toggles.weights', 'door.rotation']));
    // idle moves only the tag, so the held trip (poke_test's toggles) never mixes with it.
    expect(targets('idle')).toEqual(['tag.rotation']);
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'accent', 'paper', 'shadow']));
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  // exit is a door in its frame with a doormat, in body and detail only (no accent). The leaf is
  // `poke_door_hit` (Task 16 reads a hit on it as "leave"); the mat is `poke_mat_hit`, its corner
  // a child of it, so poke_mat flips the corner over the key and poke_mat_tidy lays it back.
  // `leave` is Task 16's swing as the camera turns away. The links' mast stands on the mat at the
  // node's centre: the root's origin is the mat's middle and the door stands behind it.
  test('exit meets the pipeline contract, with its clips, the door and the mat to hit', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'exit.glb'));

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_mat', 'poke_mat_tidy', 'off', 'on', 'leave']),
    );
    const bytes = readFileSync(join(PUBLIC, 'exit.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; children?: number[] }[];
    };
    const index = (name: string) => gltf.nodes.findIndex((n) => n.name === name);
    for (const name of ['poke_door_hit', 'poke_mat_hit', 'mat_corner', 'knob']) expect(index(name), name).toBeGreaterThanOrEqual(0);
    expect(gltf.nodes[index('poke_mat_hit')]!.children).toContain(index('mat_corner'));
    expect(gltf.nodes[index('poke_door_hit')]!.children).toContain(index('knob'));
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(EXIT_BYTES);

    // On the floor, and the tallest model in its batch without towering (0.86 to the cap's top).
    const { min, max } = await glbBounds(join(PUBLIC, 'exit.glb'), ['shadow']);
    expect(min[1]!).toBeCloseTo(0, 3);
    expect(max[1]!).toBeGreaterThan(0.8);
    expect(max[1]!).toBeLessThan(0.9);
  });

  // origin, the hub: a small server on a round plinth, the status light its one accent. The power
  // switch's housing is `poke_power_hit` (Task 15 reads a hit on it as the switch), with the cover
  // (the blank sticky note its child) and the toggle as its children, so a click anywhere on the
  // switch is the switch. Sled 2 is `poke_drive_hit`; poke_drive leaves it half out until
  // poke_drive_tidy. The light's top stays at the blockout's 0.65, so the hub lift
  // (tuning.flightHubClearance over the model's top) is as it was, and below 0.35 nothing leaves
  // radius 0.6 (the gondola's turnaround ring).
  test('origin meets the pipeline contract, with its clips, the power switch and the drive to hit', async () => {
    const path = join(PUBLIC, 'origin.glb');
    const glb = await inspectGlb(path);

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_drive', 'poke_drive_tidy', 'poke_power', 'off', 'on']),
    );
    const bytes = readFileSync(path);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; children?: number[] }[];
      animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
    };
    const index = (name: string) => gltf.nodes.findIndex((n) => n.name === name);
    for (const name of ['tower', 'poke_power_hit', 'cover', 'note', 'toggle', 'poke_drive_hit', 'fan', 'light']) {
      expect(index(name), name).toBeGreaterThanOrEqual(0);
    }
    expect(gltf.nodes[index('poke_power_hit')]!.children).toEqual(expect.arrayContaining([index('cover'), index('toggle')]));
    expect(gltf.nodes[index('cover')]!.children).toContain(index('note'));
    // Task 17's taped switch: the tape is the switch's too, folded out of sight at rest, with the
    // scale that unfolds it and the point it unfolds about in its extras; poke_power_taped strains
    // the cover against it. tape_on (the owner's test notes, 2026-10-21) puts it on: `tape_roll`,
    // hidden at rest, rolls down the cover laying the strip (its roll_<k> morph targets).
    const tape = gltf.nodes[index('tape')] as { scale?: number[]; extras?: { unfold?: number; unfold_at?: number[] } };
    expect(gltf.nodes[index('poke_power_hit')]!.children).toEqual(expect.arrayContaining([index('tape'), index('tape_roll')]));
    expect(tape.extras?.unfold).toBe(1000);
    expect(tape.extras?.unfold_at).toHaveLength(3);
    expect(glb.clips).toEqual(expect.arrayContaining(['poke_power_taped', 'tape_on']));
    const targets = (clip: string) =>
      new Set(gltf.animations.find((a) => a.name === clip)!.channels.map((c) => `${gltf.nodes[c.target.node]!.name}.${c.target.path}`));
    expect([...targets('poke_power')]).toEqual(expect.arrayContaining(['cover.rotation', 'note.rotation', 'toggle.rotation']));
    expect([...targets('off')]).toEqual(expect.arrayContaining(['toggle.rotation', 'light.translation', 'fan.rotation']));
    expect([...targets('on')]).toEqual(expect.arrayContaining(['toggle.rotation', 'cover.rotation', 'light.translation', 'fan.rotation']));
    expect([...targets('poke_drive')]).toEqual(['poke_drive_hit.translation']);
    expect([...targets('poke_power_taped')].sort()).toEqual(['cover.rotation', 'note.rotation', 'tape.weights']);
    expect([...targets('tape_on')].sort()).toEqual(['tape.weights', 'tape_roll.scale', 'tape_roll.translation']);
    // idle and the held sled never key the same channel: the runtime holds poke_drive over idle.
    const idle = targets('idle');
    for (const k of targets('poke_drive')) expect(idle.has(k), k).toBe(false);

    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'accent', 'paper', 'shadow']));
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    // The origin's own cap (the owner's budgets raised: 300 KB, 18,000 triangles); tape_on's
    // strip with torn ends, its dark rim and its roll take about 1,900 triangles and 25 KB of it.
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    // The bake is 512 px, to stay inside the 300 KB ceiling: its islands now fill the atlas (they
    // were packed to nothing before), and at 1024 px the model needs about 360 KB, the owner's call.
    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [512, 512];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[512, 512], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(ORIGIN_BYTES);

    // On the floor, the light's top at the blockout's 0.65, the plinth 1.10 across.
    const { min, max } = await glbBounds(path, ['shadow']);
    expect(min[1]!).toBeCloseTo(0, 3);
    expect(max[1]!).toBeGreaterThan(0.64);
    expect(max[1]!).toBeLessThanOrEqual(0.651);
    for (const k of [0, 2]) {
      expect(min[k]!).toBeGreaterThanOrEqual(-0.56);
      expect(max[k]!).toBeLessThanOrEqual(0.56);
    }
  });

  // The power going off darkens the lens where it is (the runtime takes the accent to --lamp)
  // instead of sinking it out of sight, so from the overview the origin's dot goes dark rather
  // than vanishing (the owner's test notes, 2026-10-21): off's light only flickers (a dip of at
  // most 0.025) and ends at rest, held there; on starts from there.
  test('origin: off leaves the light up in its bore, and on starts it there', async () => {
    const doc = await readGlb(join(PUBLIC, 'origin.glb'));
    const root = doc.getRoot();
    const light = root.listNodes().find((n) => n.getName() === 'light')!;
    const rest = light.getTranslation()[1];
    const heights = (clip: string) => {
      const anim = root.listAnimations().find((a) => a.getName() === clip)!;
      const ch = anim.listChannels().find((c) => c.getTargetNode() === light && c.getTargetPath() === 'translation')!;
      const out = ch.getSampler()!.getOutput()!;
      return Array.from({ length: out.getCount() }, (_, i) => out.getElement(i, [])[1]!);
    };
    const off = heights('off');
    expect(Math.min(...off)).toBeGreaterThan(rest - 0.025);
    expect(off.at(-1)!).toBeCloseTo(rest, 3);
    expect(heights('on')[0]!).toBeCloseTo(rest, 3);
  });

  // tape_on lays the tape: the strip's weights walk its roll_<k> stages in order and end on none
  // (its rest: laid and pressed down, as the runtime leaves it), the strip is paper (light in
  // both themes), and the roll is hidden at its start and end and full size between.
  test('origin: tape_on unrolls the paper tape stage by stage and leaves it laid, the roll hidden at rest', async () => {
    const doc = await readGlb(join(PUBLIC, 'origin.glb'));
    const root = doc.getRoot();
    const tapeNode = root.listNodes().find((n) => n.getName() === 'tape')!;
    const mesh = tapeNode.getMesh()!;
    const names = (mesh.getExtras() as { targetNames?: string[] }).targetNames ?? [];
    expect(names[0]).toBe('strain');
    const stages = names.filter((n) => /^roll_\d\d$/.test(n));
    expect(stages.length).toBeGreaterThanOrEqual(8);
    // paper, with a detail rim under its edges: its outline on the light body
    expect(mesh.listPrimitives().map((p) => p.getMaterial()?.getName())).toEqual(['paper', 'detail']);
    expect(mesh.getWeights().every((w) => w === 0)).toBe(true);

    const anim = root.listAnimations().find((a) => a.getName() === 'tape_on')!;
    const channel = (node: string, path: string) =>
      anim.listChannels().find((c) => c.getTargetNode()?.getName() === node && c.getTargetPath() === path)!;
    const sample = (node: string, path: string) => {
      const out = channel(node, path).getSampler()!.getOutput()!;
      const input = channel(node, path).getSampler()!.getInput()!;
      const n = out.getCount();
      const size = path === 'weights' ? names.length : 3;
      const flat: number[] = [];
      for (let i = 0; i < n; i++) flat.push(...out.getElement(i, []));
      return Array.from({ length: input.getCount() }, (_, k) => flat.slice(k * size, k * size + size));
    };
    const weights = sample('tape', 'weights');
    const stage = (w: number[]) => {
      const s = w.slice(1);
      const top = Math.max(...s);
      return top < 1e-3 ? null : s.indexOf(top);
    };
    // the first key lays the first stage, the stages after only go forward, the last key is rest
    expect(stage(weights[0]!)).toBe(0);
    const seen = weights.map(stage).filter((s): s is number => s !== null);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen.at(-1)).toBe(stages.length - 1);
    expect(weights.at(-1)!.every((w) => Math.abs(w) < 1e-3)).toBe(true);
    for (const w of weights) expect(Math.abs(w[0]!)).toBeLessThan(1e-3); // no strain while it goes on

    const roll = root.listNodes().find((n) => n.getName() === 'tape_roll')!;
    expect(Math.max(...roll.getScale())).toBeLessThan(0.01); // hidden at rest
    const scales = sample('tape_roll', 'scale').map((s) => Math.max(...s));
    expect(scales[0]!).toBeLessThan(0.01);
    expect(scales.at(-1)!).toBeLessThan(0.01);
    expect(Math.max(...scales)).toBeGreaterThan(0.9);
    // it travels down the cover's face and the housing's (glTF Y is up)
    const ys = sample('tape_roll', 'translation').map((t) => t[1]!);
    expect(ys[0]! - Math.min(...ys)).toBeGreaterThan(0.06);
  });

  // dolci-eoliani's box is body, its ribbon detail, the slip, liner and glaze paper; it has no
  // accent. poke_bow unties the bow (the part under `poke_bow_hit`) and leaves the tails on the
  // floor (shape keys), poke_bow_tidy ties it back; the slip folds on a skinned rig in arrive.
  test('dolci-eoliani meets the pipeline contract, with its clips, the bow to hit, the tails and the slip', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'dolci-eoliani.glb'));

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_bow', 'poke_bow_tidy', 'off', 'on']),
    );
    const bytes = readFileSync(join(PUBLIC, 'dolci-eoliani.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; mesh?: number; children?: number[]; skin?: number }[];
      meshes: { name?: string; primitives: { targets?: unknown[] }[] }[];
      skins?: unknown[];
      animations: { name?: string; channels: { target: { node: number; path: string } }[] }[];
    };
    const names = gltf.nodes.map((n) => n.name);
    for (const n of ['poke_bow_hit', 'bow', 'tails', 'curl_left', 'curl_right', 'slip', 'lid']) expect(names).toContain(n);
    // The tails carry two shape keys (lift, floor) that poke_bow keys; the slip paper is skinned.
    const tails = gltf.meshes.find((m) => m.name === 'tails');
    expect(tails?.primitives[0]?.targets?.length).toBe(2);
    expect(gltf.skins?.length).toBe(1);
    const pokeBow = gltf.animations.find((a) => a.name === 'poke_bow');
    expect(pokeBow?.channels.some((c) => c.target.path === 'weights')).toBe(true);
    // idle and poke_bow never key the same channel: the runtime holds poke_bow over idle.
    const keyed = (name: string) =>
      new Set(gltf.animations.find((a) => a.name === name)?.channels.map((c) => `${c.target.node}.${c.target.path}`));
    const idle = keyed('idle');
    for (const k of keyed('poke_bow')) expect(idle.has(k), k).toBe(false);

    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  test('experiments meets the pipeline contract, with a poke and a hit object per experiment', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'experiments.glb'));
    const ids = ['battery', 'compose', 'keyboard', 'logscope', 'mail', 'photo', 'subnet', 'next'];

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'off', 'on', ...ids.map((id) => `poke_${id}`)]),
    );
    // Each object a click must hit to play its poke_<id> (plan: poke_<name>_hit), from the GLB's JSON chunk.
    const bytes = readFileSync(join(PUBLIC, 'experiments.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string }[];
    };
    const names = gltf.nodes.map((n) => n.name);
    for (const id of ids) expect(names).toContain(`poke_${id}_hit`);
    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  // colophon's type case, sort drawer, books and composing stick are body, detail and paper; no
  // accent. A click on the stick plays poke_stick (the turned sort stays) and poke_stick_tidy.
  // Task 17's desk lamp (secret 6): a click on it plays poke_lamp, its chain pulled and the lit
  // glass (paper, over the unlit shade in body) gone for a moment; its cap is the model cap.
  // The case's six columns of sorts are one mesh with a shape key each, so arrive's wave is one
  // weights track, and off ends with the case in its slot, where on starts.
  test('colophon meets the pipeline contract, with its clips, the stick to hit and the sorts as shape keys', async () => {
    const glb = await inspectGlb(join(PUBLIC, 'colophon.glb'));

    expect(glb.clips).toEqual(
      expect.arrayContaining(['appear', 'arrive', 'idle', 'poke', 'poke_stick', 'poke_stick_tidy', 'poke_lamp', 'off', 'on']),
    );
    const bytes = readFileSync(join(PUBLIC, 'colophon.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; mesh?: number }[];
      meshes: { name?: string; primitives: { targets?: unknown[] }[] }[];
      animations: { name?: string; channels: { target: { node?: number; path: string } }[] }[];
    };
    expect(gltf.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['poke_stick_hit', 'poke_lamp_hit', 'lamp_glow', 'lamp_chain']));
    const sorts = gltf.meshes.find((m) => m.name === 'sorts');
    expect(sorts?.primitives[0]?.targets).toHaveLength(6);
    const arrive = gltf.animations.find((a) => a.name === 'arrive');
    expect(arrive?.channels.map((c) => c.target.path)).toContain('weights');

    for (const m of glb.materials) expect(ROLES).toContain(m);
    expect(glb.materials).toEqual(expect.arrayContaining(['body', 'detail', 'paper', 'shadow']));
    expect(glb.materials).not.toContain('accent');
    expect(new Set(glb.materials).size).toBe(glb.materials.length);
    expect(glb.triangles).toBeGreaterThan(0);
    expect(glb.triangles).toBeLessThanOrEqual(MODEL_TRIANGLES);

    for (const [name, sizes] of Object.entries(glb.materialTextures)) {
      const want = name === 'shadow' ? [128, 128] : [1024, 1024];
      expect(sizes.length, `${name} has a texture`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `${name} texture size`).toEqual(want);
    }
    for (const s of glb.textureSizes) expect([[1024, 1024], [128, 128]]).toContainEqual(s);

    expect(glb.bytes).toBeLessThanOrEqual(MODEL_BYTES);
  });

  // Models not exported yet (blocked out, awaiting the owner's go) are skipped; see exportDue.
  test.skipIf(!BLENDER_SOURCES)('every blender/models/*.py has a matching public/models/*.glb', () => {
    const missing = dueIds().filter((id) => !existsSync(join(PUBLIC, `${id}.glb`)));
    expect(missing).toEqual([]);
  });

  test.skipIf(!BLENDER_SOURCES)("every GLB's sourceHash equals its .blend's current SHA-256", async () => {
    for (const id of dueIds()) {
      const glb = await inspectGlb(join(PUBLIC, `${id}.glb`));
      expect(glb.sourceHash, `${id}.glb was exported from the current ${id}.blend`).toBe(
        await sha256File(join(MODELS, `${id}.blend`)),
      );
    }
  });
});

// Task 9: world.py --export writes the arrival's camera clips (authored in world.blend) to
// world.glb, a camera and its clips with no meshes; world.json carries their timing.
describe('world.glb', () => {
  const WORLD_GLB = join(PUBLIC, 'world.glb');
  type V3 = [number, number, number];
  interface Cam {
    position: V3;
    target: V3;
  }
  const world = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'world.json'), 'utf8')) as {
    cameras: Record<string, Cam>;
    arrival: { clipLength: number; portrait: { clipLength: number } };
  };

  /** The direction a glTF camera with rotation q looks along: q applied to (0, 0, -1). */
  const forward = ([x, y, z, w]: number[]): V3 => [-2 * (x! * z! + w! * y!), -2 * (y! * z! - w! * x!), -(1 - 2 * (x! * x! + y! * y!))];
  const toward = (c: Cam): V3 => {
    const d: V3 = [c.target[0] - c.position[0], c.target[1] - c.position[1], c.target[2] - c.position[2]];
    const l = Math.hypot(...d);
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  const angle = (a: V3, b: V3) => (Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
  const close = (got: number[], want: number[], digits = 3) => want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, digits));

  test('holds the clips arrival and arrival_portrait and no meshes', async () => {
    const glb = await inspectGlb(WORLD_GLB);
    expect(glb.clips).toEqual(expect.arrayContaining(['arrival', 'arrival_portrait']));
    expect(glb.meshes).toBe(0);
    expect(glb.triangles).toBe(0);
    expect(glb.materials).toEqual([]);
  });

  test.skipIf(!BLENDER_SOURCES)('was exported from the current world.blend', async () => {
    const glb = await inspectGlb(WORLD_GLB);
    expect(glb.sourceHash).toBe(await sha256File(join(ROOT, 'blender', 'world', 'world.blend')));
  });

  test.each([
    ['arrival', 'overview', () => world.arrival.clipLength],
    ['arrival_portrait', 'overviewPortrait', () => world.arrival.portrait.clipLength],
  ] as const)('%s starts straight down, ends exactly on cameras.%s, and never jumps or flips', async (clip, end, length) => {
    const c = await cameraClip(WORLD_GLB, clip);
    expect(c.isRoot).toBe(true);
    expect(c.yfov * (180 / Math.PI)).toBeCloseTo(30, 3);
    expect(c.times[0]).toBeCloseTo(0, 6);
    expect(c.times.at(-1)!).toBeCloseTo(length(), 3);

    // Top-down at the start (the empty floor seen from straight above) ...
    expect(angle(forward(c.rotations[0]!), [0, -1, 0])).toBeLessThan(0.1);
    if (clip === 'arrival') close(c.positions[0]!, world.cameras.arrivalStart!.position);
    // ... and the overview's own pose at the end, so the runtime hands over without a cut.
    const cam = world.cameras[end]!;
    close(c.positions.at(-1)!, cam.position);
    expect(angle(forward(c.rotations.at(-1)!), toward(cam))).toBeLessThan(0.05);

    // No jumps: each sample's step is bounded, and close to the step before it (a cut or a
    // flip is a step out of line with its neighbours; a fast but smooth move is not).
    const step = (i: number) => {
      const [a, b] = [c.positions[i - 1]!, c.positions[i]!];
      return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    };
    const turn = (i: number) => angle(forward(c.rotations[i - 1]!), forward(c.rotations[i]!));
    for (let i = 1; i < c.times.length; i++) {
      expect(step(i), `move at ${c.times[i]}`).toBeLessThan(1.5);
      expect(turn(i), `turn at ${c.times[i]}`).toBeLessThan(4);
      if (i > 1) {
        expect(Math.abs(step(i) - step(i - 1)), `move jerks at ${c.times[i]}`).toBeLessThan(0.1);
        expect(Math.abs(turn(i) - turn(i - 1)), `turn jerks at ${c.times[i]}`).toBeLessThan(0.5);
      }
      // The camera's up stays on the same side: a flip near the straight-down start would
      // turn the quaternion through 180 degrees between two samples.
      const [q, r] = [c.rotations[i - 1]!, c.rotations[i]!];
      const dot = Math.abs(q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3]);
      expect(dot, `rotation step at ${c.times[i]}`).toBeGreaterThan(Math.cos((4 * Math.PI) / 180 / 2));
    }
  });
});

// Blender isn't installed in CI; there the committed GLBs are the build input.
describe.skipIf(!BLENDER || !BLENDER_SOURCES)('hand edits win (runs Blender on a temporary copy of the probe)', () => {
  const LIFT = 0.5;
  afterAll(removeProbeSandboxes);

  /** Opens the .blend, raises its highest vertex by LIFT (Blender Z = glTF Y) and saves it plainly. */
  const handEdit = (blend: string) => {
    const expr = [
      'import bpy',
      `bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(blend)})`,
      'bpy.context.preferences.filepaths.save_version = 0',
      'best = None',
      'for o in bpy.data.objects:',
      '    if o.type != "MESH" or o.name == "shadow": continue',
      '    for v in o.data.vertices:',
      '        z = (o.matrix_world @ v.co).z',
      '        if best is None or z > best[0]: best = (z, o, v)',
      `best[2].co.z += ${LIFT} / best[1].matrix_world.to_scale().z`,
      'bpy.ops.wm.save_mainfile()',
    ].join('\n');
    const r = runBlender(['--python-expr', expr]);
    expect(r.code, r.output).toBe(0);
  };

  test('hand edits are exported, not overwritten', { timeout: 300_000 }, async () => {
    const box = makeProbeSandbox();
    const before = await glbBounds(join(PUBLIC, '_probe.glb'));
    handEdit(join(box.models, '_probe.blend'));

    const r = runBuild(['_probe', '--stage', 'export'], box);
    expect(r.code, r.output).toBe(0);

    const raw = join(box.out, '_probe.raw.glb');
    const after = await glbBounds(raw);
    expect(after.max[1]! - before.max[1]!).toBeCloseTo(LIFT, 2);
    expect((await inspectGlb(raw)).sourceHash).toBe(await sha256File(join(box.models, '_probe.blend')));
  });

  test('touching the .blend without changing it is not a hand edit', { timeout: 600_000 }, async () => {
    const box = makeProbeSandbox();
    const blend = join(box.models, '_probe.blend');
    const later = new Date(Date.now() + 60_000);
    utimesSync(blend, later, later);

    const r = runBuild(['_probe', '--stage', 'export'], box);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain('source: _probe.py (scripted rebuild)');
    expect(readFileSync(join(box.models, '_probe.py'), 'utf8')).not.toMatch(/^# RETIRED/);
    expect(readFileSync(join(box.models, '_probe.stamp'), 'utf8').trim()).toBe(await sha256File(blend));
    expect((await inspectGlb(join(box.out, '_probe.raw.glb'))).sourceHash).toBe(await sha256File(blend));
  });

  test('a hand-edited model is retired', { timeout: 300_000 }, async () => {
    const box = makeProbeSandbox();
    const blend = join(box.models, '_probe.blend');
    handEdit(blend);

    const exported = runBuild(['_probe', '--stage', 'export'], box);
    expect(exported.code, exported.output).toBe(0);
    expect(exported.output).toContain('source: _probe.blend (hand-edited)');
    expect(readFileSync(join(box.models, '_probe.py'), 'utf8')).toMatch(
      /^# RETIRED \d{4}-\d{2}-\d{2}: _probe\.blend is the source\n/,
    );

    const blockout = runBuild(['_probe', '--stage', 'blockout'], box);
    expect(blockout.code).not.toBe(0);
    expect(blockout.output).toContain('_probe.blend');

    const rebuild = runBuild(['_probe', '--stage', 'export', '--rebuild'], box);
    expect(rebuild.code).not.toBe(0);
    expect(rebuild.output).toContain('_probe.blend');

    mkdirSync(join(box.models, '_probe.patches'));
    writeFileSync(
      join(box.models, '_probe.patches', '001-mark.py'),
      ['import bpy', 'from common import save_blend', 'bpy.data.objects["body"]["patched"] = 1', 'save_blend(ID)', ''].join('\n'),
    );
    const patch = runBuild(['_probe', '--stage', 'patch', '001'], box);
    expect(patch.code, patch.output).toBe(0);
    expect(readFileSync(join(box.models, '_probe.stamp'), 'utf8').trim()).toBe(await sha256File(blend));

    const check = runBlender([
      blend,
      '--python-expr',
      'import bpy, sys; sys.exit(0 if bpy.data.objects["body"].get("patched") == 1 else 7)',
    ]);
    expect(check.code, check.output).toBe(0);

    const again = runBuild(['_probe', '--stage', 'patch', '001'], box);
    expect(again.code, 'a patch runs once').not.toBe(0);
  });
});

// Task 17: the duck's model loads only on the first stray signal, so the map frames it and lays
// its footprint by DUCK_BOUNDS until it's in. They must be the file's own.
describe('duck.glb', () => {
  test('its bounds without the shadow are DUCK_BOUNDS (src/data/hidden.ts), to 1 mm', async () => {
    const { min, max } = await glbBounds(join(PUBLIC, 'duck.glb'), ['shadow']);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(min[i]! - DUCK_BOUNDS.min[i]!), `min[${i}]`).toBeLessThan(1e-3);
      expect(Math.abs(max[i]! - DUCK_BOUNDS.max[i]!), `max[${i}]`).toBeLessThan(1e-3);
    }
  });

  // A hidden node, loaded lazily: it gives the models' 4.0 MB total (budget.test) its room back,
  // so its cap is half the model cap.
  test('it is within its own cap, 120,000 bytes', () => {
    expect(readFileSync(join(PUBLIC, 'duck.glb')).length).toBeLessThanOrEqual(DUCK_BYTES);
  });

  // The squeak squashes and stretches the duck about its own base and never lifts it off the
  // desk (the owner's test notes: a poke moves parts, not the whole model).
  test('its poke squashes the duck in place: scale and turns, no translation', () => {
    const bytes = readFileSync(join(PUBLIC, 'duck.glb'));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string }[];
      animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
    };
    const poke = gltf.animations.find((a) => a.name === 'poke')!.channels.map((c) => `${gltf.nodes[c.target.node]!.name}.${c.target.path}`);
    expect(poke).toEqual(expect.arrayContaining(['body.scale', 'head.rotation', 'beak.rotation']));
    expect(poke.filter((t) => t.endsWith('.translation') || t.startsWith('duck.'))).toEqual([]);
  });
});
