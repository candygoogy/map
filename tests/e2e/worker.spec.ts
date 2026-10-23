import { expect, test, type Page } from '@playwright/test';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import { copy } from '../../src/copy';
import world from '../../src/data/world.json' with { type: 'json' };
import { withCluster } from '../../src/data/cluster';
import { parseFeed } from '../../src/data/feed';
import { orderIds } from '../../src/nav/stations';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// Task 19: the built site as the Cloudflare Worker serves it (wrangler.jsonc, public/_headers).
// Runs in the `worker` project (playwright.config.ts) against `npx wrangler dev --port 8788`
// after `npm run build`, or a deployed URL in WORKER_URL / BASE_URL. Locally, with neither
// set and nothing on 8788, the file skips with the command to run; in CI it fails instead.

const feed = withCluster(parseFeed(fixture), world); // the homelab cluster's devices are stations too
const order = orderIds(feed.nodes.map((n) => n.id));
const counter = (id: string) =>
  copy.stationCounter.text.replace('{n}', String(order.indexOf(id) + 1)).replace('{total}', String(order.length));

/** The policy public/_headers sends, one directive per entry. */
const POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

const directives = (header: string | undefined) =>
  (header ?? '')
    .split(';')
    .map((d) => d.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

test.beforeAll(async ({ request, baseURL }) => {
  const explicit = Boolean(process.env.CI || process.env.WORKER_URL || process.env.BASE_URL);
  const up = await request.get('/', { timeout: 5_000 }).then(
    (r) => r.ok(),
    () => false,
  );
  test.skip(!up && !explicit, `nothing serves ${baseURL}: run \`npm run build\`, then \`npx wrangler dev --port 8788\``);
});

test('/ returns 200 with X-Robots-Tag: noindex and the CSP header', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers['content-type']).toMatch(/^text\/html/);
  expect(headers['x-robots-tag']).toMatch(/\bnoindex\b/);
  expect(directives(headers['content-security-policy'])).toEqual(POLICY);
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  // The page itself revalidates every time, so a rebuild (new feed, new hashed bundles) shows at once.
  expect(headers['cache-control']).toBe('public, max-age=0, must-revalidate');
});

test('/ carries the link preview, as candygoogy.dev’s inner pages, and its card is served', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const meta = (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
  expect(meta('og:title')).toBe('Map – candygoogy');
  expect(meta('og:description')).toBe(meta('description'));
  expect(meta('og:url')).toBe('https://map.candygoogy.dev/');
  expect(meta('og:image')).toBe('https://map.candygoogy.dev/og.png');
  expect(meta('twitter:card')).toBe('summary_large_image');
  const card = await request.get('/og.png');
  expect(card.status()).toBe(200);
  expect(card.headers()['content-type']).toBe('image/png');
});

test('/models/fettle.glb is served with a long cache', async ({ request }) => {
  const res = await request.get('/models/fettle.glb');
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers['content-type']).toBe('model/gltf-binary');
  expect(headers['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(headers['x-robots-tag']).toMatch(/\bnoindex\b/);
  // The bundles Vite names by content hash get the same.
  const html = await (await request.get('/')).text();
  const script = /<script type="module" crossorigin src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(script).toBeDefined();
  expect((await request.get(script!)).headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('a 404 is never kept for a year, under /assets/ and /models/ too', async ({ request }) => {
  // The year's cache is one _headers rule per shipped file (vite.config.ts, immutableHeaders),
  // since a rule by pattern would apply to a 404 there as well: a deploy's old chunk, a model
  // that isn't there yet, the folders themselves.
  for (const path of ['/no-such-page', '/assets/map-OLDHASH.js', '/assets/', '/models/no-such-model.glb', '/models/no-such-model.glb?v=0123456789', '/models/']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
    expect(res.headers()['cache-control'], path).toBe('public, max-age=0, must-revalidate');
  }
  // Every file the page itself asks for under /assets/ (its scripts, stylesheet, fonts, icons)
  // and a model by its versioned URL keep the year.
  const html = await (await request.get('/')).text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]!))];
  expect(assets.length).toBeGreaterThan(3);
  for (const path of [...assets, '/models/fettle.glb?v=0123456789']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['cache-control'], path).toBe('public, max-age=31536000, immutable');
  }
});

