import { expect, test, type Page } from '@playwright/test';
import world from '../../src/data/world.json' with { type: 'json' };
import type {} from '../../src/main'; // window.__map's type

// The power switch (Task 15, approved by the owner 2026-10-20 with its recommendations). A click on
// the origin's switch (its `poke_power_hit`) at the origin's station flips it: the network goes
// dark node by node, then reboots with the arrival's "Checking…" → "Working". On the manual clock
// (?test) with motion; under reduced motion the moment runs on timers, so those tests wait in real
// time.

// Each test steps several seconds of frames, every one rendered.
test.describe.configure({ timeout: 120_000 });

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    const { director, nodes, advance } = window.__map!;
    await director.ready;
    await nodes.ready;
    director.skipArrival();
    advance(1 / 60);
  });
  await page.evaluate(() => window.__map!.director.arrived);
}

const advance = (page: Page, seconds: number) => page.evaluate((s) => window.__map!.advance(s), seconds);

/** Travels to the origin and lets its `arrive` play out. */
async function atOrigin(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { stations, director, advance } = window.__map!;
    stations.go('origin');
    for (let i = 0; i < 600 && director.state !== 'station'; i++) advance(1 / 60);
  });
  await advance(page, 3);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
}

/** The CSS px point over the switch (the origin's `poke_power_hit`). */
const overSwitch = (page: Page) =>
  page.evaluate(() => {
    const { stage, nodes } = window.__map!;
    const node = nodes.get('origin');
    const o = node.root.getObjectByName('poke_power_hit')!;
    o.updateWorldMatrix(true, true);
    const p = node.bounds.clone().setFromObject(o, true).getCenter(node.root.position.clone());
    p.project(stage.camera);
    const { width, height } = stage.viewport;
    return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
  });

/** Records every word each label's status line shows from now on, in order (window.__said). */
const listen = (page: Page) =>
  page.evaluate(() => {
    const said: Record<string, string[]> = {};
    const w = window as unknown as { __said: typeof said };
    w.__said = said;
    for (const id of window.__map!.stations.ids) {
      const status = document.querySelector(`button.label[data-go="${id}"] .status`)!;
      said[id] = [status.textContent ?? ''];
      // From the records, not the node: a whole run of frames in one evaluate delivers them together.
      // textContent = words puts in a new text node (none for '').
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.removedNodes.length === 0 && r.addedNodes.length === 0) continue;
          const now = r.addedNodes[0]?.textContent ?? '';
          if (said[id]!.at(-1) !== now) said[id]!.push(now);
        }
      }).observe(status, { childList: true });
    }
  });

const said = (page: Page) => page.evaluate(() => (window as unknown as { __said: Record<string, string[]> }).__said);

/** The network as it stands: which nodes and links are lit, the statuses and traffic. */
const network = (page: Page) =>
  page.evaluate(() => {
    const { stations, nodes, links, traffic, director } = window.__map!;
    const ids = stations.ids;
    return {
      lit: ids.filter((id) => nodes.get(id).lit),
      linksLit: ids.filter((id) => id !== 'origin' && links.isLit(id)),
      statuses: ids.map((id) => document.querySelector(`button.label[data-go="${id}"] .status`)?.textContent ?? ''),
      pinned: ids.filter((id) => document.querySelector(`button.label[data-go="${id}"]`)?.closest('[data-pinned]')),
      traffic: traffic.enabled,
      state: director.state,
    };
  });

