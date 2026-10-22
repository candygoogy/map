import { defineConfig, normalizePath, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { prerender } from './vite-plugin-prerender';
import { threeShaders } from './vite-plugin-three-shaders';

// Blender exports land in public/models/<id>.raw.glb before compression; only the
// compressed <id>.glb ships, so the raw files are removed from dist/ after the copy, and so
// are the _-prefixed pipeline probes (_probe.glb), which the page never asks for.
function dropRawModels(): Plugin {
  let outDir = '';
  return {
    name: 'map:drop-raw-models',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const dir = join(outDir, 'models');
      let files: string[] = [];
      try {
        files = readdirSync(dir);
      } catch {
        return;
      }
      for (const f of files) if (f.endsWith('.raw.glb') || f.startsWith('_')) rmSync(join(dir, f));
    },
  };
}

// The year's cache, file by file. Cloudflare applies `_headers` by path, whatever the status, so a
// `/assets/*` rule would also keep a 404 there (a deploy's old chunk, a missing model) for a year
// as `immutable`: a path that 404s once and exists later would stay a 404. So once the bundle is
// written, the build writes dist/_headers as public/_headers (the rules for every path) plus one
// rule per file it ships under assets/ and models/, and a path that isn't a file gets the
// default `public, max-age=0, must-revalidate`, as the page does. A build that doesn't write
// (the unit tests' `write: false`) leaves it alone. Workers takes at most 100 rules in
// _headers, so the build fails before that would be passed.
function immutableHeaders(): Plugin {
  const YEAR = 'Cache-Control: public, max-age=31536000, immutable';
  const MAX_RULES = 100;
  let outDir = '';
  let publicDir = '';
  let assets: string[] | null = null; // the bundle's files, once it's written (not with write: false)
  return {
    name: 'map:immutable-headers',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
      publicDir = c.build.copyPublicDir ? c.publicDir : '';
    },
    writeBundle(_options, bundle) {
      assets = Object.keys(bundle).filter((f) => f.startsWith('assets/'));
    },
    closeBundle() {
      if (!assets || !publicDir) return;
      const models = readdirSync(join(publicDir, 'models')).filter((f) => f.endsWith('.glb') && !f.endsWith('.raw.glb') && !f.startsWith('_'));
      const paths = [...assets.sort(), ...models.sort().map((f) => `models/${f}`)].map((f) => `/${f}`);
      // Written whole from public/_headers each time, so a second build never adds to the first's.
      const source = readFileSync(join(publicDir, '_headers'), 'utf8');
      const rules = (source.match(/^\/\S*$/gm) ?? []).length + paths.length;
      if (rules > MAX_RULES) throw new Error(`_headers: ${rules} rules, over Workers' ${MAX_RULES}`);
      const added = paths.map((p) => `${p}\n  ${YEAR}\n`).join('');
      writeFileSync(join(outDir, '_headers'), `${source}\n# Added by the build (vite.config.ts, immutableHeaders): the files under /assets/ and /models/.\n${added}`);
    },
  };
}

// Which models exist, so a node asks only for a GLB that's there (no 404s in the console):
// `import modelIds from 'virtual:models'` is the ids of public/models/<id>.glb, read at build
// time (raw exports and _-prefixed probes left out). `versions` is a short hash of each file,
// which models.ts puts on its URL (`?v=`): the models are cached for a year (immutableHeaders)
// under names that don't change, so a re-exported model needs a new URL. In dev, adding,
// removing or re-exporting a GLB invalidates the list, so the next page load sees it.
function modelManifest(): Plugin {
  const id = 'virtual:models';
  const resolved = '\0virtual:models';
  let dir = '';
  return {
    name: 'map:models',
    configResolved(c) {
      dir = resolve(c.publicDir, 'models');
    },
    resolveId: (source) => (source === id ? resolved : undefined),
    load(source) {
      if (source !== resolved) return;
      const files = readdirSync(dir).filter((f) => /^[a-z0-9-]+\.glb$/.test(f));
      const ids = files.map((f) => f.slice(0, -'.glb'.length));
      const versions = Object.fromEntries(
        files.map((f, i) => [ids[i], createHash('sha256').update(readFileSync(join(dir, f))).digest('hex').slice(0, 10)]),
      );
      return `export default ${JSON.stringify(ids)};\nexport const versions = ${JSON.stringify(versions)};`;
    },
    configureServer(server) {
      const changed = (file: string) => {
        if (!file.endsWith('.glb') || resolve(dirname(file)) !== dir) return;
        const mod = server.moduleGraph.getModuleById(resolved);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on('add', changed);
      server.watcher.on('change', changed);
      server.watcher.on('unlink', changed);
    },
  };
}

// The dev server watches the project root, and the root's .claude/ holds the agents' git
// worktrees: tens of thousands of files, none of them the page's. Until the watcher's first
// crawl of them is done, a cold server answers the page's stylesheet 15-25 s late, which is
// most of an e2e test's 30 s before the runtime has even been asked for. Only this checkout's
// own .claude/ is left out: a worktree's root is itself inside one, so a `**/.claude/**` glob
// would stop it watching anything.
const claudeDir = normalizePath(join(dirname(fileURLToPath(import.meta.url)), '.claude'));
const inClaudeDir = (path: string): boolean => {
  const p = normalizePath(path);
  return p === claudeDir || p.startsWith(`${claudeDir}/`);
};

// dev/ pages (model viewer, render gallery) are served by `npm run dev` only:
// the production build has index.html as its one input, so dev/ never reaches dist/.
export default defineConfig({
  plugins: [prerender(), dropRawModels(), immutableHeaders(), modelManifest(), threeShaders()],
  server: { watch: { ignored: [inClaudeDir] } },
  build: {
    target: 'es2022',
    // No modulepreload polyfill (0.5 kB of first-load JS): a browser without modulepreload
    // only loses the preload hint, and every browser the es2022 target reaches loads fine.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { main: fileURLToPath(new URL('./index.html', import.meta.url)) },
    },
  },
});
