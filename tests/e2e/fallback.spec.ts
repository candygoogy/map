import { expect, test } from '@playwright/test';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import { copy } from '../../src/copy';
import world from '../../src/data/world.json' with { type: 'json' };
import { withCluster } from '../../src/data/cluster';
import { parseFeed } from '../../src/data/feed';

const feed = parseFeed(fixture);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test("with JavaScript disabled every station's heading and links are present", async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bno-3d\b/);
    // The page says plainly that this is the plain version.
    await expect(page.locator('header').getByText(copy.plainNote.text, { exact: true })).toBeVisible();
    for (const node of feed.nodes) {
      const station = page.locator(`section.station[data-node="${node.id}"]`);
      await expect(station.getByRole('heading', { level: 2, name: node.name, exact: true })).toBeVisible();
      const hrefs = [
        ...node.links.map((l) => l.href),
        ...(node.children ?? []).map((c) => c.href),
        ...(node.page ? [node.page] : []),
      ];
      for (const href of hrefs) {
        await expect(station.locator(`a[href="${href}"]`).first()).toBeVisible();
      }
    }
    // The homelab cluster's devices have sections for the 3D map, kept off the plain page, which
    // lists them once in homelab's own device list.
    const devices = withCluster(feed, world).nodes.filter((n) => n.kind === 'device');
    expect(devices.length).toBeGreaterThan(0);
    await expect(page.locator('section.station')).toHaveCount(feed.nodes.length + devices.length);
    for (const d of devices) await expect(page.locator(`section.station[data-node="${d.id}"]`)).toBeHidden();
    // The welcome is about models to click, so the plain page opens with the origin's intro.
    await expect(page.locator('#welcome')).toBeHidden();
    await expect(page.locator('.peek-hint')).toBeHidden();
    await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText(feed.nodes.find((n) => n.id === 'origin')!.name);
  });
});

test('with WebGL2 available, html has class has-3d at DOMContentLoaded', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { __classAtDcl: string }).__classAtDcl = document.documentElement.className;
    });
  });
  await page.goto('/');
  const webgl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  expect(webgl2, 'this browser has no WebGL2, so the test cannot check the swap').toBe(true);
  const cls = await page.evaluate(() => (window as unknown as { __classAtDcl?: string }).__classAtDcl);
  expect(cls).toMatch(/\bhas-3d\b/);
  // With 3D running, the plain-version note would be false.
  await expect(page.getByText(copy.plainNote.text, { exact: true })).toBeHidden();
  expect(cls).not.toMatch(/\bno-3d\b/);
});

test("the tab icon is the main site's avatar favicon, and it's served", async ({ page, request }) => {
  await page.goto('/');
  for (const rel of ['icon', 'apple-touch-icon']) {
    const href = await page.locator(`link[rel="${rel}"]`).getAttribute('href');
    expect(href, `${rel} link`).toBeTruthy();
    const res = await request.get(href!);
    expect(res.status(), `${rel} at ${href}`).toBe(200);
  }
});

test('the tab title reads as the main site’s, "<Page> – candygoogy"', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(copy.pageTitle.text);
  expect(copy.pageTitle.text).toBe('Map – candygoogy');
});
