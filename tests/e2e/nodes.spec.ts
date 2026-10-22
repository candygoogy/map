import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../src/copy';
import { parseFeed } from '../../src/data/feed';
import { renderStations } from '../../src/fallback/html';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// Every check runs on the manual clock (?test): springs move only when __map.advance says.

/** Opens the map under ?test, waits for every node's model, skips the arrival (Task 9), and renders one frame. */
async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    await window.__map!.director.ready;
    window.__map!.director.skipArrival();
    window.__map!.advance(1 / 60);
  });
}

const advance = (page: Page, seconds: number) => page.evaluate((s) => window.__map!.advance(s), seconds);

/** The node's root position (y is its lift off the floor). */
const where = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { x, y, z } = window.__map!.nodes.get(id).root.position;
    return { x, y, z };
  }, id);

/** Where the node's link ends now: its last segment's end point. */
const linkEnd = (page: Page, id: string) =>
  page.evaluate((id) => {
    const line = window.__map!.stage.scene.getObjectByName(`link:${id}`) as unknown as {
      geometry: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } };
    };
    const end = line.geometry.getAttribute('instanceEnd');
    const i = end.count - 1;
    return { x: end.getX(i), y: end.getY(i), z: end.getZ(i) };
  }, id);

const near = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The top of the mast over a node standing at `p`: where its link ends. */
const mastTop = (p: { x: number; y: number; z: number }) => ({ ...p, y: p.y + tuning.linkMast });

/** The CSS px point over the middle of the node's model. */
const screenOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { stage, nodes } = window.__map!;
    const node = nodes.get(id);
    const p = node.root.localToWorld(node.bounds.getCenter(node.root.position.clone())).project(stage.camera);
    const { width, height } = stage.viewport;
    return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
  }, id);

/** Node `id`'s ground ring's colour now, and the theme's --edge and --soft, as hex. */
const ring = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { stage } = window.__map!;
    const line = stage.scene.getObjectByName(`ring:${id}`) as unknown as { material: { color: { getHex(): number } } };
    return { now: line.material.color.getHex(), edge: stage.theme.edge.getHex(), soft: stage.theme.soft.getHex() };
  }, id);

// Line ends (a) fade (the owner's pick, 2026-10-21 night): once a model is in, its
// link stops at its edge and fades out to it; the patched LineMaterial compiles and links.
test("a link stopped at its model's edge fades out to it, and its shader links", async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  page.on('pageerror', (e) => void errors.push(e.message));
  await open(page);
  const run = await page.evaluate(() => {
    const { stage } = window.__map!;
    type Link = {
      name: string;
      material: { vertexColors: boolean; transparent: boolean };
      geometry: { instanceCount: number; getAttribute(n: string): { data: { array: ArrayLike<number> } } | undefined };
    };
    const ends: Record<string, number[]> = {};
    stage.scene.traverse((o) => {
      const l = o as unknown as Link;
      const c = l.geometry?.getAttribute('instanceColorStart');
      if (!o.name.startsWith('link:') || !c || !l.material.vertexColors || !l.material.transparent) return;
      const n = l.geometry.instanceCount;
      ends[o.name] = [c.data.array[6 * (n - 1)]!, c.data.array[6 * n - 3]!]; // the last segment's alphas
    });
    const gl = stage.renderer.getContext();
    const programs = stage.renderer.info.programs as unknown as { program: WebGLProgram; name: string }[];
    return { ends, unlinked: programs.filter((p) => !gl.getProgramParameter(p.program, gl.LINK_STATUS)).map((p) => p.name) };
  });
  expect(Object.keys(run.ends).length, 'most nodes stop their link at the model').toBeGreaterThanOrEqual(8);
  for (const [name, [from, to]] of Object.entries(run.ends)) {
    expect(to, `${name}: gone at the edge`).toBe(0);
    expect(from, `${name}: fading`).toBeLessThan(1);
  }
  expect(run.unlinked).toEqual([]);
  expect(errors).toEqual([]);
});

