import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type
import type {} from '../../src/moments/sound'; // window.__sound's
import type {} from '../../src/sound-toggle'; // window.soundContext's

// Task 17's sound (approved by the owner 2026-10-20): a header toggle named "Sound", off by default
// and kept in localStorage.sound; nothing audio, not even an AudioContext, until it's on; quiet;
// muted while the tab is hidden; no toggle on the plain page.

declare global {
  interface Window {
    __contexts?: number;
  }
}

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const toggle = (page: Page) => page.getByRole('button', { name: 'Sound', exact: true });

/** Counts AudioContexts made (and OfflineAudioContexts, which would be audio work too). */
async function countContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__contexts = 0;
    for (const name of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext'] as const) {
      const Real = (window as unknown as Record<string, typeof AudioContext | undefined>)[name];
      if (!Real) continue;
      (window as unknown as Record<string, unknown>)[name] = new Proxy(Real, {
        construct(target, args) {
          window.__contexts! += 1;
          return Reflect.construct(target, args) as object;
        },
      });
    }
  });
}

/** Requests for audio files, or for the sound engine's own code. */
function audioRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (/\/sounds\/|\.(webm|ogg|opus|mp3|wav|m4a)(\?|$)|\/moments\/sound|\/sound-[\w-]+\.js/.test(url)) seen.push(url);
  });
  return seen;
}

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

/** Flies to `id` on the manual clock and lands. */
async function settleAt(page: Page, id: string): Promise<void> {
  await page.evaluate((to) => {
    const { stations, director, advance } = window.__map!;
    stations.go(to);
    for (let i = 0; i < 600 && director.state !== 'station'; i++) advance(1 / 60);
  }, id);
  await page.evaluate(() => window.__map!.advance(3));
}

/** What the engine has played so far (under ?test). */
const played = (page: Page) => page.evaluate(() => window.__sound?.played ?? []);

