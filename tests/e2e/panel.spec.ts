import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import { copy } from '../../src/copy';
import world from '../../src/data/world.json' with { type: 'json' };
import { withCluster } from '../../src/data/cluster';
import { parseFeed } from '../../src/data/feed';
import { orderIds } from '../../src/nav/stations';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// The panel (the current station's own section, shown beside the map) and the labels (a
// real button on every node). Under ?test, so the labels move only when __map.advance says.

const feed = withCluster(parseFeed(fixture), world); // the homelab cluster's devices are stations too
const order = orderIds(feed.nodes.map((n) => n.id));
const node = (id: string) => feed.nodes.find((n) => n.id === id)!;

/** Opens the map under ?test at `hash`, waits for the models, skips the arrival (Task 9), and runs one frame. */
async function open(page: Page, hash = '', size = { width: 1440, height: 900 }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?test${hash}`);
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    await window.__map!.director.ready;
    window.__map!.director.skipArrival();
    window.__map!.advance(1 / 60);
  });
}

test("at #fettle the panel shows Fettle's summary and facts from the feed", async ({ page }) => {
  await open(page, '#fettle');
  const fettle = node('fettle');
  const section = page.locator('section.station#fettle');

  // Shown in the right column, the stage's inset, and nowhere else.
  await expect(section).not.toHaveClass(/\bsr-only\b/);
  await expect(section).toHaveCSS('opacity', '1');
  const box = (await section.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(1440 - tuning.panelWidthPx - 1);
  expect(box.width).toBeGreaterThan(tuning.panelWidthPx / 2);

  await expect(section.getByRole('heading', { level: 2 })).toHaveText(fettle.name);
  const summary = section.locator('.summary');
  await expect(summary).toHaveText(fettle.summary!);
  expect((await summary.boundingBox())!.width).toBeGreaterThan(200);

  const facts = section.locator('dl.facts > div');
  await expect(facts.locator('dt')).toHaveText([
    copy.factStatus.text,
    copy.factVersion.text,
    copy.factRunsOn.text,
    copy.factStack.text,
    copy.factLicense.text,
  ]);
  await expect(facts.locator('dd')).toHaveText([
    copy.statusLive.text,
    fettle.version!,
    fettle.runsOn!,
    fettle.stack!.join(', '),
    fettle.license!,
  ]);
  for (const dd of await facts.locator('dd').all()) {
    const b = (await dd.boundingBox())!;
    expect(b.x, 'a fact sits outside the panel').toBeGreaterThanOrEqual(1440 - tuning.panelWidthPx);
    expect(b.x + b.width).toBeLessThanOrEqual(1440);
  }

  // The panel covers exactly the inset the camera is framed around: the column on desktop,
  // and on a phone the open sheet.
  const insetEdge = async () => {
    const { inset, viewport } = await page.evaluate(() => ({ inset: window.__map!.stage.inset, viewport: window.__map!.stage.viewport }));
    const panel = (await page.locator('#stations').boundingBox())!;
    return { panel, inset, viewport };
  };
  const desk = await insetEdge();
  expect(Math.abs(desk.panel.x - (desk.viewport.width - desk.inset.right))).toBeLessThanOrEqual(1);
  expect(desk.panel.height).toBe(900);

  await open(page, '#fettle', { width: 390, height: 844 });
  // The camera flies there from the arrival's end; the sheet opens as it settles.
  await page.evaluate((s) => window.__map!.advance(s), tuning.flight.max + 0.1);
  await expect(section).toBeInViewport();
  const phone = await insetEdge();
  expect(phone.inset.bottom).toBeCloseTo(844 * tuning.sheetOpen, 0);
  expect(Math.abs(phone.panel.y - (844 - phone.inset.bottom))).toBeLessThanOrEqual(1);
  expect(phone.panel.width).toBe(390);
  await expect(summary).toHaveText(fettle.summary!);
});

test('the overview at 1440×900 welcomes the visitor instead of showing the origin’s intro', async ({ page }) => {
  await open(page);
  const welcome = page.locator('#stations section#welcome');
  await expect(welcome).not.toHaveClass(/\bsr-only\b/);
  await expect(welcome).toHaveCSS('opacity', '1');
  const heading = welcome.getByRole('heading', { level: 2 });
  await expect(heading).toHaveText(copy.welcomeHeading.text);
  await expect(heading).toBeInViewport();
  await expect(heading).toHaveAttribute('tabindex', '-1'); // focusable from code, never from Tab
  await expect(welcome.locator('.lede')).toHaveText(copy.welcomeLede.text);
  // Three boxes, each under a small heading; a mouse's controls, never touch's beside them.
  await expect(welcome.getByRole('heading', { level: 3 })).toHaveText([
    copy.welcomeAroundHeading.text,
    copy.welcomeOnItHeading.text,
    copy.welcomeKnowHeading.text,
  ]);
  await expect(welcome.locator('dl.for-mouse')).toBeVisible();
  await expect(welcome.locator('.for-touch')).toHaveCount(2);
  for (const el of await welcome.locator('.for-touch').all()) await expect(el).toBeHidden();
  await expect(welcome.locator('[data-found]')).toHaveText('0 of a few');
  expect((await welcome.boundingBox())!.x).toBeGreaterThanOrEqual(1440 - tuning.panelWidthPx);
  // The origin's own section waits for its station: read by screen readers, not on screen.
  await expect(page.locator('section.station#origin')).toHaveClass(/\bsr-only\b/);
  await expect(page.getByText(node('origin').blurb!, { exact: true })).not.toBeInViewport();
  // A named region with its heading, as the stations are.
  await expect(page.getByRole('region', { name: copy.welcomeHeading.text, exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.__map!.panel.shown)).toBe('welcome');
});

test('at /#origin the panel shows the origin’s own section, not the welcome', async ({ page }) => {
  await open(page, '#origin');
  await expect(page.locator('section.station#origin')).not.toHaveClass(/\bsr-only\b/);
  await expect(page.locator('section.station#origin h2')).toBeInViewport();
  await expect(page.locator('section#welcome')).toHaveClass(/\bsr-only\b/);
  expect(await page.evaluate(() => window.__map!.panel.shown)).toBe('origin');
});

test('at 1440×900 the Largest Contentful Paint is the welcome’s heading', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/'); // no ?test: the real clock, and no window.__map in a build
  await page.locator('#stations[data-panel]').waitFor({ state: 'attached' }); // the panel has run
  await page.evaluate(() => document.fonts.ready);
  const lcp = await page.evaluate(
    () =>
      new Promise<string>((done) => {
        new PerformanceObserver((list) => {
          const last = list.getEntries().at(-1) as PerformanceEntry & { element: Element | null };
          done(last.element ? `${last.element.tagName.toLowerCase()}#${last.element.id}` : 'none');
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }),
  );
  expect(lcp).toBe('h2#welcome-title');
});