// The owner's test notes: a hover that lifted the model moved the very thing being
// aimed at. Hover brightens the node's ground ring (--edge to --soft) and the model stays put.
test('hovering fettle brightens its ground ring and leaves the model where it is', async ({ page }) => {
  await open(page);
  expect((await ring(page, 'fettle')).now).toBe((await ring(page, 'fettle')).edge);
  const at = await screenOf(page, 'fettle');
  await page.mouse.move(at.x, at.y);
  await advance(page, 0.06); // on its way
  const mid = await ring(page, 'fettle');
  expect(mid.now).not.toBe(mid.edge);
  expect(mid.now).not.toBe(mid.soft);
  await advance(page, 1);
  expect((await ring(page, 'fettle')).now).toBe(mid.soft);
  expect((await where(page, 'fettle')).y).toBe(0);
  await page.mouse.move(5, 5); // off it: back to --edge
  await advance(page, 1);
  expect((await ring(page, 'fettle')).now).toBe(mid.edge);
});

/** Node `id`'s ground ring's width now, in CSS px. */
const ringPx = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { stage } = window.__map!;
    const line = stage.scene.getObjectByName(`ring:${id}`) as unknown as { material: { linewidth: number } };
    return line.material.linewidth / stage.viewport.pixelRatio;
  }, id);

// At 1 px the --soft ring barely read in the overview, where a ring is a few px across
// (map-tweaks): the hovered ring is tuning.hoverRing wide as well, eased in and out with its
// colour. A switched-off node's goes back to a 1 px --ghost.
test('in the overview a hovered ring eases to --soft and hoverRing wide, and back to 1 px --edge, or --ghost when off', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('overview');
  expect(await ringPx(page, 'desktop')).toBe(tuning.hairline);
  const at = await screenOf(page, 'desktop');
  await page.mouse.move(at.x, at.y);
  await advance(page, 0.06); // on its way
  const mid = await ringPx(page, 'desktop');
  expect(mid).toBeGreaterThan(tuning.hairline);
  expect(mid).toBeLessThan(tuning.hoverRing);
  await advance(page, 1);
  expect(await ringPx(page, 'desktop')).toBe(tuning.hoverRing);
  const on = await ring(page, 'desktop');
  expect(on.now).toBe(on.soft);
  await page.evaluate(() => window.__map!.links.setLit('desktop', false));
  await advance(page, 1);
  expect(await ringPx(page, 'desktop'), 'hovered while off').toBe(tuning.hoverRing);
  await page.mouse.move(5, 5);
  await advance(page, 1);
  expect(await ringPx(page, 'desktop')).toBe(tuning.hairline);
  const off = await page.evaluate(() => {
    const { stage } = window.__map!;
    const line = stage.scene.getObjectByName('ring:desktop') as unknown as { material: { color: { getHex(): number } } };
    return { now: line.material.color.getHex(), ghost: stage.theme.ghost.getHex() };
  });
  expect(off.now).toBe(off.ghost);
});

test('with motion reduced, a hover brightens the ring on the next frame, without easing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.evaluate(() => window.__map!.nodes.get('origin').hover(true)); // the origin has a ring and no link
  await advance(page, 1 / 60);
  const r = await ring(page, 'origin');
  expect(r.now).toBe(r.soft);
  expect(await ringPx(page, 'origin')).toBe(tuning.hoverRing);
  expect((await where(page, 'origin')).y).toBe(0);
});