/** Makes the page think the tab is hidden (or shown again), as a tab switch does. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const ctxState = (page: Page) => page.evaluate(() => window.soundContext?.state ?? null);

test('no audio requests before the toggle is on', async ({ page }) => {
  test.setTimeout(90_000);
  await countContexts(page);
  const audio = audioRequests(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  // A visit with every made sound's clip: travel (the dock), a poke, the power switch.
  await settleAt(page, 'notary');
  await page.evaluate(() => window.__map!.nodes.get('notary').poke(null));
  await settleAt(page, 'origin');
  await page.getByRole('button', { name: 'Turn it off and on again' }).click();
  await page.evaluate(() => window.__map!.advance(8));
  await page.mouse.click(300, 700); // gestures don't start it either
  await page.keyboard.press('Shift');
  await page.waitForTimeout(500);
  expect(audio).toEqual([]);
  expect(await page.evaluate(() => window.__contexts)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('sound'))).toBeNull();

  // On: the context starts in the click, and the engine comes in.
  await toggle(page).click();
  await expect.poll(() => page.evaluate(() => window.__contexts)).toBe(1);
  await expect.poll(() => audio.length).toBeGreaterThan(0);
  expect(audio.every((u) => !/\.(webm|ogg|opus|mp3|wav|m4a)/.test(u))).toBe(true); // no recordings yet: no audio file
});

test('the toggle is a 44×44 button named Sound with aria-pressed; click, Enter and Space switch it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const t = toggle(page);
  await expect(t).toBeVisible();
  await expect(t).toHaveAttribute('aria-pressed', 'false');
  expect(await t.textContent()).toBe(''); // icon only: its name is its label
  const box = (await t.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await t.click();
  await expect(t).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-sound', 'on');
  await t.focus();
  await page.keyboard.press('Enter');
  await expect(t).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space');
  await expect(t).toHaveAttribute('aria-pressed', 'true');
  // The icon shows the state: waves when on, crossed out when off.
  await expect(t.locator('.waves')).toBeVisible();
  await expect(t.locator('.cross')).toBeHidden();
  await t.click();
  await expect(t.locator('.waves')).toBeHidden();
  await expect(t.locator('.cross')).toBeVisible();
});

test('desktop: on the map side at the header’s end, beside the panel’s rule, on the pill’s line', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const box = (await toggle(page).boundingBox())!;
  const panel = (await page.locator('#stations').boundingBox())!;
  const pill = (await page.getByRole('group', { name: 'Theme' }).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(panel.x); // the map's side of the rule
  expect(panel.x - (box.x + box.width)).toBeLessThan(24); // and right beside it
  expect(Math.abs(box.y + box.height / 2 - (pill.y + pill.height / 2))).toBeLessThan(1.5);
  // In the tab order between the wordmark and the theme switch.
  const order = await page.locator('header.top').evaluate((h) =>
    [...h.querySelectorAll('button, a')].map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim().split(/\s/)[0]),
  );
  expect(order.slice(0, 2)).toEqual(['Sound', 'Auto']);
});

test('phone: in the theme pill’s row, to its left, and gone with it at a station', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, PHONE);
  const box = (await toggle(page).boundingBox())!;
  const pill = (await page.getByRole('group', { name: 'Theme' }).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(pill.x);
  expect(pill.x - (box.x + box.width)).toBeLessThan(16);
  expect(Math.abs(box.y + box.height / 2 - (pill.y + pill.height / 2))).toBeLessThan(1.5);
  // The row is no taller for it.
  const row = (await page.locator('.theme-row').boundingBox())!;
  expect(row.height).toBeCloseTo(pill.height, 0);

  await page.evaluate(() => window.__map!.stations.go('homelab'));
  await page.evaluate((s) => window.__map!.advance(s), tuning.flight.max + 0.2);
  await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe('homelab');
  await expect(toggle(page)).toBeHidden();
  await page.evaluate(() => window.__map!.stations.overview());
  await page.evaluate((s) => window.__map!.advance(s), tuning.flight.max + 0.2);
  await expect(toggle(page)).toBeVisible();
});

test('the choice survives a reload; the context then waits for the first gesture', async ({ page }) => {
  await countContexts(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await toggle(page).click();
  expect(await page.evaluate(() => localStorage.getItem('sound'))).toBe('on');
  await page.reload();
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__contexts)).toBe(0); // no gesture yet
  await page.mouse.click(300, 700);
  await expect.poll(() => page.evaluate(() => window.__contexts)).toBe(1);
  await expect.poll(() => ctxState(page)).toBe('running');

  // Off is kept too.
  await toggle(page).click();
  expect(await page.evaluate(() => localStorage.getItem('sound'))).toBeNull();
  await page.reload();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
});

test('sounds play on their clips, and stop while sound is off or the tab is hidden', async ({ page }) => {
  test.setTimeout(120_000); // two flights and a reboot, frame by frame
  await open(page);
  await toggle(page).click();
  await expect.poll(() => ctxState(page)).toBe('running');
  await expect.poll(() => page.evaluate(() => !!window.__sound)).toBe(true);

  await settleAt(page, 'notary');
  await page.evaluate(() => window.__map!.nodes.get('notary').poke(null));
  expect(await played(page)).toContain('notary poke stamp');
  expect(await played(page)).toContain('visitor dock dock'); // the gondola docked there

  // Hidden: suspended, and nothing is scheduled.
  await setHidden(page, true);
  await expect.poll(() => ctxState(page)).toBe('suspended');
  const before = (await played(page)).length;
  await page.evaluate(() => window.__map!.nodes.get('notary').poke(null));
  expect((await played(page)).length).toBe(before);
  await setHidden(page, false);
  await expect.poll(() => ctxState(page)).toBe('running');

  // Off: the same.
  await toggle(page).click();
  await expect.poll(() => ctxState(page)).toBe('suspended');
  await page.evaluate(() => window.__map!.nodes.get('notary').poke(null));
  expect((await played(page)).length).toBe(before);

  // The power switch: the cover, the relay and the hum, and the POST beep at the end.
  await toggle(page).click();
  await expect.poll(() => ctxState(page)).toBe('running');
  await settleAt(page, 'origin');
  await page.getByRole('button', { name: 'Turn it off and on again' }).click();
  await expect.poll(() => played(page)).toContain('origin poke_power snap'); // once its chunk is in
  await page.evaluate(() => window.__map!.advance(9));
  const power = await played(page);
  for (const s of ['origin poke_power snap', 'origin off relay', 'origin off humDown', 'origin on humUp', 'power post beep'])
    expect(power).toContain(s);
});

test('every station’s made sounds play on its clips, and the plane’s trip has its own', async ({ page }) => {
  test.setTimeout(180_000); // seven flights and a plane trip, frame by frame
  await open(page);
  await toggle(page).click();
  await expect.poll(() => ctxState(page)).toBe('running');
  await expect.poll(() => page.evaluate(() => !!window.__sound)).toBe(true);
  const pokes: [string, string | null, string][] = [
    ['idiff', null, 'idiff poke slide'],
    ['eolietech', null, 'eolietech poke postcard'],
    ['desktop', null, 'desktop poke fans'],
    ['switch', 'cable', 'switch poke_cable plug'],
    ['experiments', 'keyboard', 'experiments poke_keyboard key'],
    ['colophon', null, 'colophon poke riffle'],
    ['exit', null, 'exit poke knock'],
  ];
  for (const [id, part, want] of pokes) {
    await settleAt(page, id);
    await page.evaluate(([i, p]) => window.__map!.nodes.get(i!).poke(p), [id, part] as const);
    expect(await played(page), id).toContain(want);
  }
  // Secret 3: Enter on the bot's label pokes the plane, then the stand, in turn; twice the stand
  // launches it (moments/plane.ts), and its trip cues its own sounds out, onto the lid and home.
  await settleAt(page, 'candygoogy-bot');
  expect(await played(page)).toContain('candygoogy-bot arrive whoosh');
  await page.locator('button.label[data-go="candygoogy-bot"]').focus();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.__map!.advance(1.4, 1 / 30));
  }
  await expect.poll(() => played(page)).toContain('plane out whoosh');
  for (let i = 0; i < 40 && !(await played(page)).includes('plane home tap'); i++) await page.evaluate(() => window.__map!.advance(0.25, 1 / 30));
  const trip = await played(page);
  for (const s of ['candygoogy-bot poke whoosh', 'candygoogy-bot poke_stand click', 'plane lid pat', 'plane home tap']) expect(trip).toContain(s);
});

// The levels' rule (sound-synth.ts, TRIM_DB): nothing over about −18 LUFS momentary, the short
// ones set by their peaks, and headroom left for the variation and for hits that overlap.
test('every made sound is quiet: −18 LUFS momentary at most, peaks under −3 dBFS', async ({ page }) => {
  await page.goto('/?test');
  const levels = await page.evaluate(async () => {
    // The dev server's own modules (the levels don't depend on the build).
    const from = (path: string) => import(/* @vite-ignore */ path);
    const synth = (await from('/src/moments/sound-synth.ts')) as typeof import('../../src/moments/sound-synth');
    const engine = (await from('/src/moments/sound.ts')) as typeof import('../../src/moments/sound');
    const rate = 48000;
    const out: Record<string, { lufs: number; peak: number }> = {};
    for (const id of Object.keys(synth.SOUNDS) as (keyof typeof synth.SOUNDS)[]) {
      const length = 3.2;
      // As the engine plays it (its master level), then K-weighted for the loudness.
      const render = async (weighted: boolean) => {
        const ctx = new OfflineAudioContext(1, rate * length, rate);
        const master = ctx.createGain();
        master.gain.value = engine.MASTER;
        let tail: AudioNode = ctx.destination;
        if (weighted) {
          const shelf = ctx.createBiquadFilter();
          shelf.type = 'highshelf';
          shelf.frequency.value = 1681.97;
          shelf.gain.value = 4;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 38.13;
          hp.Q.value = 0.5;
          shelf.connect(hp).connect(ctx.destination);
          tail = shelf;
        }
        master.connect(tail);
        synth.make(ctx, master, id, 0.05, 1); // each at its own length (feed's a line, 0.125 s)
        return (await ctx.startRendering()).getChannelData(0);
      };
      const raw = await render(false);
      const k = await render(true);
      let peak = 0;
      for (const v of raw) peak = Math.max(peak, Math.abs(v));
      // Momentary loudness: the mean square over 400 ms windows, every 100 ms; the loudest.
      const win = 0.4 * rate;
      let best = 0;
      for (let s = 0; s + win <= k.length; s += 0.1 * rate) {
        let sum = 0;
        for (let i = s; i < s + win; i++) sum += k[i]! * k[i]!;
        best = Math.max(best, sum / win);
      }
      out[id] = { lufs: -0.691 + 10 * Math.log10(best), peak: 20 * Math.log10(peak) };
    }
    return out;
  });
  console.info(Object.entries(levels).map(([id, l]) => `${id} ${l.lufs.toFixed(1)} LUFS, peak ${l.peak.toFixed(1)} dBFS`).join('\n'));
  for (const [id, l] of Object.entries(levels)) {
    expect(l.peak, `${id}'s peak`).toBeLessThanOrEqual(-3);
    expect(l.peak, `${id}'s peak`).toBeGreaterThanOrEqual(-14); // heard at all
    expect(l.lufs, `${id}'s loudness`).toBeLessThanOrEqual(-17.5);
    expect(l.lufs, `${id}'s loudness`).toBeGreaterThanOrEqual(-35);
  }
});