test('flipping the switch darkens every node, then every status returns to Working', async ({ page }) => {
  await open(page);
  await atOrigin(page);
  const ids = await page.evaluate(() => [...window.__map!.stations.ids]);
  await page.waitForFunction(() => window.__map!.cable !== null); // its lazy chunk, after the arrival
  await listen(page);
  const at = await overSwitch(page);
  await page.mouse.click(at.x, at.y);
  // The moment's chunk loads on the first flip; then the switch flips, the origin's own poke.
  await expect.poll(() => page.evaluate(() => window.__map!.nodes.get('origin').playing)).toBe('poke_power');

  // Frame by frame: when each node goes dark, and that it all goes dark before any comes back.
  const run = await page.evaluate((ids) => {
    const { nodes, traffic, advance, cable, stage } = window.__map!;
    const darkAt: Record<string, number> = {};
    const backAt: Record<string, number> = {};
    let cableOff: number | null = null;
    let cableOn: number | null = null;
    let cableDimmed: boolean | null = null;
    const server = cable!.get('server_switch')!;
    const colours = () => cable!.lines.map((l) => (l.line.material as unknown as { color: { getHex(): number } }).color.getHex());
    const litColours = colours();
    let allDark: number | null = null;
    let trafficWhenDark: boolean | null = null;
    let firstLit: number | null = null;
    let signalsAfterFade: number | null = null;
    for (let f = 1; f <= 30 * 9; f++) {
      advance(1 / 30, 1 / 30); // 30 fps: 270 frames, each one rendered
      const t = f / 30;
      // The toggle snaps at 0.3 s, and the signals out shrink away where they are over 0.15 s.
      if (signalsAfterFade === null && t >= 0.5) signalsAfterFade = traffic.alive;
      for (const id of ids) if (!nodes.get(id).lit && darkAt[id] === undefined) darkAt[id] = t;
      for (const id of ids) if (darkAt[id] !== undefined && nodes.get(id).lit && backAt[id] === undefined) backAt[id] = t;
      if (cableOff === null && !server.lit) cableOff = t;
      if (cableOff !== null && cableOn === null && server.lit) cableOn = t;
      // Every line, cables and cords, at --ghost: dark 0.9 s by then.
      if (cableDimmed === null && t >= 2.5) cableDimmed = colours().every((c) => c === stage.theme.ghost.getHex());
      if (allDark === null && ids.every((id) => !nodes.get(id).lit)) {
        allDark = t;
        trafficWhenDark = traffic.enabled;
      }
      if (allDark !== null && firstLit === null && ids.some((id) => nodes.get(id).lit)) firstLit = t;
    }
    return {
      darkAt,
      backAt,
      allDark,
      trafficWhenDark,
      firstLit,
      signalsAfterFade,
      cableOff,
      cableOn,
      cableDimmed,
      cableBack: colours().every((c, i) => c === litColours[i]),
      lines: cable!.lines.length,
    };
  }, ids);

  expect(run.allDark, 'every node went dark').not.toBeNull();
  expect(run.trafficWhenDark).toBe(false);
  expect(run.signalsAfterFade).toBe(0);
  // In reverse station order, 80 ms apart: exit first, fettle last.
  const order = ids.filter((id) => id !== 'origin').reverse();
  for (let i = 1; i < order.length; i++) {
    expect(run.darkAt[order[i]!]! - run.darkAt[order[i - 1]!]!).toBeCloseTo(0.08, 1);
  }
  // The homelab's cables and cords (all ten, the switch's brick's two among them) go dark with
  // the network; the server's cable goes off with the first of its two nodes, and back with the second.
  expect(run.lines).toBe(10);
  expect(run.cableOff).toBeCloseTo(Math.min(run.darkAt['server']!, run.darkAt['switch']!), 5);
  expect(run.cableOn).toBeCloseTo(Math.max(run.backAt['server']!, run.backAt['switch']!), 5);
  expect(run.cableDimmed).toBe(true);
  expect(run.cableBack).toBe(true);
  // 1.2 s of dark, then the reboot.
  expect(run.firstLit! - run.allDark!).toBeGreaterThan(1.1);
  expect(run.firstLit! - run.allDark!).toBeLessThan(1.4);

  // Every status emptied, read "Checking…", then "Working", and let go.
  const words = await said(page);
  for (const id of ids) {
    const seen = words[id]!;
    expect(seen, id).toContain('');
    expect(seen.indexOf('Checking…'), id).toBeGreaterThan(seen.indexOf(''));
    expect(seen.at(-1), id).toBe('Working');
  }
  const end = await network(page);
  expect(end.lit).toEqual(ids);
  expect(end.linksLit).toEqual(ids.filter((id) => id !== 'origin'));
  expect(end.statuses.every((s) => s === 'Working')).toBe(true);
  expect(end.pinned).toEqual([]);
  expect(end.traffic).toBe(true);
  // Camera B (approved): the camera pulled back to the overview for the show, the hash cleared.
  expect(end.state).toBe('overview');
  await expect(page).not.toHaveURL(/#/);
});

// The owner's test notes ("while it's off the links look unused, make it more obvious"):
// dark, the links go to --ghost, quieter than the range rings' --faint; the reboot redraws them
// from the hub out (the arrival's draw), and traffic comes back with a burst of signals.
test('dark, the links go quieter than --faint; the reboot redraws them from the hub out and traffic comes back in a burst', async ({ page }) => {
  await open(page);
  const ids = await page.evaluate(() => window.__map!.stations.ids.filter((id) => id !== 'origin'));
  // Every burst the moment asks for (power.ts calls traffic.burst on the live object).
  await page.evaluate(() => {
    const t = window.__map!.traffic;
    const real = t.burst.bind(t);
    const w = window as unknown as { __bursts: number[] };
    w.__bursts = [];
    t.burst = (n) => {
      w.__bursts.push(n);
      real(n);
    };
  });
  // From the overview: the origin panel's button, as in the arrival-end test.
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#origin button.power')!.click());
  await expect.poll(() => page.evaluate(() => window.__map!.nodes.get('origin').playing)).toBe('poke_power');

  const run = await page.evaluate((ids) => {
    const { links, traffic, advance, stage } = window.__map!;
    const group = stage.scene.getObjectByName('links')!;
    const colour = (name: string) => (group.getObjectByName(name) as unknown as { material: { color: { getHex(): number } } }).material.color.getHex();
    const off: Record<string, { link: number; ring: number }> = {};
    let rebootAt: number | null = null;
    let allZeroAtReboot: boolean | null = null;
    const startedAt: Record<string, number> = {};
    const doneAt: Record<string, number> = {};
    let endAt: number | null = null;
    let signalsAfterEnd = 0;
    for (let f = 1; f <= 30 * 8; f++) {
      advance(1 / 30, 1 / 30);
      const t = f / 30;
      if (f === 72) for (const id of ids) off[id] = { link: colour(`link:${id}`), ring: colour(`ring:${id}`) }; // 2.4 s: all dark
      if (rebootAt === null && ids.some((id) => links.progress(id) < 1)) {
        rebootAt = t;
        allZeroAtReboot = ids.every((id) => links.progress(id) === 0 || links.progress(id) < 0.05);
      }
      for (const id of ids) {
        if (rebootAt !== null && startedAt[id] === undefined && links.progress(id) > 0) startedAt[id] = t;
        if (rebootAt !== null && doneAt[id] === undefined && links.progress(id) >= 1 && startedAt[id] !== undefined) doneAt[id] = t;
      }
      if (endAt === null && rebootAt !== null && ids.every((id) => links.progress(id) >= 1)) endAt = t;
      if (endAt !== null && t <= endAt + 1.1) signalsAfterEnd = Math.max(signalsAfterEnd, traffic.alive);
    }
    const hex = (c: { getHex(): number }) => c.getHex();
    return {
      off,
      ghost: hex(stage.theme.ghost),
      faint: hex(stage.theme.faint),
      bg: hex(stage.theme.bg),
      rebootAt,
      allZeroAtReboot,
      startedAt,
      doneAt,
      endAt,
      signalsAfterEnd,
      lit: ids.filter((id) => links.isLit(id)).length,
    };
  }, ids);

  // Dark: every link and its ground ring in --ghost, nearer the floor than the range rings' --faint.
  const grey = (hex: number) => (hex >> 16) & 0xff;
  expect(Math.abs(grey(run.ghost) - grey(run.bg))).toBeLessThan(Math.abs(grey(run.faint) - grey(run.bg)));
  for (const id of ids) expect(run.off[id], id).toEqual({ link: run.ghost, ring: run.ghost });

  // The reboot takes every link away and draws it out again from its hub end; a cluster's
  // links only once their hub's own link has landed, down the real wiring's tree (router →
  // switch → desktop / server / AP, AP → laptop): the laptop's after the AP's after the switch's.
  expect(run.rebootAt).not.toBeNull();
  expect(run.allZeroAtReboot).toBe(true);
  for (const [sub, hub] of Object.entries(world.linkFrom).filter(([id]) => ids.includes(id))) {
    expect(run.startedAt[sub]!, `${sub} after ${hub}`).toBeGreaterThanOrEqual(run.doneAt[hub]!);
  }
  const spread = Math.max(...Object.values(run.startedAt)) - Math.min(...Object.values(run.startedAt));
  expect(spread, 'the links start one after another, not all at once').toBeGreaterThan(0.3);

  // Then one burst, and the signals are out within about a second.
  expect(await page.evaluate(() => (window as unknown as { __bursts: number[] }).__bursts)).toEqual([6]);
  expect(run.signalsAfterEnd).toBeGreaterThanOrEqual(5);
  expect(run.lit).toBe(ids.length);
});

test('the origin panel’s button turns it off and on again from the keyboard', async ({ page }) => {
  await open(page);
  await atOrigin(page);
  const button = page.getByRole('button', { name: 'Turn it off and on again' });
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__map!.nodes.get('origin').playing)).toBe('poke_power');
  await advance(page, 2);
  expect((await network(page)).lit).toEqual([]);
  await advance(page, 6);
  const end = await network(page);
  expect(end.statuses.every((s) => s === 'Working')).toBe(true);
  expect(end.lit.length).toBe(await page.evaluate(() => window.__map!.stations.ids.length));
  // The screen reader heard the reboot in the approved words.
  await expect(page.locator('#origin [aria-live]')).toHaveText('Working');
});

