import { expect, test, type Page } from '@playwright/test';
import world from '../../src/data/world.json' with { type: 'json' };
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// The homelab cluster (Task 13 Batch B, option A): switch, desktop, server, ap and laptop are
// stations of their own on short links, wired as in reality since 2026-10-21 (layout R1): a
// tree, homelab (the router) → switch → desktop / server / ap, ap → laptop over Wi-Fi (its link
// dotted). Flights and the gondola go via the nearest node their ends share, the gondola rounding
// each hub on its own turnaround; traffic for them is relayed down the tree; their links draw
// out from their hubs in the arrival; their labels keep quiet in the overview. On the manual
// clock (?test).

const SUBS = ['switch', 'desktop', 'server', 'ap', 'laptop'];
const TREE: Record<string, string> = world.linkFrom;

async function open(page: Page, hash = '', skip = true): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?test${hash}`);
  await page.waitForFunction(() => window.__map?.visitor !== undefined);
  await page.evaluate(async (skip) => {
    const { director, visitor, advance } = window.__map!;
    await director.ready;
    await visitor.ready;
    await document.fonts.ready;
    if (skip) director.skipArrival();
    advance(1 / 60);
  }, skip);
}

/**
 * Every manual-clock step draws a whole frame, and the rides and the signal hunt step through
 * a thousand or more: under a full run's load the draws alone outlast the test's timeout.
 * These tests read the scene, not its pixels, so the draw is left out. What render() does
 * first (bringing the scene's and the camera's world matrices up to date, which the labels
 * read) still happens.
 */
const undrawn = (page: Page) =>
  page.evaluate(() => {
    const { renderer } = window.__map!.stage;
    renderer.render = (scene, camera) => {
      if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
      if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
    };
  });

/** Travels to `id` frame by frame, and returns every place the gondola was on the way. */
const ride = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { stations, director, visitor, advance } = window.__map!;
    stations.go(id);
    const seen: string[] = [];
    for (let i = 0; i < 600 && (director.state === 'flying' || i === 0); i++) {
      advance(1 / 60);
      const at = visitor.at.id ?? '';
      if (seen.at(-1) !== at) seen.push(at);
    }
    for (let i = 0; i < 120; i++) advance(1 / 60); // the dock clip
    return { seen, state: director.state, at: visitor.at, length: window.__map!.links.curve(id).getLength() };
  }, id);

test('the five sub-nodes are stations after homelab: ‹ › step through them, and a deep link lands on one with its device panel', async ({ page }) => {
  await open(page, '#server');
  await page.evaluate(() => {
    for (let i = 0; i < 300 && window.__map!.director.state !== 'station'; i++) window.__map!.advance(1 / 60);
  });
  expect(await page.evaluate(() => [window.__map!.stations.current, window.__map!.panel.shown])).toEqual(['server', 'server']);
  const section = page.locator('section.station[data-node="server"]');
  await expect(section.getByRole('heading', { level: 2, name: 'Server', exact: true })).toBeVisible();
  await expect(section.locator('.blurb')).toHaveText('Lenovo V15');
  await expect(section.locator('.summary')).toHaveText('Runs candygoogy-bot');
  const ids = await page.evaluate(() => window.__map!.stations.ids);
  const at = ids.indexOf('homelab');
  expect(ids.slice(at, at + 7)).toEqual(['homelab', ...SUBS, 'colophon']);
  expect(await page.evaluate((subs) => subs.map((id) => window.__map!.links.parent(id)), SUBS)).toEqual(SUBS.map((id) => TREE[id]));
  expect(TREE).toEqual({ switch: 'homelab', desktop: 'switch', server: 'switch', ap: 'switch', laptop: 'ap' });
  // The laptop's link is the AP's Wi-Fi: dotted; every cabled one a plain line.
  const dashed = await page.evaluate((subs) => {
    const group = window.__map!.stage.scene.getObjectByName('links')!;
    return subs.map((id) => (group.getObjectByName(`link:${id}`) as unknown as { material: { dashed: boolean } }).material.dashed);
  }, ['homelab', ...SUBS]);
  expect(dashed).toEqual(['homelab', ...SUBS].map((id) => id === 'laptop'));
});

test('the gondola rounds each hub of the tree on its own ring: desktop → server turns at the switch, never near homelab or the origin, and it docks', async ({ page }) => {
  await open(page);
  await undrawn(page);
  const toDesktop = await ride(page, 'desktop');
  // From its park by the origin: round the origin's ring, out along homelab's link, round
  // homelab's ring onto the switch's link, round the switch's onto the desktop's. The switch's
  // link is 1.57 long and each ring meets it 0.75 from its end, so the 0.07 between them passes
  // within a frame: `seen` (a frame's sample) may skip it.
  const bare = (seen: string[]) => seen.filter((id) => id !== 'switch');
  expect(toDesktop.seen).toEqual(expect.arrayContaining(['turnaround', 'homelab', 'turnaround:homelab', 'turnaround:switch', 'desktop']));
  const order = ['homelab', 'turnaround:homelab', 'turnaround:switch', 'desktop'].map((id) => toDesktop.seen.indexOf(id));
  expect(order, 'down the tree in turn').toEqual([...order].sort((a, b) => a - b));
  expect(toDesktop.state).toBe('station');
  expect(toDesktop.at.id).toBe('desktop');
  expect(toDesktop.at.at).toBeCloseTo(toDesktop.length - tuning.visitorDock, 1);

  const toServer = await ride(page, 'server');
  expect(toServer.seen).toEqual(['desktop', 'turnaround:switch', 'server']);
  expect(toServer.at.at).toBeCloseTo(toServer.length - tuning.visitorDock, 1);

  // Over the air: down the AP's dotted link to the laptop, round the switch's ring and the AP's.
  const toLaptop = await ride(page, 'laptop');
  expect(toLaptop.seen).toEqual(['server', 'turnaround:switch', 'ap', 'turnaround:ap', 'laptop']);
  expect(toLaptop.at.at).toBeCloseTo(toLaptop.length - tuning.visitorDock, 1);

  // Up to homelab's own station: up the tree, round each ring onto the link above, and dock there.
  const toHub = await ride(page, 'homelab');
  expect(bare(toHub.seen)).toEqual(['laptop', 'turnaround:ap', 'ap', 'turnaround:switch', 'turnaround:homelab', 'homelab']);
  expect(toHub.at.at).toBeCloseTo(toHub.length - tuning.visitorDock, 1);
});

test('the gondola on a hub’s ring stays on it: level, visitorDock round the hub at mast height', async ({ page }) => {
  await open(page);
  await undrawn(page);
  await ride(page, 'desktop');
  const rows = await page.evaluate(() => {
    const { stations, director, visitor, advance } = window.__map!;
    stations.go('laptop');
    const out: { hub: string; x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 600 && (director.state === 'flying' || i === 0); i++) {
      advance(1 / 60);
      const id = visitor.at.id ?? '';
      if (id.startsWith('turnaround:')) out.push({ hub: id.slice('turnaround:'.length), x: visitor.root.position.x, y: visitor.root.position.y, z: visitor.root.position.z });
    }
    return out;
  });
  // desktop → laptop rounds the switch (where the way turns back) and the AP (down onto its link).
  expect([...new Set(rows.map((r) => r.hub))]).toEqual(['switch', 'ap']);
  expect(rows.length).toBeGreaterThan(3);
  for (const p of rows) {
    const [hx = 0, hz = 0] = world.nodes[p.hub as keyof typeof world.nodes];
    expect(Math.hypot(p.x - hx, p.z - hz), p.hub).toBeCloseTo(tuning.visitorDock, 1);
    expect(p.y).toBeCloseTo(tuning.linkMast, 2);
  }
});

// The owner's test notes: drawn, the ring read as a second ground ring round homelab.
// It isn't drawn (tuning.turnaroundDrawn false): not at rest, and not while the gondola rides it,
// round any hub of the tree.
test('the hubs’ rings are never drawn, even while the gondola rounds them', async ({ page }) => {
  test.skip(tuning.turnaroundDrawn, 'drawn');
  await open(page);
  await undrawn(page);
  await ride(page, 'desktop');
  const { rest, rows, after } = await page.evaluate(() => {
    const { stations, director, visitor, advance, stage } = window.__map!;
    const rings = ['turnaround:0', 'turnaround:homelab:0', 'turnaround:switch:0', 'turnaround:ap:0'].map((n) => stage.scene.getObjectByName(n)!);
    const shown = () => rings.map((r) => r.visible);
    const rest = shown();
    stations.go('laptop');
    const rows: { on: boolean; shown: boolean }[] = [];
    for (let i = 0; i < 600 && (director.state === 'flying' || i === 0); i++) {
      advance(1 / 60);
      rows.push({ on: (visitor.at.id ?? '').startsWith('turnaround:'), shown: shown().some(Boolean) });
    }
    advance(1);
    return { rest, rows, after: shown() };
  });
  expect(rest, 'docked at desktop').toEqual([false, false, false, false]);
  expect(rows.some((r) => r.on), 'it rides a ring').toBe(true);
  expect(rows.some((r) => r.shown), 'never drawn').toBe(false);
  expect(after, 'docked at laptop').toEqual([false, false, false, false]);
});

test("signals for the cluster are relayed down the tree: out of the router onto the switch's link, and on to the laptop through the AP", async ({ page }) => {
  // Every route due at once (the hub still spaces them), so a relayed one goes out early.
  await page.addInitScript(() => {
    Math.random = () => 0.01;
  });
  await open(page);
  await undrawn(page);
  // The signal's model loads on its own; its first instance is made as it comes in.
  await page.waitForFunction(() => (window.__map!.stage.scene.getObjectByName('traffic')?.children.length ?? 0) > 0);
  const found = await page.evaluate((subs) => {
    const { stage, links, advance } = window.__map!;
    const traffic = stage.scene.getObjectByName('traffic')!;
    // Each sub-link's points away from both its ends' models (its middle 60%).
    const samples = subs.map((id) => ({ id, pts: links.curve(id).getSpacedPoints(64).slice(13, 52) }));
    const first: Record<string, number> = {};
    let t = 0;
    for (let i = 0; i < 1500 && first['laptop'] === undefined; i++) {
      advance(1 / 60);
      t += 1 / 60;
      for (const s of traffic.children) {
        if (!s.visible) continue;
        for (const { id, pts } of samples) {
          if (first[id] === undefined && pts.some((q) => q.distanceTo(s.position) < 0.03)) first[id] = t;
        }
      }
    }
    return first;
  }, SUBS);
  const len = (id: string) => {
    const pts = world.links[id as keyof typeof world.links]!;
    const [a, b] = [pts[0]!, pts.at(-1)!];
    return Math.hypot(b[3]! - a[3]!, b[5]! - a[5]!);
  };
  expect(found['switch'], 'a signal on the switch’s link').toBeDefined();
  expect(found['laptop'], 'a signal on the laptop’s link').toBeDefined();
  // It rode homelab's whole link first (about 9 units at signalSpeed) and paused in the router.
  expect(found['switch']!).toBeGreaterThan(9 / tuning.signalSpeed);
  // The laptop's rode the router's, the switch's and the AP's links first, pausing in each hub.
  const before = 9 + len('switch') + len('ap');
  expect(found['laptop']!).toBeGreaterThan(before / tuning.signalSpeed + 2 * tuning.signalRelay.pause);
});

test('in the arrival each sub-link draws out from its hub once the hub’s own link has landed there, the last by 2.2 s', async ({ page }) => {
  await open(page, '', false);
  const reach = world.arrival.reach as Record<string, number>;
  const rows = await page.evaluate((ids) => {
    const { director, links, advance } = window.__map!;
    const out: { t: number; p: Record<string, number> }[] = [];
    while ((director.arrivalTime ?? Infinity) < 2.3) {
      advance(1 / 100, 1 / 100);
      const t = director.arrivalTime ?? Infinity;
      if (t >= 1.5) out.push({ t, p: Object.fromEntries(ids.map((id) => [id, links.progress(id)])) });
    }
    return out;
  }, ['homelab', ...SUBS]);
  expect(rows.length).toBeGreaterThan(50);
  for (const id of SUBS) {
    const hub = TREE[id]!;
    // Nothing of it before its hub's link has landed.
    for (const r of rows) if (r.p[hub]! < 1) expect(r.p[id], `${id} before ${hub} landed at ${r.t.toFixed(2)}`).toBe(0);
    // It starts as its hub lands (siblings 0.04 s apart), and lands on its own reach time.
    const started = rows.find((r) => r.p[id]! > 0)!.t;
    expect(started, `${id} starts`).toBeGreaterThanOrEqual(reach[hub]! - 0.011);
    expect(started, `${id} starts`).toBeLessThan(reach[hub]! + 0.1);
    const landed = rows.find((r) => r.p[id]! >= 1)!.t;
    expect(Math.abs(landed - reach[id]!), `${id} lands on its reach time`).toBeLessThan(0.021);
  }
  expect(Math.max(...SUBS.map((id) => reach[id]!))).toBeLessThanOrEqual(2.2);
  expect(reach['homelab']).toBeCloseTo(1.74, 6);
});

test("the sub-nodes' labels keep quiet in the landscape overview, take no room, and show on hover, focus and at a station", async ({ page }) => {
  await open(page);
  const opacity = (id: string) => page.locator(`button.label[data-go="${id}"]`).evaluate((el) => getComputedStyle(el).opacity);
  for (const id of SUBS) await expect.poll(() => opacity(id), id).toBe('0');
  await expect.poll(() => opacity('homelab')).toBe('1');
  expect(await page.evaluate((ids) => ids.map((id) => window.__map!.labels.room(id)), SUBS)).toEqual(SUBS.map(() => 0));
  // Focused, it shows.
  const desktop = page.locator('button.label[data-go="desktop"]');
  await desktop.focus();
  await expect.poll(() => opacity('desktop')).toBe('1');
  await desktop.blur();
  await expect.poll(() => opacity('desktop')).toBe('0');
  // Hovered on the canvas (its node), it shows.
  await page.evaluate(() => window.__map!.nodes.get('ap').hover(true));
  await page.evaluate(() => window.__map!.advance(1 / 60));
  await expect.poll(() => opacity('ap')).toBe('1');
  await page.evaluate(() => window.__map!.nodes.get('ap').hover(false));
  // At a station every label shows again.
  await page.evaluate(() => {
    window.__map!.stations.go('homelab');
    for (let i = 0; i < 300 && window.__map!.director.state !== 'station'; i++) window.__map!.advance(1 / 60);
  });
  for (const id of SUBS) await expect.poll(() => opacity(id), id).toBe('1');
});
