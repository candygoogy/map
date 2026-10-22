import { expect, test, type Page } from '@playwright/test';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import { copy } from '../../src/copy';
import world from '../../src/data/world.json' with { type: 'json' };
import { withCluster } from '../../src/data/cluster';
import { parseFeed } from '../../src/data/feed';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

const feed = parseFeed(fixture);

declare global {
  interface Window {
    __cls?: number;
    __sameDocument?: boolean;
  }
}

/** The renderer's clear colour as #rrggbb, read back through Three.js (sRGB, like the token). */
const clearColour = (page: Page) =>
  page.evaluate(() => {
    const { renderer, theme } = window.__map!.stage;
    return `#${renderer.getClearColor(theme.bg.clone()).getHexString()}`;
  });

/** Renders one frame on the manual clock and reads the canvas's centre pixel in the same task. */
const centrePixel = (page: Page) =>
  page.evaluate(() => {
    const map = window.__map!;
    map.advance(1 / 60);
    const gl = map.stage.renderer.getContext();
    const px = new Uint8Array(4);
    gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return `#${[...px.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  });

/** The inset the camera is framed for, and the view offset that applies it (rounded to 0.1 px). */
const view = (page: Page) =>
  page.evaluate(() => {
    const { inset, camera } = window.__map!.stage;
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      right: r(inset.right),
      bottom: r(inset.bottom),
      offsetX: r(camera.view?.offsetX ?? NaN),
      offsetY: r(camera.view?.offsetY ?? NaN),
      aspect: r(camera.aspect),
    };
  });

const r1 = (v: number) => Math.round(v * 10) / 10;

test('canvas fills the viewport and html has class has-3d', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhas-3d\b/);
  // has-3d is set before the runtime (src/map.ts) is fetched, after the first paint (Task 18):
  // wait for it to have built the stage rather than for a fixed few seconds.
  await page.waitForFunction(() => window.__map !== undefined);
  const canvas = page.locator('#stage canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  const buffer = await canvas.evaluate((c: HTMLCanvasElement) => ({
    width: c.width,
    height: c.height,
    dpr: Math.min(devicePixelRatio, 2),
  }));
  expect(buffer.width).toBe(Math.floor(1440 * buffer.dpr));
  expect(buffer.height).toBe(Math.floor(900 * buffer.dpr));

  // The canvas is decorative; the stations stay in the accessibility tree without covering it,
  // and the header sits above it.
  await expect(page.locator('#stage')).toHaveAttribute('aria-hidden', 'true');
  // Every station, the homelab cluster's devices included (src/data/cluster.ts).
  await expect(page.locator('section.station').getByRole('heading', { level: 2 })).toHaveCount(withCluster(feed, world).nodes.length);
  // Under the point, past any node label (labels sit over the canvas by design, and on the real
  // clock one can drift across it), is the canvas, not a station section.
  const hit = await page.evaluate(
    () => document.elementsFromPoint(720, 600).find((e) => !e.closest('button.label'))?.tagName,
  );
  expect(hit).toBe('CANVAS');
  const backLink = page.locator('header.top a').last();
  await expect(backLink).toBeVisible();
  const box = (await backLink.boundingBox())!;
  const top = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest('header')?.className,
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(top).toBe('top');
});

test('emulating dark scheme changes the clear colour to #121214 without reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.stage !== undefined); // the runtime loads after the paint
  await expect.poll(() => clearColour(page)).toBe('#f4f4f5');
  expect(await centrePixel(page)).toBe('#f4f4f5');

  await page.evaluate(() => void (window.__sameDocument = true));
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => clearColour(page)).toBe('#121214');
  expect(await centrePixel(page)).toBe('#121214');
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

test('WEBGL_lose_context.loseContext() reverts html to no-3d and stations stay readable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test');
  await expect(page.locator('html')).toHaveClass(/\bhas-3d\b/);
  await expect(page.locator('#stage canvas')).toHaveCount(1);

  await page.evaluate(() => {
    window.__map!.stage.renderer.getContext().getExtension('WEBGL_lose_context')!.loseContext();
  });

  await expect(page.locator('html')).toHaveClass(/\bno-3d\b/);
  await expect(page.locator('html')).not.toHaveClass(/\bhas-3d\b/);
  await expect(page.locator('#stage canvas')).toHaveCount(0);
  await expect(page.getByText(copy.plainNote.text, { exact: true })).toBeVisible();
  for (const node of feed.nodes) {
    const station = page.locator(`section.station[data-node="${node.id}"]`);
    await expect(station.getByRole('heading', { level: 2, name: node.name, exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('a lost context keeps the visitor at their station, and a restored one brings the map back there', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let loads = 0;
  page.on('load', () => void (loads += 1));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test#notary');
  await page.waitForFunction(() => window.__map?.director !== undefined);
  const land = () =>
    page.evaluate(async (s) => {
      const { director, advance } = window.__map!;
      await director.ready;
      director.skipArrival();
      advance(s);
      return window.__map!.stations.current;
    }, tuning.flight.max + tuning.flightDive + 0.5);
  expect(await land()).toBe('notary');

  // The context goes (the extension kept, to bring it back): the plain page, at Notary's section.
  await page.evaluate(() => {
    const lose = window.__map!.stage.renderer.getContext().getExtension('WEBGL_lose_context')!;
    (window as Window & { __lose?: WEBGL_lose_context }).__lose = lose;
    lose.loseContext();
  });
  await expect(page.locator('html')).toHaveClass(/\bno-3d\b/);
  await expect(page).toHaveURL(/#notary$/);
  await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('notary')!.getBoundingClientRect().top))).toBeLessThan(100);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);

  // The browser restores it: the page reloads into the 3D map, at Notary again.
  await page.evaluate(() => (window as Window & { __lose?: WEBGL_lose_context }).__lose!.restoreContext());
  await expect.poll(() => loads).toBe(2);
  await expect(page).toHaveURL(/\?test#notary$/);
  expect(await page.evaluate(() => sessionStorage.getItem('map:restored'))).not.toBeNull(); // the map's own reload
  await expect(page.locator('html')).toHaveClass(/\bhas-3d\b/);
  await page.waitForFunction(() => window.__map?.director !== undefined);
  expect(await land()).toBe('notary');
  expect(errors).toEqual([]);
});

test('resizing from 1440×900 to 390×844 moves the panel inset to the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.stage !== undefined); // the runtime loads after the paint
  // The panel's 460 px on the right: the camera centres on the 980 px left of it.
  await expect
    .poll(() => view(page))
    .toEqual({ right: tuning.panelWidthPx, bottom: 0, offsetX: tuning.panelWidthPx / 2, offsetY: 0, aspect: r1(1440 / 900) });

  await page.setViewportSize({ width: 390, height: 844 });
  // A phone: no right panel, the sheet at its peek in the overview.
  const peek = 844 * tuning.sheetPeek;
  await expect
    .poll(() => view(page))
    .toEqual({ right: 0, bottom: r1(peek), offsetX: 0, offsetY: r1(peek / 2), aspect: r1(390 / 844) });

  await test.step('opening the sheet animates the inset to 45% on the clock', async () => {
    await page.evaluate(() => window.__map!.stage.setSheet('open'));
    await page.evaluate((s) => window.__map!.advance(s), tuning.sheetSeconds / 2);
    const mid = await view(page);
    expect(mid.bottom).toBeGreaterThan(r1(peek));
    expect(mid.bottom).toBeLessThan(r1(844 * tuning.sheetOpen));
    await page.evaluate((s) => window.__map!.advance(s), tuning.sheetSeconds);
    const open = 844 * tuning.sheetOpen;
    expect(await view(page)).toMatchObject({ bottom: r1(open), offsetY: r1(open / 2) });
  });
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`cumulative layout shift during load is under 0.05 (${size.width}×${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!e.hadRecentInput) window.__cls! += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/');
    await page.waitForLoadState('load');
    await page.evaluate(async () => {
      await document.fonts.ready;
      // A few frames for the stage's first render and any late layout.
      for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r));
    });
    await expect(page.locator('html')).toHaveClass(/\bhas-3d\b/);
    expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.05);
  });
}
