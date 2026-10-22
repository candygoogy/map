#!/usr/bin/env node
// npm run compress -- <id>
// Reads public/models/<id>.raw.glb (from `npm run model -- <id> export`) and writes
// public/models/<id>.glb: meshes in meshopt (EXT_meshopt_compression, quantized),
// textures in WebP, animations resampled and stripped of channels that only hold the rest
// pose, and the JSON properties written at their defaults left out. asset.extras.sourceHash
// is carried over.
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id || id.startsWith('-')) {
  console.error('usage: npm run compress -- <id>');
  process.exit(2);
}
const dir = process.env.MAP_OUT_DIR ?? join(root, 'public', 'models');
const input = join(dir, `${id}.raw.glb`);
const output = join(dir, `${id}.glb`);
if (!existsSync(input)) {
  console.error(`compress: ${input} is missing; run \`npm run model -- ${id} export\` first`);
  process.exit(2);
}

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);
const extras = { ...(doc.getRoot().getAsset().extras ?? {}) };
if (typeof extras.sourceHash !== 'string') {
  console.error(`compress: ${input} has no asset.extras.sourceHash; re-export it with build.py`);
  process.exit(1);
}

/**
 * Drops each animation channel that holds its node's rest value the whole clip through.
 * Blender's exporter writes every bone and object into every clip, moving or not (Fettle's 16
 * paper bones in all six clips cost 18 KB of JSON). It's safe for the runtime: three.js mixes
 * a binding no playing clip drives back to its original state, which is the rest pose, so a
 * clip without the channel leaves that node at rest, or lets a held clip keep it. Each clip
 * keeps at least one channel, so its duration stays.
 */
function dropRestChannels(eps = 1e-5) {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
  return (doc) => {
    let dropped = 0;
    for (const anim of doc.getRoot().listAnimations()) {
      for (const channel of anim.listChannels()) {
        if (anim.listChannels().length <= 1) break;
        const node = channel.getTargetNode();
        const path = channel.getTargetPath();
        const rest = { translation: node?.getTranslation(), rotation: node?.getRotation(), scale: node?.getScale() }[path];
        const out = channel.getSampler()?.getOutput();
        if (!rest || !out) continue;
        const n = rest.length;
        const v = Array.from({ length: n });
        let still = true;
        for (let i = 0; still && i < out.getCount(); i++) {
          out.getElement(i, v);
          // q and -q are the same rotation.
          still = near(v, rest) || (path === 'rotation' && near(v.map((x) => -x), rest));
        }
        if (!still) continue;
        const sampler = channel.getSampler();
        channel.dispose();
        if (sampler && sampler.listParents().every((p) => p === anim || p.propertyType === 'Root')) sampler.dispose();
        dropped++;
      }
    }
    if (dropped) console.log(`compress: dropped ${dropped} channels that only hold the rest pose`);
  };
}

// A second UV map is kept though no material in the file uses it: Fettle's paper carries the
// trip receipt's `print` UVs (TEXCOORD_1, Task 16), which the runtime maps the receipt onto.
const keepAttributes = doc
  .getRoot()
  .listMeshes()
  .some((m) => m.listPrimitives().some((p) => p.getAttribute('TEXCOORD_1') !== null));

await doc.transform(
  // Never merge materials: each role (body, detail, accent, ...) must stay its own material
  // for the runtime, even when two look identical in the file.
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE, PropertyType.SKIN] }),
  prune({ keepAttributes }),
  resample(),
  dropRestChannels(),
  // Only the accessors the dropped channels leave behind: a wider prune would take leaf bones.
  prune({ propertyTypes: [PropertyType.ACCESSOR], keepAttributes }),
  // Greyscale bakes and alpha shadows survive lossy WebP at this quality without banding.
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, effort: 100 }),
  // 'high' adds meshopt's filters: positions are unchanged and normals move by 1° at most,
  // which baked shading never shows, and it keeps a detailed model like Fettle in budget.
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
doc.getRoot().getAsset().extras = extras;

/**
 * Drops the JSON properties glTF-Transform writes out at their spec defaults: an accessor's
 * `normalized: false` and `byteOffset: 0`, a buffer view's `byteOffset: 0`, a sampler's
 * `interpolation: "LINEAR"` and a primitive's `mode: 4` (triangles). Lossless: glTF 2.0 reads
 * each missing one as that default, as three.js's loader does. A GLB's JSON is stored
 * uncompressed, so on a model of many small parts, each with its accessors and channels,
 * they add up (homelab: 3.7 KB of its 40 KB of JSON).
 */
function trimDefaults(glb) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  for (const a of json.accessors ?? []) {
    if (a.normalized === false) delete a.normalized;
    if (a.byteOffset === 0) delete a.byteOffset;
  }
  for (const v of json.bufferViews ?? []) if (v.byteOffset === 0) delete v.byteOffset;
  for (const anim of json.animations ?? [])
    for (const s of anim.samplers) if (s.interpolation === 'LINEAR') delete s.interpolation;
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) if (p.mode === 4) delete p.mode;
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20); // JSON pads with spaces
  padded.set(text);
  const rest = glb.subarray(20 + jsonLength); // the BIN chunk, header and all
  const out = new Uint8Array(20 + padded.length + rest.length);
  const head = new DataView(out.buffer);
  out.set(glb.subarray(0, 12));
  head.setUint32(8, out.length, true);
  head.setUint32(12, padded.length, true);
  head.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(padded, 20);
  out.set(rest, 20 + padded.length);
  return out;
}

writeFileSync(output, trimDefaults(await io.writeBinary(doc)));
const kb = (p) => (statSync(p).size / 1024).toFixed(1);
console.log(`compress: ${output} (${kb(input)} KB -> ${kb(output)} KB)`);
