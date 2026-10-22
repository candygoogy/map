import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/main'; // window.__map's type

// The rubber duck (Task 17, secret 4, approved 2026-10-20): a hidden node off the map's far edge.
// Now and then a signal strays: out of a node near the view (the station's, or one on screen) on an
// undrawn way of its own to the duck (the owner's test 2026-10-21: it used to leave the origin
// every time). Clicking that stray signal (or Tab to it, then Enter) follows it there. The node is
// never in the ‹ › order; once found its link, label and panel stay for the visit.
// __map.traffic.sendStray(from?) sends one at once, rather than waiting for one in 20.

test.describe.configure({ timeout: 120_000 });

async function open(page: Page, url = '/?test'): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
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

/** Sends a stray (out of node `from`, else near the view) and waits for the duck's moment to lay its button over it. */
async function sendStray(page: Page, from?: string): Promise<void> {
  // The traffic's signal model is in once a signal has run, and the stray's way once the duck's
  // chunk is (the first ask fetches it); give them a moment.
  await expect.poll(() => page.evaluate((f) => window.__map!.traffic.sendStray(f), from)).toBe(true);
  await page.waitForFunction(() => window.__map!.duck !== null);
  await page.evaluate(() => window.__map!.duck);
  await advance(page, 0.5);
  await expect(page.locator('li.stray')).toBeVisible();
}

/** Where the duck stands now: its model, link, ring, label and panel. */
const duckState = (page: Page) =>
  page.evaluate(() => {
    const { nodes, links, stations } = window.__map!;
    const ring = window.__map!.stage.scene.getObjectByName('ring:duck');
    const label = document.querySelector<HTMLElement>('button.label[data-go="duck"]');
    const section = document.querySelector<HTMLElement>('section.station[data-node="duck"]');
    return {
      model: nodes.get('duck').root.visible,
      link: links.progress('duck'),
      ring: ring?.visible ?? null,
      label: label ? !label.closest('li')!.hidden : null,
      labelText: label?.querySelector('.name')?.textContent ?? null,
      section: section ? !section.hidden : null,
      revealed: stations.revealed('duck'),
      ids: [...stations.ids],
    };
  });

/** Steps the clock until the camera has landed at a station (or 10 s). */
const land = (page: Page) =>
  page.evaluate(() => {
    const { director, advance } = window.__map!;
    for (let i = 0; i < 600 && director.state !== 'station'; i++) advance(1 / 60);
    advance(0.5);
    return director.state;
  });

test('hidden until found: no model, link, ring, label or panel, never in the ‹ › order, and #duck shows nothing', async ({ page }) => {
  await open(page);
  const s = await duckState(page);
  expect(s).toMatchObject({ model: false, link: 0, ring: false, label: false, section: false, revealed: false });
  expect(s.ids).not.toContain('duck');
  expect(s.ids).toHaveLength(17);
  await expect(page.locator('section.station[data-node="duck"]')).toBeHidden();
  // ‹ › all the way round, twice: never the duck.
  const seen = await page.evaluate(() => {
    const { stations } = window.__map!;
    const out: (string | null)[] = [];
    for (let i = 0; i < 40; i++) {
      stations.next();
      out.push(stations.current);
    }
    return out;
  });
  expect(seen).not.toContain('duck');
  // A deep link to it before it's found is the overview.
  await page.goto('/?test#duck');
  await page.waitForFunction(() => window.__map?.stations !== undefined);
  expect(await page.evaluate(() => window.__map!.stations.current)).toBeNull();
  expect(new URL(page.url()).hash).toBe('');
});

