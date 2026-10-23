import { fileURLToPath } from 'node:url';
import { build, type Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { copy } from '../../src/copy';
import { parseFeed } from '../../src/data/feed';
import fixture from '../../src/data/fixture.json';
import { type BuildStamp, buildStamp } from '../../src/fallback/build';
import { MAP_SOURCE, renderNotFound } from '../../src/fallback/notfound';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('404.html, as built', () => {
  let out: Rolldown.RolldownOutput;
  let html = '';
  const file = (name: string) => out.output.find((f) => f.fileName === name);

  beforeAll(async () => {
    out = (await build({
      root,
      configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
      logLevel: 'silent',
      build: { write: false },
    })) as Rolldown.RolldownOutput;
    const page = file('404.html');
    expect(page?.type).toBe('asset');
    html = String((page as Rolldown.OutputAsset).source);
  }, 180_000);

  it('has two external scripts, the pre-paint one first, and no inline script or style', () => {
    // The CSP (public/_headers) allows no inline script or style. First, before the paint, the
    // saved theme and html.js (src/theme-boot.ts + src/notfound/head.ts) as a classic script;
    // then the 404's module (src/notfound/main.ts): the theme switch and the motion.
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    expect(scripts.map((s) => s[0])).toEqual([
      expect.stringMatching(/^<script src="\/assets\/notfound-head-[\w-]+\.js"><\/script>$/),
      expect.stringMatching(/^<script type="module" crossorigin src="\/assets\/notfound-[\w-]+\.js"><\/script>$/),
    ]);
    const early = /src="\/(assets\/notfound-head-[\w-]+\.js)"/.exec(html)![1]!;
    const earlyJs = String((file(early) as Rolldown.OutputAsset).source);
    expect(earlyJs).toContain('localStorage.getItem("theme")');
    expect(earlyJs).toContain('classList.add("js")');
    expect(html.indexOf('<script')).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
    expect(html).not.toMatch(/<style\b|\sstyle=/i);
  });

  it('builds its module as its own entry, sharing nothing with the map', () => {
    const name = /src="\/(assets\/notfound-(?!head)[\w-]+\.js)"/.exec(html)![1]!;
    const chunk = file(name) as Rolldown.OutputChunk;
    expect(chunk.type).toBe('chunk');
    expect(chunk.isEntry).toBe(true);
    expect(chunk.imports).toEqual([]);
    expect(chunk.dynamicImports).toEqual([]);
    const ids = chunk.moduleIds.map((id) => id.replace(/\\/g, '/'));
    for (const src of ['/src/notfound/main.ts', '/src/notfound/trace.ts', '/src/notfound/reveal.ts', '/src/theme-switch.ts']) {
      expect(ids.some((id) => id.includes(src)), src).toBe(true);
    }
    // The map's own chunks never carry the 404's code.
    for (const o of out.output) {
      if (o.type !== 'chunk' || o === chunk) continue;
      expect(o.moduleIds.some((id) => id.replace(/\\/g, '/').includes('/src/notfound/')), o.fileName).toBe(false);
    }
  });

  it('links the built stylesheets, the map’s then the 404’s', () => {
    const sheets = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/([^"]+)"/g)].map((m) => m[1]!);
    expect(sheets).toHaveLength(2);
    expect(sheets[1]).toMatch(/^assets\/notfound-[\w-]+\.css$/);
    for (const s of sheets) expect(file(s), s).toBeDefined();
  });

  it('stamps the footer with the build’s date and commit at prerender, in no script', () => {
    expect(html).toMatch(
      /<span class="nf-stamp">Built <time datetime="\d{4}-\d\d-\d\d">[A-Z][a-z]{2} \d{1,2}, \d{4}<\/time> from <a href="https:\/\/github\.com\/candygoogy\/map\.candygoogy\.dev\/commit\/[0-9a-f]{40}" aria-label="commit [0-9a-f]{7}(-dirty, with uncommitted changes)?">[0-9a-f]{7}(-dirty)?<\/a><\/span>/,
    );
    for (const f of out.output) {
      if (f.fileName.endsWith('.js')) {
        const code = f.type === 'chunk' ? f.code : String(f.source);
        expect(code, f.fileName).not.toContain('github.com/candygoogy/map.candygoogy.dev');
      }
    }
  });
});

const SHA = '0123456789abcdef0123456789abcdef01234567';
const built: BuildStamp = { iso: '2026-10-22', label: 'Oct 22, 2026', commit: SHA, dirty: false };

describe('renderNotFound', () => {
  const feed = parseFeed(fixture);
  const html = renderNotFound(feed, copy, ['<link rel="stylesheet" href="/x.css">'], built, 2026);

  it('keeps the head of the site’s 404: title, description, noindex and the theme colours', () => {
    expect(html).toContain(`<title>${copy.nfPageTitle.text}</title>`);
    expect(html).toContain(`<meta name="description" content="${copy.nfDescription.text}" />`);
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain('<meta name="theme-color" content="#f4f4f5" media="(prefers-color-scheme: light)" />');
    expect(html).toContain('<meta name="theme-color" content="#121214" media="(prefers-color-scheme: dark)" />');
    // The pre-paint script sets the metas, so they come before it.
    expect(html.indexOf('name="theme-color"')).toBeLessThan(html.indexOf('<link rel="stylesheet" href="/x.css">'));
  });

  it('has the site’s order: skip link, header with the theme switch, the 404, the trace, the footer', () => {
    const at = (s: string) => {
      const i = html.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      `<a class="nf-skip" href="#main">${copy.nfSkip.text}</a>`,
      '<header id="top" class="top">',
      'data-theme-switch',
      `>${copy.backToSite.text}</a>`,
      '<main id="main"',
      'class="nf-code"',
      `<h1 id="nf-title"><span class="rv-mask" data-d="260"><span>${copy.nfHeading.text}</span></span></h1>`,
      `<p class="nf-lede rv" data-d="380">`,
      `<p class="nf-back rv" data-d="500"><a href="/">${copy.nfBack.text}</a></p>`,
      'data-trace',
      '<footer class="nf-foot">',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The header's switch comes alone: no sound on the 404.
    expect(html).not.toContain('data-sound');
    expect(html).not.toContain('plain-note');
  });

  it('types the "404" in digit by digit', () => {
    expect(html).toContain(
      '<p class="nf-code" aria-hidden="true"><span class="nf-l" data-i="0"><span>4</span></span><span class="nf-l" data-i="1"><span>0</span></span><span class="nf-l" data-i="2"><span>4</span></span></p>',
    );
  });

  it('draws the three hops with every state, the settled one marked, and their words for the script', () => {
    const hops = [...html.matchAll(/<li class="nf-hop" data-hop="(\d)">([\s\S]*?)<\/li>/g)];
    expect(hops.map((h) => h[1])).toEqual(['1', '2', '3']);
    const labels = hops.map((h) => /<span class="nf-label">([^<]*)<\/span>/.exec(h[2]!)![1]);
    expect(labels).toEqual([copy.nfYou.text, copy.nfSite.text, copy.nfThisPage.text]);
    const settled = hops.map((h) => /data-is="(\w+)" data-word="[^"]*" data-settled/.exec(h[2]!)![1]);
    expect(settled).toEqual(['ok', 'ok', 'missing']);
    for (const h of hops) {
      expect(h[2]).toContain(`data-word="${copy.nfChecking.text}"`);
      expect(h[2]).toContain(`data-word="${copy.nfRestarting.text}"`);
      expect(h[2]).toContain('Checking<span class="nf-dots"><span>.</span><span>.</span><span>.</span></span>');
    }
    // Only the page's hop has a path line, kept even while it's empty.
    expect(hops.map((h) => h[2]!.includes('data-path'))).toEqual([false, false, true]);
    expect(html).toContain(`data-time="${copy.nfTime.text}"`);
    expect(html).toContain(`data-egg-hint="${copy.nfEggHint.text}"`);
    expect(html).toContain(`data-egg-reply="${copy.nfEggReply.text}"`);
    expect(html).toContain('<p class="nf-egg-line" aria-live="polite" data-egg-line></p>');
    expect(html).toContain(`<div hidden data-meta-path><dt>${copy.nfPath.text}</dt><dd data-path-value></dd></div>`);
  });

  it('makes the second hop the door back to the site, named for a screen reader', () => {
    const door = /<li class="nf-hop" data-hop="2">([\s\S]*?)<\/li>/.exec(html)![1]!;
    expect(door).toMatch(/^<a class="nf-node" href="https:\/\/candygoogy\.dev\/">/);
    expect(door).toContain(`<span class="nf-sr">${copy.nfOpensSite.text}</span>`);
    expect(door.endsWith('</a>')).toBe(true);
    expect(copy.nfOpensSite.approved).toBe(true); // the map's own words, approved by the owner (2026-10-23)
  });

  // The owner's footer for the 404 (2026-10-22 evening): the three notes, then the three links,
  // in the markup's order; no "Back to top".
  const footOf = (page: string) => /<footer class="nf-foot"><div class="nf-foot-inner">([\s\S]*?)<\/div><\/footer>/.exec(page)![1]!;

  it('ends with the site’s footer: the ©, the claim and the build stamp, then Colophon, Uses and Source', () => {
    const foot = footOf(html);
    const notes = /^<p class="nf-notes">([\s\S]*?)<\/p>/.exec(foot)![1]!;
    expect([...notes.matchAll(/<span( class="nf-stamp")?>([\s\S]*?)<\/span>/g)].map((m) => m[2])).toEqual([
      '© 2026 candygoogy',
      '<a href="https://candygoogy.dev/colophon#privacy">No trackers, no cookies</a>',
      `Built <time datetime="2026-10-22">Oct 22, 2026</time> from <a href="https://github.com/candygoogy/map.candygoogy.dev/commit/${SHA}" aria-label="commit 0123456">0123456</a>`,
    ]);
    expect(notes).toContain('<span class="nf-stamp">Built ');
    // After the notes, the links: nothing but them, no "·" separators.
    const links = foot.slice(foot.indexOf('</p>') + 4);
    expect(links).toBe(
      '<a href="https://candygoogy.dev/colophon">Colophon</a>' +
        '<a href="https://candygoogy.dev/uses">Uses</a>' +
        '<a href="https://github.com/candygoogy/map.candygoogy.dev">Source</a>',
    );
    expect(MAP_SOURCE).toBe('https://github.com/candygoogy/map.candygoogy.dev');
    expect(foot).not.toContain('·');
    expect(foot).not.toContain('#top');
    expect(foot).not.toContain('Back to top');
  });

  it('marks a build from a tree with uncommitted changes, as the site does', () => {
    const foot = footOf(renderNotFound(feed, copy, [], { ...built, dirty: true }, 2026));
    expect(foot).toContain(
      `from <a href="https://github.com/candygoogy/map.candygoogy.dev/commit/${SHA}" aria-label="commit 0123456-dirty, with uncommitted changes">0123456-dirty</a>`,
    );
  });

  it('says just "Built <date>" when no commit could be read', () => {
    const foot = footOf(renderNotFound(feed, copy, [], { ...built, commit: undefined }, 2026));
    expect(foot).toContain('<span class="nf-stamp">Built <time datetime="2026-10-22">Oct 22, 2026</time></span>');
    expect(foot).not.toContain('/commit/');
    expect(foot).not.toContain(' from ');
  });

  it('uses the site’s words, approved as they are there', () => {
    expect(copy.nfFootPrivacy.text).toBe('No trackers, no cookies');
    expect(copy.nfEggHint.text).toBe('Have you tried turning it off and on again?');
    expect(copy.nfEggReply.text).toBe('Tried it. Still a 404.');
    expect(copy.nfFootBuiltFrom.text).toBe('Built {date} from {commit}');
    expect(copy.nfFootCommitDirty.text).toBe('commit {commit}, with uncommitted changes');
    for (const key of [
      'nfDescription', 'nfSkip', 'nfChecking', 'nfRestarting', 'nfTime', 'nfPath', 'nfEggHint', 'nfEggReply',
      'nfFootOwner', 'nfFootPrivacy', 'nfFootColophon', 'nfFootUses', 'nfFootBuilt', 'nfFootBuiltFrom',
      'nfFootCommit', 'nfFootCommitDirty', 'nfFootSource',
    ] as const) {
      expect(copy[key].approved, key).toBe(true);
    }
  });
});

// The stamp's sources (src/fallback/build.ts), as the site's src/lib/build.ts reads them: Workers
// Builds' commit, then git's, with git's dirty check; none, and the date alone, never a throw.
describe('buildStamp', () => {
  const now = new Date('2026-10-22T23:30:00Z');
  const git =
    (head: string | Error, status = '') =>
    (args: string) => {
      if (head instanceof Error) throw head;
      return args === 'rev-parse HEAD' ? `${head}\n` : status;
    };

  it('dates the build in UTC, as the site does', () => {
    const s = buildStamp({ env: undefined, git: git(SHA), now });
    expect([s.iso, s.label]).toEqual(['2026-10-22', 'Oct 22, 2026']);
  });

  it('takes Workers Builds’ commit first, never dirty', () => {
    const s = buildStamp({ env: SHA.toUpperCase(), git: git('f'.repeat(40), ' M src/x.ts'), now });
    expect([s.commit, s.dirty]).toEqual([SHA, false]);
  });

  it('reads git’s, marked dirty when the tree has uncommitted changes', () => {
    expect(buildStamp({ env: '', git: git(SHA), now })).toMatchObject({ commit: SHA, dirty: false });
    expect(buildStamp({ env: 'nope', git: git(SHA, ' M src/x.ts\n'), now })).toMatchObject({ commit: SHA, dirty: true });
  });

  it('has no commit, and doesn’t throw, without either', () => {
    for (const g of [git(new Error('git: not found')), git('fatal: not a git repository')]) {
      expect(buildStamp({ env: undefined, git: g, now })).toEqual({ iso: '2026-10-22', label: 'Oct 22, 2026', commit: undefined, dirty: false });
    }
  });
});
