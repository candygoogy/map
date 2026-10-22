import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import fixture from '../../src/data/fixture.json' with { type: 'json' };
import world from '../../src/data/world.json' with { type: 'json' };
import { withCluster } from '../../src/data/cluster';
import { parseFeed } from '../../src/data/feed';
import { orderIds } from '../../src/nav/stations';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// Task 18: everyone gets the map. axe in both themes, touch targets, and a hidden tab that
// schedules nothing (no-webgl.spec.ts has the page without WebGL).

const feed = withCluster(parseFeed(fixture), world); // the homelab cluster's devices are stations too
const order = orderIds(feed.nodes.map((n) => n.id));
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
/** Three stations with different bodies: devices (leaders), the tools grid, and the exit. */
const STATIONS = ['homelab', 'experiments', 'exit'] as const;

/** Opens the map under ?test at `hash`, waits for the models, skips the arrival and runs one frame. */
async function open(page: Page, hash = '', size = DESKTOP): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?test${hash}`);
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    await window.__map!.director.ready;
    window.__map!.director.skipArrival();
    window.__map!.advance(1 / 60);
  });
}

/** Flies to `id` (null: the overview), lands, and waits for its panel to settle. */
async function visit(page: Page, id: string | null, size = DESKTOP): Promise<void> {
  await page.evaluate((id) => (id ? window.__map!.stations.go(id) : window.__map!.stations.overview()), id);
  await page.evaluate((s) => window.__map!.advance(s), tuning.flight.max + 0.2);
  const expected = id ?? (size.width >= tuning.panelMinViewportPx ? 'welcome' : null);
  await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe(expected);
  const shown = page.locator('#stations section:not(.sr-only)');
  if (await shown.count()) await expect(shown.first()).toHaveCSS('opacity', '1');
}

const axe = async (page: Page, where: string): Promise<string[]> => {
  const { violations } = await new AxeBuilder({ page }).exclude('#stage').analyze();
  return violations.map((v) => `${where}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
};

test('axe: zero violations in light and dark at overview and at three stations', async ({ page }) => {
  test.setTimeout(120_000);
  const found: string[] = [];
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await open(page);
    await expect(page.locator('nav li:not([hidden]) > button.label')).toHaveCount(order.length); // not the hidden duck's (Task 17)
    for (const id of [null, ...STATIONS]) {
      await visit(page, id);
      found.push(...(await axe(page, `${colorScheme} ${id ?? 'overview'}`)));
    }
  }
  expect(found).toEqual([]);
});

/**
 * Every visible control's touch target, in CSS px: its own box joined with its ::after,
 * which is where the page lays the 44 px targets (styles.css). Controls hidden from the eye
 * and the pointer (a .sr-only pane's links, an off-screen label) are left out; a quiet label
 * on a phone's overview still takes its tap, so it counts.
 */
const targets = (page: Page) =>
  page.evaluate(() => {
    const out: { name: string; width: number; height: number; cut: boolean }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
      // A hidden label crowded onto another model (data-nohit, the homelab cluster) has no
      // target at all: its own node takes the tap (WCAG 2.5.8's equivalent-control exception).
      if (el.closest('.sr-only, [data-off], [data-nohit], [aria-hidden="true"]')) continue;
      const own = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (own.width === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      // Seen only while focused (the skip link after ‹ ›): measured then, by panel.spec.
      if (style.clipPath === 'inset(50%)' && document.activeElement !== el) continue;
      if (el.matches('section, h2')) continue; // focusable for scripts and screen readers, not controls
      let { left, top, right, bottom } = own;
      const after = getComputedStyle(el, '::after');
      if (after.content !== 'none' && after.position === 'absolute' && after.pointerEvents !== 'none') {
        // Its box: the used inset from the control's padding box (it's position: relative).
        const w = parseFloat(after.width);
        const h = parseFloat(after.height);
        const x = own.left + el.clientLeft + parseFloat(after.left) - (after.translate.startsWith('-50%') ? w / 2 : 0);
        const y = own.top + el.clientTop + parseFloat(after.top) - (after.translate.endsWith('-50%') ? h / 2 : 0);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + w);
        bottom = Math.max(bottom, y + h);
      }
      const name = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
      // labels.ts cuts a label's target back off any other model's box on screen, so a tap on
      // that model reaches it (never under 24 px): its uncut 44 px box has to meet one.
      let cut = false;
      const go = el.matches('button.label') ? el.dataset.go : undefined;
      if (go && window.__map) {
        const { stage, nodes } = window.__map;
        const cx = (own.left + own.right) / 2;
        const cy = (own.top + own.bottom) / 2;
        const half = Math.max(own.width, 44) / 2;
        cut = nodes.all().some((n) => {
          if (n.id === go) return false;
          const xs: number[] = [];
          const ys: number[] = [];
          const b = n.bounds;
          for (let c = 0; c < 8; c++) {
            const v = n.root.position.clone().set(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z);
            n.root.localToWorld(v).project(stage.camera);
            xs.push(((v.x + 1) / 2) * stage.viewport.width);
            ys.push(((1 - v.y) / 2) * stage.viewport.height);
          }
          return Math.min(...xs) < cx + half && Math.max(...xs) > cx - half && Math.min(...ys) < cy + 22 && Math.max(...ys) > cy - 22;
        });
      }
      out.push({ name, width: right - left, height: bottom - top, cut });
    }
    return out;
  });