test('dragging a node moves it and on release it returns home within 1.5 s', async ({ page }) => {
  await open(page);
  const home = await where(page, 'idiff');
  const at = await screenOf(page, 'idiff');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(tuning.pullHold * 1000 + 100); // held: a pull, not a click
  await page.mouse.move(at.x + 80, at.y + 30, { steps: 8 });
  await advance(page, 0.6);
  const pulled = await where(page, 'idiff');
  expect(Math.hypot(pulled.x - home.x, pulled.z - home.z)).toBeGreaterThan(0.3);
  expect(pulled.y).toBeGreaterThan(tuning.dragLift * 0.8);
  expect(near(await linkEnd(page, 'idiff'), mastTop(pulled))).toBeLessThan(0.01); // the link stretches to it, on its mast

  await page.mouse.up();
  await advance(page, 1.5);
  const back = await where(page, 'idiff');
  expect(near(back, home)).toBeLessThan(0.01);
  expect(near(await linkEnd(page, 'idiff'), mastTop(home))).toBeLessThan(0.01);
});

/** Travels to station `id` and lands. */
async function landAt(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => window.__map!.stations.go(id), id);
  await advance(page, tuning.flight.max + 1);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
}

/** The rest of the shown nodes' homes, and how near node `id` comes to any of them now (on the floor). */
const nearest = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { nodes } = window.__map!;
    const at = nodes.get(id).root.position;
    return Math.min(...nodes.all().filter((n) => n.id !== id && n.root.visible).map((n) => Math.hypot(n.home.x - at.x, n.home.z - at.z)));
  }, id);

// The owner, 2026-10-22 morning: a pulled neighbour landed on the station's own model. At a
// station nothing pulls (a press is a click: a poke, or travel); in the overview a pull stops
// at its neighbours' ground rings, rings touching, so no two models ever overlap.
test('at a station a drag on a neighbour moves nothing, and a click on the station still pokes it', async ({ page }) => {
  await open(page);
  // A station with a neighbour in view, clear of the panel and the labels: the homelab's cluster.
  const station = 'switch';
  await landAt(page, station);
  const other = await page.evaluate(() => {
    const { stage, nodes, stations } = window.__map!;
    const { width, height } = stage.viewport;
    const canvas = stage.renderer.domElement;
    for (const n of nodes.all()) {
      if (n.id === stations.current || !n.root.visible) continue;
      const p = n.root.localToWorld(n.bounds.getCenter(n.root.position.clone())).project(stage.camera);
      const x = ((p.x + 1) / 2) * width;
      const y = ((1 - p.y) / 2) * height;
      if (p.z < 1 && x > 40 && x < width - stage.inset.right - 40 && y > 100 && y < height - 40 && document.elementFromPoint(x, y) === canvas) return { id: n.id, x, y };
    }
    return null;
  });
  expect(other, 'a neighbour in view at the station').not.toBeNull();
  const { id, x, y } = other!;
  for (const held of [true, false]) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    if (held) await page.waitForTimeout(tuning.pullHold * 1000 + 100); // past the hold: in the overview, a pull
    await page.mouse.move(x + 90, y + 40, { steps: 8 });
    await advance(page, 0.3);
    expect(await page.evaluate((id) => window.__map!.nodes.get(id).root.position.distanceTo(window.__map!.nodes.get(id).home), id), `held: ${held}`).toBe(0);
    await page.mouse.up();
    await advance(page, 0.1);
    expect(await page.evaluate(() => window.__map!.stations.current)).toBe(station); // a drag isn't a click
    expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
  }
  // A click on the station's own model still pokes it.
  const me = await screenOf(page, station);
  await page.mouse.click(me.x, me.y);
  expect(await page.evaluate((id) => window.__map!.nodes.get(id).playing, station)).toMatch(/^poke/);
});