test('during the dark a second flip does nothing, and travel still works', async ({ page }) => {
  await open(page);
  await atOrigin(page);
  await page.getByRole('button', { name: 'Turn it off and on again' }).click();
  await expect.poll(() => page.evaluate(() => window.__map!.nodes.get('origin').playing)).toBe('poke_power');
  await advance(page, 2); // dark
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#origin button.power')!.click());
  await advance(page, 0.1);
  expect(await page.evaluate(() => window.__map!.nodes.get('origin').playing)).not.toBe('poke_power');
  await page.evaluate(() => window.__map!.stations.go('fettle'));
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('flying');
  await advance(page, 7);
  const end = await network(page);
  expect(end.statuses.every((s) => s === 'Working')).toBe(true);
  expect(end.lit.length).toBe(await page.evaluate(() => window.__map!.stations.ids.length));
  await expect(page).toHaveURL(/#fettle$/);
});

test('under reduced motion it switches off and on at once, and the statuses still change', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.evaluate(() => window.__map!.stations.go('origin'));
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
  const ids = await page.evaluate(() => [...window.__map!.stations.ids]);
  await listen(page);
  await page.evaluate(() => {
    const t = window.__map!.traffic;
    const w = window as unknown as { __bursts: number[] };
    w.__bursts = [];
    t.burst = (n) => void w.__bursts.push(n);
  });
  await page.getByRole('button', { name: 'Turn it off and on again' }).click();
  // Everything off together, not one by one.
  await expect.poll(() => network(page).then((n) => n.lit.length), { timeout: 2000 }).toBe(0);
  expect((await network(page)).linksLit).toEqual([]);
  await expect.poll(() => network(page).then((n) => n.lit.length), { timeout: 4000 }).toBe(ids.length);
  await expect
    .poll(() => network(page).then((n) => n.statuses.every((s) => s === 'Working') && n.pinned.length === 0), { timeout: 6000 })
    .toBe(true);
  const words = await said(page);
  for (const id of ids) expect(words[id], id).toContain('Checking…');
  expect((await network(page)).state).toBe('overview');
  // No signals run with motion reduced, so no burst; and no link is left half drawn.
  expect(await page.evaluate(() => (window as unknown as { __bursts: number[] }).__bursts)).toEqual([]);
  expect(await page.evaluate(() => window.__map!.stations.ids.filter((id) => id !== 'origin' && window.__map!.links.progress(id) < 1))).toEqual([]);
});

