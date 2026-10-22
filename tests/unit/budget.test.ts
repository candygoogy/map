// The page's budgets that a build can check (plan, Tasks 13 and 18). The JS numbers come
// from one production build, made in memory (write: false) with the project's own config, so
// dist/ and the dev server are left alone. Sizes are gzipped at zlib's default level (what a
// server sends) and counted in kB of 1,000 bytes. Vite's build report compresses with its own
// deflate, so its figure for the same file runs about 1% higher.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type Rolldown } from 'vite';
import { beforeAll, describe, expect, test } from 'vitest';
import { ROOT } from './helpers/blender';

const KB = 1000;
// The owner's model budgets (2026-10-21 afternoon): all models ≤ 4.0 MB, and with
// the moments' chunks, everything after the arrival ≤ 4.1 MB (raised from 2.6 and 2.7 to 3.8
// and 3.9; then raised on the owner's word, 2026-10-22, for the switch's power brick).
const MODELS_MAX = 4_000_000;
const AFTER_ARRIVAL_MAX = 4_100_000;
const FIRST_LOAD_MAX = 210 * KB;
// The meshopt decoder's scalar wasm build, which the runtime fetches only where there's no wasm
// SIMD (Safari before 16.4; src/vendor/meshopt_decoder.js).
const SCALAR_MAX = 4 * KB;
const SCALAR = '/src/vendor/meshopt_decoder_base.js';
const MOMENTS_MAX = 60 * KB;
const FIRST_PAINT_MAX = 500 * KB;

const gzipped = (code: string | Uint8Array) => gzipSync(code).length;

/**
 * What ships from public/models/: every GLB but the raw exports, which dropRawModels deletes
 * from dist/, and the _-prefixed pipeline probes (_probe.glb), which it deletes too.
 */
function shippedModels(): { file: string; bytes: number }[] {
  const dir = join(ROOT, 'public', 'models');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.glb') && !f.endsWith('.raw.glb') && !f.startsWith('_'))
    .map((file) => ({ file, bytes: statSync(join(dir, file)).size }));
}

test('all models fit in 4.0 MB', () => {
  const models = shippedModels();
  const total = models.reduce((sum, m) => sum + m.bytes, 0);
  console.info(`models: ${models.length} GLBs, ${total} bytes`);
  expect(total).toBeLessThanOrEqual(MODELS_MAX);
});

interface Js {
  file: string;
  gzip: number;
}

