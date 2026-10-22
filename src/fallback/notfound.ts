// The map's 404 (dist/404.html, written by vite-plugin-prerender.ts; Cloudflare serves it with a
// 404 for any path that matches no file: wrangler.jsonc's not_found_handling). candygoogy.dev's
// 404 (404.astro), as the experiments serve it (experiments/shared/shell.ts, notFoundHtml), in
// the map's own header: a large "404" that types in, the page's words and the way back to the
// map, beside the three-hop route trace (you, the site, this page), with the request's time,
// the hops checked in turn ("Checking…", then "Working", the page "Not found"), its path, and the
// last hop's egg. The second hop, the site, is a door back to it, as the site's is the door to
// the map. Then the site's footer, with the map's build stamp. With the owner's call of
// 2026-10-22 evening ("the 404 page needs to have full parity with others"), its old static,
// switch-less version retired.
//
// Without JS it's the finished state. With it: html.js and the saved theme before the paint (an
// external classic script: src/theme-boot.ts and src/notfound/head.ts), then src/notfound/main.ts
// (the theme switch and the motion), a module of its own. No inline script or style, so it stays
// inside the map's CSP (public/_headers) with no hashes. Around it, the map's stylesheet (tokens,
// fonts, links, focus, the header and its switch), then src/notfound.css for the nf- classes.

import type { Copy } from '../copy';
import type { MapFeed } from '../data/feed';
import { type BuildStamp, shortCommit } from './build';
import { esc, renderHeader } from './html';

// The hops' icons, the site's (24 × 24, stroked in currentColor by notfound.css).
const ICONS = {
  laptop: `<rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" />`,
  globe:
    `<circle cx="12" cy="12" r="8.5" />` +
    `<path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5Z" />`,
  page: `<path d="M6.5 3.5h7.5l4 4v13h-11.5Z" /><path d="M14 3.5v4h4M9.5 13h5M9.5 16.5h3" />`,
};

type State = 'checking' | 'ok' | 'missing' | 'restarting';

/** Every word a hop can show, stacked in one cell as wide as its settled word (data-settled), so
 *  the settled status sits centred under its icon and nothing moves when it changes. Each carries
 *  its word for the screen reader's line (data-word; src/notfound/trace.ts). */
function states(copy: Copy, settled: State): string {
  const words: Record<State, string> = {
    checking: copy.nfChecking.text,
    ok: copy.working.text,
    missing: copy.nfNotFound.text,
    restarting: copy.nfRestarting.text,
  };
  return (Object.keys(words) as State[])
    .map((key) => {
      const word = words[key];
      // "Checking…" has its dots apart, so they can appear in turn while the hop is checked.
      const shown =
        key === 'checking'
          ? `${esc(word.replace(/…$/, ''))}<span class="nf-dots"><span>.</span><span>.</span><span>.</span></span>`
          : esc(word);
      return `<span data-is="${key}" data-word="${esc(word)}"${key === settled ? ' data-settled' : ''}>${shown}</span>`;
    })
    .join('');
}

function trace(feed: MapFeed, copy: Copy): string {
  const hops = [
    { label: copy.nfYou.text, state: 'ok' as const, icon: ICONS.laptop },
    // The site, as on candygoogy.dev's 404 and the experiments': the map is one of its
    // subdomains. A door back to it, as the site's own second hop is the door to the map.
    { label: copy.nfSite.text, state: 'ok' as const, icon: ICONS.globe, href: new URL('/', feed.site.url).href },
    { label: copy.nfThisPage.text, state: 'missing' as const, icon: ICONS.page },
  ]
    .map((hop, i) => {
      const words = hop.state === 'ok' ? copy.working.text : copy.nfNotFound.text;
      const open = hop.href ? `<a class="nf-node" href="${esc(hop.href)}">` : `<span class="nf-node">`;
      return (
        `<li class="nf-hop" data-hop="${i + 1}">${open}` +
        `<span class="nf-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28">${hop.icon}</svg></span>` +
        `<span class="nf-num" aria-hidden="true">0${i + 1}</span>` +
        `<span class="nf-label">${esc(hop.label)}</span><span class="nf-sr">, </span>` +
        `<span class="nf-status" data-state="${hop.state}">` +
        `<span class="nf-dot" aria-hidden="true"></span>` +
        `<span class="nf-states" aria-hidden="true">${states(copy, hop.state)}</span>` +
        `<span class="nf-sr" data-sr>${esc(words)}</span>` +
        `</span>` +
        (hop.href ? `<span class="nf-sr">${esc(copy.nfOpensSite.text)}</span>` : '') +
        // The path under "This page", filled in by the script; its line is kept even when empty,
        // so nothing moves.
        (hop.state === 'missing' ? `<span class="nf-path" data-path></span>` : '') +
        (hop.href ? `</a>` : `</span>`) +
        `</li>`
      );
    })
    .join('');
  return (
    `<div class="nf-trace" data-trace data-time="${esc(copy.nfTime.text)}" data-egg-hint="${esc(copy.nfEggHint.text)}" data-egg-reply="${esc(copy.nfEggReply.text)}">` +
    ['tl', 'tr', 'bl', 'br'].map((c) => `<span class="nf-tick nf-${c}" aria-hidden="true"></span>`).join('') +
    // The request's time (UTC, set once) and the path come from the script.
    `<p class="nf-panel-head"><span>${esc(copy.nfRouteCheck.text)}</span><span data-time-value></span></p>` +
    `<div class="nf-panel-body"><ol class="nf-hops">${hops}</ol>` +
    `<p class="nf-egg-line" aria-live="polite" data-egg-line></p></div>` +
    `<dl class="nf-meta leaders"><div><dt>${esc(copy.nfStatus.text)}</dt><dd>404</dd></div>` +
    `<div hidden data-meta-path><dt>${esc(copy.nfPath.text)}</dt><dd data-path-value></dd></div></dl>` +
    `</div>`
  );
}

