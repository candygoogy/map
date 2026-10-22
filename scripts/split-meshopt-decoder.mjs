#!/usr/bin/env node
// node scripts/split-meshopt-decoder.mjs [--check]
// Writes src/vendor/meshopt_decoder.js and src/vendor/meshopt_decoder_base.js: three's
// meshopt_decoder.module.js (node_modules/three, whatever version is installed) split in two, so
// the first-load JS carries only the decoder's SIMD wasm.
// three's file embeds two wasm builds and picks one with WebAssembly.validate: SIMD, which every
// browser we target has (Chrome 91, Firefox 89, Safari 16.4), and the scalar build for those
// without (Safari before 16.4). Here the scalar build is the second file, which the decoder
// import()s only where SIMD is missing, so it ships as a chunk of its own that most visitors
// never fetch. `ready` resolves once either build is running. The decoder's API is three's but
// for useWorkers, which nothing calls: its worker pool is cut (option E).
//
// tests/unit/meshopt-decoder.test.ts checks that the files are this script's output for the
// installed three, and decodes every shipped GLB through both builds (the scalar one by making
// WebAssembly.validate say no). Re-sync after a three upgrade: run this, then that test, the
// budget test and Playwright. If three's file changed shape, this throws rather than writing a
// half-split decoder: fix the patterns below.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const three = join(root, 'node_modules', 'three');
const source = readFileSync(join(three, 'examples', 'jsm', 'libs', 'meshopt_decoder.module.js'), 'utf8').replace(/\r\n/g, '\n');
const revision = /REVISION = '(\d+)'/.exec(readFileSync(join(three, 'build', 'three.core.js'), 'utf8'))?.[1];
if (!revision) throw new Error('split-meshopt-decoder: no REVISION in three.core.js');

let out = source;

/** Replaces the one occurrence of `from` with `to`, or throws. */
function swap(from, to) {
  const at = out.indexOf(from);
  if (at < 0 || out.indexOf(from, at + 1) >= 0) throw new Error(`split-meshopt-decoder: expected one ${JSON.stringify(from.slice(0, 60))}`);
  out = out.slice(0, at) + to + out.slice(at + from.length);
}

// The scalar build's string moves to its own module.
// (meshoptimizer's build marks each string with a trailing `// embed! base` or `simd` comment.)
const base = /\n\tvar wasm_base =\n\t\t'([^']+)';(?: \/\/ embed! base)?\n/.exec(out);
if (!base) throw new Error('split-meshopt-decoder: no wasm_base string');
out = out.slice(0, base.index) + '\n' + out.slice(base.index + base[0].length);
if (!/\n\tvar wasm_simd =\n\t\t'[^']+';(?: \/\/ embed! simd)?\n/.test(out)) throw new Error('split-meshopt-decoder: no wasm_simd string');

// Without SIMD, the build is fetched: `wasm` is set once it's here.
swap(
  'var wasm = WebAssembly.validate(detector) ? unpack(wasm_simd) : unpack(wasm_base);',
  [
    '// Without SIMD (Safari before 16.4), the scalar build comes from its own chunk.',
    '\tvar wasm = WebAssembly.validate(detector) ? unpack(wasm_simd) : null;',
  ].join('\n'),
);
swap(
  'var ready = WebAssembly.instantiate(wasm, {}).then(function (result) {',
  [
    'var ready = (',
    '\t\twasm',
    '\t\t\t? WebAssembly.instantiate(wasm, {})',
    "\t\t\t: import('./meshopt_decoder_base.js').then(function (scalar) {",
    '\t\t\t\t\twasm = unpack(scalar.wasm_base);',
    '\t\t\t\t\treturn WebAssembly.instantiate(wasm, {});',
    '\t\t\t\t})',
    '\t).then(function (result) {',
  ].join('\n'),
);
// No workers (option E): nothing calls useWorkers (GLTFLoader decodes on the main thread, through
// decodeGltfBufferAsync), so the worker pool and useWorkers go.
{
  const at = out.indexOf('\n\tvar workers = [];\n');
  const end = out.indexOf('\n\treturn {\n\t\tready: ready,', at);
  if (at < 0 || end < 0) throw new Error('split-meshopt-decoder: no worker pool where expected');
  out = out.slice(0, at) + out.slice(end);
}
swap('\t\tuseWorkers: function (count) {\n\t\t\tinitWorkers(count);\n\t\t},\n', '');
swap(
  '\t\t\tif (workers.length > 0) {\n\t\t\t\treturn decodeWorker(count, size, source, decoders[mode], filters[filter]);\n\t\t\t}\n\n',
  '',
);
if (/\b(workers?|Worker|initWorkers|decodeWorker|workerProcess|useWorkers)\b/.test(out.replace(/\/\/.*$/gm, ''))) {
  throw new Error('split-meshopt-decoder: the workers are still referenced');
}
if (/\bwasm_base\b/.test(out.replace("unpack(scalar.wasm_base)", ''))) throw new Error('split-meshopt-decoder: wasm_base is still referenced');

const header = `// three.js r${revision} examples/jsm/libs/meshopt_decoder.module.js (meshoptimizer, MIT, Arseny
// Kapoulkine), split by scripts/split-meshopt-decoder.mjs. Don't edit it by hand: after upgrading
// three, re-run the script.
//
// It embeds only the SIMD wasm build. Where WebAssembly.validate says there's no SIMD (Safari
// before 16.4), it import()s the scalar build from meshopt_decoder_base.js, a chunk most visitors
// never fetch. Its worker pool and useWorkers, which nothing calls, are cut too.
// tests/unit/meshopt-decoder.test.ts decodes the shipped models through both builds.
// three-revision: ${revision}

`;
const baseHeader = `// three.js r${revision} meshopt_decoder.module.js's scalar wasm build (meshoptimizer, MIT, Arseny
// Kapoulkine), for browsers without wasm SIMD. Made by scripts/split-meshopt-decoder.mjs; only
// meshopt_decoder.js imports it, and only when WebAssembly.validate says there's no SIMD.
// three-revision: ${revision}

`;
const files = [
  [join(root, 'src', 'vendor', 'meshopt_decoder.js'), header + out],
  [join(root, 'src', 'vendor', 'meshopt_decoder_base.js'), `${baseHeader}export const wasm_base =\n\t'${base[1]}';\n`],
];

// --check: exit 1 if the committed files aren't what this script makes from the installed three.
if (process.argv.includes('--check')) {
  const stale = files.filter(([path, text]) => (existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '') !== text);
  if (stale.length > 0) {
    console.error('src/vendor/meshopt_decoder*.js is out of date: run node scripts/split-meshopt-decoder.mjs');
    process.exit(1);
  }
  console.log(`src/vendor/meshopt_decoder*.js match three r${revision}`);
  process.exit(0);
}
for (const [path, text] of files) writeFileSync(path, text);
console.log(`src/vendor/meshopt_decoder.js and meshopt_decoder_base.js: r${revision}, the scalar build split out`);