test.describe('on a phone', () => {
  // Lighthouse's phone (a Moto G Power): the overview names the inner six once the arrival ends.
  test.use({ viewport: { width: 412, height: 823 }, hasTouch: true, isMobile: true });

  test('the Largest Contentful Paint is the wordmark painted first, still after the arrival’s names come in', async ({ page }) => {
    // The 2026-10-22 audit: the labels' glow, as a text-shadow, counted in their text's area,
    // so candygoogy-bot's name (7,644 px² for 2,320) outranked the wordmark at the arrival's end
    // and Lighthouse's phone LCP moved from 1.65 s to 22.9 s.
    await page.goto('/'); // the real clock: the arrival plays
    await page.evaluate(() => document.fonts.ready);
    const named = page.locator('.stations-nav li[data-named] .label');
    await expect(named.first()).toBeVisible({ timeout: 30_000 });
    // Every name the arrival brings in at full strength, then a frame for its paint to count.
    await expect.poll(async () => (await named.evaluateAll((ls) => ls.map((l) => getComputedStyle(l).opacity))).every((o) => o === '1'), { timeout: 10_000 }).toBe(true);
    expect(await named.count()).toBeGreaterThan(0);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const lcp = await page.evaluate(
      () =>
        new Promise<{ last: string; all: string[] }>((done) => {
          new PerformanceObserver((list) => {
            const name = (e: PerformanceEntry) => {
              const el = (e as PerformanceEntry & { element: Element | null }).element;
              return el ? `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join('')}` : 'none';
            };
            const all = list.getEntries().map(name);
            done({ last: all.at(-1)!, all });
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        }),
    );
    expect(lcp.last, `the candidates: ${lcp.all.join(', ')}`).toBe('h1.mark');
    expect(lcp.all.filter((c) => c === 'button.label' || c === 'span.status'), 'no label was ever a candidate').toEqual([]);
  });
});

test('on a phone the peek sheet shows the hint, and the welcome stays for screen readers', async ({ page }) => {
  await open(page, '', { width: 390, height: 844 });
  const hint = page.locator('#stations .peek-hint');
  await expect(hint).toHaveText(copy.peekHint.text);
  await expect(hint).toBeInViewport();
  await expect(hint).not.toHaveClass(/\bsr-only\b/);
  // The full welcome is off screen but read: the same .sr-only as an off-screen station.
  const welcome = page.locator('section#welcome');
  await expect(welcome).toHaveClass(/\bsr-only\b/);
  await expect(page.getByRole('heading', { level: 2, name: copy.welcomeHeading.text, exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.__map!.panel.shown)).toBeNull();
  // Mid-flight the counter already reads the new station: the hint fades so it never runs under it
  // (the review tour, 2026-10-22: "4 of 17" over "…the floor to turn.").
  await page.evaluate(() => {
    window.__map!.stations.go('fettle');
    window.__map!.advance(0.2);
  });
  await expect(page.locator('.travel .count')).not.toHaveText('');
  await expect.poll(() => hint.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await expect(hint).not.toHaveClass(/\bsr-only\b/); // still read until the station's text takes over
  // At a station the hint gives way to the station's text.
  await page.evaluate((s) => {
    window.__map!.stations.go('fettle');
    window.__map!.advance(s);
  }, tuning.flight.max + 0.1);
  await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe('fettle');
  await expect(hint).toHaveClass(/\bsr-only\b/);
});

test('on a phone the hint has faded before the counter comes in, so the two never show together', async ({ page }) => {
  // At 360 px the hint's second line runs under where the counter reads "1 of 17" (polish-2: over
  // the sheet's 450 ms both stood at full strength for 300 ms). The fades are CSS, on the wall clock.
  await open(page, '', { width: 360, height: 780 });
  const both = await page.evaluate(
    () =>
      new Promise<number[][]>((done) => {
        const hint = document.querySelector('#stations .peek-hint')!;
        const count = document.querySelector('.travel .count')!;
        const seen: number[][] = [];
        const t0 = performance.now();
        window.__map!.stations.go('fettle');
        window.__map!.advance(0.2);
        const look = () => {
          const h = +getComputedStyle(hint).opacity;
          const c = count.textContent ? +getComputedStyle(count).opacity : 0;
          if (h > 0.3 && c > 0.3) seen.push([Math.round(performance.now() - t0), h, c]);
          if (performance.now() - t0 < 800) requestAnimationFrame(look);
          else done(seen);
        };
        look();
      }),
  );
  expect(both, 'frames with the hint and the counter both showing [ms, hint, count]').toEqual([]);
  await expect.poll(() => page.locator('.travel .count').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});

test('on a phone the header’s icons and ‹ › take no square system tap flash: they mark a press themselves', async ({ page }) => {
  await open(page, '', { width: 390, height: 844 });
  const flash = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.sound, .themes button[aria-pressed="true"], .top .back, .travel button')].map((el) => {
      const cs = getComputedStyle(el);
      return [el.getAttribute('aria-label') ?? el.textContent?.trim(), cs.getPropertyValue('-webkit-tap-highlight-color'), cs.borderRadius !== '0px'];
    }),
  );
  expect(flash.length).toBe(5);
  for (const [name, colour, round] of flash) expect([name, colour, round]).toEqual([name, 'rgba(0, 0, 0, 0)', true]);
});

// The phone pass: the peek is 10% of a portrait screen (was 15%), its two-line hint still on
// the 44 px row beside ‹ ›, inside the sheet.
for (const size of [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 440, height: 956 },
]) {
  test(`at ${size.width}×${size.height} the peek is ${tuning.sheetPeek * 100}% of the screen, and the hint fits its row`, async ({ page }) => {
    await open(page, '', size);
    await page.evaluate(() => document.fonts.ready);
    const read = () =>
      page.evaluate(() => {
        const sheet = document.getElementById('stations')!;
        const hint = sheet.querySelector('.peek-hint')!;
        const r = hint.getBoundingClientRect();
        return {
          rule: sheet.getBoundingClientRect().top,
          hint: [r.left, r.top, r.right, r.bottom],
          lines: Math.round(r.height / parseFloat(getComputedStyle(hint).lineHeight)),
          buttons: [...document.querySelectorAll('.travel button')].map((b) => b.getBoundingClientRect().left),
        };
      });
    await expect.poll(async () => size.height - (await read()).rule).toBeCloseTo(size.height * tuning.sheetPeek, 0);
    const { rule, hint, buttons, lines } = await read();
    expect(lines, 'the hint keeps to two lines').toBeLessThanOrEqual(2);
    expect(hint[1]!).toBeGreaterThan(rule);
    expect(hint[3]!).toBeLessThanOrEqual(size.height);
    expect(hint[2]!).toBeLessThanOrEqual(Math.min(...buttons));
    expect(await page.evaluate(() => window.__map!.stage.inset.bottom)).toBeCloseTo(size.height * tuning.sheetPeek, 1);
  });
}

test('on a landscape phone the hint and ‹ › sit in the middle of the short peek, on one row; the open sheet keeps the usual foot', async ({ page }) => {
  await open(page, '', { width: 844, height: 390 });
  await page.evaluate(() => document.fonts.ready);
  const rows = () =>
    page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect();
      const sheet = document.getElementById('stations')!;
      return {
        rule: box(sheet).top + parseFloat(getComputedStyle(sheet).borderTopWidth),
        hint: box(sheet.querySelector('.peek-hint')!),
        buttons: [...document.querySelectorAll('.travel button')].map(box),
      };
    });
  // The peek is 58.5 px here: the 44 px row has as much room above it, under the rule, as below.
  await expect.poll(async () => (await rows()).rule).toBeCloseTo(390 * (1 - tuning.sheetPeekWide) + 1, 1);
  const peek = await rows();
  for (const b of [peek.hint, ...peek.buttons]) {
    expect(b.height).toBeCloseTo(44, 1);
    expect(b.top - peek.rule).toBeCloseTo(390 - b.bottom, 0);
    expect(b.top).toBeCloseTo(peek.buttons[0]!.top, 1);
  }
  // At a station the sheet is open, and the row is back on its usual foot (--sp-5, 24 px).
  await page.evaluate((s) => {
    window.__map!.stations.go('fettle');
    window.__map!.advance(s);
  }, tuning.flight.max + 0.1);
  await expect.poll(async () => 390 - (await rows()).buttons[0]!.bottom).toBeCloseTo(24, 1);
});