test("in the overview a pulled model stops at its neighbour's ground ring, there and back", async ({ page }) => {
  await open(page);
  const ring2 = 2 * tuning.groundRing;
  // The switch, 1.57 from homelab: pulled by the pointer straight at homelab and on past it.
  const from = await screenOf(page, 'switch');
  const to = await screenOf(page, 'homelab');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down(); // the first press asks for the input chunk, which carries the ring stop
  await page.waitForTimeout(tuning.pullHold * 1000 + 300);
  let closest = Infinity;
  for (let i = 1; i <= 20; i++) {
    const k = (i / 20) * 2.5; // to homelab and as far again beyond
    await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    await advance(page, 1 / 30);
    closest = Math.min(closest, await nearest(page, 'switch'));
  }
  const pulled = await where(page, 'switch');
  expect(Math.hypot(pulled.x - -6.55, pulled.z - 8.2)).toBeGreaterThan(0.2); // it did move
  await page.mouse.up();
  for (let i = 0; i < 90; i++) {
    await advance(page, 1 / 60);
    closest = Math.min(closest, await nearest(page, 'switch'));
  }
  expect(closest).toBeGreaterThan(ring2 - 0.01);
  expect(near(await where(page, 'switch'), { x: -6.55, y: 0, z: 8.2 })).toBeLessThan(0.01); // home again
});

test('a pull round a neighbour goes round its ring, and the way home goes round it too', async ({ page }) => {
  await open(page);
  await page.mouse.click(5, 300); // asks for the input chunk (the ring stop)
  await expect.poll(() => page.evaluate(() => window.__map!.director.state)).toBe('overview');
  await page.waitForTimeout(300);
  const trace = await page.evaluate((r) => {
    const { nodes, advance } = window.__map!;
    const n = nodes.get('homelab');
    const other = nodes.get('switch').home;
    const gaps: number[] = [];
    const gap = () => Math.hypot(n.root.position.x - other.x, n.root.position.z - other.z);
    // Along a line through the switch's home and out the far side, then let go.
    const a = n.home.clone();
    const b = other.clone().multiplyScalar(2).sub(a);
    for (let i = 0; i <= 60; i++) {
      n.dragTo(a.clone().lerp(b, i / 60));
      advance(1 / 60);
      gaps.push(gap());
    }
    n.dragTo(null);
    for (let i = 0; i < 120; i++) {
      advance(1 / 60);
      gaps.push(gap());
    }
    return { least: Math.min(...gaps), r, home: n.root.position.distanceTo(n.home) };
  }, 2 * tuning.groundRing);
  expect(trace.least).toBeGreaterThan(trace.r - 0.01);
  expect(trace.home).toBeLessThan(0.01);
});

test('the hovered ring is tuning.hoverRing wide in the overview, and lighter up close at a station', async ({ page }) => {
  await open(page);
  const at = await screenOf(page, 'idiff');
  await page.mouse.move(at.x, at.y);
  await advance(page, 1);
  expect(await ringPx(page, 'idiff')).toBe(tuning.hoverRing);
  await page.mouse.move(5, 5);
  await landAt(page, 'idiff');
  const me = await screenOf(page, 'idiff');
  await page.mouse.move(me.x, me.y);
  await advance(page, 1);
  expect((await ring(page, 'idiff')).now).toBe((await ring(page, 'idiff')).soft);
  expect(await ringPx(page, 'idiff')).toBe(tuning.hoverRingNear.px);
  expect(tuning.hoverRingNear.px).toBeLessThan(tuning.hoverRing);
});