// A phone: the sheet drops to its peek as the camera leaves, so the network fills the screen for
// the show. The phone's overview keeps its labels quiet, the arrival's diagnostic included
// (styles.css), so what a phone sees is every node going dark and coming back, all of them in frame
// above the peek.
test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test('the sheet drops to its peek and every node goes dark and comes back in frame', async ({ page }) => {
    await page.goto('/?test');
    await page.waitForFunction(() => window.__map?.director !== undefined);
    await page.evaluate(async () => {
      const { director, nodes, advance } = window.__map!;
      await director.ready;
      await nodes.ready;
      director.skipArrival();
      advance(1 / 60);
    });
    await atOrigin(page);
    const at = await overSwitch(page);
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(() => page.evaluate(() => window.__map!.nodes.get('origin').playing)).toBe('poke_power');
    await advance(page, 1.8); // fettle went dark at 1.58 s; the dive ended at 1.55 s
    // The sheet's slide is CSS, on wall-clock time: let it reach its peek before measuring.
    await expect.poll(() => page.evaluate(() => document.getElementById('stations')!.getBoundingClientRect().top)).toBeGreaterThan(700);
    const seen = await page.evaluate(() => {
      const { stations, nodes, stage, director } = window.__map!;
      const sheet = document.getElementById('stations')!;
      const floor = sheet.getBoundingClientRect().top; // the peek's top edge
      const { width } = stage.viewport;
      const out = stations.ids.filter((id) => {
        const n = nodes.get(id);
        const p = n.root.localToWorld(n.bounds.getCenter(n.root.position.clone().set(0, 0, 0))).project(stage.camera);
        const x = ((p.x + 1) / 2) * width;
        const y = ((1 - p.y) / 2) * stage.viewport.height;
        return x < 0 || x > width || y < 0 || y > floor;
      });
      return { state: director.state, sheet: sheet.dataset['sheet'], lit: stations.ids.filter((id) => nodes.get(id).lit), out };
    });
    expect(seen.state).toBe('overview');
    expect(seen.sheet).toBe('peek');
    expect(seen.lit).toEqual([]);
    expect(seen.out, 'nodes out of frame or under the sheet').toEqual([]);
    await advance(page, 5);
    const end = await network(page);
    expect(end.lit.length).toBe(await page.evaluate(() => window.__map!.stations.ids.length));
    expect(end.traffic).toBe(true);
  });
});