test('other stations are sr-only, not hidden', async ({ page }) => {
  await open(page, '#fettle');
  for (const id of order.filter((id) => id !== 'fettle')) {
    const section = page.locator(`section.station#${id}`);
    await expect(section).toHaveClass(/\bsr-only\b/);
    const state = await section.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { hidden: (el as HTMLElement).hidden, display: cs.display, visibility: cs.visibility, inert: (el as HTMLElement).inert };
    });
    expect(state, id).toEqual({ hidden: false, display: expect.not.stringMatching(/^none$/), visibility: 'visible', inert: false });
    // Still in the accessibility tree: a named region with its own heading.
    await expect(page.getByRole('region', { name: node(id).name, exact: true })).toBeAttached();
    await expect(section.getByRole('heading', { level: 2, name: node(id).name, exact: true })).toBeAttached();
  }
});

test('Tab reaches every label in station order and Enter travels', async ({ page }) => {
  await open(page);
  const reached: string[] = [];
  for (let i = 0; i < 40 && reached.length < order.length; i++) {
    await page.keyboard.press('Tab');
    const go = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('button.label')?.getAttribute('data-go'));
    if (go) reached.push(go);
  }
  expect(reached).toEqual(order);

  // Back to Fettle's label, and Enter travels there.
  const label = page.locator('nav button.label[data-go="fettle"]');
  await expect(label).toHaveAccessibleName(node('fettle').name);
  await label.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\?test#fettle$/);
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('fettle');
  await expect(label).toHaveAttribute('aria-current', 'location');
  // Keyboard travel takes focus to the new panel's heading, once it's there: the panel swaps
  // as the camera lands (motion audit #4), so the flight has to land first.
  await page.evaluate((s) => window.__map!.advance(s), tuning.flight.max + 0.1);
  await expect(page.locator('#fettle h2')).toBeFocused();
});