// The owner's test notes: a tap is never a drag. A finger that travels before
// tuning.pullHold doesn't pull, and having travelled, it isn't a tap either. (A mouse or pen
// pulls at once: rotation.spec.ts.)
test.describe('by touch', () => {
  test.use({ hasTouch: true });

  test('a quick press-drag under the hold does not pull the node', async ({ page }) => {
    await open(page);
    const home = await where(page, 'idiff');
    const at = await screenOf(page, 'idiff');
    await page.evaluate(() => {
      const t: number[] = [];
      (window as unknown as { __presses: number[] }).__presses = t;
      const canvas = window.__map!.stage.renderer.domElement;
      canvas.addEventListener('pointerdown', (e) => void (e.pointerType === 'touch' && t.push(e.timeStamp)), true);
      canvas.addEventListener('pointermove', (e) => void (e.pointerType === 'touch' && e.buttons && t.push(e.timeStamp)), true);
    });
    // A fingertip (CDP), as on a phone.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12 }] });
    await touch('touchStart', at.x, at.y);
    await touch('touchMove', at.x + 80, at.y + 30);
    const t = await page.evaluate(() => (window as unknown as { __presses: number[] }).__presses);
    expect(t.length, 'a touch press and move on the canvas').toBeGreaterThanOrEqual(2);
    expect(t.at(-1)! - t[0]!, 'the move came within the hold').toBeLessThan(tuning.pullHold * 1000);
    await advance(page, 0.3); // still pressed
    expect(near(await where(page, 'idiff'), home)).toBe(0);
    await touch('touchEnd');
    expect(await page.evaluate(() => window.__map!.director.state)).not.toBe('flying'); // no tap: no travel
  });
});

test('an unknown feed id renders a placeholder', async ({ page }) => {
  const requested: string[] = [];
  const failed: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => requested.push(new URL(r.url()).pathname));
  page.on('response', (r) => void (r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`)));
  page.on('pageerror', (e) => errors.push(e.message));
  // Chrome's Local Network Access refuses Vite's HMR socket to a document that route.fulfill
  // made (it isn't "from" localhost), so the dev client's own complaints about that are
  // this test's routing, not the page.
  const viteClient = /^WebSocket connection to 'ws:|^\[vite\] |^Failed to send error to Vite server/;
  page.on('console', (m) => void (m.type() === 'error' && !viteClient.test(m.text()) && errors.push(m.text())));

  // A feed with a project the map doesn't know yet: the page as the prerender plugin would
  // make it (the same renderStations), with the node added to the snapshot and the stations.
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const snapshot = /<script type="application\/json" id="feed-snapshot">([\s\S]*?)<\/script>/.exec(html)!;
      const feed = parseFeed(JSON.parse(snapshot[1]!));
      feed.nodes.splice(feed.nodes.length - 1, 0, { id: 'newthing', kind: 'project', name: 'New thing', links: [] });
      const json = JSON.stringify(feed).replace(/</g, '\\u003c');
      const body = html
        .replace(snapshot[0], () => `<script type="application/json" id="feed-snapshot">${json}</script>`)
        .replace(/<main id="stations">[\s\S]*?<\/main>/, () => `<main id="stations">${renderStations(feed, copy)}</main>`);
      await route.fulfill({ response, body });
    },
  );
  await open(page);

  await expect(page.locator('section#newthing h2')).toHaveText('New thing');
  const placeholder = await page.evaluate(() => window.__map!.nodes.get('newthing').root.getObjectByName('box') !== undefined);
  expect(placeholder).toBe(true);
  // Task 10: and a label (a <button class="label" data-go="newthing">).
  expect(requested).not.toContain('/models/newthing.glb');
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

// The Phase 1 motion audit (#7): a drag follows close and stops dead. (#15, a hover's lift
// without a bounce, went with the lift: the owner's test notes.)
test('a dragged model keeps close to the pointer and does not overshoot when it stops', async ({ page }) => {
  await open(page);
  const trace = await page.evaluate(() => {
    const { nodes, advance } = window.__map!;
    const n = nodes.get('idiff');
    const target = n.home.clone().add({ x: 1, y: 0, z: 0 } as never);
    const xs: number[] = [];
    n.dragTo(target);
    for (let i = 0; i < 60; i++) {
      advance(1 / 60);
      xs.push(n.root.position.x - n.home.x);
    }
    n.dragTo(null);
    return xs;
  });
  expect(Math.max(...trace)).toBeLessThanOrEqual(1.001);
  expect(trace.findIndex((x) => Math.abs(x - 1) < 0.02) / 60).toBeLessThan(0.25);
});
