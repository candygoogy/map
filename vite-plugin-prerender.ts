// Prerenders the map's HTML from the content feed, in `vite dev` and
// `vite build` alike:
// - reads FEED_URL (a file path or an http(s) URL; default the fixture) and
//   validates it with parseFeed. If it can't be read or doesn't parse, the
//   build fails with the reason, so nothing stale ships;
// - fills index.html's markers with the header, the overview's welcome and
//   the stations (the homelab cluster's devices included: src/data/cluster.ts), embeds the feed as <script type="application/json"
//   id="feed-snapshot">, and sets <html class="no-3d">;
// - serves src/theme-boot.ts + src/boot.ts as one external classic script at index.html's boot
//   marker, ahead of the stylesheet (the CSP allows no inline script). In a
//   build it's emitted as assets/boot-<hash>.js; in dev it's compiled on
//   each request;
// - in a build, writes dist/404.html (src/fallback/notfound.ts), which
//   Cloudflare serves for any path with no file: first src/theme-boot.ts and
//   src/notfound/head.ts as one classic script, assets/notfound-head-<hash>.js
//   (the saved theme and html.js, before the paint; boot.js starts with the
//   same theme code), then the 404's module, src/notfound/main.ts (the theme
//   switch and the motion), built as an entry of its own,
//   assets/notfound-<hash>.js; then the built page's <link>s (fonts, icons, its
//   stylesheet), and src/notfound.css as assets/notfound-<hash>.css. No inline
//   script, so the CSP needs no hashes. Its footer's build stamp (the date, and
//   the commit from Workers Builds or git: src/fallback/build.ts) is read here,
//   at build time, so it adds nothing to any script.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { type Plugin, type ResolvedConfig, transformWithOxc } from 'vite';
import { copy } from './src/copy';
import { withCluster } from './src/data/cluster';
import { loadFeed } from './src/data/load-feed';
import world from './src/data/world.json';
import type { MapFeed } from './src/data/feed';
import { buildStamp } from './src/fallback/build';
import { esc, renderHeader, renderStations, renderWelcome } from './src/fallback/html';
import { renderNotFound } from './src/fallback/notfound';

export interface PrerenderOptions {
  /** Default: process.env.FEED_URL, else src/data/fixture.json. */
  feedUrl?: string;
  /** Injected by tests. */
  fetchImpl?: typeof fetch;
}

const MARKERS = {
  title: '<!--map:title-->',
  header: '<!--map:header-->',
  welcome: '<!--map:welcome-->',
  stations: '<!--map:stations-->',
  snapshot: '<!--map:snapshot-->',
  boot: '<!--map:boot-->',
} as const;

const BOOT_SOURCE = 'src/boot.ts';
const THEME_SOURCE = 'src/theme-boot.ts';
const NOT_FOUND_CSS = 'src/notfound.css';
const NOT_FOUND_HEAD = 'src/notfound/head.ts';
// The 404's module, an entry of its own that only 404.html loads. Every module it reaches is a
// copy of its own (its id marked with NOT_FOUND_ID), as the experiments build theirs
// (experiments/shared/vite.ts): nothing is shared with the map's entry, so no common chunk, and
// the map's own files come out exactly as they would without it (its first load unchanged).
const NOT_FOUND_ENTRY = 'src/notfound/main.ts';
const NOT_FOUND = 'notfound';
const NOT_FOUND_ID = '?notfound';
const BOOT_DEV_URL = '/boot.js';

/** JSON that is safe inside a <script> element: no `</script>` or `<!--`. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c');

/** Only the map's own page is prerendered; dev/ pages pass through untouched. */
const isMapPage = (path: string) => path === '/' || path === '/index.html';

function fill(html: string, marker: string, content: string): string {
  if (!html.includes(marker)) throw new Error(`index.html has no ${marker} marker`);
  return html.replace(marker, () => content);
}

function setNo3d(html: string): string {
  return html.replace(/<html\b([^>]*)>/i, (tag, attrs: string) => {
    const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(attrs);
    if (!cls) return `<html${attrs} class="no-3d">`;
    const names = cls[1]!.split(/\s+/).filter((c) => c && c !== 'has-3d' && c !== 'no-3d');
    return tag.replace(cls[0], `class="${[...names, 'no-3d'].join(' ')}"`);
  });
}

async function compileClassic(root: string, file: string): Promise<string> {
  const path = resolve(root, file);
  const source = await readFile(path, 'utf8');
  const out = await transformWithOxc(source, path, { lang: 'ts', target: 'es2020' });
  // Its whole-line comments left out: they're for the source, and this runs before the paint.
  return out.code.replace(/^[ \t]*\/\/.*\r?\n/gm, '');
}

/** boot.js: the saved theme (src/theme-boot.ts), then src/boot.ts. */
const compileBoot = async (root: string): Promise<string> =>
  (await compileClassic(root, THEME_SOURCE)) + (await compileClassic(root, BOOT_SOURCE));

