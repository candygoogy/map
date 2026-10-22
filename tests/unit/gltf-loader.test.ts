// The trimmed GLTFLoader (src/vendor/GLTFLoader.js, made by scripts/trim-gltf-loader.mjs, to keep
// the first-load JS small). It reads only the glTF extensions our models use, and only triangles
// and LINEAR or STEP clips, so a model that starts using anything else (a new Blender material
// setting, a Draco export, a line or a cubic spline clip) must fail here rather than on the page.
// And it's a copy of three's file, so upgrading three without re-running the script fails too.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REVISION, type Mesh } from 'three';
import { describe, expect, test } from 'vitest';
import { GLTFLoader, SUPPORTED_EXTENSIONS } from '../../src/vendor/GLTFLoader.js';
import { ROOT } from './helpers/blender';

const PUBLIC = join(ROOT, 'public', 'models');

/** The JSON chunk of a binary glTF (header, then the JSON chunk's length and type). */
interface GltfJson {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  meshes?: { primitives: { mode?: number }[] }[];
  animations?: { samplers: { interpolation?: string }[] }[];
}

function gltfJson(path: string): GltfJson {
  const b = readFileSync(path);
  if (b.toString('latin1', 0, 4) !== 'glTF') throw new Error(`${path} isn't a binary glTF`);
  const length = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${path}: the first chunk isn't JSON`);
  return JSON.parse(b.toString('utf8', 20, 20 + length)) as GltfJson;
}

// What ships: every GLB but the raw exports and the _-prefixed pipeline probes (as budget.test.ts).
const shipped = readdirSync(PUBLIC).filter((f) => f.endsWith('.glb') && !f.endsWith('.raw.glb') && !f.startsWith('_'));

describe('the trimmed GLTFLoader', () => {
  test('there are models to check', () => {
    expect(shipped.length).toBeGreaterThan(10);
  });

  test.each(shipped)('%s uses only extensions the trimmed loader reads', (file) => {
    const json = gltfJson(join(PUBLIC, file));
    const used = [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])];
    const missing = [...new Set(used)].filter((e) => !SUPPORTED_EXTENSIONS.includes(e));
    expect(missing, `add these to scripts/trim-gltf-loader.mjs's SUPPORTED (and keep their plugins), then re-run it`).toEqual([]);
  });

  test.each(shipped)('%s has only triangles and LINEAR or STEP clips, all the trimmed loader keeps', (file) => {
    const json = gltfJson(join(PUBLIC, file));
    // glTF's mode 4 is TRIANGLES, and the default.
    const modes = new Set((json.meshes ?? []).flatMap((m) => m.primitives.map((p) => p.mode ?? 4)));
    expect([...modes].filter((m) => m !== 4), 'strips, fans, lines and points are cut from the loader (scripts/trim-gltf-loader.mjs)').toEqual([]);
    const kinds = new Set((json.animations ?? []).flatMap((a) => a.samplers.map((s) => s.interpolation ?? 'LINEAR')));
    expect([...kinds].filter((k) => k !== 'LINEAR' && k !== 'STEP'), 'CUBICSPLINE is cut from the loader (scripts/trim-gltf-loader.mjs)').toEqual([]);
  });

  // A one-triangle GLB (with a clip moving its node): what the models are, it still loads; what
  // the trim cut, it refuses, rather than loading wrong. Its buffer is the GLB's own BIN chunk, so
  // nothing is fetched.
  function tiny(opts: { mode?: number; interpolation?: string; extension?: string } = {}): ArrayBuffer {
    const data = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]); // 3 positions; times 0, 1; 2 translations
    const json = JSON.stringify({
      asset: { version: '2.0' },
      ...(opts.extension ? { extensionsUsed: [opts.extension] } : {}),
      buffers: [{ byteLength: data.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 8 },
        { buffer: 0, byteOffset: 44, byteLength: 24 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
        { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...(opts.mode === undefined ? {} : { mode: opts.mode }) }] }],
      nodes: [{ name: 'tri', mesh: 0 }],
      scenes: [{ nodes: [0] }],
      animations: [
        {
          name: 'move',
          samplers: [{ input: 1, output: 2, interpolation: opts.interpolation ?? 'LINEAR' }],
          channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
        },
      ],
    });
    const text = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
    const bin = Buffer.from(data.buffer);
    const glb = Buffer.alloc(12 + 8 + text.length + 8 + bin.length);
    glb.write('glTF', 0, 'latin1');
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(text.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16); // JSON
    text.copy(glb, 20);
    glb.writeUInt32LE(bin.length, 20 + text.length);
    glb.writeUInt32LE(0x004e4942, 24 + text.length); // BIN
    bin.copy(glb, 28 + text.length);
    return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length);
  }

  test('it loads a triangle mesh with a LINEAR or STEP clip', async () => {
    for (const interpolation of ['LINEAR', 'STEP']) {
      const gltf = await new GLTFLoader().parseAsync(tiny({ interpolation }), '');
      const tri = gltf.scene.getObjectByName('tri') as Mesh;
      expect(tri.isMesh).toBe(true);
      expect(tri.geometry.getAttribute('position').count).toBe(3);
      expect(gltf.animations[0]!.tracks[0]!.name).toBe('tri.position');
    }
  });

  test.each([0, 1, 2, 3, 5, 6])('it refuses a primitive of mode %i (triangles only)', async (mode) => {
    await expect(new GLTFLoader().parseAsync(tiny({ mode }), '')).rejects.toThrow(/triangles only/);
  });

  test('it refuses a CUBICSPLINE clip, KHR_materials_unlit and KHR_texture_transform', async () => {
    await expect(new GLTFLoader().parseAsync(tiny({ interpolation: 'CUBICSPLINE' }), '')).rejects.toThrow(/CUBICSPLINE animation is trimmed/);
    for (const extension of ['KHR_materials_unlit', 'KHR_texture_transform']) {
      await expect(new GLTFLoader().parseAsync(tiny({ extension }), '')).rejects.toThrow(new RegExp(`${extension} is trimmed`));
    }
  });

  test("it is the script's output for the installed three", () => {
    const header = readFileSync(join(ROOT, 'src', 'vendor', 'GLTFLoader.js'), 'utf8');
    expect(/three-revision: (\d+)/.exec(header)?.[1]).toBe(REVISION);
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'trim-gltf-loader.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });
});