/** Each sound's longest, in seconds, from its start to where it has died 50 dB under its peak. */
const CAP: Record<string, number> = {
  clack: 0.1,
  snap: 0.1,
  relay: 0.25,
  humDown: 1.6,
  humUp: 2.7,
  beep: 0.2,
  dock: 0.25,
  stamp: 0.3,
  tap: 0.1,
  thump: 0.15,
  breaker: 0.1,
  rcd: 0.2,
  click: 0.05,
  feed: 0.2,
  slide: 0.3,
  flick: 0.15,
  pat: 0.15,
  whoosh: 0.6,
  postcard: 0.12,
  fans: 1.5,
  plug: 0.08,
  key: 0.08,
  riffle: 0.3,
  chain: 0.35,
  knock: 0.15,
  latch: 0.06,
  tear: 0.17,
};

// Every sound is made in code (the owner, 2026-10-21): each rendered offline as the engine makes
// it, then every clip's cue as it plays them, overlaps and all.
test('every made sound renders: not silent, not clipped, short; and no clip’s cue clips', async ({ page }) => {
  await page.goto('/?test');
  const { sounds, cues } = await page.evaluate(async () => {
    const from = (path: string) => import(/* @vite-ignore */ path);
    const synth = (await from('/src/moments/sound-synth.ts')) as typeof import('../../src/moments/sound-synth');
    const engine = (await from('/src/moments/sound.ts')) as typeof import('../../src/moments/sound');
    const rate = 48000;
    const lead = 0.05;
    const render = async (length: number, draw: (ctx: OfflineAudioContext, out: AudioNode) => void) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(rate * length), rate);
      const master = ctx.createGain();
      master.gain.value = engine.MASTER;
      master.connect(ctx.destination);
      draw(ctx, master);
      const data = (await ctx.startRendering()).getChannelData(0);
      let peak = 0;
      let finite = true;
      for (const v of data) {
        if (!Number.isFinite(v)) finite = false;
        peak = Math.max(peak, Math.abs(v));
      }
      let last = 0;
      for (let i = data.length - 1; i >= 0; i--)
        if (Math.abs(data[i]!) > peak * 10 ** (-50 / 20)) {
          last = i;
          break;
        }
      return { peak: 20 * Math.log10(peak), length: last / rate - lead, finite, tail: Math.abs(data[data.length - 1]!) };
    };
    const sounds: Record<string, Awaited<ReturnType<typeof render>>> = {};
    for (const id of Object.keys(synth.SOUNDS) as (keyof typeof synth.SOUNDS)[])
      sounds[id] = await render(3.2, (ctx, out) => synth.make(ctx, out, id, lead, 1));
    const cues: Record<string, Awaited<ReturnType<typeof render>>> = {};
    for (const [key, hits] of Object.entries(engine.CUES)) {
      const end = Math.max(...hits.map((h) => h.at + (h.length ?? 0))) + 3;
      cues[key] = await render(end, (ctx, out) => {
        for (const h of hits) {
          const level = ctx.createGain();
          level.gain.value = 10 ** ((h.gain ?? 0) / 20);
          level.connect(out);
          synth.make(ctx, level, h.sound, lead + h.at, 1, h.length);
        }
      });
    }
    return { sounds, cues };
  });
  console.info(Object.entries(sounds).map(([id, r]) => `${id} ${(r.length * 1000).toFixed(0)} ms, peak ${r.peak.toFixed(1)} dBFS`).join('\n'));
  expect(Object.keys(sounds).sort()).toEqual(Object.keys(CAP).sort());
  for (const [id, r] of Object.entries(sounds)) {
    expect(r.finite, `${id} renders numbers`).toBe(true);
    expect(r.peak, `${id} isn't silent`).toBeGreaterThan(-20);
    expect(r.peak, `${id} isn't clipped`).toBeLessThan(-3);
    expect(r.length, `${id}'s length`).toBeGreaterThan(0.005);
    expect(r.length, `${id}'s length`).toBeLessThanOrEqual(CAP[id]!);
    expect(r.tail, `${id} has died away`).toBeLessThan(1e-4);
  }
  // A clip's sounds together, overlaps and all, keep their headroom for the ±1.5 dB variation.
  for (const [key, r] of Object.entries(cues)) {
    expect(r.finite, key).toBe(true);
    expect(r.peak, `${key}'s peak`).toBeLessThan(-2);
  }
});

test('axe: zero violations with the toggle, on and off, light and dark, desktop and phone', async ({ page }) => {
  test.setTimeout(90_000);
  const found: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    for (const size of [DESKTOP, PHONE]) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await open(page, size);
      for (const state of ['off', 'on']) {
        if (state === 'on') await toggle(page).click();
        const { violations } = await new AxeBuilder({ page }).include('header.top').analyze();
        found.push(...violations.map((v) => `${size.width} ${scheme} ${state}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`));
      }
      await toggle(page).click();
    }
  }
  expect(found).toEqual([]);
});

test.describe('without JS', () => {
  test.use({ javaScriptEnabled: false });

  test('there is no toggle', async ({ page }) => {
    await page.goto('/');
    await expect(toggle(page)).toBeHidden();
  });
});