const small = (list: Awaited<ReturnType<typeof targets>>, where: string) =>
  list.filter((t) => t.width < 44 - 0.01 || t.height < 44 - 0.01).map((t) => `${where}: ${t.name} ${t.width.toFixed(2)}×${t.height.toFixed(2)}`);

test('every interactive control is ≥ 44×44 px', async ({ browser }) => {
  test.setTimeout(120_000);
  const found: string[] = [];
  for (const [size, touch] of [
    [DESKTOP, false],
    [PHONE, true],
  ] as const) {
    const context = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    await open(page, '', size);
    for (const id of [null, 'fettle', ...STATIONS]) {
      await visit(page, id, size);
      const list = await targets(page);
      expect(list.length, 'controls measured').toBeGreaterThan(3);
      // A label cut back off a neighbouring model keeps WCAG 2.5.8's 24 px: that cut is how a
      // tap on the model reaches it (Phase 1).
      found.push(...small(list.filter((t) => !t.cut), `${size.width} ${id ?? 'overview'}`));
      for (const t of list.filter((t) => t.cut)) {
        if (t.width < 24 || t.height < 24) found.push(`${size.width} ${id ?? 'overview'}: ${t.name} cut to ${t.width.toFixed(2)}×${t.height.toFixed(2)}`);
      }
    }
    await context.close();

    // The plain page, at the same size.
    const plain = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, javaScriptEnabled: false });
    const p = await plain.newPage();
    await p.goto('/');
    found.push(...small(await targets(p), `plain ${size.width}`));
    await plain.close();
  }
  expect(found).toEqual([]);
});

/** WCAG relative luminance of an sRGB colour, 0–255 a channel. */
const luminance = (c: number[]) =>
  c.slice(0, 3).reduce((sum, v, i) => {
    const s = v / 255;
    return sum + [0.2126, 0.7152, 0.0722][i]! * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  }, 0);
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

test("a label on its model's contact shadow still reads at 4.5:1: its halo of the floor's colour lies behind its words, light and dark", async ({ page }) => {
  // The audit's item 5: at Siel Eolie, in light, its current label lay on the shadow at about 2.4:1.
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await open(page, '#siel-eolie');
    await page.evaluate((s) => window.__map!.advance(s), 1);
    await page.evaluate(() => document.fonts.ready);
    const label = page.locator('button.label[data-go="siel-eolie"] .name');
    const fg = (await label.evaluate((el) => getComputedStyle(el).color)).match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const box = await label.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) };
    });
    const shot = async (css: string) => {
      const tag = await page.addStyleTag({ content: css });
      const png = await page.screenshot({ clip: box });
      await tag.evaluate((el) => (el as Element).remove());
      return sharp(png).raw().toBuffer({ resolveWithObject: true });
    };
    // What's behind the words: the label's own text made transparent, its halo still drawn; and
    // where its glyphs are: the text in magenta, no halo.
    const { data, info } = await shot('.label, .label * { color: transparent !important; }');
    const ink = (await shot('.label, .label * { color: #f0f !important; text-shadow: none !important; -webkit-text-stroke: 0 !important; }')).data;
    const glyph = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= info.width || y >= info.height) return false;
      const i = (y * info.width + x) * info.channels;
      return ink[i]! > 180 && ink[i + 1]! < 90 && ink[i + 2]! > 180;
    };
    const all: number[] = [];
    const edge: number[] = []; // within 2 px of a glyph: what its strokes read against
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        const r = contrast(fg, [data[i]!, data[i + 1]!, data[i + 2]!]);
        all.push(r);
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) near = glyph(x + dx, y + dy);
        if (near && !glyph(x, y)) edge.push(r);
      }
    all.sort((a, b) => a - b);
    edge.sort((a, b) => a - b);
    expect(edge.length).toBeGreaterThan(50);
    expect(all[Math.floor(all.length / 2)], `${colorScheme}: the median behind the label`).toBeGreaterThanOrEqual(4.5);
    expect(edge[Math.floor(edge.length / 10)], `${colorScheme}: the darkest tenth round its glyphs`).toBeGreaterThanOrEqual(4.5);
  }
});

test('no rAF is scheduled while the document is hidden', async ({ page }) => {
  // The real clock (no ?test): the page's own requestAnimationFrame calls are counted.
  await page.addInitScript(() => {
    const w = window as unknown as { __rafsHidden: number };
    w.__rafsHidden = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      if (document.hidden) w.__rafsHidden++;
      return raf(cb);
    };
  });
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(() => window.__map!.nodes.ready);
  // Running: traffic and drift keep frames coming.
  const f0 = await page.evaluate(() => window.__map!.clock.frames);
  await expect.poll(() => page.evaluate(() => window.__map!.clock.frames)).toBeGreaterThan(f0 + 10);

  // A real background tab stays `visible` in headless Chromium, so hide it by hand, as the
  // browser would: document.hidden, then the event. rAF keeps firing, so the page must stop.
  const setHidden = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  const hiddenAt = await page.evaluate(() => window.__map!.clock.frames);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__map!.clock.frames)).toBe(hiddenAt);
  expect(await page.evaluate(() => (window as unknown as { __rafsHidden: number }).__rafsHidden)).toBe(0);

  await setHidden(false);
  await expect.poll(() => page.evaluate(() => window.__map!.clock.frames)).toBeGreaterThan(hiddenAt + 10);
});