export function prerender(opts: PrerenderOptions = {}): Plugin[] {
  const feedUrl = opts.feedUrl ?? process.env.FEED_URL ?? 'src/data/fixture.json';
  let config: ResolvedConfig;
  let bootUrl = BOOT_DEV_URL;
  // The feed index.html was built from, for the 404's header (the way back to the site).
  let builtFeed: MapFeed | undefined;

  const content: Plugin = {
    name: 'map:prerender',
    configResolved(c) {
      config = c;
    },
    configureServer(server) {
      // An edit to a local feed file reloads the page.
      if (/^https?:\/\//i.test(feedUrl)) return;
      const path = isAbsolute(feedUrl) ? feedUrl : resolve(config.root, feedUrl);
      server.watcher.add(path);
      server.watcher.on('change', (changed) => {
        if (resolve(changed) === path) server.ws.send({ type: 'full-reload' });
      });
    },
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        if (!isMapPage(ctx.path)) return html;
        const feed = await loadFeed(feedUrl, opts.fetchImpl, config.root);
        builtFeed = feed;
        let out = fill(html, MARKERS.title, esc(copy.pageTitle.text));
        out = fill(out, MARKERS.header, renderHeader(feed, copy));
        // The homelab cluster's devices get sections of their own (src/data/cluster.ts), as
        // map.ts makes them stations, and the welcome counts them; the snapshot below stays the
        // feed as it came.
        const clustered = withCluster(feed, world);
        out = fill(out, MARKERS.welcome, renderWelcome(clustered, copy));
        out = fill(out, MARKERS.stations, renderStations(clustered, copy));
        out = fill(
          out,
          MARKERS.snapshot,
          `<script type="application/json" id="feed-snapshot">${scriptJson(feed)}</script>`,
        );
        return setNo3d(out);
      },
    },
  };

  const boot: Plugin = {
    name: 'map:boot',
    async buildStart() {
      if (config.command !== 'build') return;
      const code = await compileBoot(config.root);
      const hash = createHash('sha256').update(code).digest('base64url').slice(0, 8);
      const fileName = `${config.build.assetsDir}/boot-${hash}.js`;
      this.emitFile({ type: 'asset', fileName, source: code });
      bootUrl = config.base + fileName;
    },
    configureServer(server) {
      server.middlewares.use(BOOT_DEV_URL, async (_req, res, next) => {
        try {
          const code = await compileBoot(config.root);
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(code);
        } catch (err) {
          next(err);
        }
      });
    },
    // After Vite's own HTML processing, so the classic script is left as it
    // is rather than offered to the bundler.
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!isMapPage(ctx.path)) return html;
        return fill(html, MARKERS.boot, `<script src="${bootUrl}"></script>`);
      },
    },
  };

  const notFound: Plugin = {
    name: 'map:404',
    apply: 'build',
    buildStart() {
      this.emitFile({ type: 'chunk', id: resolve(config.root, NOT_FOUND_ENTRY) + NOT_FOUND_ID, name: NOT_FOUND });
    },
    // What the 404's entry imports, it gets as its own copy too: ahead of Vite's own resolving,
    // which would hand it the map's.
    resolveId: {
      order: 'pre',
      async handler(id, importer, options) {
        if (!importer?.endsWith(NOT_FOUND_ID)) return;
        const resolved = await this.resolve(id, importer.slice(0, -NOT_FOUND_ID.length), { ...options, skipSelf: true });
        if (!resolved || resolved.external || resolved.id.includes('?')) return resolved;
        return { ...resolved, id: resolved.id + NOT_FOUND_ID };
      },
    },
    // After Vite has written index.html into the bundle, so its hashed asset names are final.
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const index = bundle['index.html'];
        if (index?.type !== 'asset' || !builtFeed) throw new Error('404.html: index.html was not built');
        const indexHead = /<head>([\s\S]*?)<\/head>/i.exec(String(index.source))?.[1] ?? '';
        // Its <link>s only (preloads, icons, the stylesheet): never its scripts.
        const links = (indexHead.match(/<link\b[^>]*>/gi) ?? []).filter((l) =>
          /\brel="(?:preload|icon|apple-touch-icon|stylesheet)"/.test(l),
        );
        // Its comments and blank lines left out (they're for the source).
        const css = (await readFile(resolve(config.root, NOT_FOUND_CSS), 'utf8'))
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\n\s*\n+/g, '\n')
          .trim();
        const hash = createHash('sha256').update(css).digest('base64url').slice(0, 8);
        const cssFile = `${config.build.assetsDir}/notfound-${hash}.css`;
        this.emitFile({ type: 'asset', fileName: cssFile, source: `${css}\n` });
        links.push(`<link rel="stylesheet" href="${config.base}${cssFile}">`);
        // Before the paint, first in its head as boot.js is on the map's page: the saved theme
        // (src/theme-boot.ts), so a visitor who chose Dark gets a dark 404, then html.js and the
        // browser bar's colour (src/notfound/head.ts). External, so the CSP stays hash-free.
        const early = (await compileClassic(config.root, THEME_SOURCE)) + (await compileClassic(config.root, NOT_FOUND_HEAD));
        const earlyHash = createHash('sha256').update(early).digest('base64url').slice(0, 8);
        const earlyFile = `${config.build.assetsDir}/notfound-head-${earlyHash}.js`;
        this.emitFile({ type: 'asset', fileName: earlyFile, source: early });
        // The 404's module (src/notfound/main.ts), deferred as modules are.
        const entry = Object.values(bundle).find((f) => f.type === 'chunk' && f.isEntry && f.name === NOT_FOUND);
        if (!entry) throw new Error('404.html: its script was not built');
        const head = [
          `<script src="${config.base}${earlyFile}"></script>`,
          `<script type="module" crossorigin src="${config.base}${entry.fileName}"></script>`,
          ...links,
        ];
        this.emitFile({ type: 'asset', fileName: '404.html', source: renderNotFound(builtFeed, copy, head, buildStamp()) });
      },
    },
  };

  return [content, boot, notFound];
}
