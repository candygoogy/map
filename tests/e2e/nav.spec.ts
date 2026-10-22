import { expect, test, type Page } from '@playwright/test';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import { copy } from '../../src/copy';
import world from '../../src/data/world.json' with { type: 'json' };
import { withCluster } from '../../src/data/cluster';
import { parseFeed } from '../../src/data/feed';
import { orderIds } from '../../src/nav/stations';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// Phase 1 travel: arriving is the station state, the URL hash, the sheet and the counter
// agreeing. The camera (Task 9) opens the sheet as it settles, so that check waits for it.

const feed = withCluster(parseFeed(fixture), world); // the homelab cluster's devices are stations too
const order = orderIds(feed.nodes.map((n) => n.id));
const counter = (id: string) =>
  copy.stationCounter.text.replace('{n}', String(order.indexOf(id) + 1)).replace('{total}', String(order.length));

/** Opens the map under ?test, at `hash` if given, once the stations are bound. */
async function open(page: Page, hash = ''): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?test${hash}`);
  await page.waitForFunction(() => window.__map?.stations !== undefined);
}

const current = (page: Page) => page.evaluate(() => window.__map!.stations.current);

test('→ twice from overview lands on fettle with hash #fettle', async ({ page }) => {
  await open(page);
  expect(await current(page)).toBeNull();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  await expect(page).toHaveURL(/\?test#fettle$/);
  expect(await current(page)).toBe('fettle');
  await expect(page.locator('.travel .count')).toHaveText(counter('fettle'));
});

test('browser Back returns to #origin', async ({ page }) => {
  await open(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/#fettle$/);

  await page.goBack();

  await expect(page).toHaveURL(/\?test#origin$/);
  await expect.poll(() => current(page)).toBe('origin');
  await expect(page.locator('.travel .count')).toHaveText(counter('origin'));
});

test('loading /#notary opens notary directly', async ({ page }) => {
  await open(page, '#notary');

  expect(await current(page)).toBe('notary');
  await expect(page).toHaveURL(/\?test#notary$/);
  await expect(page.locator('.travel .count')).toHaveText(counter('notary'));
  // The arrival, then the flight there; the sheet is open once the camera has settled.
  await page.evaluate(async (s) => {
    await window.__map!.director.ready;
    window.__map!.director.skipArrival();
    window.__map!.advance(s);
  }, tuning.flight.max + 0.1);
  expect(await page.evaluate(() => window.__map!.stage.sheet)).toBe('open');
});