test('a flip as the arrival ends: the arrival’s late "Working" never lands on a dark label', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.director !== undefined);
  // The arrival's statuses let go on wall-clock timers, statusStaggerMs apart. Stretched tenfold
  // here, so they're still pending when the switch snaps whatever the chunk's fetch takes.
  const ms = await page.evaluate(async () => {
    const { director, nodes, advance, stations } = window.__map!;
    await director.ready;
    await nodes.ready;
    const real = window.setTimeout;
    window.setTimeout = ((fn: () => void, ms = 0) => real(fn, ms * 10)) as typeof window.setTimeout;
    try {
      director.skipArrival();
    } finally {
      window.setTimeout = real;
    }
    advance(1 / 60);
    return stations.ids.length * 40 * 10;
  });
  // At once: the flip waits for the moments to load (after the arrival), then switches.
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#origin button.power')!.click());
  await expect.poll(() => page.evaluate(() => window.__map!.nodes.get('origin').playing)).toBe('poke_power');
  await advance(page, 2); // past the snap: every node dark, the reboot not yet begun
  expect((await network(page)).lit).toEqual([]);
  await page.waitForTimeout(ms + 500); // every timer the arrival left has fired by now
  const n = await network(page);
  expect(n.lit).toEqual([]);
  expect(n.statuses.filter((s) => s !== '')).toEqual([]);
});