test('a click on the stray signal follows it to the duck: its link draws in, its label and panel show', async ({ page }) => {
  await open(page);
  await sendStray(page);
  const box = (await page.locator('.stray-hit').boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  // Over the signal: the button's centre is the stray's point on screen.
  const at = await page.evaluate(() => {
    const { traffic, stage } = window.__map!;
    const p = traffic.stray!.getWorldPosition(stage.camera.position.clone()).project(stage.camera);
    return { x: ((p.x + 1) / 2) * stage.viewport.width, y: ((1 - p.y) / 2) * stage.viewport.height };
  });
  expect(Math.abs(box.x + box.width / 2 - at.x)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - at.y)).toBeLessThan(2);
  // Pointing at it holds it where it is.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => window.__map!.traffic.stray!.position.toArray());
  await advance(page, 1);
  expect(await page.evaluate(() => window.__map!.traffic.stray!.position.toArray())).toEqual(before);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Mid-flight the link is drawing in.
  await advance(page, 0.4);
  const mid = await page.evaluate(() => window.__map!.links.progress('duck'));
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(1);
  expect(await land(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('duck');
  expect(new URL(page.url()).hash).toBe('#duck');
  const s = await duckState(page);
  expect(s).toMatchObject({ model: true, link: 1, ring: true, label: true, section: true, revealed: true, labelText: 'Rubber duck' });
  expect(s.ids).not.toContain('duck');
  await expect(page.locator('section.station[data-node="duck"] h2')).toHaveText('Rubber duck');
  await expect(page.locator('section.station[data-node="duck"]')).toBeVisible();
  await expect(page.locator('li.stray')).toBeHidden();
  // The counter has no number for it (it's not on the loop).
  await expect(page.locator('.travel .count')).toHaveText('');
  // Recorded once as a secret, with its line for the trip receipt (Task 16).
  const secrets = await page.evaluate(async () => (await window.__map!.secrets()).map((f) => ({ id: f.id, line: f.line })));
  expect(secrets).toEqual([{ id: 'duck', line: 'Found the rubber duck' }]);
});

/** The stray's marks (the owner's test notes): its model's waddle, and the trail behind
 *  it, and how far the trail's first and last points are off its way's (0: it follows the way). */
const marks = (page: Page) =>
  page.evaluate(() => {
    const { traffic, stage } = window.__map!;
    type Trail = import('three').Object3D & {
      geometry: { instanceCount: number; attributes: { instanceStart: { data: { array: ArrayLike<number> } } } };
      material: { opacity: number };
    };
    const trail = stage.scene.getObjectByName('stray-trail') as Trail | undefined;
    const model = traffic.stray?.children[0];
    const way = traffic.strayWay;
    let off: number | null = null;
    if (trail && way) {
      const a = trail.geometry.attributes.instanceStart.data.array;
      const p = traffic.stray!.position.clone();
      const first = way.point(0, p.clone()).distanceTo(p.set(a[0]!, a[1]!, a[2]!));
      const n = a.length;
      const last = way.point(1, p.clone()).distanceTo(p.set(a[n - 3]!, a[n - 2]!, a[n - 1]!));
      off = Math.max(first, last);
    }
    return {
      side: model ? Math.abs(model.position.x) : null,
      yaw: model ? Math.abs(model.rotation.y) : null,
      trail: trail ? trail.visible && trail.geometry.instanceCount > 0 : null,
      drawn: trail?.geometry.instanceCount ?? 0,
      opacity: trail?.material.opacity ?? null,
      off,
    };
  });

test('the stray stands out: it waddles across its path, a dotted trail draws in behind it, and the trail fades once it’s followed', async ({ page }) => {
  await open(page);
  await sendStray(page);
  await advance(page, 1.1); // off a zero of the sway
  const riding = await marks(page);
  expect(riding.side! + riding.yaw!).toBeGreaterThan(0.01);
  expect(riding.trail).toBe(true);
  expect(riding.off!).toBeLessThan(1e-4); // along the stray's own way, end to end
  await advance(page, 1);
  const on = await marks(page);
  expect(on.drawn).toBeGreaterThan(riding.drawn); // it draws on behind the stray
  // The pooled signal goes back straight once it's no longer the stray.
  const pill = await page.evaluate(() => window.__map!.traffic.stray!.children[0]!.uuid);
  await page.locator('.stray-hit').click();
  await advance(page, 1);
  expect((await marks(page)).trail).toBe(true); // held a moment
  await advance(page, 2);
  const fading = await marks(page);
  expect(fading.opacity!).toBeLessThan(1);
  expect(fading.opacity!).toBeGreaterThan(0);
  await advance(page, 6);
  expect((await marks(page)).trail).toBe(false);
  await land(page);
  const rest = await page.evaluate((uuid) => {
    const o = window.__map!.stage.scene.getObjectByProperty('uuid', uuid)!;
    return [o.position.x, o.rotation.y];
  }, pill);
  expect(rest).toEqual([0, 0]);
});

test('found, it stays for the visit: its label and Back reach it, ‹ › never do, and no stray goes out again', async ({ page }) => {
  await open(page);
  await sendStray(page);
  await page.locator('.stray-hit').click();
  expect(await land(page)).toBe('station');
  // ‹ › from the duck act as from the overview: › is the origin, ‹ is exit.
  await page.evaluate(() => window.__map!.stations.next());
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('origin');
  await land(page);
  // Back to the duck.
  await page.goBack();
  expect(await land(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('duck');
  await page.evaluate(() => window.__map!.stations.prev());
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('exit');
  await land(page);
  // The overview, then its label.
  await page.evaluate(() => window.__map!.stations.overview());
  await land(page);
  await advance(page, 1.5);
  const s = await duckState(page);
  expect(s).toMatchObject({ model: true, link: 1, ring: true, label: true, revealed: true });
  // Its label is in the Tab order, after exit's.
  const order = await page.locator('button.label').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.go));
  expect(order.at(-1)).toBe('duck');
  expect(order.at(-2)).toBe('exit');
  await page.locator('button.label[data-go="duck"]').click();
  expect(await land(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('duck');
  // Found: no more strays.
  expect(await page.evaluate(() => window.__map!.traffic.sendStray())).toBe(false);
});

test('the keyboard: Tab from the origin’s label reaches the stray while it rides, it waits while focused, and Enter follows it', async ({ page }) => {
  await open(page);
  await sendStray(page);
  await page.locator('button.label[data-go="origin"]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.stray-hit')).toBeFocused();
  await expect(page.locator('.stray-hit')).toHaveAccessibleName('Follow the stray signal');
  const before = await page.evaluate(() => window.__map!.traffic.stray!.position.toArray());
  await advance(page, 2);
  expect(await page.evaluate(() => window.__map!.traffic.stray!.position.toArray())).toEqual(before);
  await page.keyboard.press('Enter');
  expect(await land(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('duck');
  // Focus never drops to the page as the button goes: it's on the duck's own label, or the panel's heading.
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.matches('button.label[data-go="duck"], section.station[data-node="duck"] h2') ?? false;
  });
  expect(focused).toBe(true);
});

test('with motion reduced a stray waits still on its way, and a click on it still finds the duck', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  expect(await page.evaluate(() => window.__map!.traffic.alive)).toBe(0); // no traffic
  await sendStray(page);
  // No waddle; the trail alone marks it, drawn up to where it waits.
  await advance(page, 1.1);
  expect(await marks(page)).toMatchObject({ side: 0, yaw: 0, trail: true });
  const box = (await page.locator('.stray-hit').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await land(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('duck');
  const s = await duckState(page);
  expect(s).toMatchObject({ model: true, link: 1, ring: true, label: true, section: true });
});

// The duck's model (59 KB) isn't part of the arrival: most visitors never find it. It's fetched
// as the first stray sets out, and is in by the time the follow lands.
test('duck.glb is fetched only once a stray sets out, and the duck shows on landing', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.endsWith('/duck.glb')) asked.push(r.url());
  });
  await open(page);
  await advance(page, 2);
  await page.waitForTimeout(500);
  expect(asked, 'no duck.glb in or after the arrival').toEqual([]);
  // Its bounds are known before the model is in (DUCK_BOUNDS), for its framing and footprint.
  expect(await page.evaluate(() => window.__map!.nodes.get('duck').bounds.isEmpty())).toBe(false);
  const fetched = page.waitForRequest((r) => new URL(r.url()).pathname.endsWith('/duck.glb'));
  await sendStray(page);
  await fetched;
  await page.evaluate(() => window.__map!.nodes.get('duck').ready);
  await page.locator('.stray-hit').click();
  expect(await land(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('duck');
  expect(await page.evaluate(() => window.__map!.nodes.get('duck').root.visible)).toBe(true);
  expect(await page.evaluate(() => window.__map!.nodes.get('duck').has('poke'))).toBe(true);
  expect(asked).toHaveLength(1);
});

test('a follow that lands before duck.glb is in still lands framed, and the duck appears as it comes in', async ({ page }) => {
  let release = (): void => undefined;
  const held = new Promise<void>((r) => (release = r));
  await page.route((url) => url.pathname.endsWith('/duck.glb'), async (route) => {
    await held;
    await route.continue();
  });
  await open(page);
  await sendStray(page);
  await page.locator('.stray-hit').click();
  expect(await land(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('duck');
  expect(await page.evaluate(() => window.__map!.nodes.get('duck').has('appear'))).toBe(false); // not in yet
  const before = await page.evaluate(() => window.__map!.stage.camera.position.toArray());
  release();
  await page.evaluate(() => window.__map!.nodes.get('duck').ready);
  await advance(page, 1.5);
  expect(await page.evaluate(() => window.__map!.nodes.get('duck').root.visible)).toBe(true);
  // Framed for its known bounds all along: the camera stays where it landed, within drift.
  const after = await page.evaluate(() => window.__map!.stage.camera.position.toArray());
  expect(Math.hypot(after[0]! - before[0]!, after[1]! - before[1]!, after[2]! - before[2]!)).toBeLessThan(0.1);
  const s = await duckState(page);
  expect(s).toMatchObject({ model: true, link: 1, ring: true, label: true, section: true });
});

/** Where the stray sets out, whether its button is on screen, and how far its node is from the duck. */
const setOut = (page: Page) =>
  page.evaluate(() => {
    const { traffic, nodes } = window.__map!;
    const from = traffic.strayWay?.from ?? null;
    const at = from ? nodes.get(from).root.position : null;
    const duck = nodes.get('duck').root.position;
    return {
      from,
      shown: !document.querySelector('li.stray')!.hasAttribute('data-off'),
      fromDuck: at ? Math.hypot(at.x - duck.x, at.z - duck.z) : null,
    };
  });

// The owner's test (2026-10-21): every stray left the origin, "always in one position". Now it
// sets out from the station you're at, in view, and following it from there still lands at the
// duck: a homelab device, the far side of the map, and the right-hand edge.
for (const station of ['server', 'colophon', 'exit']) {
  test(`at ${station}, a stray sets out from ${station} in view, and following it lands at the duck`, async ({ page }) => {
    await open(page);
    await page.evaluate((id) => window.__map!.stations.go(id), station);
    expect(await land(page)).toBe('station');
    await sendStray(page);
    expect(await setOut(page)).toMatchObject({ from: station, shown: true });
    await page.locator('.stray-hit').click();
    expect(await land(page)).toBe('station');
    expect(await page.evaluate(() => window.__map!.stations.current)).toBe('duck');
    expect(new URL(page.url()).hash).toBe('#duck');
    expect(await duckState(page)).toMatchObject({ model: true, link: 1, ring: true, label: true, section: true, revealed: true });
  });
}

test('in the overview a stray sets out from a node on screen, not one near the duck', async ({ page }) => {
  await open(page);
  await sendStray(page);
  const s = await setOut(page);
  expect(s.shown).toBe(true);
  expect(s.fromDuck!).toBeGreaterThanOrEqual(5);
  // sendStray(from) sends it out of that node instead (tests, the dev console), wherever you are.
  await open(page);
  await page.evaluate(() => window.__map!.stations.go('fettle'));
  await land(page);
  await sendStray(page, 'idiff');
  expect((await setOut(page)).from).toBe('idiff');
});

test('with motion reduced, at a station, the stray waits in view on its way out of that node', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.evaluate(() => window.__map!.stations.go('colophon'));
  expect(await land(page)).toBe('station');
  await sendStray(page);
  await advance(page, 0.1);
  expect(await setOut(page)).toMatchObject({ from: 'colophon', shown: true });
  const box = (await page.locator('.stray-hit').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await land(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('duck');
});
