import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/main'; // window.__map's type

// A tab left open across a deploy (the pre-launch audit, item 9): its lazy chunks are named for
// the build it loaded, which the new deploy doesn't have, so their imports 404. A failed import
// reloads the page once, its hash kept, and a reload that brings the same build back doesn't
// reload again (src/moments/load.ts, src/reload.ts). Offline, nothing reloads.

/** Under ?test at `hash`, the arrival skipped, so the moments' gate opens. */
async function open(page: Page, hash: string): Promise<void> {
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    await window.__map!.director.ready;
    window.__map!.director.skipArrival();
    window.__map!.advance(1 / 60);
  });
  await expect(page).toHaveURL(new RegExp(`${hash}$`));
}

/** The sound engine's chunk (a lazy moment, asked for once sound is on) answers 404. */
async function goneSound(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/\/src\/moments\/sound\.ts/, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 404, contentType: 'text/html', body: 'gone' });
  });
  return asked;
}

test('a lazy chunk that 404s reloads the page once, at the same station, and not again', async ({ page }) => {
  const asked = await goneSound(page);
  let loads = 0;
  page.on('load', () => void (loads += 1));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test#fettle');
  await open(page, '#fettle');
  expect(loads).toBe(1);

  // Sound on: its engine's import fails, and the page reloads with its hash.
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect.poll(() => loads).toBe(2);
  await expect(page).toHaveURL(/\?test#fettle$/);
  await expect(page.locator('html')).toHaveClass(/\bhas-3d\b/);

  // The same build again (the chunk is still gone): sound is still on, and the first gesture
  // (a key) makes its AudioContext, so its import fails again, and the page stays as it is.
  await open(page, '#fettle');
  await page.keyboard.press('Shift');
  await expect.poll(() => asked.length).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1000);
  expect(loads).toBe(2);
  await expect(page.locator('html')).toHaveClass(/\bhas-3d\b/);
});

test('offline, a lazy chunk that fails doesn’t reload', async ({ page }) => {
  const asked = await goneSound(page);
  let loads = 0;
  page.on('load', () => void (loads += 1));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test#fettle');
  await open(page, '#fettle');
  // The browser says it's offline (the chunk's 404 stands in for the failed fetch).
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }));
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect.poll(() => asked.length).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1000);
  expect(loads).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('map:reloaded'))).toBeNull();
});
