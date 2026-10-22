import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../src/copy';
import world from '../../src/data/world.json' with { type: 'json' };
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// The camera director (Task 9): the arrival, flights along the links, the sheet that opens as
// the camera settles, drift, and reduced motion. On the manual clock (?test) unless a test
// needs the real one (rAF counting under reduced motion).

declare global {
  interface Window {
    __rafs?: number;
  }
}

type Size = { width: number; height: number };
const DESKTOP: Size = { width: 1440, height: 900 };
const PHONE: Size = { width: 390, height: 844 };
const FRAME = 1 / 60;

/** Opens the map under ?test and waits until the arrival can start (models and camera clip in). */
async function open(page: Page, size: Size = DESKTOP, hash = ''): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?test${hash}`);
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(() => window.__map!.director.ready);
}

const advance = (page: Page, seconds: number) => page.evaluate((s) => window.__map!.advance(s), seconds);
const state = (page: Page) => page.evaluate(() => window.__map!.director.state);

/** How far the camera stands from the fitted framing of `id` (null: the overview). */
/** How far the camera is from station `id`'s framing, or (null) from the overview's home: the
 *  composed overview, but on a phone its closer start (decided 2026-10-22 morning). */
const offFraming = (page: Page, id: string | null) =>
  page.evaluate((id) => {
    const { director, stage } = window.__map!;
    const f = director.framing(id);
    if (id === null) {
      const { zoom, target } = director.home;
      f.position.sub(f.target).multiplyScalar(zoom).add(target);
    }
    return stage.camera.position.distanceTo(f.position);
  }, id);

test('at 390×844, after the arrival, every node label’s box is inside the viewport and above the peek sheet', async ({ page }) => {
  await open(page, PHONE);
  await advance(page, world.arrival.portrait.clipLength + 0.2);
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.__map!.advance(1 / 60); // the labels re-measure with the web fonts
  });
  expect(await state(page)).toBe('overview');

  const sheetTop = PHONE.height * (1 - tuning.sheetPeek);
  const labels = page.locator('nav .labels li:not([hidden])'); // not the hidden duck's or the stray's (Task 17)
  const count = await labels.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const item = labels.nth(i);
    const id = await item.locator('button.label').getAttribute('data-go');
    await expect(item, `${id} is out of sight`).not.toHaveAttribute('data-off');
    const b = (await item.locator('button.label').boundingBox())!;
    expect(b.x, `${id} left`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${id} top`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${id} right`).toBeLessThanOrEqual(PHONE.width);
    expect(b.y + b.height, `${id} under the sheet`).toBeLessThanOrEqual(sheetTop);
  }
});

test('at 390×844, flying to fettle opens the sheet to 45% as the camera settles, and Escape collapses it back to the peek', async ({ page }) => {
  await open(page, PHONE);
  await page.evaluate(() => window.__map!.director.skipArrival());
  await advance(page, FRAME);
  const peek = PHONE.height * tuning.sheetPeek;
  const opened = PHONE.height * tuning.sheetOpen;
  const bottom = () => page.evaluate(() => window.__map!.stage.inset.bottom);

  await page.evaluate(() => window.__map!.stations.go('fettle'));
  expect(await state(page)).toBe('flying');
  const duration = await page.evaluate(() => window.__map!.director.flight!.duration);

  // While the camera travels the map keeps the screen: the sheet stays at its peek ...
  await advance(page, duration - tuning.sheetSeconds - 0.05);
  expect(await bottom()).toBeCloseTo(peek, 3);
  expect(await page.locator('#stations').getAttribute('data-sheet')).toBe('peek');
  // ... and opens over the flight's last tuning.sheetSeconds, done as the camera lands.
  await advance(page, 0.05 + tuning.sheetSeconds / 2);
  expect(await bottom()).toBeGreaterThan(peek);
  expect(await bottom()).toBeLessThan(opened);
  expect(await page.locator('#stations').getAttribute('data-sheet')).toBe('open');
  await advance(page, tuning.sheetSeconds / 2 + FRAME);
  expect(await state(page)).toBe('station');
  expect(await bottom()).toBeCloseTo(opened, 3);
  expect(await offFraming(page, 'fettle')).toBeLessThan(1e-6);

  await page.keyboard.press('Escape');
  expect(await page.locator('#stations').getAttribute('data-sheet')).toBe('peek');
  await advance(page, tuning.sheetSeconds + FRAME);
  expect(await bottom()).toBeCloseTo(peek, 3);
  await advance(page, tuning.flight.max);
  expect(await state(page)).toBe('overview');
  expect(await offFraming(page, null)).toBeLessThan(1e-6);
});

test('arrival ends in overview by world.arrival.clipLength + 0.2 s', async ({ page }) => {
  await open(page);
  expect(await state(page)).toBe('arrival');
  await advance(page, world.arrival.clipLength - 0.1);
  expect(await state(page)).toBe('arrival');
  await advance(page, 0.3);
  expect(await state(page)).toBe('overview');
  expect(await offFraming(page, null)).toBeLessThan(1e-6);
  // Every link drawn and every model standing.
  const all = await page.evaluate(() => {
    const { stations, links, nodes } = window.__map!;
    return stations.ids.every((id) => (id === 'origin' || links.progress(id) === 1) && nodes.get(id).root.visible);
  });
  expect(all).toBe(true);
});

// The zoom chunk carries the pull's stop at the neighbours' rings, and a mouse pulls at once:
// so it's fetched as the arrival ends in the overview, not at the first press (map.ts).
test('the zoom chunk is fetched as the arrival ends in the overview, before any press, and not before', async ({ page }) => {
  const isZoom = (url: string) => /\/input\/zoom\.ts$|\/zoom-[\w-]+\.js$/.test(new URL(url).pathname);
  const fetched: string[] = [];
  page.on('request', (r) => void (isZoom(r.url()) && fetched.push(r.url())));
  await open(page);
  await advance(page, world.arrival.clipLength - 0.1);
  expect(await state(page)).toBe('arrival');
  expect(fetched).toEqual([]);
  const request = page.waitForRequest((r) => isZoom(r.url()), { timeout: 5_000 });
  await advance(page, 0.3);
  expect(await state(page)).toBe('overview');
  await request; // with no press, wheel or key
  expect(fetched).toHaveLength(1);
});

test('each node’s appear starts within one frame of its reach_<id> marker', async ({ page }) => {
  await open(page);
  const seen = await page.evaluate(async (end) => {
    const { director, nodes, stations, advance } = window.__map!;
    const at: Record<string, number> = {};
    // Already standing as the arrival starts (the origin's reach is 0): its time is the start.
    for (const id of stations.ids) if (nodes.get(id).root.visible) at[id] = director.arrivalTime ?? -1;
    while (director.state === 'arrival' && (director.arrivalTime ?? 0) < end) {
      advance(1 / 60);
      await new Promise((r) => setTimeout(r, 0)); // play() starts the clip a microtask later
      const t = director.arrivalTime ?? end;
      for (const id of stations.ids) if (!(id in at) && nodes.get(id).root.visible) at[id] = t;
    }
    return at;
  }, world.arrival.clipLength);
  for (const [id, reach] of Object.entries(world.arrival.reach)) {
    expect(seen[id], `${id} never appeared`).toBeDefined();
    expect(seen[id]! - reach, `${id} appeared early`).toBeGreaterThanOrEqual(0);
    expect(seen[id]! - reach, `${id} appeared late`).toBeLessThanOrEqual(FRAME + 1e-6);
  }
});

// The load order (the owner's model budgets): the arrival doesn't wait past tuning.arrivalLoadWait
// for a model that's slow to come in; that one plays its `appear` once it's in, and the overview
// takes in its bounds.
test('a model still loading when the arrival starts rises once it is in, and the overview frames it', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/models/exit.glb*', async (route) => {
    await held;
    await route.continue();
  });
  await page.setViewportSize(DESKTOP);
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.director.arrivalTime != null, null, { timeout: 30_000 });
  await advance(page, world.arrival.clipLength + 0.2);
  expect(await state(page)).toBe('overview');
  // The arrival's end lets every status go to "Working" (finishArrival), its model in or not.
  const visible = () => page.evaluate(() => window.__map!.nodes.get('exit').root.visible);
  expect(await visible()).toBe(false);
  release();
  await page.evaluate(() => window.__map!.director.ready);
  await page.evaluate(async (frame) => {
    window.__map!.advance(frame);
    await new Promise((r) => setTimeout(r, 0)); // play() starts the clip a microtask later
    window.__map!.advance(1);
    await new Promise((r) => setTimeout(r, 0));
  }, FRAME);
  expect(await visible()).toBe(true);
  expect(await page.evaluate(() => window.__map!.nodes.get('exit').playing)).not.toBe('appear'); // played, now idle
  expect(await offFraming(page, null)).toBeLessThan(1e-6);
});

// A model in while the arrival plays joins its framing over tuning.arrivalJoin: on a phone the
// overview's fit moves with the models' bounds, and in one frame that would be a jump. Frame by
// frame, the camera's step differs from an arrival with every model in by a little at a time.
test('at 390×844, a model in mid-arrival eases the framing: no jump against an arrival with every model in', async ({ page }) => {
  const path = async (hold: boolean): Promise<number[][]> => {
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    if (hold) await page.route('**/models/colophon.glb*', async (route) => (await held, route.continue()));
    await page.setViewportSize(PHONE);
    await page.goto('/?test');
    await page.waitForFunction(() => window.__map?.director.arrivalTime != null, null, { timeout: 30_000 });
    if (!hold) await page.evaluate(() => window.__map!.director.ready);
    await advance(page, 0.5);
    if (hold) {
      release();
      await page.evaluate(() => window.__map!.nodes.get('colophon').ready);
    }
    const out = await page.evaluate(async (frame) => {
      const { director, stage, advance } = window.__map!;
      const at: number[][] = [stage.camera.position.toArray()];
      while (director.state === 'arrival') {
        advance(frame);
        await new Promise((r) => setTimeout(r, 0));
        at.push(stage.camera.position.toArray());
      }
      return at;
    }, FRAME);
    await page.unrouteAll();
    return out;
  };
  const all = await path(false);
  const joined = await path(true);
  const off = joined.map((p, i) => Math.hypot(...p.map((v, k) => v - all[Math.min(i, all.length - 1)]![k]!)));
  // How far the joined path is from the other: it may start apart, and must close in small steps.
  const jumps = off.slice(1).map((d, i) => Math.abs(d - off[i]!));
  expect(off.at(-1)!).toBeLessThan(1e-3);
  expect(Math.max(...jumps)).toBeLessThan(off[0]! / 10 + 1e-3);
});

test('a click during arrival skips to overview immediately', async ({ page }) => {
  await open(page);
  await advance(page, 0.5);
  expect(await state(page)).toBe('arrival');
  await page.mouse.click(60, DESKTOP.height - 60);
  expect(await state(page)).toBe('overview');
  expect(await offFraming(page, null)).toBeLessThan(1e-6);
  const all = await page.evaluate(() => {
    const { stations, links, nodes } = window.__map!;
    return stations.ids.every((id) => (id === 'origin' || links.progress(id) === 1) && nodes.get(id).root.visible);
  });
  expect(all).toBe(true);
});

// A skip lands the statuses in the overview's state at once: "Working", let go. No line reads
// "Checking…" after it, and none comes into sight (a model brought in by the skip showed its
// pinned line as its label faded in, then lost it; the rest crossfaded to "Working" and dropped
// it 40 ms later). Sampled in real time: the let-go, the fades and the labels' fade-in are.
test('a skip early, mid or late in the arrival lands every status at once: no "Checking…", nothing flashing in', async ({ page }) => {
  const skips: [number, (page: Page) => Promise<void>][] = [
    [0.5, (p) => p.mouse.click(60, DESKTOP.height - 60)],
    [1.4, (p) => p.mouse.click(60, DESKTOP.height - 60, { button: 'right' })],
    [2.6, async (p) => (await p.mouse.move(60, DESKTOP.height - 60), p.mouse.wheel(0, -100))],
  ];
  for (const [at, skip] of skips) {
    await open(page);
    await advance(page, at);
    expect(await state(page)).toBe('arrival');
    await skip(page);
    expect(await state(page)).toBe('overview');
    const samples = await page.evaluate(async (frame) => {
      const { advance } = window.__map!;
      const opacity = (e: Element | null) => (e ? Number(getComputedStyle(e).opacity) : 1);
      const sample = () =>
        [...document.querySelectorAll('nav .labels li:not([hidden])')].map((li) => {
          const label = li.querySelector('button.label');
          const lines = [...li.querySelectorAll('.status')].map((s) => ({
            text: s.textContent ?? '',
            seen: opacity(li) * opacity(label) * opacity(s),
          }));
          return { id: label?.getAttribute('data-go') ?? '', pinned: li.hasAttribute('data-pinned'), lines };
        });
      const out = [sample()];
      for (let i = 0; i < 20; i++) {
        advance(frame);
        await new Promise((r) => setTimeout(r, 25));
        out.push(sample());
      }
      return out;
    }, FRAME);
    const was = new Map<string, number>();
    samples.forEach((labels, i) => {
      for (const { id, pinned, lines } of labels) {
        const where = `${id}, skipped at ${at} s, sample ${i}`;
        expect(pinned, where).toBe(false);
        for (const l of lines) expect(l.text === copy.checking.text && l.seen > 0.01, `"Checking…" in sight: ${where}`).toBe(false);
        expect(lines.map((l) => l.text), where).toEqual([copy.working.text]);
        const seen = Math.max(0, ...lines.map((l) => l.seen));
        expect(seen, `status line comes into sight: ${where}`).toBeLessThanOrEqual((was.get(id) ?? 0) + 0.01);
        was.set(id, seen);
      }
    });
  }
});

// A wheel skips it too, and doesn't zoom: neither the wheel that skipped nor a trackpad's coast
// after it, for tuning.wheelAfterSkip (real time: a coast is the visitor's, not the clock's).
test('a wheel during arrival skips to overview immediately, and zooms nothing until tuning.wheelAfterSkip has passed', async ({ page }) => {
  await open(page);
  await advance(page, 0.5);
  expect(await state(page)).toBe('arrival');
  await page.mouse.move(60, DESKTOP.height - 60);
  expect(await page.evaluate(() => document.elementFromPoint(60, innerHeight - 60) === window.__map!.stage.renderer.domElement)).toBe(true);
  await page.mouse.wheel(0, -100);
  expect(await state(page)).toBe('overview');
  expect(await offFraming(page, null)).toBeLessThan(1e-6);
  await page.mouse.wheel(0, -100); // the coast, inside the window
  const zoomNow = () => page.evaluate(() => window.__map!.director.zoom);
  await advance(page, 0.5);
  expect(await zoomNow()).toBe(1);
  // Past it the wheel zooms, by its own travel alone: the two before it were never queued.
  await page.waitForTimeout(tuning.wheelAfterSkip * 1000 + 50);
  await page.mouse.wheel(0, -100);
  let was = NaN;
  for (let i = 0; i < 60; i++) {
    await advance(page, 0.1);
    await page.waitForTimeout(20); // the zoom chunk's fetch is real time
    const z = await zoomNow();
    if (z === was && z < 1) break; // the chunk answered and its ease settled
    was = z;
  }
  expect(await zoomNow()).toBeCloseTo(Math.exp(-100 * tuning.zoom.wheel), 3);
});

test('the header’s controls work during the arrival without skipping it', async ({ page }) => {
  await open(page);
  await advance(page, 0.5);
  expect(await state(page)).toBe('arrival');
  await page.locator('header.top [data-theme-switch] button[data-value="dark"]').click();
  await page.keyboard.press('Enter'); // a key on a focused header control doesn't skip either
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await state(page)).toBe('arrival');
  await page.mouse.click(60, DESKTOP.height - 60); // the map still skips it
  expect(await state(page)).toBe('overview');
});

test('pressing → three times quickly ends on the third station with matching hash and panel', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__map!.director.skipArrival());
  await advance(page, FRAME);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await advance(page, 0.12); // each press lands mid-flight
  }
  expect(await state(page)).toBe('flying');
  await advance(page, tuning.flight.max + FRAME);

  expect(await state(page)).toBe('station');
  await expect(page).toHaveURL(/\?test#idiff$/);
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('idiff');
  await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe('idiff');
  await expect(page.locator('section.station#idiff')).not.toHaveClass(/\bsr-only\b/);
  expect(await offFraming(page, 'idiff')).toBeLessThan(1e-6);
});

test('hiding the tab mid-arrival then showing it finishes the arrival without a camera jump', async ({ page }) => {
  await open(page);
  await advance(page, 1);
  const before = await page.evaluate(() => window.__map!.director.arrivalTime!);

  const setHidden = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await advance(page, 5); // away for five seconds: no frames
  expect(await page.evaluate(() => window.__map!.director.arrivalTime)).toBe(before);
  await setHidden(false);

  const steps = await page.evaluate(() => {
    const { director, stage, advance } = window.__map!;
    const out: number[] = [];
    let last = stage.camera.position.clone();
    for (let i = 0; i < 400 && director.state === 'arrival'; i++) {
      advance(1 / 60);
      out.push(stage.camera.position.distanceTo(last));
      last = stage.camera.position.clone();
    }
    return { max: Math.max(...out), end: director.state };
  });
  expect(steps.end).toBe('overview');
  // The crane's own fastest frame, scaled by the overview's fit: about 0.97 at 1440×900 since
  // cam_overview was recomposed for the homelab cluster (s 1, but 39.0 from its target where it
  // was 29.9); 1.03 with the cluster before that, at s 1.232. A jump would be far more.
  expect(steps.max).toBeLessThan(1.25);
});

test('with reducedMotion: reduce, travel to fettle completes in one frame and no rAF runs 500 ms later', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.__rafs = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      window.__rafs!++;
      return raf(cb);
    };
  });
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(() => window.__map!.nodes.ready);
  expect(await state(page)).toBe('overview'); // no arrival

  const frames = await page.evaluate(() => window.__map!.clock.frames);
  const now = await page.evaluate(() => {
    window.__map!.stations.go('fettle');
    return window.__map!.director.state;
  });
  expect(now).toBe('station');
  expect(await offFraming(page, 'fettle')).toBeLessThan(1e-6);
  expect(await page.evaluate(() => window.__map!.stage.sheet)).toBe('open');
  await expect.poll(() => page.evaluate(() => window.__map!.clock.frames)).toBeGreaterThan(frames);

  await page.waitForTimeout(500);
  const rafs = await page.evaluate(() => window.__rafs!);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__rafs!)).toBe(rafs);
});

test('rotating mid-flight retargets from where the camera is and lands framed for the new screen', async ({ page }) => {
  const at = () => page.evaluate(() => window.__map!.stage.camera.position.toArray());
  const step = (a: number[], b: number[]) => b.map((v, i) => v - a[i]!);
  const change = (u: number[], v: number[]) => Math.hypot(...v.map((x, i) => x - u[i]!));
  // The same dive to fettle, sampled 0.6 s in; `turn` turns the phone on its side between the
  // last two frames. Returns how much the velocity changes across those frames.
  const dive = async (turn: boolean) => {
    await open(page, PHONE);
    await page.evaluate(() => window.__map!.director.skipArrival());
    await advance(page, FRAME);
    await page.evaluate(() => window.__map!.stations.go('fettle'));
    await advance(page, 0.6 - FRAME);
    const p0 = await at();
    await advance(page, FRAME);
    const p1 = await at();
    if (turn) {
      await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
      await expect.poll(() => page.evaluate(() => window.__map!.stage.viewport.width)).toBe(PHONE.height);
      expect(await state(page)).toBe('flying');
    }
    await advance(page, FRAME);
    return change(step(p0, p1), step(p1, await at()));
  };
  // No cut: the retarget changes the velocity no more than the unturned flight's own change at
  // the same frames (this is the steep part of the dive from the overview).
  const unturned = await dive(false);
  expect(await dive(true)).toBeLessThan(unturned + 0.05);
  await advance(page, tuning.flight.max + FRAME);
  expect(await state(page)).toBe('station');
  expect(await offFraming(page, 'fettle')).toBeLessThan(1e-6);
});

test('pointer drift turns the overview at most a few degrees, eases there, and then stops asking for frames', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__map!.director.skipArrival());
  await advance(page, FRAME);
  const azimuth = () =>
    page.evaluate(() => {
      const { stage, director } = window.__map!;
      const target = director.framing(null).target;
      const p = stage.camera.position;
      return (Math.atan2(p.x - target.x, p.z - target.z) * 180) / Math.PI;
    });
  const rest = await azimuth();

  await page.mouse.move(DESKTOP.width - 1, DESKTOP.height / 2); // far right, over the panel: held at the edge
  await advance(page, FRAME * 3);
  const early = Math.abs((await azimuth()) - rest);
  expect(early).toBeGreaterThan(0); // it moves at once ...
  await advance(page, 3);
  const settled = Math.abs((await azimuth()) - rest);
  expect(early).toBeLessThan(settled); // ... but eases, it doesn't jump
  expect(settled).toBeGreaterThan(tuning.driftYawDeg * 0.9);
  expect(settled).toBeLessThanOrEqual(tuning.driftYawDeg + 1e-6);
  expect(await page.evaluate(() => window.__map!.director.animating)).toBe(false);
});

// The Phase 1 motion audit: #4, #5 and #13.

/** Lands at `id` from wherever the camera is, and lets the drift settle. */
async function landAt(page: Page, id: string | null): Promise<void> {
  await page.evaluate((id) => (id === null ? window.__map!.stations.overview() : window.__map!.stations.go(id)), id);
  await advance(page, tuning.flight.max + 1);
  expect(await state(page)).toBe(id === null ? 'overview' : 'station');
}

test('a routed flight takes a time set by its route, and a dive from the overview tuning.flightDive', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__map!.director.skipArrival());
  await advance(page, FRAME);
  await page.evaluate(() => window.__map!.stations.go('fettle'));
  expect(await page.evaluate(() => window.__map!.director.flight!.duration)).toBeCloseTo(tuning.flightDive, 9);
  await advance(page, tuning.flight.max + 1);
  await landAt(page, 'origin');
  await page.evaluate(() => window.__map!.stations.go('fettle'));
  const f = await page.evaluate(() => {
    const { duration, route } = window.__map!.director.flight!;
    return { duration, length: route.length };
  });
  expect(f.length).toBeGreaterThan(0);
  expect(f.duration).toBeCloseTo(Math.min(Math.max(tuning.flight.min + tuning.flight.perUnit * f.length, tuning.flight.min), tuning.flight.max), 9);
});

test('the panel swaps as the camera lands, not as it leaves, while the counter announces at once', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__map!.director.skipArrival());
  await advance(page, FRAME);
  await landAt(page, 'origin');
  await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe('origin');

  await page.evaluate(() => window.__map!.stations.go('fettle'));
  await expect(page.locator('.travel .count')).toHaveText(/^2 of /); // at once
  const duration = await page.evaluate(() => window.__map!.director.flight!.duration);
  const lead = (tuning.panelOutMs + tuning.panelInMs) / 1000;
  await advance(page, duration - lead - 0.1);
  await page.waitForTimeout(tuning.panelOutMs + tuning.panelInMs + 100); // real time for any fade to run
  expect(await page.evaluate(() => window.__map!.panel.shown)).toBe('origin'); // still the old text mid-flight
  await advance(page, 0.1 + FRAME);
  await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe('fettle');
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`at 390×844 with reducedMotion ${reducedMotion}, station → station ${reducedMotion === 'reduce' ? 'cuts with the sheet open (its end state)' : 'drops the sheet to its peek for the ride, the camera framed for it open throughout, and opens it as the camera lands'}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await open(page, PHONE);
    await page.evaluate(() => window.__map!.director.skipArrival());
    await advance(page, FRAME);
    await landAt(page, 'fettle');
    const opened = PHONE.height * tuning.sheetOpen;
    await page.locator('#fettle h2').focus();
    await page.evaluate(() => window.__map!.stations.go('idiff'));
    const trace = await page.evaluate(() => {
      const { director, stage, advance } = window.__map!;
      const out: { duration: number; gone: number; left: number; bottom: number; sheet: string | undefined; focus: string }[] = [];
      for (let i = 0; i < 200 && director.state === 'flying'; i++) {
        const f = director.flight!;
        const gone = f.t * f.duration;
        out.push({
          duration: f.duration,
          gone,
          left: f.duration - gone,
          bottom: stage.inset.bottom,
          sheet: document.getElementById('stations')!.dataset.sheet,
          focus: document.activeElement?.closest('section')?.id ?? '',
        });
        advance(1 / 60);
      }
      return out;
    });
    if (reducedMotion === 'reduce') {
      expect(trace).toHaveLength(0); // a cut: no flight, so nothing moves
    } else {
      expect(trace.length).toBeGreaterThan(10);
      expect(trace[0]!.duration, 'fettle → idiff is long enough to peek').toBeGreaterThanOrEqual(tuning.sheetPeekMinFlight);
      expect(trace[0]!.sheet).toBe('peek'); // as the camera leaves
      let peeked = 0;
      for (const f of trace) {
        // Until the last sheetSeconds the sheet peeks (it opens from there, done as it lands) ...
        if (f.left > tuning.sheetSeconds + FRAME) {
          expect(f.sheet).toBe('peek');
          peeked++;
        }
        // ... but the camera stays framed for it open: the projection never pans.
        expect(f.bottom).toBeCloseTo(opened, 3);
        // Focus is never dropped: it stays in fettle's section until the panel hands it to idiff's
        // heading as it swaps, and the sheet's moves never take it anywhere else.
        expect(['fettle', 'idiff'], 'focus stays in the panel').toContain(f.focus);
      }
      expect(peeked).toBeGreaterThan(trace.length / 2);
      const handed = trace.findIndex((f) => f.focus === 'idiff');
      if (handed >= 0) expect(trace.slice(handed).every((f) => f.focus === 'idiff'), 'focus moves once, forward').toBe(true);
      expect(trace.at(-1)!.sheet).toBe('open'); // opening over the last sheetSeconds
      await advance(page, FRAME);
    }
    // Landed: open, on the open sheet's framing, the new station in the panel.
    expect(await state(page)).toBe('station');
    expect(await page.locator('#stations').getAttribute('data-sheet')).toBe('open');
    expect(await page.evaluate(() => window.__map!.stage.inset.bottom)).toBeCloseTo(opened, 3);
    expect(await offFraming(page, 'idiff')).toBeLessThan(1e-6);
    await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe('idiff');
  });
}

