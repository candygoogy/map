import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// The header's theme switch (approved by the owner 2026-10-20): Auto / Light / Dark as on
// candygoogy.dev, shown only with JS, kept in localStorage.theme, put on before the first paint,
// and recolouring the 3D scene through the OS switch's own path.

declare global {
  interface Window {
    __sameDocument?: boolean;
    __transitions?: number;
    __firstPaint?: { theme?: string; bg: string };
  }
}

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const LIGHT_BG = 'rgb(244, 244, 245)';
const DARK_BG = 'rgb(18, 18, 20)';

const group = (page: Page) => page.getByRole('group', { name: 'Theme' });
const option = (page: Page, name: 'Auto' | 'Light' | 'Dark') =>
  group(page).getByRole('button', { name: new RegExp(`^${name}\\b`) });

/** The renderer's clear colour as #rrggbb (stage.spec's reading). */
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

const pageBg = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

/** Opens the map under ?test, waits for the models and skips the arrival. */
async function open(page: Page, size = DESKTOP, hash = ''): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?test${hash}`);
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    await window.__map!.director.ready;
    window.__map!.director.skipArrival();
    window.__map!.advance(1 / 60);
  });
}

/** Counts document.startViewTransition calls, and records the look at DOMContentLoaded. */
async function watch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__transitions = 0;
    const start = document.startViewTransition?.bind(document);
    if (start) {
      document.startViewTransition = ((cb?: ViewTransitionUpdateCallback) => {
        window.__transitions! += 1;
        return start(cb);
      }) as typeof document.startViewTransition;
    }
    document.addEventListener('DOMContentLoaded', () => {
      window.__firstPaint = {
        theme: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.documentElement).backgroundColor,
      };
    });
  });
}

test.describe('without JS', () => {
  test.use({ javaScriptEnabled: false });

  test('there is no switch, and Auto still follows the OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('[data-theme-switch]')).toHaveCount(1);
    await expect(page.locator('[data-theme-switch]')).toBeHidden();
    expect(await pageBg(page)).toBe(DARK_BG);
  });
});

test('the switch is a group named Theme, Auto pressed and saying what it resolves to', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await expect(group(page)).toBeVisible();
  await expect(group(page).getByRole('button')).toHaveCount(3);
  await expect(option(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
  await expect(option(page, 'Auto')).toHaveAccessibleName('Auto (light)');
  await expect(option(page, 'Light')).toHaveAttribute('aria-pressed', 'false');
  await expect(option(page, 'Dark')).toHaveAttribute('aria-pressed', 'false');
  // On the panel's column, left of the way back, and not on the map's side.
  const pill = await group(page).boundingBox();
  const back = await page.locator('header.top .back').boundingBox();
  expect(pill!.x).toBeGreaterThanOrEqual(DESKTOP.width - tuning.panelWidthPx);
  expect(pill!.x + pill!.width).toBeLessThan(back!.x);
  // Centred on the way back's line, within a pixel or two.
  expect(Math.abs(pill!.y + pill!.height / 2 - (back!.y + back!.height / 2))).toBeLessThan(3);
});

test('keyboard: Tab reaches each option, Enter and Space choose', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page);
  await option(page, 'Auto').focus();
  await page.keyboard.press('Tab');
  await expect(option(page, 'Light')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(option(page, 'Dark')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(option(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(option(page, 'Auto')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(option(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});

test('Dark on a light OS recolours the scene and the page without a reload, and drops in like a blind', async ({ page }) => {
  await watch(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await expect.poll(() => clearColour(page)).toBe('#f4f4f5');
  expect(await centrePixel(page)).toBe('#f4f4f5');
  await page.evaluate(() => void (window.__sameDocument = true));

  await option(page, 'Dark').click();
  await expect(option(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => clearColour(page)).toBe('#121214');
  expect(await centrePixel(page)).toBe('#121214');
  await expect.poll(() => pageBg(page)).toBe(DARK_BG);
  expect(await page.evaluate(() => window.__transitions)).toBe(1);
  await expect(page.locator('html')).not.toHaveClass(/\btheme-vt\b/); // the blind has finished
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  expect(await page.locator('meta[name="color-scheme"]').getAttribute('content')).toBe('dark');

  // And back to Light: the other direction.
  await option(page, 'Light').click();
  await expect.poll(() => clearColour(page)).toBe('#f4f4f5');
  await expect.poll(() => pageBg(page)).toBe(LIGHT_BG);
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

test('a wipe skipped as it starts (a fast change of mind, a fast lamp pull) leaves no uncaught error', async ({ page }) => {
  // The audit's item 13: "Transition was skipped. skipTransition() called" surfaced as an
  // uncaught page error: the View Transition's `ready` rejects when it's skipped, and nothing
  // caught it. Here: Dark, and as its wipe starts (before it has changed the theme), Light,
  // which looks as Auto does on a light OS, so it switches at once and skips the wipe.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const root = document.documentElement;
          const pick = (v: string) => document.querySelector<HTMLButtonElement>(`[data-theme-switch] button[data-value="${v}"]`)!.click();
          pick('dark');
          const id = setInterval(() => {
            if (!root.classList.contains('theme-vt')) return;
            clearInterval(id);
            pick('light');
            done();
          }, 1);
        }),
    );
    await expect(page.locator('html')).not.toHaveClass(/\btheme-vt\b/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-theme-switch] button[data-value="auto"]')!.click());
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('during the arrival a choice switches at once (no blind to freeze it), and after it the blind is back', async ({ page }) => {
  await watch(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize(DESKTOP);
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    await window.__map!.director.ready;
    window.__map!.advance(0.5);
  });
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('arrival');
  await page.evaluate(() => {
    const root = document.documentElement;
    (window as { __vt?: boolean }).__vt = false;
    new MutationObserver(() => {
      if (root.classList.contains('theme-vt')) (window as { __vt?: boolean }).__vt = true;
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
  });
  const before = await page.evaluate(() => window.__map!.director.arrivalTime!);

  await option(page, 'Dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300); // past the pill's slide, when a wipe would start
  expect(await page.evaluate(() => window.__transitions)).toBe(0);
  expect(await page.evaluate(() => (window as { __vt?: boolean }).__vt)).toBe(false);
  // The arrival plays on.
  await page.evaluate(() => window.__map!.advance(0.25));
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('arrival');
  expect(await page.evaluate(() => window.__map!.director.arrivalTime!)).toBeGreaterThan(before);

  // Once it has ended, the blind drops in again.
  await page.evaluate(() => {
    window.__map!.director.skipArrival();
    window.__map!.advance(1 / 60);
  });
  await option(page, 'Light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => window.__transitions)).toBe(1);
  await expect(page.locator('html')).not.toHaveClass(/theme-vt/);
});

test('the choice is kept across a reload and is on before the first paint', async ({ page }) => {
  await watch(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page);
  await option(page, 'Dark').click();
  await open(page);
  expect(await page.evaluate(() => window.__firstPaint)).toEqual({ theme: 'dark', bg: DARK_BG });
  await expect(option(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => clearColour(page)).toBe('#121214');

  // Light on a dark OS, the same way.
  await page.emulateMedia({ colorScheme: 'dark' });
  await option(page, 'Light').click();
  await open(page);
  expect(await page.evaluate(() => window.__firstPaint)).toEqual({ theme: 'light', bg: LIGHT_BG });
  await expect.poll(() => clearColour(page)).toBe('#f4f4f5');
});

test('Auto follows the OS live; a chosen theme doesn’t', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => clearColour(page)).toBe('#121214');
  await expect(option(page, 'Auto')).toHaveAccessibleName('Auto (dark)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => clearColour(page)).toBe('#f4f4f5');
  await expect(option(page, 'Auto')).toHaveAccessibleName('Auto (light)');

  await option(page, 'Dark').click();
  await expect.poll(() => clearColour(page)).toBe('#121214');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await clearColour(page)).toBe('#121214');
  expect(await pageBg(page)).toBe(DARK_BG);
});

test('reduced motion switches at once, with no blind', async ({ page }) => {
  await watch(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page);
  await option(page, 'Dark').click();
  // At once: no slide-then-wipe delay.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await expect.poll(() => clearColour(page)).toBe('#121214');
  expect(await page.evaluate(() => window.__transitions)).toBe(0);
});

test('no blind when the look doesn’t change (Auto to the theme it resolves to)', async ({ page }) => {
  await watch(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await option(page, 'Light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__transitions)).toBe(0);
});

const PHONES = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 440, height: 956 },
];

/** Picks `name`: on a phone, by tapping the one shown option until it's pressed (header A). */
async function choose(page: Page, name: 'Auto' | 'Light' | 'Dark'): Promise<void> {
  if (await option(page, name).isVisible()) return option(page, name).click();
  // The options not shown are out of the accessibility tree, so this reads them by value.
  const target = page.locator(`[data-theme-switch] button[data-value="${name.toLowerCase()}"]`);
  for (let i = 0; i < 3 && (await target.getAttribute('aria-pressed')) !== 'true'; i++)
    await group(page).getByRole('button').filter({ visible: true }).click();
}

// The phone pass, header A: one row of wordmark, sound, theme and home.
for (const size of PHONES) {
  test(`phone ${size.width}×${size.height}: one header row, 66px at most, its three targets 44×44`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await open(page, size);
    const header = (await page.locator('header.top').boundingBox())!;
    expect(header.y + header.height).toBeLessThanOrEqual(66.5);
    const mark = (await page.locator('header.top .mark').boundingBox())!;
    const sound = (await page.getByRole('button', { name: 'Sound' }).boundingBox())!;
    const theme = (await group(page).getByRole('button').filter({ visible: true }).boundingBox())!;
    const home = page.getByRole('banner').getByRole('link', { name: 'Back to the site' });
    const back = (await home.boundingBox())!;
    await expect(group(page).getByRole('button').filter({ visible: true })).toHaveCount(1);
    for (const b of [sound, theme, back]) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(b.y + b.height / 2 - (mark.y + mark.height / 2))).toBeLessThan(3); // one row
    }
    // In order, not overlapping, the house on the gutter's edge (its glyph ends where the text did).
    expect(mark.x + mark.width).toBeLessThanOrEqual(sound.x);
    expect(sound.x + sound.width).toBeLessThanOrEqual(theme.x + 0.5);
    expect(theme.x + theme.width).toBeLessThanOrEqual(back.x + 0.5);
    expect(back.x + back.width).toBeLessThanOrEqual(size.width);
    await expect(home).toHaveText('Back to the site');
  });
}

test('phone: the theme is one button, a tap steps Auto → Light → Dark → Auto, focus follows', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page, PHONE);
  const shown = () => group(page).getByRole('button').filter({ visible: true });
  await expect(shown()).toHaveAccessibleName('Auto (light)');
  await expect(shown()).toHaveAttribute('aria-pressed', 'true');
  for (const [name, theme] of [
    ['Light', 'light'],
    ['Dark', 'dark'],
  ] as const) {
    await shown().click();
    await expect(shown()).toHaveAccessibleName(name);
    await expect(shown()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }
  // From the keyboard too: the focus stays on the switch as it changes.
  await shown().focus();
  await page.keyboard.press('Enter');
  await expect(option(page, 'Auto')).toBeFocused();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await page.keyboard.press('Space');
  await expect(option(page, 'Light')).toBeFocused();
  await expect(option(page, 'Light')).toHaveAttribute('aria-pressed', 'true');
});

test('phone: in the header row in the overview, gone at a station', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page, PHONE);
  await expect(group(page)).toBeVisible();
  const pill = (await group(page).boundingBox())!;
  const back = (await page.locator('header.top .back').boundingBox())!;
  expect(pill.x + pill.width).toBeLessThanOrEqual(back.x + 0.5); // just before the way back
  expect(Math.abs(pill.y + pill.height / 2 - (back.y + back.height / 2))).toBeLessThan(1);

  await page.evaluate(() => window.__map!.stations.go('homelab'));
  await page.evaluate((s) => window.__map!.advance(s), tuning.flight.max + 0.2);
  await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe('homelab');
  await expect(group(page)).toBeHidden();
  await expect(page.locator('header.top .back')).toBeVisible();

  await page.evaluate(() => window.__map!.stations.overview());
  await page.evaluate((s) => window.__map!.advance(s), tuning.flight.max + 0.2);
  await expect(group(page)).toBeVisible();
});

test('axe: zero violations with Dark chosen on a light OS and Light on a dark one', async ({ page }) => {
  test.setTimeout(90_000);
  const found: string[] = [];
  for (const [os, chosen] of [
    ['light', 'Dark'],
    ['dark', 'Light'],
  ] as const) {
    for (const size of [DESKTOP, PHONE]) {
      await page.emulateMedia({ colorScheme: os, reducedMotion: 'reduce' });
      await open(page, size);
      await choose(page, chosen);
      await expect(option(page, chosen)).toHaveAttribute('aria-pressed', 'true');
      const { violations } = await new AxeBuilder({ page }).exclude('#stage').analyze();
      found.push(...violations.map((v) => `${size.width} ${os} OS, ${chosen}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`));
      await choose(page, 'Auto');
    }
  }
  expect(found).toEqual([]);
});

test('landscape phone: in the header row, which it leaves no taller', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page, { width: 844, height: 390 });
  const pill = (await group(page).boundingBox())!;
  const back = (await page.locator('header.top .back').boundingBox())!;
  expect(pill.x + pill.width).toBeLessThanOrEqual(back.x + 0.5); // header A from 900px down
  expect(Math.abs(pill.y + pill.height / 2 - (back.y + back.height / 2))).toBeLessThan(3);
  const height = () => page.locator('header.top').evaluate((h) => h.getBoundingClientRect().height);
  const withPill = await height();
  await page.addStyleTag({ content: '.theme-row { display: none !important; }' });
  expect(await height()).toBeCloseTo(withPill, 0);
});
