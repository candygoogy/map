import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import world from '../../src/data/world.json' with { type: 'json' };
import { withCluster } from '../../src/data/cluster';
import { parseFeed } from '../../src/data/feed';
import { orderIds } from '../../src/nav/stations';

// Task 18: a browser with no WebGL at all gets the plain page, whole and quiet. The browser's
// own switch, not a stubbed getContext; it's a launch option, so it has this file to itself.

test.use({ launchOptions: { args: ['--disable-webgl', '--disable-3d-apis'] } });

const feed = parseFeed(fixture);
const order = orderIds(feed.nodes.map((n) => n.id));
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

test('the page shows all stations, no loader and no console error', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  page.on('pageerror', (e) => void errors.push(e.message));
  const models: string[] = [];
  page.on('request', (r) => void (r.url().includes('/models/') && models.push(r.url())));

  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await page.waitForLoadState('load');
  expect(await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))).toBe(false);
  await expect(page.locator('html')).toHaveClass(/\bno-3d\b/);
  await expect(page.locator('html')).not.toHaveClass(/\bhas-3d\b/);

  // Every station, in order, with its heading in sight once scrolled to. The homelab cluster's
  // devices have sections for the 3D map (src/data/cluster.ts), kept off the plain page, which
  // lists them once in homelab's own device list.
  const sections = page.locator('section.station');
  await expect(sections).toHaveCount(withCluster(feed, world).nodes.length);
  const shown = page.locator('section.station:not([data-kind="device"])');
  for (const s of await page.locator('section.station[data-kind="device"]').all()) await expect(s).toBeHidden();
  expect(await shown.evaluateAll((s) => s.map((e) => (e as HTMLElement).dataset.node))).toEqual(order);
  for (const id of order) {
    const heading = page.locator(`section.station[data-node="${id}"] h2`);
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible();
  }

  // No loader, no stage, and nothing of the 3D map fetched.
  await expect(page.locator('[role="progressbar"], [aria-busy="true"], [class*="load" i]')).toHaveCount(0);
  await expect(page.locator('#stage')).toBeHidden();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('nav, .travel')).toHaveCount(0);
  await page.waitForTimeout(500); // anything late would still log
  expect(models).toEqual([]);
  expect(errors).toEqual([]);
});

test('axe: zero violations on the plain page in light and dark', async ({ page }) => {
  test.setTimeout(90_000);
  const found: string[] = [];
  for (const size of [DESKTOP, PHONE]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.locator('html')).toHaveClass(/\bno-3d\b/);
      const { violations } = await new AxeBuilder({ page }).analyze();
      found.push(...violations.map((v) => `${size.width} ${colorScheme}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`));
    }
  }
  expect(found).toEqual([]);
});

test('the theme switch works on the plain page, before the way back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  for (const size of [DESKTOP, PHONE]) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bno-3d\b/);
    const group = page.getByRole('group', { name: 'Theme' });
    await expect(group).toBeVisible();
    const pill = (await group.boundingBox())!;
    const back = (await page.locator('header.top .back').boundingBox())!;
    // Desktop: on the way back's line, before it. Phone: a row of its own under it, at its right.
    if (size === DESKTOP) expect(pill.x + pill.width).toBeLessThan(back.x);
    else expect(pill.y).toBeGreaterThan(back.y + back.height - 1);
    await group.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // Polled: reduced motion gives every property a 1 ms transition (styles.css).
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(18, 18, 20)');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(group.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    await group.getByRole('button', { name: /^Auto/ }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  }
});

// Task 17: the plain page makes no sound, so it has no sound toggle (the theme switch stays).
test('the plain page has no sound toggle', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bno-3d\b/);
  await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toBeHidden();
});

test('at 390×844 the plain page never scrolls sideways (the experiments’ tool list included)', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await page.waitForLoadState('load');
  await expect(page.locator('#experiments .tools')).toHaveCount(1);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
});
