// Loading the Blender-made models (public/models/<id>.glb): one GLTFLoader with the meshopt
// decoder, since every GLB is meshopt-compressed (scripts/compress.mjs). Both are copies in
// src/vendor/, to save first-load JS: the loader trimmed to the glTF extensions our models use
// (tests/unit/gltf-loader.test.ts holds the models to it), the decoder with only its SIMD wasm,
// fetching the scalar build where there's no SIMD (tests/unit/meshopt-decoder.test.ts). Shared
// by the map (traffic, nodes) and the dev model viewer. Each URL carries the file's content hash
// (`?v=`, vite.config.ts → virtual:models), since the models are cached for a year.
//
// The load order (the owner's model budgets): a load's `rank` says when it starts. Rank 0 (the
// origin, the arrival's camera) goes alone, before any other, since the arrival waits for it;
// then the lowest rank first, AT_ONCE at a time, so on a slow line the models the arrival shows
// first are in first, while the line stays full. A fast line has them all in at once anyway.

import { GLTFLoader, type GLTF } from '../vendor/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.js';
import { versions } from 'virtual:models';

const AT_ONCE = 3;
let loader: GLTFLoader | null = null;
const waiting: { rank: number; go: () => void }[] = [];
let running = 0;
let firsts = 0; // rank-0 loads running

function next(): void {
  while (running < AT_ONCE && waiting.length && !(firsts && waiting[0]!.rank > 0)) {
    const { rank, go } = waiting.shift()!;
    running++;
    if (!rank) firsts++;
    go();
  }
}

/** Loads `/models/<id>.glb?v=<hash>`, in `rank` order (above; unranked loads go last). Ids are
 *  file names, so anything but [a-z0-9_-] is refused. */
export function loadModel(id: string, rank = Infinity): Promise<GLTF> {
  if (!/^[a-z0-9_-]+$/.test(id)) return Promise.reject(new Error(`"${id}" isn't a model id`));
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const v = versions[id];
  return new Promise<void>((go) => {
    const at = waiting.findIndex((w) => w.rank > rank); // after those of its rank
    waiting.splice(at < 0 ? waiting.length : at, 0, { rank, go });
    queueMicrotask(next); // once this task's other loads are queued too: they start by rank
  })
    .then(() => loader!.loadAsync(`/models/${id}.glb${v ? `?v=${v}` : ''}`))
    .finally(() => {
      running--;
      if (!rank) firsts--;
      next();
    });
}
