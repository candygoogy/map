import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// The render gallery and the probe's renders it shows (dev/shots.*, shots/_probe/) aren't in the
// public repo, so there this skips.
const ROOT = join(import.meta.dirname, '../..');
const GALLERY = existsSync(join(ROOT, 'dev', 'shots.html')) && existsSync(join(ROOT, 'shots', '_probe'));

// The prerender plugin fills only the map's own page; dev/ pages have no markers.
test.skip(!GALLERY, 'needs dev/shots.html and shots/_probe/');
test('the dev render gallery is served alongside the prerendered map', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const res = await page.goto('/dev/shots.html#_probe');
  expect(res?.status()).toBe(200);
  await expect(page.locator('img').first()).toBeVisible();
  expect(errors).toEqual([]);

  const map = await page.goto('/');
  expect(map?.status()).toBe(200);
  await expect(page.locator('#feed-snapshot')).toHaveCount(1);
});
