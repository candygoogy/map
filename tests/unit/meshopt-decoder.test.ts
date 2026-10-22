// The split meshopt decoder (src/vendor/meshopt_decoder.js, made by scripts/split-meshopt-decoder.mjs,
// to keep the first-load JS small). It embeds only the SIMD wasm build and import()s the scalar one
// where WebAssembly.validate says there's no SIMD (Safari before 16.4). Node has SIMD, so the
// scalar path is forced by making validate say no while the module loads. Each path must decode
// every shipped GLB to the same bytes as three's own file on that path. (The two builds don't agree
// to the bit: the quaternion filter of the clips' rotations rounds one value in about a hundred
// differently, by 1 in 32767. That's meshoptimizer's, the same with three's file.) The SIMD path
// also matches meshoptimizer's own decoder, which the GLB tests read with. And it's a copy of
// three's file, so upgrading three without re-running the script fails here too. Its worker pool is
// cut, so the main-thread path GLTFLoader takes is checked on its own.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder as Reference } from 'meshoptimizer';
import { REVISION } from 'three';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ROOT } from './helpers/blender';

type Decoder = typeof Reference;
const PUBLIC = join(ROOT, 'public', 'models');
// What ships: every GLB but the raw exports and the _-prefixed pipeline probes (as budget.test.ts).
const shipped = readdirSync(PUBLIC).filter((f) => f.endsWith('.glb') && !f.endsWith('.raw.glb') && !f.startsWith('_'));

const SPLIT = '../../src/vendor/meshopt_decoder.js';
// three's own file, a package Node loads itself: a query makes each path's copy a module of its own.
const THREE = pathToFileURL(join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'meshopt_decoder.module.js')).href;

/** A fresh copy of a decoder module, with `simd` as WebAssembly.validate's answer while it loads. */
async function load(simd: boolean, module = SPLIT): Promise<{ decoder: Decoder; wasm: Uint8Array<ArrayBuffer>; scalarImported: boolean }> {
  vi.resetModules();
  let scalarImported = false;
  vi.doMock('../../src/vendor/meshopt_decoder_base.js', async (original) => {
    scalarImported = true;
    return original();
  });
  const validate = vi.spyOn(WebAssembly, 'validate');
  if (!simd) validate.mockReturnValue(false);
  const instantiate = vi.spyOn(WebAssembly, 'instantiate');
  const { MeshoptDecoder } = (await import(/* @vite-ignore */ module)) as { MeshoptDecoder: Decoder };
  validate.mockRestore();
  await MeshoptDecoder.ready;
  const bytes = instantiate.mock.calls[0]?.[0];
  instantiate.mockRestore();
  if (!(bytes instanceof ArrayBuffer)) throw new Error('the decoder instantiated no wasm');
  return { decoder: MeshoptDecoder, wasm: new Uint8Array(bytes), scalarImported };
}

async function read(path: string, decoder: Decoder): Promise<Document> {
  await decoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': decoder }).read(path);
}

/** Every accessor's decoded bytes, in document order. */
const accessors = (doc: Document) =>
  doc
    .getRoot()
    .listAccessors()
    .map((a) => {
      const array = a.getArray()!;
      return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    });

afterEach(() => {
  vi.doUnmock('../../src/vendor/meshopt_decoder_base.js');
  vi.restoreAllMocks();
});

describe('the split meshopt decoder', () => {
  test('with SIMD it runs the embedded build and never imports the scalar one', async () => {
    const { decoder, wasm, scalarImported } = await load(true);
    expect(decoder.supported).toBe(true);
    expect(scalarImported).toBe(false);
    expect(WebAssembly.validate(wasm)).toBe(true);
  });

  test("without SIMD it imports the scalar build and runs that, the wasm three's file runs there", async () => {
    const simd = await load(true);
    const scalar = await load(false);
    expect(scalar.scalarImported).toBe(true);
    expect(scalar.decoder.supported).toBe(true);
    expect(WebAssembly.validate(scalar.wasm)).toBe(true);
    expect(Buffer.from(scalar.wasm).equals(Buffer.from(simd.wasm))).toBe(false);
    // The same wasm as three's own file on each path.
    expect(Buffer.from(simd.wasm).equals(Buffer.from((await load(true, `${THREE}?wasm-simd`)).wasm))).toBe(true);
    expect(Buffer.from(scalar.wasm).equals(Buffer.from((await load(false, `${THREE}?wasm-scalar`)).wasm))).toBe(true);
  });

  test('there are models to decode', () => {
    expect(shipped.length).toBeGreaterThan(10);
  });

  test("both builds decode every shipped GLB as three's file does on the same path", { timeout: 120_000 }, async () => {
    const paths = [
      { name: 'SIMD', split: (await load(true)).decoder, want: [(await load(true, `${THREE}?simd`)).decoder, Reference] },
      { name: 'scalar', split: (await load(false)).decoder, want: [(await load(false, `${THREE}?scalar`)).decoder] },
    ];
    for (const file of shipped) {
      const path = join(PUBLIC, file);
      for (const { name, split, want } of paths) {
        const got = accessors(await read(path, split));
        expect(got.length, `${file} has accessors`).toBeGreaterThan(0);
        for (const [w, decoder] of want.entries()) {
          const expected = accessors(await read(path, decoder));
          expect(got.length, `${file}, ${name}`).toBe(expected.length);
          got.forEach((bytes, i) => expect(bytes.equals(expected[i]!), `${file}, ${name} (against ${w}): accessor ${i}`).toBe(true));
        }
      }
    }
  });

  // Option E: no worker pool. GLTFLoader decodes through decodeGltfBufferAsync on the main
  // thread, and nothing in src/ asks for workers.
  test('without useWorkers, decodeGltfBufferAsync decodes on the main thread on both paths', async () => {
    await MeshoptEncoder.ready;
    const source = new Uint8Array(Float32Array.from({ length: 64 * 4 }, (_, i) => Math.sin(i)).buffer);
    const encoded = MeshoptEncoder.encodeGltfBuffer(source, 64, 16, 'ATTRIBUTES');
    for (const simd of [true, false]) {
      const { decoder } = await load(simd);
      expect('useWorkers' in decoder).toBe(false);
      const decoded = await decoder.decodeGltfBufferAsync(64, 16, encoded, 'ATTRIBUTES');
      expect(Buffer.from(decoded).equals(Buffer.from(source))).toBe(true);
    }
    const sources = readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' }).filter((f) => /\.(ts|js)$/.test(f));
    expect(sources.filter((f) => readFileSync(join(ROOT, 'src', f), 'utf8').includes('useWorkers('))).toEqual([]);
  });

  test("it is the script's output for the installed three", () => {
    const header = readFileSync(join(ROOT, 'src', 'vendor', 'meshopt_decoder.js'), 'utf8');
    expect(/three-revision: (\d+)/.exec(header)?.[1]).toBe(REVISION);
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'split-meshopt-decoder.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });
});