test('a skip link right after ‹ › shows when focused and takes focus to the station’s heading (the welcome’s in the overview), so its links are a Tab away', async ({ page }) => {
  await open(page, '#homelab');
  await page.evaluate((s) => window.__map!.advance(s), 1);
  const skip = page.locator('.travel .skip');
  // Hidden from the eye until it has focus.
  expect((await skip.boundingBox())!.width).toBeLessThanOrEqual(1);
  await page.locator('.travel button[aria-label="' + copy.nextStation.text + '"]').focus();
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveText(copy.skipToStation.text);
  const box = (await skip.boundingBox())!;
  expect(box.width).toBeGreaterThan(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeLessThanOrEqual(1440);
  await page.keyboard.press('Enter');
  await expect(page.locator('#homelab h2')).toBeFocused();
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('homelab');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('section.station')?.id)).toBe('homelab');

  // In the overview, to the welcome.
  await open(page);
  await page.locator('.travel button[aria-label="' + copy.nextStation.text + '"]').focus();
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveText(copy.skipToWelcome.text);
  await page.keyboard.press('Enter');
  await expect(page.locator('#welcome h2')).toBeFocused();
  expect(await page.evaluate(() => window.__map!.stations.current)).toBeNull();
});

for (const [where, size, hash] of [
  ['the phone’s sheet', { width: 390, height: 844 }, '#homelab'],
  ['the column', { width: 1440, height: 620 }, '#fettle'],
] as const) {
  test(`in ${where} a scrolled station fades in at its top edge, never cut hard; unscrolled, its top is as before`, async ({ page }) => {
    await open(page, hash, size);
    await page.evaluate((s) => window.__map!.advance(s), 1);
    const section = page.locator(`section.station${hash}`);
    await expect(section).toHaveCSS('opacity', '1');
    const fade = () => section.evaluate((el) => getComputedStyle(el).getPropertyValue('--less'));
    expect(await section.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(60);
    expect(await fade()).toBe('0px');
    await section.evaluate((el) => (el.scrollTop = 120));
    await expect.poll(fade).toBe('24px');
    await section.evaluate((el) => (el.scrollTop = 10));
    await expect.poll(async () => parseFloat(await fade())).toBeLessThan(24);
    await section.evaluate((el) => (el.scrollTop = 0));
    await expect.poll(fade).toBe('0px');
  });
}

test('axe finds no violations at overview and at #fettle', async ({ page }) => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const hash of ['', '#fettle']) {
      await open(page, hash, size);
      await expect(page.locator('nav li:not([hidden]) > button.label')).toHaveCount(order.length); // not the hidden duck's (Task 17)
      // A same-page hash change flies there, and the panel swaps with a fade as the camera
      // lands: land it, then wait until the station has taken over, so the old one isn't
      // read mid-fade-out.
      await page.evaluate((s) => window.__map!.advance(s), tuning.flight.max + 0.1);
      const expected = hash ? hash.slice(1) : size.width >= tuning.panelMinViewportPx ? 'welcome' : null;
      await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe(expected);
      // Let a panel settle before axe reads colours (a phone's overview shows none: the peek).
      const shown = page.locator('#stations section:not(.sr-only)');
      if (await shown.count()) await expect(shown.first()).toHaveCSS('opacity', '1');
      const { violations } = await new AxeBuilder({ page }).exclude('#stage').analyze();
      expect(
        violations.map((v) => `${size.width} ${hash || 'overview'}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      ).toEqual([]);
    }
  }
});

/** A node model's projected box and centre, in CSS px. */
const modelOnScreen = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { stage, nodes } = window.__map!;
    const n = nodes.get(id);
    const { width, height } = stage.viewport;
    const xs: number[] = [];
    const ys: number[] = [];
    const b = n.bounds;
    for (let c = 0; c < 8; c++) {
      const v = n.root.position.clone().set(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z);
      n.root.localToWorld(v).project(stage.camera);
      xs.push(((v.x + 1) / 2) * width);
      ys.push(((1 - v.y) / 2) * height);
    }
    const p = n.root.localToWorld(b.getCenter(n.root.position.clone())).project(stage.camera);
    return {
      x: ((p.x + 1) / 2) * width,
      y: ((1 - p.y) / 2) * height,
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
  }, id);

/** Touches with a fingertip's size (12 px radius), so Chrome's touch adjustment is as on a phone. */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12 }],
    });
  return {
    down: (x: number, y: number) => touch('touchStart', x, y),
    move: (x: number, y: number) => touch('touchMove', x, y),
    up: () => touch('touchEnd'),
    async tap(x: number, y: number) {
      await touch('touchStart', x, y);
      await touch('touchEnd');
    },
  };
}

test.describe('on a phone, by touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a tap on Fettle's model travels to #fettle, not to the label near it", async ({ page }) => {
    await open(page, '', { width: 390, height: 844 });
    const m = await modelOnScreen(page, 'fettle');
    const touch = await finger(page);
    // Its middle, then high on it, nearer Eolietech's label.
    for (const y of [m.y, m.top + (m.bottom - m.top) * 0.3]) {
      await touch.tap(m.x, y);
      await expect(page).toHaveURL(/\?test#fettle$/);
      expect(await page.evaluate(() => window.__map!.stations.current)).toBe('fettle');
      await page.evaluate((s) => {
        window.__map!.stations.overview();
        window.__map!.advance(s);
      }, tuning.flight.max + 0.1);
    }
  });

  test("a touch drag on Install diff's model moves it", async ({ page }) => {
    await open(page, '', { width: 390, height: 844 });
    const home = await page.evaluate(() => window.__map!.nodes.get('idiff').root.position.toArray());
    const at = await modelOnScreen(page, 'idiff');
    const touch = await finger(page);
    await touch.down(at.x, at.y);
    // Held first (tuning.pullHold): a quick drag from a model pans the map instead (decided
    // 2026-10-22 morning).
    await page.waitForTimeout(tuning.pullHold * 1000 + 100);
    for (let i = 1; i <= 8; i++) await touch.move(at.x + 6 * i, at.y + 4 * i);
    await page.evaluate(() => window.__map!.advance(0.6));
    const pulled = await page.evaluate(() => window.__map!.nodes.get('idiff').root.position.toArray());
    await touch.up();
    expect(Math.hypot(pulled[0]! - home[0]!, pulled[2]! - home[2]!)).toBeGreaterThan(0.3);
    expect(await page.evaluate(() => window.__map!.stations.current)).toBeNull(); // no label took it
  });

  test('a label never lays its touch target over a model or another target, and keeps 44 px of it where neither is in the way', async ({ page }) => {
    await open(page, '', { width: 390, height: 844 });
    // At the closer start (2026-10-22 morning: there the hidden origin's target lay on
    // Dolci Eoliani's named one, and a tap meant for the origin went to Dolci), then at the
    // overview as composed (there Install diff's lay on the origin's).
    for (const view of ['start', 'composed']) {
      if (view === 'composed') {
        await page.evaluate(() => {
          const { director, advance } = window.__map!;
          director.viewTo(1, director.framing(null).target);
          advance(1 / 60);
        });
      }
      const models = await Promise.all(order.map((id) => modelOnScreen(page, id)));
      // The middle of every model's box (its body) on screen is the canvas's: at the start a few
      // are off its edges, reached by a pan.
      for (const [i, m] of models.entries()) {
        const w = m.right - m.left;
        const h = m.bottom - m.top;
        for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]] as const) {
          const [x, y] = [m.left + fx * w, m.top + fy * h];
          if (x < 0 || x > 390 || y < 0 || y > 844) continue;
          const tag = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.tagName, [x, y]);
          expect(tag, `${view}: ${order[i]} at ${fx}, ${fy}`).toBe('CANVAS');
        }
      }
      // Every target that takes the pointer (a label off the screen, or a hidden one crowded onto
      // another model, has none: its model still takes the tap), from labels.ts's --hit.
      const targets = await page.evaluate((ids) => {
        const out: { id: string; box: number[]; hit: number[] }[] = [];
        for (const id of ids) {
          const b = document.querySelector<HTMLElement>(`button.label[data-go="${id}"]`)!;
          if (b.closest('li')!.matches('[data-off], [data-nohit]')) continue;
          const r = b.getBoundingClientRect();
          const [t, right, bottom, left] = b.style.getPropertyValue('--hit').split(' ').map(parseFloat) as [number, number, number, number];
          out.push({ id, box: [r.left, r.top, r.right, r.bottom], hit: [r.left + left, r.top + t, r.right - right, r.bottom - bottom] });
        }
        return out;
      }, order);
      const meets = (a: number[], b: number[]) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;
      for (const t of targets) {
        for (const [j, m] of models.entries()) {
          if (order[j] !== t.id) expect(meets(t.hit, [m.left, m.top, m.right, m.bottom]), `${view}: ${t.id}'s target on ${order[j]}`).toBe(false);
        }
        for (const o of targets) if (o !== t) expect(meets(t.hit, o.hit), `${view}: ${t.id}'s target on ${o.id}'s`).toBe(false);
      }
      // Each still takes a press 22 px above and below its middle unless another model or
      // another's target is within its 44 px target, and always at least 12 px either way
      // (24 px: WCAG 2.5.8).
      for (const t of targets) {
        const x = (t.box[0]! + t.box[2]!) / 2;
        const mid = (t.box[1]! + t.box[3]!) / 2;
        const half = Math.max(t.box[2]! - t.box[0]!, 44) / 2;
        const full = [x - half, mid - 22, x + half, mid + 22];
        const blocked =
          models.some((m, j) => order[j] !== t.id && meets(full, [m.left, m.top, m.right, m.bottom])) ||
          targets.some((o) => o !== t && meets(full, o.hit));
        const at = (y: number) =>
          page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('button.label')?.getAttribute('data-go') ?? null, [x, y]);
        if (!blocked) for (const dy of [-21.5, 21.5]) expect(await at(mid + dy), `${view}: ${t.id} ${dy > 0 ? 'below' : 'above'}`).toBe(t.id);
        for (const dy of [-11.5, 11.5]) expect(await at(mid + dy), `${view}: ${t.id} ${dy}`).toBe(t.id);
      }
    }
  });

  test("at the closer start, a tap on the origin's model, or just under it, travels to the origin", async ({ page }) => {
    await open(page, '', { width: 390, height: 844 });
    const m = await modelOnScreen(page, 'origin');
    const touch = await finger(page);
    for (const y of [m.y, m.bottom - 4]) {
      await touch.tap(m.x, y);
      await expect(page).toHaveURL(/\?test#origin$/);
      await page.evaluate((s) => {
        window.__map!.stations.overview();
        window.__map!.advance(s);
      }, tuning.flight.max + 0.1);
    }
  });

  test('a focused label, name and status line, lies over no other model (Experiments kept off candygoogy-bot)', async ({ page }) => {
    await open(page, '', { width: 390, height: 844 });
    await page.evaluate(() => document.fonts.ready);
    for (const id of order) {
      const label = page.locator(`button.label[data-go="${id}"]`);
      await label.focus();
      await page.evaluate(() => window.__map!.advance(0.5)); // its hover has settled
      const r = await label.evaluate((el) => {
        const a = el.getBoundingClientRect();
        const s = el.querySelector('.status')!.getBoundingClientRect();
        return { left: a.left, top: a.top, right: Math.max(a.right, s.right), bottom: Math.max(a.bottom, s.bottom) };
      });
      for (const other of order.filter((o) => o !== id)) {
        const m = await modelOnScreen(page, other);
        const over = r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top;
        expect(over, `${id}'s label over ${other}`).toBe(false);
      }
      await label.blur();
    }
  });

  test('a tap on a label, even one cut back, still travels to its station', async ({ page }) => {
    await open(page, '', { width: 390, height: 844 });
    // At the overview as composed, where these labels are cut back (the phone starts closer).
    const composed = () =>
      page.evaluate(() => {
        const { director, advance } = window.__map!;
        director.viewTo(1, director.framing(null).target);
        advance(1 / 60);
      });
    await composed();
    const touch = await finger(page);
    for (const id of ['notary', 'origin', 'experiments']) {
      const box = (await page.locator(`button.label[data-go="${id}"]`).boundingBox())!;
      await touch.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      // Back to the overview, landed, for the next.
      await page.evaluate((s) => {
        window.__map!.stations.overview();
        window.__map!.advance(s);
      }, tuning.flight.max + 0.1);
      await composed();
    }
  });
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`at 390×844 with reducedMotion ${reducedMotion}, Escape from fettle by keyboard leaves no station in the peek sheet`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await open(page, '', { width: 390, height: 844 });
    const land = () => page.evaluate((s) => window.__map!.advance(s), tuning.flight.max + 0.1);
    await page.keyboard.press('ArrowRight');
    await land();
    await page.keyboard.press('ArrowRight');
    await land();
    await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe('fettle');
    await expect(page.locator('#fettle h2')).toBeFocused();

    await page.keyboard.press('Escape');
    await land();
    await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBeNull();
    expect(await page.locator('#stations').getAttribute('data-sheet')).toBe('peek');
    // Fettle's text is off screen: sr-only, not shown over the sheet.
    const fettle = (await page.locator('section.station#fettle').boundingBox())!;
    expect(fettle.width).toBeLessThanOrEqual(1);
    for (const s of await page.locator('#stations section.station:not([hidden])').all()) { // not the hidden duck's (Task 17)
      // No box at all is fine too: the receipt's section (Task 16) isn't there before a trip is left.
      expect((await s.boundingBox())?.width ?? 0, await s.getAttribute('id') ?? '').toBeLessThanOrEqual(1);
    }
    // Focus is on the map, at the station just left, not in a hidden section.
    await expect(page.locator('button.label[data-go="fettle"]')).toBeFocused();
  });
}
