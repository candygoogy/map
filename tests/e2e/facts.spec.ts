import { expect, test, type Page } from '@playwright/test';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import { parseFeed } from '../../src/data/feed';
import type {} from '../../src/main'; // window.__map's type

// Receipt-style leader lists: every value ends on one shared right edge, and
// each dotted leader runs right up to its value (owner, 2026-10-18).

/** Every leader list `scope` matches, row by row, measured where it's drawn. */
const measure = (page: Page, scope: string) =>
  page.locator(scope).evaluateAll((dls) =>
    dls.map((dl) =>
      [...dl.querySelectorAll(':scope > div')].map((row) => {
        const dt = row.querySelector('dt')!;
        const dd = row.querySelector('dd')!;
        // The leader is dt::after: it ends where dt's content box ends, less its end margin.
        const margin = parseFloat(getComputedStyle(dt, '::after').marginInlineEnd);
        const leaderEnd = dt.getBoundingClientRect().right - margin;
        // The value's first line: a range over its first text node.
        const range = document.createRange();
        range.selectNodeContents(dd.firstChild!);
        const firstLine = range.getClientRects()[0]!;
        // The column the list sits in: the values end on its right edge, as on the site.
        const column = dl.parentElement!.getBoundingClientRect().right;
        return { label: dt.textContent, leaderEnd, valueStart: firstLine.left, valueEnd: dd.getBoundingClientRect().right, column };
      }),
    ),
  );

function expectFlush(lists: Awaited<ReturnType<typeof measure>>): void {
  expect(lists.length).toBeGreaterThan(0);
  for (const rows of lists) {
    const edge = Math.max(...rows.map((r) => r.valueEnd));
    expect(Math.abs(edge - rows[0]!.column), 'values stop short of the column edge').toBeLessThanOrEqual(1);
    for (const r of rows) {
      expect(Math.abs(r.valueEnd - edge), `${r.label}: value ends off the shared edge`).toBeLessThanOrEqual(1);
      expect(r.valueStart - r.leaderEnd, `${r.label}: leader stops short of its value`).toBeLessThanOrEqual(16);
      expect(r.valueStart - r.leaderEnd, `${r.label}: leader runs into its value`).toBeGreaterThanOrEqual(0);
    }
  }
}

test.describe('the plain page', () => {
  test.use({ javaScriptEnabled: false });

  for (const [width, height] of [[1440, 900], [1000, 800]] as const) {
    test(`at ${width}x${height} leader values share a right edge and leaders reach them`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      // The stations' lists (the welcome's are the 3D map's alone: display:none here).
      expectFlush(await measure(page, 'section.station dl.leaders'));
    });
  }
});

// The same lists in the map's panel, a narrower column where long values wrap.
test.describe('the panel', () => {
  const feed = parseFeed(fixture);
  const withLeaders = feed.nodes.filter((n) => n.status || n.devices?.length).map((n) => n.id);

  for (const [width, height] of [[1440, 900], [1000, 800]] as const) {
    test(`at ${width}x${height} every station's leader values share a right edge and leaders reach them`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      for (const id of withLeaders) {
        await page.goto(`/?test&at=${id}#${id}`); // a fresh load each, not a hash change
        await page.waitForFunction(() => window.__map?.panel !== undefined);
        // Measured once the web fonts are in and the panel has re-fitted its leaders.
        await expect(async () => {
          expectFlush(await measure(page, `#stations section.station#${id}:not(.sr-only) dl.leaders`));
        }).toPass({ timeout: 3000 });
      }
    });
  }
});

// The overview welcome's lists (Getting around and the secrets' counter): the set for the pointer
// shown, the other display:none. Each list's values end on the column's edge, so the two share it.
test.describe('the welcome', () => {
  /** Under ?test, the arrival skipped: the overview's column shows the welcome. */
  async function overview(page: Page): Promise<void> {
    await page.goto('/?test');
    await page.waitForFunction(() => window.__map?.director !== undefined);
    await page.evaluate(async () => {
      await window.__map!.director.ready;
      window.__map!.director.skipArrival();
      window.__map!.advance(1 / 60);
    });
  }

  for (const [width, height] of [[1440, 900], [1000, 800]] as const) {
    test(`at ${width}x${height} with a mouse its leader values share a right edge and leaders reach them`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await overview(page);
      const lists = '#stations section#welcome:not(.sr-only) dl.leaders:not(.for-touch)';
      await expect(page.locator(lists)).toHaveCount(2);
      await expect(async () => expectFlush(await measure(page, lists))).toPass({ timeout: 3000 });
    });
  }

  test.describe('on a touch tablet', () => {
    test.use({ viewport: { width: 1024, height: 1366 }, hasTouch: true });

    test('the touch set shows, its values on one right edge and leaders reaching them', async ({ page }) => {
      await overview(page);
      await expect(page.locator('#welcome dl.for-mouse')).toBeHidden();
      await expect(page.locator('#welcome dl.for-touch')).toBeVisible();
      const lists = '#stations section#welcome:not(.sr-only) dl.leaders:not(.for-mouse)';
      await expect(page.locator(lists)).toHaveCount(2);
      await expect(async () => expectFlush(await measure(page, lists))).toPass({ timeout: 3000 });
    });
  });
});