describe('the JS budgets', () => {
  let firstLoad: Js[] = [];
  let lazy: Js[] = [];
  let scalar: Js[] = [];
  let notFound: Js[] = [];
  let notFoundImports: string[] = [];
  let scalarChunks: Rolldown.OutputChunk[] = [];
  let indexHtml = '';
  let entry: Rolldown.OutputChunk | undefined;
  let runtime: Rolldown.OutputChunk | undefined;

  beforeAll(async () => {
    // Vitest sets NODE_ENV=test, which Vite would build as a dev bundle (import.meta.env.DEV
    // true, window.__map kept): measure what `npm run build` ships.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let out: Rolldown.RolldownOutput;
    try {
      out = (await build({
        root: ROOT,
        mode: 'production',
        logLevel: 'silent',
        build: { write: false, copyPublicDir: false },
      })) as Rolldown.RolldownOutput;
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
    }
    const files = new Map(out.output.map((o) => [o.fileName, o]));
    const html = out.output.find((o) => o.fileName === 'index.html');
    if (html?.type !== 'asset') throw new Error('budget: the build has no index.html');

    // First paint loads the HTML's scripts (boot.ts, then main) and its modulepreloads, and
    // the browser follows each chunk's static imports from there. main then imports the map's
    // runtime (src/map.ts) after the first paint, on every 3D visit, so the runtime and its
    // static imports are first-load JS too: only the moments' chunks are lazy.
    const source = String(html.source);
    indexHtml = source;
    const urls = [
      ...source.matchAll(/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g),
      ...source.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"]+\.js)"/g),
    ].map((m) => m[1]!);
    const first = new Set<string>();
    const visit = (file: string): void => {
      if (first.has(file)) return;
      const o = files.get(file);
      if (!o) throw new Error(`budget: index.html loads ${file}, which the build didn't emit`);
      first.add(file);
      if (o.type === 'chunk') o.imports.forEach(visit);
    };
    urls.forEach(visit);
    const has = (o: Rolldown.OutputChunk, src: string) => o.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith(src));
    // The HTML's one module script is main, the entry (its facade is index.html's script).
    const module = /<script\b[^>]*\btype="module"[^>]*\bsrc="\/([^"]+\.js)"/.exec(source)?.[1];
    const main = module ? files.get(module) : undefined;
    entry = main?.type === 'chunk' && has(main, '/src/main.ts') ? main : undefined;
    runtime = out.output.find(
      (o): o is Rolldown.OutputChunk => o.type === 'chunk' && !!o.facadeModuleId?.replace(/\\/g, '/').endsWith('/src/map.ts'),
    );
    if (runtime) visit(runtime.fileName);

    const js = out.output
      .filter((o) => o.fileName.endsWith('.js'))
      .map((o) => ({ file: o.fileName, gzip: gzipped(o.type === 'chunk' ? o.code : o.source) }));
    // The decoder's scalar build isn't a moment: the browsers without SIMD fetch it before the
    // first model decodes, so for them it's first load. It's kept out of the lazy total.
    scalarChunks = out.output.filter((o): o is Rolldown.OutputChunk => o.type === 'chunk' && has(o, SCALAR));
    const scalarFiles = new Set(scalarChunks.map((o) => o.fileName));
    firstLoad = js.filter((j) => first.has(j.file));
    scalar = js.filter((j) => scalarFiles.has(j.file) && !first.has(j.file));
    // The 404's own scripts (dist/404.html: its pre-paint file and its module) are never the
    // map's: kept out of the lazy total and measured on their own.
    const page404 = (file: string) => /^assets\/notfound-/.test(file);
    notFound = js.filter((j) => page404(j.file));
    notFoundImports = out.output.flatMap((o) => (o.type === 'chunk' && page404(o.fileName) ? [...o.imports, ...o.dynamicImports] : []));
    lazy = js.filter((j) => !first.has(j.file) && !scalarFiles.has(j.file) && !page404(j.file));
  }, 180_000);

  const sum = (list: Js[]) => list.reduce((s, j) => s + j.gzip, 0);
  const show = (list: Js[]) => list.map((j) => `${j.file} ${(j.gzip / KB).toFixed(1)} kB`).join(', ') || 'none';

  test('first-load JS is within 210 kB gzipped', () => {
    console.info(`first load: ${(sum(firstLoad) / KB).toFixed(1)} kB gzipped (${show(firstLoad)})`);
    expect(firstLoad.some((j) => j.file.includes('main'))).toBe(true);
    expect(firstLoad.some((j) => j.file === runtime?.fileName)).toBe(true);
    expect(sum(firstLoad)).toBeLessThanOrEqual(FIRST_LOAD_MAX);
  });

  // Every browser we target but Safari before 16.4 has wasm SIMD and takes the first load above.
  // Those without it also fetch the decoder's scalar build, one chunk of that alone, as soon as the
  // runtime runs: their first load is the two together.
  test('the meshopt decoder ships its SIMD build on the first load and its scalar build apart', () => {
    console.info(
      `first load without wasm SIMD: ${((sum(firstLoad) + sum(scalar)) / KB).toFixed(1)} kB gzipped (+ ${show(scalar)})`,
    );
    expect(scalar).toHaveLength(1);
    expect(scalarChunks[0]!.moduleIds).toHaveLength(1);
    expect(sum(scalar)).toBeLessThanOrEqual(SCALAR_MAX);
    expect(sum(firstLoad) + sum(scalar)).toBeLessThanOrEqual(FIRST_LOAD_MAX + SCALAR_MAX);
    expect(runtime!.dynamicImports).toContain(scalar[0]!.file);
  });

  // Task 18: the HTML heading is the LCP, so nothing it needs waits on the runtime.
  // main is the page's only module script and stays small; its one import() is the runtime,
  // which main fetches after the first paint, and which holds the map's code (three.js too).
  // The header's toggles (the theme switch, later the sound) live in main, so the plain page has
  // them too: its limit was raised from 2 to 4 kB for them (owner, 2026-10-21).
  test('the map runtime is its own chunk, which main imports after the first paint', () => {
    expect(entry, 'src/main.ts is an entry chunk').toBeDefined();
    expect(runtime, 'src/map.ts is a chunk of its own').toBeDefined();
    expect(entry!.imports).toEqual([]);
    expect(entry!.dynamicImports).toEqual([runtime!.fileName]);
    expect(gzipped(entry!.code)).toBeLessThanOrEqual(4 * KB);
    expect(runtime!.moduleIds.some((id) => id.replace(/\\/g, '/').includes('/node_modules/three/'))).toBe(true);
    // A value import of 'three' in a second lazy moment made Rolldown split three.core out of
    // the runtime into a shared chunk, 2.2 kB more on the first load (Task 16): the moments
    // take three's classes from objects the runtime made, and import its types only.
    expect(runtime!.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith('/three/build/three.core.js'))).toBe(true);
  });

  test('the HTML heading is in the prerendered page, ahead of any module script', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('<body'));
    // The one classic script is boot.js (no defer: it picks has-3d or no-3d before the paint).
    const classic = [...head.matchAll(/<script\b(?![^>]*type="(?:module|application\/json)")[^>]*>/g)];
    expect(classic.map((m) => m[0])).toEqual([expect.stringMatching(/src="\/assets\/boot-[^"]+\.js"/)]);
    expect([...indexHtml.matchAll(/<script\b[^>]*type="module"[^>]*>/g)]).toHaveLength(1);
    expect(indexHtml).toMatch(/<header class="top"><h1 class="mark">candygoogy/);
  });

  // The budget: the first load is the HTML and the origin's model; the rest come as you move. The
  // origin loads <id>.glb when it has one, else the box (nodes.ts, KNOWN_MODELS); its URL
  // carries ?v=<hash> (models.ts), which doesn't change the file. Counted as the files' own
  // bytes, so before the server's gzip of the HTML.
  test('index.html and the origin model are within 500 kB', () => {
    const own = join(ROOT, 'public', 'models', 'origin.glb');
    const glb = existsSync(own) ? own : join(ROOT, 'public', 'models', 'box.glb');
    const html = Buffer.byteLength(indexHtml);
    const model = statSync(glb).size;
    console.info(
      `first paint: index.html ${(html / KB).toFixed(1)} kB (${(gzipped(indexHtml) / KB).toFixed(1)} gzipped) + ${basename(glb)} ${(model / KB).toFixed(1)} kB`,
    );
    expect(html).toBeGreaterThan(0);
    expect(html + model).toBeLessThanOrEqual(FIRST_PAINT_MAX);
  });

  test('the lazy chunks (the moments) are within 60 kB gzipped together', () => {
    console.info(`lazy: ${(sum(lazy) / KB).toFixed(1)} kB gzipped (${show(lazy)})`);
    expect(sum(lazy)).toBeLessThanOrEqual(MOMENTS_MAX);
  });

  test('the 404’s scripts are its own and stay small', () => {
    console.info(`404: ${(sum(notFound) / KB).toFixed(1)} kB gzipped (${show(notFound)})`);
    expect(notFound).toHaveLength(2);
    // A copy of everything it uses (vite-plugin-prerender.ts): it shares no chunk with the map.
    expect(notFoundImports).toEqual([]);
    expect(firstLoad.some((j) => notFound.some((n) => n.file === j.file))).toBe(false);
    expect(sum(notFound)).toBeLessThanOrEqual(8 * KB);
  });

  test('everything after the arrival (the models and the moments) is within 4.1 MB', () => {
    const models = shippedModels().reduce((s, m) => s + m.bytes, 0);
    console.info(`after the arrival: ${((models + sum(lazy)) / KB).toFixed(1)} kB`);
    expect(models + sum(lazy)).toBeLessThanOrEqual(AFTER_ARRIVAL_MAX);
  });
});