test('/#fettle opens fettle', async ({ page }) => {
  // The real clock, as a visitor gets it: the arrival plays, then the camera flies there.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#fettle');
  await expect(page.locator('html')).toHaveClass(/\bhas-3d\b/);
  await expect(page.locator('.travel .count')).toHaveText(counter('fettle'), { timeout: 15_000 });
  await expect(page).toHaveURL(/#fettle$/);
});

test('an unknown path returns the 404 page with noindex', async ({ request }) => {
  const res = await request.get('/no-such-page', { headers: { Accept: 'text/html' } });
  expect(res.status()).toBe(404);
  const headers = res.headers();
  expect(headers['x-robots-tag']).toMatch(/\bnoindex\b/);
  expect(directives(headers['content-security-policy'])).toEqual(POLICY);
  expect(await res.text()).toContain(`<span>${copy.nfHeading.text}</span></span></h1>`);
  // A missing model 404s too (nodes.ts falls back to the box), with the 404 page as its body:
  // never the map's own HTML.
  const model = await request.get('/models/no-such-model.glb');
  expect(model.status()).toBe(404);
  const body = await model.text();
  expect(body).toContain(`<span>${copy.nfHeading.text}</span></span></h1>`);
  expect(body).not.toContain('id="stations"');
  // Notes kept beside the code don't ship: the sounds' sources live in sounds/, out of public/,
  // and the pipeline's probe model is dropped from dist/ (vite.config.ts).
  for (const path of ['/sounds/SOURCES.md', '/models/_probe.glb', '/_headers']) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
});

test('the 404 page: its heading, the way back, the route check run through, and no CSP violations', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // The browser reports the page's own 404 as a console error; anything else counts.
  const own = /^Failed to load resource: the server responded with a status of 404/;
  page.on('console', (m) => void (m.type() === 'error' && !own.test(m.text()) && problems.push(`console: ${m.text()}`)));
  // Only the page itself 404s: its scripts, stylesheets, fonts and icon all load.
  page.on('response', (r) => void (r.status() >= 400 && !r.url().endsWith('/nope/deeper') && problems.push(`${r.status()} ${r.url()}`)));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP: ${e.effectiveDirective} refused ${e.blockedURI || '(inline)'}`);
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const res = await page.goto('/nope/deeper');
  expect(res?.status()).toBe(404);
  await expect(page).toHaveTitle(copy.nfPageTitle.text);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.nfHeading.text);
  await expect(page.getByRole('link', { name: copy.nfBack.text })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: copy.backToSite.text })).toHaveAttribute('href', /^https:\/\/candygoogy\.dev\//);
  // Styled by its own sheet (the trace's frame), in the map's plain page, html.js on.
  await expect(page.locator('.nf-trace')).toHaveCSS('border-top-style', 'solid');
  await expect(page.locator('html')).toHaveClass(/\bno-3d\b/);
  await expect(page.locator('html')).toHaveClass(/\bjs\b/);
  // Two scripts, both external: the pre-paint one (the saved theme, html.js) and the 404's module.
  await expect(page.locator('script')).toHaveCount(2);
  await expect(page.locator('script').first()).toHaveAttribute('src', /^\/assets\/notfound-head-[\w-]+\.js$/);
  await expect(page.locator('script[type="module"]')).toHaveAttribute('src', /^\/assets\/notfound-[\w-]+\.js$/);
  // The header's theme switch, as on the site's 404 and the experiments'.
  await expect(page.getByRole('group', { name: copy.themeGroup.text })).toBeVisible();
  // The route check runs through: You and the site work, the page isn't found; the request's
  // time and the path fill in.
  await expect(page.locator('.nf-trace')).toHaveAttribute('data-done', '', { timeout: 8_000 });
  const states = () => page.locator('.nf-status').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['state']));
  expect(await states()).toEqual(['ok', 'ok', 'missing']);
  await expect(page.locator('[data-time-value]')).toHaveText(/^\d\d:\d\d:\d\d UTC$/);
  await expect(page.locator('[data-path-value]')).toHaveText('/nope/deeper');
  // The site's hop is the door back to it; the page's hop is the egg.
  const door = page.locator('.nf-hop[data-hop="2"] a.nf-node');
  await expect(door).toHaveAttribute('href', 'https://candygoogy.dev/');
  // Its name runs on from its parts as the site's does ("candygoogy.dev , Working . Opens the map").
  const words = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  await expect(door).toHaveAccessibleName(
    new RegExp(`^${words(copy.nfSite.text)}\\s*,\\s*${words(copy.working.text)}\\s*${words(copy.nfOpensSite.text)}$`),
  );
  const egg = page.locator('.nf-hop[data-hop="3"] button.nf-node');
  await expect(egg).toHaveAccessibleDescription(copy.nfEggHint.text);
  await egg.click();
  await expect(page.locator('[data-egg-line]')).toHaveText(copy.nfEggReply.text);
  expect(await states()).toEqual(['ok', 'ok', 'missing']);
  // The site's footer: the ©, the claim and the build stamp, then Colophon, Uses and Source.
  const foot = page.getByRole('contentinfo');
  await expect(foot.getByRole('link')).toHaveText([
    copy.nfFootPrivacy.text,
    /^[0-9a-f]{7}(-dirty)?$/,
    copy.nfFootColophon.text,
    copy.nfFootUses.text,
    copy.nfFootSource.text,
  ]);
  await expect(foot.getByRole('link', { name: copy.nfFootPrivacy.text })).toHaveAttribute(
    'href',
    'https://candygoogy.dev/colophon#privacy',
  );
  await expect(foot.getByRole('link', { name: /^commit [0-9a-f]{7}/ })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/candygoogy\/map\.candygoogy\.dev\/commit\/[0-9a-f]{40}$/,
  );
  await expect(foot.getByRole('link', { name: copy.nfFootSource.text })).toHaveAttribute('href', 'https://github.com/candygoogy/map.candygoogy.dev');
  await expect(foot.locator('.nf-stamp')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(problems).toEqual([]);
});

test('the 404 footer on a phone: the stamp left out, the © and the claim on one line, the links under them, on the left', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/nope');
  await page.evaluate(() => document.fonts.ready);
  const foot = page.getByRole('contentinfo');
  await expect(foot.locator('.nf-stamp')).toBeHidden();
  // Where each part's words start and sit (a link's box bleeds 0.2em past its words: styles.css).
  const box = (sel: string) =>
    foot.locator(sel).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + parseFloat(getComputedStyle(e).paddingLeft), y: r.y, bottom: r.bottom };
    });
  const owner = await box('.nf-notes > span:nth-child(1)');
  const claim = await box('.nf-notes > span:nth-child(2)');
  const colophon = await box(`a:text-is("${copy.nfFootColophon.text}")`);
  const source = await box(`a:text-is("${copy.nfFootSource.text}")`);
  expect(Math.abs(owner.y - claim.y)).toBeLessThan(1); // one line
  expect(colophon.y).toBeGreaterThan(owner.bottom); // the links' row under it
  expect(Math.abs(colophon.y - source.y)).toBeLessThan(1);
  expect(Math.abs(colophon.x - owner.x)).toBeLessThan(1); // the same left edge
});

test('the 404 under reduced motion: the finished state at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/nope');
  await expect(page.locator('.nf-trace')).toHaveAttribute('data-done', '');
  const states = await page.locator('.nf-status').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['state']));
  expect(states).toEqual(['ok', 'ok', 'missing']);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(page.locator('html')).not.toHaveClass(/\bmotion-ready\b/);
});

test('the 404 honours the theme chosen on the map, from the first paint, and its switch changes it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as Window & { __bg?: string }).__bg = getComputedStyle(document.documentElement).backgroundColor;
    });
  });
  await page.goto('/nope');
  expect(await page.evaluate(() => (window as Window & { __bg?: string }).__bg)).toBe('rgb(244, 244, 245)');
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.goto('/nope');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => (window as Window & { __bg?: string }).__bg)).toBe('rgb(18, 18, 20)');
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark');
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#121214');
  await expect(page.locator('[data-theme-switch] [data-value="dark"]')).toHaveAttribute('aria-pressed', 'true');
  // Light from the 404's own switch: saved for the map too, and the browser bar follows.
  await page.locator('[data-theme-switch] [data-value="light"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
  await expect(page.locator('meta[name="theme-color"]').last()).toHaveAttribute('content', '#f4f4f5');
});

/** Opens the map under ?test (the manual clock) once the stations are bound. */
async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.stations !== undefined);
}

test('no CSP violations in the console during arrival and three flights', async ({ page }) => {
  // A hosted CI runner has no GPU: in software WebGL the arrival and three flights take minutes.
  if (process.env.CI) test.setTimeout(300_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => void (m.type() === 'error' && problems.push(`console: ${m.text()}`)));
  page.on('response', (r) => void (r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`)));
  const models: string[] = [];
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.endsWith('.glb') && r.ok()) models.push(path);
  });
  // Violations are also events on the document, with the directive that refused them.
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP: ${e.effectiveDirective} refused ${e.blockedURI || '(inline)'}`);
    });
  });

  await open(page);
  // The meshopt-compressed models decode (WebAssembly, 'wasm-unsafe-eval') and their baked
  // textures become blob: images: every model is in, and fettle is its own, not the box.
  await page.evaluate(async () => {
    await window.__map!.director.ready;
    await window.__map!.nodes.ready;
  });
  const fettle = await page.evaluate(() => {
    const node = window.__map!.nodes.get('fettle');
    return { empty: node.bounds.isEmpty(), box: node.root.getObjectByName('box') !== undefined };
  });
  expect(fettle).toEqual({ empty: false, box: false });
  // Over a real network the gondola (visitor.glb) can come in after the nodes are ready.
  await expect.poll(() => models, { timeout: 15_000 }).toEqual(expect.arrayContaining(['/models/world.glb', '/models/fettle.glb', '/models/visitor.glb']));

  // The arrival on the manual clock, then three flights.
  await page.evaluate(() => window.__map!.advance(3.5));
  for (const id of [order[1]!, order[2]!, order[3]!]) {
    await page.evaluate(
      ([to, s]) => {
        window.__map!.stations.go(to);
        window.__map!.advance(s);
      },
      [id, tuning.flight.max + tuning.flightDive + 0.5] as const,
    );
    expect(await page.evaluate(() => window.__map!.stations.current)).toBe(id);
  }
  expect(problems).toEqual([]);
});