/** The map's source, which the footer's Source link and its build stamp's commit point into. */
export const MAP_SOURCE = 'https://github.com/candygoogy/map';

/** The site's build stamp (Footer.astro): "Built <date> from <commit>", the date a <time>, the
 *  short commit linked to the full one and named "commit 1a2b3c4" (", with uncommitted changes"
 *  when dirty). With no commit, "Built <date>" alone. */
function stamp(copy: Copy, built: BuildStamp): string {
  const time = `<time datetime="${esc(built.iso)}">${esc(built.label)}</time>`;
  const short = shortCommit(built);
  if (!built.commit || !short) return esc(copy.nfFootBuilt.text).replace('{date}', time);
  const name = (built.dirty ? copy.nfFootCommitDirty : copy.nfFootCommit).text.replace('{commit}', short);
  const link = `<a href="${esc(`${MAP_SOURCE}/commit/${built.commit}`)}" aria-label="${esc(name)}">${esc(short)}</a>`;
  return esc(copy.nfFootBuiltFrom.text).replace('{date}', time).replace('{commit}', link);
}

/** The site's footer (Footer.astro): the notes (the ©, the privacy claim linked to how to check
 *  it, the build stamp), then its links (Colophon, Uses, and the map's Source). No "Back to top":
 *  on a page this short it's no use (the owner, 2026-10-22 evening; the site's 404 drops it
 *  too). Phones leave the stamp out, as the site's do (notfound.css). */
function footer(feed: MapFeed, copy: Copy, built: BuildStamp, year: number): string {
  const site = (path: string) => esc(new URL(path, feed.site.url).href);
  return (
    `<footer class="nf-foot"><div class="nf-foot-inner">` +
    `<p class="nf-notes"><span>${esc(copy.nfFootOwner.text.replace('{year}', String(year)))}</span>` +
    `<span><a href="${site('/colophon#privacy')}">${esc(copy.nfFootPrivacy.text)}</a></span>` +
    `<span class="nf-stamp">${stamp(copy, built)}</span></p>` +
    `<a href="${site('/colophon')}">${esc(copy.nfFootColophon.text)}</a>` +
    `<a href="${site('/uses')}">${esc(copy.nfFootUses.text)}</a>` +
    `<a href="${esc(MAP_SOURCE)}">${esc(copy.nfFootSource.text)}</a>` +
    `</div></footer>`
  );
}

/**
 * The whole 404.html. `head` is its scripts and the built page's <link>s, as they are (the
 * pre-paint script, the 404's module, font preloads, icons, the map's stylesheet, then the
 * 404's), so the hashed asset names come from the build. `built` is the footer's build stamp
 * (src/fallback/build.ts, read by the prerender), `year` its ©.
 */
export function renderNotFound(
  feed: MapFeed,
  copy: Copy,
  head: string[],
  built: BuildStamp,
  year = new Date().getFullYear(),
): string {
  // The "404" types in digit by digit, each in its own clip (notfound.css).
  const code = [...'404'].map((ch, i) => `<span class="nf-l" data-i="${i}"><span>${ch}</span></span>`).join('');
  return [
    `<!doctype html>`,
    `<html lang="en" class="no-3d">`,
    `  <head>`,
    `    <meta charset="utf-8" />`,
    `    <meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `    <title>${esc(copy.nfPageTitle.text)}</title>`,
    `    <meta name="description" content="${esc(copy.nfDescription.text)}" />`,
    `    <meta name="robots" content="noindex" />`,
    `    <meta name="color-scheme" content="light dark" />`,
    // The browser's bar in the page's colour (--bg), as on the site; the pre-paint script and
    // the switch set both to a chosen theme's.
    `    <meta name="theme-color" content="#f4f4f5" media="(prefers-color-scheme: light)" />`,
    `    <meta name="theme-color" content="#121214" media="(prefers-color-scheme: dark)" />`,
    ...head.map((l) => `    ${l}`),
    `  </head>`,
    `  <body class="nf-page">`,
    `    <a class="nf-skip" href="#main">${esc(copy.nfSkip.text)}</a>`,
    `    <header id="top" class="top">${renderHeader(feed, copy, { page: 'notFound' })}</header>`,
    `    <main id="main" class="nf-main">`,
    `      <section class="nf" aria-labelledby="nf-title">`,
    `        <div class="nf-lost">`,
    `          <p class="nf-code" aria-hidden="true">${code}</p>`,
    `          <h1 id="nf-title"><span class="rv-mask" data-d="260"><span>${esc(copy.nfHeading.text)}</span></span></h1>`,
    `          <p class="nf-lede rv" data-d="380">${esc(copy.nfLede.text)}</p>`,
    `          <p class="nf-back rv" data-d="500"><a href="/">${esc(copy.nfBack.text)}</a></p>`,
    `        </div>`,
    `        ${trace(feed, copy)}`,
    `      </section>`,
    `    </main>`,
    `    ${footer(feed, copy, built, year)}`,
    `  </body>`,
    `</html>`,
    ``,
  ].join('\n');
}