test('at 390×844 a station → station hop shorter than sheetPeekMinFlight keeps the sheet open for the ride', async ({ page }) => {
  await open(page, PHONE);
  await page.evaluate(() => window.__map!.director.skipArrival());
  await advance(page, FRAME);
  await landAt(page, 'switch');
  await page.evaluate(() => window.__map!.stations.go('laptop'));
  const trace = await page.evaluate(() => {
    const { director, advance } = window.__map!;
    const out: { duration: number; sheet: string | undefined }[] = [];
    for (let i = 0; i < 200 && director.state === 'flying'; i++) {
      out.push({ duration: director.flight!.duration, sheet: document.getElementById('stations')!.dataset.sheet });
      advance(1 / 60);
    }
    return out;
  });
  expect(trace.length).toBeGreaterThan(10);
  expect(trace[0]!.duration, 'switch → laptop is a short hop').toBeLessThan(tuning.sheetPeekMinFlight);
  for (const f of trace) expect(f.sheet).toBe('open');
  await advance(page, FRAME);
  expect(await state(page)).toBe('station');
  expect(await page.locator('#stations').getAttribute('data-sheet')).toBe('open');
});

test('the pointer drift carries through a flight: the camera lands on the drifted framing and stays', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__map!.director.skipArrival());
  await advance(page, FRAME);
  await page.mouse.move(80, 120); // off-centre: the drift turns the camera a little
  await advance(page, 3);
  await page.evaluate(() => window.__map!.stations.go('fettle'));
  const duration = await page.evaluate(() => window.__map!.director.flight!.duration);
  await advance(page, duration + FRAME);
  expect(await state(page)).toBe('station');
  const at = () => page.evaluate(() => window.__map!.stage.camera.position.toArray());
  const landed = await at();
  await advance(page, 1.5);
  const later = await at();
  expect(Math.hypot(...later.map((v, i) => v - landed[i]!))).toBeLessThan(1e-3); // no glide after landing
  expect(await offFraming(page, 'fettle')).toBeGreaterThan(0.01); // and it is drifted, not the bare framing
});
