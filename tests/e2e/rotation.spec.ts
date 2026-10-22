import { expect, test, type Page } from '@playwright/test';
import { Vector3 } from 'three';
import { clampToHull, hullOf } from '../../src/input/zoom';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// Map rotation (approved by the owner 2026-10-20): a turn swings a station's framing about its own
// target and the overview about the network's middle, left and right: all the way round in the
// overview, within ±tuning.turn.stationDeg at a station (decided 2026-10-21); it stays until the
// next travel, which leaves from the turned view and lands unturned. Moving the map (decided
// 2026-10-22 morning): in the overview a drag on the empty floor pans it (and glides on a little),
// and the turn moves to the right button, Shift or Ctrl with a drag, two fingers' twist and
// `[` `]`; at a station a floor drag still turns it. Zoom (the owner's test notes): the overview
// only, by wheel, pinch or `+` `-`, towards the pointer, between the composed overview and
// tuning.zoom.min of its distance; travel resets it all (on a phone, to its closer start). On the
// manual clock (?test).

type Size = { width: number; height: number };
const DESKTOP: Size = { width: 1440, height: 900 };
const PHONE: Size = { width: 390, height: 844 };

async function open(page: Page, size: Size = DESKTOP, hash = ''): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?test${hash}`);
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    const { director, nodes, advance } = window.__map!;
    await director.ready;
    await nodes.ready;
    director.skipArrival();
    advance(1 / 60);
  });
}

const advance = (page: Page, seconds: number) => page.evaluate((s) => window.__map!.advance(s), seconds);
const turn = (page: Page) => page.evaluate(() => window.__map!.director.turn);
const current = (page: Page) => page.evaluate(() => window.__map!.stations.current);

/** Travels to `id` (null: the overview) and lands. */
async function landAt(page: Page, id: string | null): Promise<void> {
  await page.evaluate((id) => (id === null ? window.__map!.stations.overview() : window.__map!.stations.go(id)), id);
  await advance(page, tuning.flight.max + 1);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe(id === null ? 'overview' : 'station');
}

/** The camera's pose: where it stands, and what it looks at on its line of sight `reach` ahead. */
const cameraNow = (page: Page) =>
  page.evaluate(() => {
    const { camera } = window.__map!.stage;
    const f = camera.getWorldDirection(camera.position.clone());
    return { p: camera.position.toArray(), f: f.toArray() };
  });

/**
 * A point on the canvas over the empty floor: nothing but the canvas under it (no label, no
 * panel), and well clear of every model on screen, so a press there is a floor press.
 */
const emptyFloor = (page: Page) =>
  page.evaluate(() => {
    const { stage, nodes } = window.__map!;
    const { width, height } = stage.viewport;
    const inset = stage.inset;
    const canvas = stage.renderer.domElement;
    const centres = nodes.all().map((n) => {
      const p = n.root.localToWorld(n.bounds.getCenter(n.root.position.clone())).project(stage.camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    });
    let best = { x: 0, y: 0, room: -1 };
    for (let y = 120; y < height - inset.bottom - 40; y += 16) {
      for (let x = 40; x < width - inset.right - 40; x += 16) {
        if (document.elementFromPoint(x, y) !== canvas) continue;
        const room = Math.min(...centres.map((c) => Math.hypot(c.x - x, c.y - y)));
        if (room > best.room) best = { x, y, room };
      }
    }
    return best;
  });

/** Drags with the mouse from `at` by dx (and dy), in steps: the left button, or the right (a turn). */
async function drag(page: Page, at: { x: number; y: number }, dx: number, dy = 0, steps = 12, button: 'left' | 'right' = 'left'): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button });
  await page.mouse.move(at.x + dx, at.y + dy, { steps });
  await advance(page, 1 / 60);
}

/** A turning drag: the right button. */
const turnDrag = (page: Page, at: { x: number; y: number }, dx: number, steps = 12) => drag(page, at, dx, 0, steps, 'right');

/** What the overview looks at, on the floor. */
const lookNow = (page: Page) => page.evaluate(() => window.__map!.director.look.toArray());

/** The visible width the drag is measured against (the canvas left of the side panel). */
const visibleWidth = (page: Page) => page.evaluate(() => window.__map!.stage.viewport.width - window.__map!.stage.inset.right);

/**
 * How far (degrees) the camera looks off its turned framing's target, and how much further that
 * target is from the network's middle (the shown nodes' bounds, fit.ts) than the composed one's.
 */
const orbit = (page: Page) =>
  page.evaluate(() => {
    const { director, stage, nodes } = window.__map!;
    const camera = stage.camera;
    const f = director.framing(null, (director.turn * Math.PI) / 180);
    const rest = director.framing(null);
    const homes = nodes.all().filter((n) => n.id !== 'duck').map((n) => n.home);
    const xs = homes.map((h) => h.x);
    const zs = homes.map((h) => h.z);
    const [mx, mz] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    const flat = (v: { x: number; z: number }) => Math.hypot(v.x - mx, v.z - mz);
    const ahead = camera.getWorldDirection(camera.position.clone());
    return { look: (ahead.angleTo(f.target.clone().sub(camera.position).normalize()) * 180) / Math.PI, swing: Math.abs(flat(f.target) - flat(rest.target)), moved: f.target.distanceTo(rest.target) };
  });

test("a right-drag on the empty floor turns the overview about the network's middle, all the way round, and it stays there on release", async ({ page }) => {
  await open(page);
  const at = await emptyFloor(page);
  expect(at.room).toBeGreaterThan(60);
  expect(await page.evaluate(() => window.__map!.stage.renderer.domElement.style.cursor)).toBe('');
  await page.mouse.move(at.x, at.y);
  expect(await page.evaluate(() => window.__map!.stage.renderer.domElement.style.cursor)).toBe('grab');

  // 100 px to the right: the floor goes with the pointer, so the camera swings left (a negative turn).
  const w = await visibleWidth(page);
  const look = await lookNow(page);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(at.x + 100, at.y, { steps: 10 });
  await advance(page, 1 / 60);
  expect(await page.evaluate(() => window.__map!.stage.renderer.domElement.style.cursor)).toBe('grabbing');
  const t1 = await turn(page);
  const expected = ((100 - tuning.dragThresholdPx) / w) * tuning.turn.overviewWidthDeg;
  expect(t1).toBeLessThan(0);
  expect(Math.abs(t1)).toBeGreaterThan(expected * 0.9);
  expect(Math.abs(t1)).toBeLessThan(expected * 1.1 + 0.01);
  // Orbiting the network's middle: the camera still looks straight at its framing's target,
  // which swings round the middle with it.
  const near = await orbit(page);
  expect(near.look).toBeLessThan(0.01);
  expect(near.swing).toBeLessThan(1e-6);

  // On round: no clamp. Two visible widths more is 360° more (the pointer captured off the
  // canvas), every step on the same rate, the turn kept in (−180, 180].
  const seen: number[] = [];
  let last = t1;
  let swept = 0;
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(at.x + 100 + (2 * w * i) / 40, at.y);
    await advance(page, 1 / 60);
    const t = await turn(page);
    expect(t).toBeGreaterThan(-180);
    expect(t).toBeLessThanOrEqual(180);
    const step = ((t - last + 540) % 360) - 180; // the short way
    expect(step).toBeCloseTo(-(2 * w * tuning.turn.overviewWidthDeg) / w / 40, 4);
    swept += step;
    last = t;
    seen.push(t);
  }
  expect(swept).toBeCloseTo(-360, 3);
  expect(Math.max(...seen)).toBeGreaterThan(150); // through the back of the map
  expect(Math.min(...seen)).toBeLessThan(-150);
  // Seen from behind, it still orbits the network's middle: the target swung round to the far
  // side of it (the composed target isn't the middle).
  await page.mouse.move(at.x + 100 + w, at.y);
  await advance(page, 1 / 60);
  expect(Math.abs(await turn(page))).toBeGreaterThan(150);
  const behind = await orbit(page);
  expect(behind.look).toBeLessThan(0.01);
  expect(behind.swing).toBeLessThan(1e-6);
  expect(behind.moved).toBeGreaterThan(0.1);
  await page.mouse.up({ button: 'right' });
  const kept = await turn(page);
  await advance(page, 2);
  expect(await turn(page)).toBe(kept); // no spring back, no fling
  expect(await current(page)).toBeNull(); // a drag isn't a click: nothing travelled
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('overview');
  // A turn, not a pan: unpanned, it still looks at its turned framing's target (orbit, above).
  expect((await orbit(page)).look).toBeLessThan(0.01);
  expect(look).toHaveLength(3);
});

test('Shift or Ctrl with a left drag turns the overview as the right button does, and the canvas keeps its context menu', async ({ page }) => {
  await open(page);
  const at = await emptyFloor(page);
  const look = await lookNow(page);
  for (const key of ['Shift', 'Control'] as const) {
    const before = await turn(page);
    await page.keyboard.down(key);
    await drag(page, at, 80);
    await page.mouse.up();
    await page.keyboard.up(key);
    expect(await turn(page), key).toBeLessThan(before);
  }
  // Turned, not panned: the target swung round the middle with the view, as the framing has it.
  expect((await orbit(page)).look).toBeLessThan(0.01);
  const now = await page.evaluate(() => {
    const { director } = window.__map!;
    return director.look.distanceTo(director.framing(null, (director.turn * Math.PI) / 180).target);
  });
  expect(now).toBeLessThan(1e-6);
  expect(look).toHaveLength(3);
  const menu = await page.evaluate(({ x, y }) => {
    const e = new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 2 });
    window.__map!.stage.renderer.domElement.dispatchEvent(e);
    return e.defaultPrevented;
  }, at);
  expect(menu).toBe(true);
});

test('a left drag on the empty floor pans the overview: the floor under the pointer stays under it, it glides on a little, and it never turns', async ({ page }) => {
  await open(page);
  const at = await emptyFloor(page);
  await page.mouse.move(at.x, at.y);
  await advance(page, 1); // the drift settles where the pointer is
  const grabbed = await floorUnder(page, at);
  const look = await lookNow(page);
  const z = await zoomNow(page);
  await page.mouse.down();
  // The chunk comes in on the first drag; the pan then catches up with the pointer.
  for (let i = 1; i <= 10; i++) await page.mouse.move(at.x - 12 * i, at.y - 6 * i);
  await expect.poll(async () => {
    await advance(page, 1 / 60);
    const p = await onScreen(page, grabbed);
    return Math.hypot(p.x - (at.x - 120), p.y - (at.y - 60));
  }).toBeLessThan(1.5);
  expect(await page.evaluate(() => window.__map!.stage.renderer.domElement.style.cursor)).toBe('grabbing');
  expect(await turn(page)).toBe(0);
  expect(await zoomNow(page)).toBe(z);
  const moved = await lookNow(page);
  expect(Math.hypot(moved[0]! - look[0]!, moved[2]! - look[2]!)).toBeGreaterThan(1);
  expect(moved[1]).toBe(0);
  // A quick last move, then let go: it glides on the same way, a little, and stops.
  await page.mouse.move(at.x - 160, at.y - 80, { steps: 2 });
  const released = await lookNow(page);
  await page.mouse.up();
  const way = [moved[0]! - look[0]!, moved[2]! - look[2]!];
  await advance(page, 0.1);
  const gliding = await lookNow(page);
  const on = [gliding[0]! - released[0]!, gliding[2]! - released[2]!];
  expect(Math.hypot(on[0]!, on[1]!)).toBeGreaterThan(0.01);
  expect(on[0]! * way[0]! + on[1]! * way[1]!).toBeGreaterThan(0); // on the way it was going
  await advance(page, 2);
  const stopped = await lookNow(page);
  await advance(page, 1);
  expect(await lookNow(page)).toEqual(stopped);
  expect(await page.evaluate(() => window.__map!.director.animating)).toBe(false);
  // Short and damped: under a sixth of the camera's distance in all.
  const reach = await page.evaluate(() => window.__map!.stage.camera.position.distanceTo(window.__map!.director.look));
  expect(Math.hypot(stopped[0]! - released[0]!, stopped[2]! - released[2]!)).toBeLessThan(reach * tuning.pan.maxSpeed * tuning.pan.glide + 1e-6);
  expect(await current(page)).toBeNull();
});

test("the pan stays within the network's reach, at any zoom and turn", async ({ page }) => {
  test.setTimeout(120_000); // a dozen drags and their glides
  await open(page);
  const at = await emptyFloor(page);
  // Within tuning.pan.margin of the shown nodes' hull (fit.ts): kept as it is by the clamp.
  const inside = async () => {
    const { look, homes } = await page.evaluate(() => {
      const { director, nodes } = window.__map!;
      const homes = nodes.all().filter((n) => n.id !== 'duck').map((n) => n.home.toArray());
      return { look: director.look.toArray(), homes };
    });
    const hull = hullOf(homes.map((h) => new Vector3(...h)));
    const kept = clampToHull(new Vector3(...look), hull, tuning.pan.margin + 1e-6);
    const near = Math.min(...homes.map((h) => Math.hypot(h[0]! - look[0]!, h[2]! - look[2]!)));
    return { off: kept.distanceTo(new Vector3(...look)), near, look };
  };
  for (const [z, turns] of [
    [1, 0],
    [0.4, 0],
    [0.4, 9],
    [0.25, -20],
  ] as const) {
    await page.evaluate(
      ({ z, turns }) => {
        const { director } = window.__map!;
        director.turnBy(turns);
        director.viewTo(z, director.look);
      },
      { z, turns },
    );
    for (const [dx, dy] of [
      [-900, 0],
      [0, -900],
      [700, 700],
    ]) {
      await drag(page, at, dx!, dy!, 8);
      await page.mouse.up();
      await advance(page, 1); // and any glide
      const { off, near } = await inside();
      const what = `zoom ${z}, ${turns} key turns, dragged ${dx}, ${dy}`;
      expect(off, what).toBeLessThan(1e-6);
      // So a node is never far: the hull's edges join nodes (the longest about 11 units).
      expect(near, what).toBeLessThan(6 + tuning.pan.margin);
    }
  }
  // Pushed on past the edge, it slides along it at most, and never out.
  await drag(page, at, 3000, 0, 20);
  await page.mouse.up();
  await advance(page, 1);
  expect((await inside()).off).toBeLessThan(1e-6);
});

test('with motion reduced the pan follows the pointer and lets go dead, without a glide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const at = await emptyFloor(page);
  const grabbed = await floorUnder(page, at);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(at.x + 15 * i, at.y);
  await expect.poll(async () => {
    const p = await onScreen(page, grabbed);
    return Math.hypot(p.x - (at.x + 150), p.y - at.y);
  }).toBeLessThan(1.5);
  await page.mouse.move(at.x + 200, at.y, { steps: 2 });
  const released = await lookNow(page);
  await page.mouse.up();
  await page.waitForTimeout(50);
  await advance(page, 1);
  expect(await lookNow(page)).toEqual(released);
  expect(await page.evaluate(() => window.__map!.director.animating)).toBe(false);
});

test('dragging a model still pulls it and turns nothing; a click on it still travels', async ({ page }) => {
  await open(page);
  const at = await page.evaluate(() => {
    const { stage, nodes } = window.__map!;
    const n = nodes.get('idiff');
    const p = n.root.localToWorld(n.bounds.getCenter(n.root.position.clone())).project(stage.camera);
    return { x: ((p.x + 1) / 2) * stage.viewport.width, y: ((1 - p.y) / 2) * stage.viewport.height };
  });
  const home = await page.evaluate(() => window.__map!.nodes.get('idiff').root.position.toArray());
  // Held past tuning.pullHold first, as a finger must be (a mouse needn't: the next test but one).
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(tuning.pullHold * 1000 + 100);
  await page.mouse.move(at.x + 80, at.y + 30, { steps: 12 });
  await advance(page, 0.6);
  const pulled = await page.evaluate(() => window.__map!.nodes.get('idiff').root.position.toArray());
  expect(Math.hypot(pulled[0]! - home[0]!, pulled[2]! - home[2]!)).toBeGreaterThan(0.3);
  expect(await turn(page)).toBe(0);
  await page.mouse.up();
  await advance(page, 1.5);
  expect(await current(page)).toBeNull();
  await page.mouse.click(at.x, at.y);
  expect(await current(page)).toBe('idiff');
});

test('a floor click does nothing, and a floor drag never travels', async ({ page }) => {
  await open(page);
  const at = await emptyFloor(page);
  const look = await lookNow(page);
  await page.mouse.click(at.x, at.y);
  await advance(page, 0.2);
  expect(await current(page)).toBeNull();
  expect(await turn(page)).toBe(0);
  expect(await lookNow(page)).toEqual(look);
  await drag(page, at, -60);
  await page.mouse.up();
  expect(await current(page)).toBeNull();
  await turnDrag(page, at, -60);
  await page.mouse.up({ button: 'right' });
  expect(await current(page)).toBeNull();
  expect(await turn(page)).toBeGreaterThan(0);
});

// A mouse pulls at once, no hold (the owner, 2026-10-22: a quick drag from a model that panned
// the map read as "can't drag stuff anymore"); a finger still holds first (nodes.spec.ts).
test('a quick mouse drag starting on a model pulls it: the model moves, the map stays, and it is no click', async ({ page }) => {
  await open(page);
  const at = await page.evaluate(() => {
    const { stage, nodes } = window.__map!;
    const n = nodes.get('notary');
    const p = n.root.localToWorld(n.bounds.getCenter(n.root.position.clone())).project(stage.camera);
    return { x: ((p.x + 1) / 2) * stage.viewport.width, y: ((1 - p.y) / 2) * stage.viewport.height };
  });
  const look = await lookNow(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(at.x + 10 * i, at.y + 5 * i); // within tuning.pullHold
  await advance(page, 0.6);
  const moved = () => page.evaluate(() => window.__map!.nodes.get('notary').root.position.distanceTo(window.__map!.nodes.get('notary').home));
  expect(await moved()).toBeGreaterThan(0.3); // the model moved
  const now = await lookNow(page);
  expect(Math.hypot(now[0]! - look[0]!, now[2]! - look[2]!)).toBe(0); // the map didn't
  expect(await turn(page)).toBe(0);
  await page.mouse.up();
  await advance(page, 0.1);
  expect(await current(page)).toBeNull(); // nor was it a click
});

test('at a station it turns up to ±15°, and the next flight leaves from the turned view and lands unturned', async ({ page }) => {
  await open(page);
  await landAt(page, 'fettle');
  const at = await emptyFloor(page);
  await drag(page, at, -3000, 0, 40);
  await page.mouse.up();
  const t = await turn(page);
  expect(t).toBeGreaterThan(0.95 * tuning.turn.stationDeg);
  expect(t).toBeLessThan(tuning.turn.stationDeg);
  const turned = await cameraNow(page);
  await page.mouse.move(at.x, at.y + 1); // the pointer stays put: the drift with it
  await page.keyboard.press('ArrowRight');
  expect(await turn(page)).toBe(0);
  // The first frame of the flight is where the turned view was.
  await advance(page, 1 / 60);
  const first = await cameraNow(page);
  const d = Math.hypot(...first.p.map((v, i) => v - turned.p[i]!));
  expect(d).toBeLessThan(0.05);
  const next = await current(page);
  await advance(page, tuning.flight.max + 1);
  // Landed on the framing as composed: at its distance from its target and looking at it (the
  // drift orbits about the target, so both hold whatever the pointer does).
  const off = await page.evaluate((id) => {
    const { director, stage } = window.__map!;
    const f = director.framing(id);
    const cam = stage.camera;
    const dir = cam.getWorldDirection(cam.position.clone());
    const to = f.target.clone().sub(cam.position);
    return {
      reach: Math.abs(to.length() - f.position.distanceTo(f.target)),
      look: (dir.angleTo(to.normalize()) * 180) / Math.PI,
      apart: (cam.position.clone().sub(f.target).setY(0).angleTo(f.position.clone().sub(f.target).setY(0)) * 180) / Math.PI,
    };
  }, next);
  expect(off.reach).toBeLessThan(1e-3);
  expect(off.look).toBeLessThan(0.01);
  expect(off.apart).toBeLessThanOrEqual(tuning.driftYawDeg + 0.01); // the drift's, not the turn's
});

test('a floor drag mid-flight turns and pans nothing (the press is the boost there)', async ({ page }) => {
  await open(page);
  await landAt(page, 'fettle');
  const at = await emptyFloor(page);
  await page.evaluate(() => window.__map!.stations.overview());
  await advance(page, 0.1);
  await drag(page, at, 200);
  expect(await turn(page)).toBe(0);
  await page.mouse.up();
  await advance(page, tuning.flightDive + 1);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('overview');
  const home = await page.evaluate(() => window.__map!.director.home.target.toArray());
  expect(await lookNow(page)).toEqual(home); // landed where it always does
  expect(await page.evaluate(() => window.__map!.stage.renderer.domElement.style.cursor)).not.toBe('grab');
});

test('the labels follow the turn and the pan', async ({ page }) => {
  await open(page);
  const where = () =>
    page.evaluate(() => {
      const { stage, nodes } = window.__map!;
      const n = nodes.get('notary');
      const p = n.root.localToWorld(n.bounds.getCenter(n.root.position.clone())).project(stage.camera);
      const label = document.querySelector('button.label[data-go="notary"]')!.getBoundingClientRect();
      return { model: ((p.x + 1) / 2) * stage.viewport.width, y: ((1 - p.y) / 2) * stage.viewport.height, label: label.left, top: label.top };
    });
  const at = await emptyFloor(page);
  for (const button of ['right', 'left'] as const) {
    const a = await where();
    await drag(page, at, 150, button === 'left' ? 40 : 0, 12, button);
    await page.mouse.up({ button });
    await advance(page, 2); // a pan's glide too
    const b = await where();
    expect(Math.abs(b.model - a.model), button).toBeGreaterThan(10); // the model moved on screen
    expect(Math.abs(b.label - a.label - (b.model - a.model)), button).toBeLessThan(12); // and its label with it
    expect(Math.abs(b.top - a.top - (b.y - a.y)), button).toBeLessThan(12);
  }
});

test('the turn and the pan survive a resize', async ({ page }) => {
  await open(page);
  await turnDrag(page, await emptyFloor(page), 120);
  await page.mouse.up({ button: 'right' });
  await drag(page, await emptyFloor(page), 80, 30);
  await page.mouse.up();
  await advance(page, 2);
  const look = await lookNow(page);
  const t = await turn(page);
  expect(t).toBeLessThan(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await advance(page, 1 / 60);
  expect(await turn(page)).toBe(t);
  const now = await lookNow(page);
  // The pan is kept as an offset off the framing's target, which a refit moves a little.
  expect(Math.hypot(now[0]! - look[0]!, now[2]! - look[2]!)).toBeLessThan(0.5);
});

test('[ and ] turn the view 5° a press, all the way round in the overview and within ±15° at a station; ← → still travel', async ({ page }) => {
  await open(page);
  await page.keyboard.press(']');
  expect(await turn(page)).toBe(-tuning.turn.keyDeg); // as a drag to the right
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  expect(await turn(page)).toBe(tuning.turn.keyDeg);
  // 35 more is 180°; one more goes on round to −175°.
  for (let i = 0; i < 35; i++) await page.keyboard.press('[');
  expect(await turn(page)).toBe(180);
  await page.keyboard.press('[');
  expect(await turn(page)).toBe(-180 + tuning.turn.keyDeg);
  await page.keyboard.press('ArrowRight');
  expect(await current(page)).not.toBeNull();
  expect(await turn(page)).toBe(0);
  await advance(page, tuning.flight.max + 1);
  for (let i = 0; i < 8; i++) await page.keyboard.press('[');
  const t = await turn(page);
  expect(t).toBeGreaterThan(0.9 * tuning.turn.stationDeg);
  expect(t).toBeLessThan(tuning.turn.stationDeg);
});

test('with motion reduced the turn follows 1:1 (with a hard stop at a station\'s clamp), holds no frames, and travel cuts and resets it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  let at = await emptyFloor(page);
  let w = await visibleWidth(page);
  await turnDrag(page, at, 100, 10);
  // From where the press became a drag (its first 10 px step, past the threshold) on, 1:1.
  const expected = ((100 - 10) / w) * tuning.turn.overviewWidthDeg;
  expect(await turn(page)).toBeCloseTo(-expected, 6);
  expect(await page.evaluate(() => window.__map!.director.animating)).toBe(false);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('ArrowRight');
  expect(await turn(page)).toBe(0);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
  at = await emptyFloor(page);
  w = await visibleWidth(page);
  await drag(page, at, 100, 0, 10);
  expect(await turn(page)).toBeCloseTo(-((100 - 10) / (w * tuning.turn.span)) * 2 * tuning.turn.stationDeg, 6);
  await page.mouse.move(at.x + 3000, at.y, { steps: 10 });
  expect(await turn(page)).toBe(-tuning.turn.stationDeg);
  await page.mouse.move(at.x + 2990, at.y);
  expect(await turn(page)).toBeGreaterThan(-tuning.turn.stationDeg); // back at once
  await page.mouse.up();
  await page.keyboard.press('ArrowRight');
  expect(await turn(page)).toBe(0);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
  const off = await page.evaluate(() => {
    const { director, stage, stations } = window.__map!;
    return stage.camera.position.distanceTo(director.framing(stations.current).position);
  });
  expect(off).toBeLessThan(1e-6);
});

/** Touches with a fingertip's size, as on a phone (CDP, so Chrome's touch handling is real). */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12 }],
    });
  return {
    async drag(from: { x: number; y: number }, dx: number, dy: number, steps = 10) {
      await touch('touchStart', from.x, from.y);
      for (let i = 1; i <= steps; i++) await touch('touchMove', from.x + (dx * i) / steps, from.y + (dy * i) / steps);
      await touch('touchEnd');
    },
  };
}

/** Two fingers (CDP): `pts(k)` places them for k = 0 (as they land) to 1, in `steps` moves, the clock stepped each. */
async function twoFingers(page: Page, pts: (k: number) => [{ x: number; y: number }, { x: number; y: number }], steps = 10, lift = true) {
  const cdp = await page.context().newCDPSession(page);
  const at = (k: number) => pts(k).map((p, id) => ({ ...p, radiusX: 12, radiusY: 12, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
    await advance(page, 1 / 60);
  }
  if (lift) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('on a phone, by touch', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('the overview starts closer, centred on the hub, its inner ring of stations filling the width', async ({ page }) => {
    await open(page, PHONE);
    const start = await page.evaluate(() => {
      const { director, stage, nodes } = window.__map!;
      const origin = nodes.get('origin').home;
      const inner = nodes.all().filter((n) => n.id !== 'origin' && n.home.distanceTo(origin) < 7.2);
      const xs = inner.map((n) => ((n.home.clone().project(stage.camera).x + 1) / 2) * stage.viewport.width);
      return { zoom: director.zoom, home: director.home.zoom, look: director.look.distanceTo(origin), n: inner.length, xs, width: stage.viewport.width };
    });
    expect(start.zoom).toBe(start.home);
    expect(start.zoom).toBeLessThan(0.85); // closer than composed: about 1.25x
    expect(start.zoom).toBeGreaterThan(0.7);
    expect(start.look).toBeLessThan(1e-6);
    expect(start.n).toBe(6);
    // Every inner station in view, and the ring as wide as the screen, less a model's room each side.
    expect(Math.min(...start.xs)).toBeGreaterThan(0);
    expect(Math.max(...start.xs)).toBeLessThan(start.width);
    expect(Math.max(...start.xs) - Math.min(...start.xs)).toBeGreaterThan(start.width * 0.8);
    // The desktop's start is the composed overview, as ever.
    await page.setViewportSize(DESKTOP);
    await advance(page, 1 / 60);
    expect(await page.evaluate(() => window.__map!.director.home.zoom)).toBe(1);
  });

  for (const size of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    test(`a tablet (${size.width}×${size.height}) starts no closer than a phone, with every station on screen`, async ({ page }) => {
      await open(page, size);
      const start = await page.evaluate(() => {
        const { director, stage, nodes, stations } = window.__map!;
        const { width, height } = stage.viewport;
        const top = document.querySelector('.top')!.getBoundingClientRect().bottom;
        const sheet = document.getElementById('stations')!.getBoundingClientRect();
        const right = sheet.top > 0 ? width : sheet.left; // the sheet below, or the column beside
        const floor = sheet.top > 0 ? sheet.top : height;
        const out = stations.ids.filter((id) => {
          const p = nodes.get(id).home.clone().project(stage.camera);
          const x = ((p.x + 1) / 2) * width;
          const y = ((1 - p.y) / 2) * height;
          return x < 0 || x > right || y < top || y > floor;
        });
        return { zoom: director.zoom, home: director.home.zoom, out };
      });
      expect(start.zoom).toBe(start.home);
      expect(start.zoom).toBeCloseTo(tuning.zoom.home, 6); // the inner ring alone would fill it at 2x
      expect(start.out).toEqual([]);
    });
  }

  test('played out, the arrival ends on the composed overview and eases in to the start, without a jump', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/?test');
    await page.waitForFunction(() => window.__map?.director !== undefined);
    await page.evaluate(async () => {
      await window.__map!.director.ready;
      await window.__map!.nodes.ready;
    });
    const steps: number[] = [];
    let last = await cameraNow(page);
    let composed = 0;
    for (let i = 0; i < 60 * 12; i++) {
      await advance(page, 1 / 60);
      const { state, zoom } = await page.evaluate(() => ({ state: window.__map!.director.state, zoom: window.__map!.director.zoom }));
      const now = await cameraNow(page);
      if (state === 'overview') {
        composed ||= zoom; // the first overview frame's
        steps.push(Math.hypot(...now.p.map((v, k) => v - last.p[k]!)));
        if (zoom === (await page.evaluate(() => window.__map!.director.home.zoom))) break; // there
      }
      last = now;
    }
    expect(composed).toBeGreaterThan(0.995); // from the composed overview, eased from its first frame
    expect(await zoomNow(page)).toBe(await page.evaluate(() => window.__map!.director.home.zoom));
    // An ease: no frame moves the camera more than a few times the average.
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(Math.max(...steps)).toBeLessThan(Math.max(mean * 4, 0.05));
  });

  test('one finger on the floor pans the overview, the floor under it staying under it, and the page does not scroll', async ({ page }) => {
    await open(page, PHONE);
    const at = await emptyFloor(page);
    expect(at.room).toBeGreaterThan(40);
    const grabbed = await floorUnder(page, at);
    const look = await lookNow(page);
    const f = await finger(page);
    await f.drag(at, 60, 40); // fetches the chunk
    await settle(page, 10);
    await advance(page, 2);
    const first = await lookNow(page);
    expect(Math.hypot(first[0]! - look[0]!, first[2]! - look[2]!)).toBeGreaterThan(0.3);
    // Now the chunk's in: a slow drag (no glide) holds the floor under the finger.
    const g2 = await floorUnder(page, at);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12 }] });
    await touch('touchStart', at.x, at.y);
    for (let i = 1; i <= 10; i++) await touch('touchMove', at.x - 5 * i, at.y + 4 * i);
    await expect.poll(async () => {
      await advance(page, 1 / 60);
      const p = await onScreen(page, g2);
      return Math.hypot(p.x - (at.x - 50), p.y - (at.y + 40));
    }).toBeLessThan(2);
    await page.waitForTimeout(150); // held still: no glide
    await touch('touchEnd');
    expect(await turn(page)).toBe(0);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    expect(await current(page)).toBeNull();
    expect(grabbed).toHaveLength(3);
  });

  test('two fingers twisting turn the overview with them, about their middle', async ({ page }) => {
    await open(page, PHONE);
    const at = await emptyFloor(page);
    await page.evaluate(() => window.__map!.stage.camera.position.toArray()); // warm
    await twoFingers(page, () => [{ x: at.x - 40, y: at.y }, { x: at.x + 40, y: at.y }], 2); // fetches the chunk
    await settle(page, 10);
    const mid = await floorUnder(page, at);
    const z = await zoomNow(page);
    // A quarter turn clockwise on the screen, the fingers 80 px apart all the way.
    const deg = 40;
    await twoFingers(page, (k) => {
      const a = (k * deg * Math.PI) / 180;
      return [
        { x: at.x - 40 * Math.cos(a), y: at.y - 40 * Math.sin(a) },
        { x: at.x + 40 * Math.cos(a), y: at.y + 40 * Math.sin(a) },
      ];
    }, 16);
    const t = await turn(page);
    // Clockwise on the screen turns the map clockwise: the camera swings right, a positive turn,
    // by the twist less the first tuning.pan.twistDeg (the dead zone for a pinch).
    expect(t).toBeGreaterThan(deg - tuning.pan.twistDeg - 3);
    expect(t).toBeLessThan(deg - tuning.pan.twistDeg + 3);
    const p = await onScreen(page, mid);
    expect(Math.hypot(p.x - at.x, p.y - at.y)).toBeLessThan(3); // about their middle
    expect(await zoomNow(page)).toBeCloseTo(z, 6); // the same distance apart: no zoom
    expect(await current(page)).toBeNull();
  });

  test('a pinch and a twist together zoom and turn at once, and a small wobble in a pinch turns nothing', async ({ page }) => {
    await open(page, PHONE);
    const at = await emptyFloor(page);
    await twoFingers(page, () => [{ x: at.x - 40, y: at.y }, { x: at.x + 40, y: at.y }], 2);
    await settle(page, 10);
    const z0 = await zoomNow(page);
    // Wider apart, wobbling 5° (under the dead zone): a zoom, no turn.
    await twoFingers(page, (k) => {
      const a = (5 * Math.sin(k * Math.PI * 2) * Math.PI) / 180;
      const r = 30 + 15 * k;
      return [
        { x: at.x - r * Math.cos(a), y: at.y - r * Math.sin(a) },
        { x: at.x + r * Math.cos(a), y: at.y + r * Math.sin(a) },
      ];
    }, 12);
    expect(await turn(page)).toBe(0);
    const z1 = await zoomNow(page);
    expect(z1).toBeCloseTo(Math.max((z0 * 30) / 45, tuning.zoom.min), 3);
    // Apart and twisted anticlockwise together.
    const mid = await floorUnder(page, at);
    await twoFingers(page, (k) => {
      const a = (-30 * k * Math.PI) / 180;
      const r = 30 + 10 * k;
      return [
        { x: at.x - r * Math.cos(a), y: at.y - r * Math.sin(a) },
        { x: at.x + r * Math.cos(a), y: at.y + r * Math.sin(a) },
      ];
    }, 12);
    expect(await zoomNow(page)).toBeCloseTo(Math.max((z1 * 30) / 40, tuning.zoom.min), 3);
    const t = await turn(page);
    expect(t).toBeLessThan(-(30 - tuning.pan.twistDeg - 3));
    expect(t).toBeGreaterThan(-(30 - tuning.pan.twistDeg + 3));
    const p = await onScreen(page, mid);
    expect(Math.hypot(p.x - at.x, p.y - at.y)).toBeLessThan(3);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY, window.visualViewport?.scale ?? 1])).toEqual([0, 0, 1]);
  });

  test('travel resets the pan, the turn and the zoom to the start, and back at the overview it is there again', async ({ page }) => {
    await open(page, PHONE);
    const home = await page.evaluate(() => ({ zoom: window.__map!.director.home.zoom, look: window.__map!.director.home.target.toArray() }));
    const at = await emptyFloor(page);
    await (await finger(page)).drag(at, 80, 60);
    await settle(page, 10);
    await twoFingers(page, (k) => {
      const a = (60 * k * Math.PI) / 180;
      return [
        { x: at.x - 40 * Math.cos(a), y: at.y - 40 * Math.sin(a) },
        { x: at.x + 40 * Math.cos(a), y: at.y + 40 * Math.sin(a) },
      ];
    }, 12);
    await advance(page, 2);
    expect(await turn(page)).not.toBe(0);
    expect(await lookNow(page)).not.toEqual(home.look);
    await landAt(page, 'notary');
    expect(await turn(page)).toBe(0);
    await landAt(page, null);
    expect(await zoomNow(page)).toBe(home.zoom);
    const look = await lookNow(page);
    expect(Math.hypot(look[0]! - home.look[0]!, look[2]! - home.look[2]!)).toBeLessThan(1e-6);
  });

  test('at a station one finger still turns the view (±15°), and two fingers do nothing', async ({ page }) => {
    await open(page, PHONE);
    await landAt(page, 'notary');
    const before = await cameraNow(page);
    const at = await emptyFloor(page);
    await (await finger(page)).drag(at, -120, 0);
    await advance(page, 1 / 60);
    const t = await turn(page);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(tuning.turn.stationDeg);
    expect(await zoomNow(page)).toBe(await page.evaluate(() => window.__map!.director.home.zoom)); // the overview's, untouched
    // At the station's turned framing's own distance from its target: no zoom.
    const zoomed = () =>
      page.evaluate(() => {
        const { director, stage, stations } = window.__map!;
        const f = director.framing(stations.current, (director.turn * Math.PI) / 180);
        return stage.camera.position.distanceTo(f.target) - f.position.distanceTo(f.target);
      });
    expect(Math.abs(await zoomed())).toBeLessThan(1e-3);
    // Two fingers: no zoom (the first finger's turn, as one finger's, is all).
    await twoFingers(page, (k) => [{ x: at.x - 30 - 20 * k, y: at.y }, { x: at.x + 30 + 20 * k, y: at.y }], 8);
    await advance(page, 1 / 60);
    expect(Math.abs(await zoomed())).toBeLessThan(1e-3);
    expect(Math.abs(await turn(page))).toBeLessThanOrEqual(tuning.turn.stationDeg);
    expect(before.p).toHaveLength(3);
    expect(await current(page)).toBe('notary');
  });

  test('a drag in the open sheet scrolls the sheet and never turns the map', async ({ page }) => {
    await open(page, PHONE, '#fettle');
    await advance(page, 4);
    expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
    const box = await page.evaluate(() => {
      const s = document.querySelector<HTMLElement>('#fettle')!;
      const r = s.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: Math.max(r.top + 40, 844 * 0.6), scrollable: s.scrollHeight > s.clientHeight + 2 };
    });
    const before = await page.evaluate(() => document.querySelector<HTMLElement>('#fettle')!.scrollTop);
    await (await finger(page)).drag(box, 0, -120);
    await advance(page, 1 / 60);
    expect(await turn(page)).toBe(0);
    if (box.scrollable) {
      await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('#fettle')!.scrollTop)).toBeGreaterThan(before);
    }
  });

  test('a tap on a model still travels after the map was moved and turned', async ({ page }) => {
    await open(page, PHONE);
    const at = await emptyFloor(page);
    await (await finger(page)).drag(at, -60, 20);
    await settle(page, 10);
    await advance(page, 2);
    await twoFingers(page, (k) => {
      const a = (-30 * k * Math.PI) / 180;
      return [
        { x: at.x - 40 * Math.cos(a), y: at.y - 40 * Math.sin(a) },
        { x: at.x + 40 * Math.cos(a), y: at.y + 40 * Math.sin(a) },
      ];
    }, 10);
    await advance(page, 1 / 60);
    expect(await turn(page)).toBeLessThan(0);
    const m = await page.evaluate(() => {
      const { stage, nodes } = window.__map!;
      const n = nodes.get('fettle');
      const p = n.root.localToWorld(n.bounds.getCenter(n.root.position.clone())).project(stage.camera);
      return { x: ((p.x + 1) / 2) * stage.viewport.width, y: ((1 - p.y) / 2) * stage.viewport.height };
    });
    await page.touchscreen.tap(m.x, m.y);
    expect(await current(page)).toBe('fettle');
    expect(await turn(page)).toBe(0);
  });
});

test('from the overview turned round, a flight leaves from the turned view, swings back and lands on the station as composed', async ({ page }) => {
  await open(page);
  for (let i = 0; i < 27; i++) await page.keyboard.press('['); // 135°
  expect(await turn(page)).toBe(135);
  const turned = await cameraNow(page);
  await page.evaluate(() => window.__map!.stations.go('notary'));
  expect(await turn(page)).toBe(0);
  await advance(page, 1 / 60);
  const first = await cameraNow(page);
  expect(Math.hypot(...first.p.map((v, i) => v - turned.p[i]!))).toBeLessThan(0.05);
  // It turns back a little at a time: no frame swings the view round by more than 4°.
  let last = first;
  let most = 0;
  for (let i = 0; i < 120 && (await page.evaluate(() => window.__map!.director.state)) === 'flying'; i++) {
    await advance(page, 1 / 60);
    const now = await cameraNow(page);
    const a = Math.atan2(last.f[2]!, last.f[0]!);
    const b = Math.atan2(now.f[2]!, now.f[0]!);
    most = Math.max(most, Math.abs(((((b - a) * 180) / Math.PI + 540) % 360) - 180));
    last = now;
  }
  expect(most).toBeLessThan(4);
  await advance(page, 1);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
  const off = await page.evaluate(() => {
    const { director, stage } = window.__map!;
    const f = director.framing('notary');
    const cam = stage.camera;
    const to = f.target.clone().sub(cam.position);
    return {
      reach: Math.abs(to.length() - f.position.distanceTo(f.target)),
      apart: (cam.position.clone().sub(f.target).setY(0).angleTo(f.position.clone().sub(f.target).setY(0)) * 180) / Math.PI,
    };
  });
  expect(off.reach).toBeLessThan(1e-3);
  expect(off.apart).toBeLessThanOrEqual(tuning.driftYawDeg + 0.01);
  // And back to the overview: as composed, unturned.
  await landAt(page, null);
  expect(await turn(page)).toBe(0);
  const back = await page.evaluate(() => {
    const { director, stage } = window.__map!;
    const f = director.framing(null);
    return Math.abs(stage.camera.position.distanceTo(f.target) - f.position.distanceTo(f.target));
  });
  expect(back).toBeLessThan(1e-3);
});

// --- zoom --------------------------------------------------------------------------------------

const zoomNow = (page: Page) => page.evaluate(() => window.__map!.director.zoom);

/** Steps the clock until the zoom chunk has answered and its ease has settled (or `tries` runs out). */
async function settle(page: Page, tries = 60): Promise<void> {
  let was = NaN;
  for (let i = 0; i < tries; i++) {
    await advance(page, 0.1);
    await page.waitForTimeout(20); // the chunk's fetch is real time
    const z = await zoomNow(page);
    if (z === was && !(await page.evaluate(() => window.__map!.director.animating))) return;
    was = z;
  }
}

/** The floor point (y = 0) under client px (x, y), as the camera sees it now. */
const floorUnder = (page: Page, at: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => {
    const { stage } = window.__map!;
    const cam = stage.camera;
    const r = stage.renderer.domElement.getBoundingClientRect();
    const d = cam.position.clone().set(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2, 0.5).unproject(cam).sub(cam.position);
    return d.multiplyScalar(-cam.position.y / d.y).add(cam.position).toArray();
  }, at);

/** Where world point `p` is on the canvas now, client px. */
const onScreen = (page: Page, p: number[]) =>
  page.evaluate((p) => {
    const { stage } = window.__map!;
    const v = stage.camera.position.clone().set(p[0]!, p[1]!, p[2]!).project(stage.camera);
    return { x: ((v.x + 1) / 2) * stage.viewport.width, y: ((1 - v.y) / 2) * stage.viewport.height };
  }, p);

/** How far the camera stands from what it looks at, as a share of the composed overview's. */
const reachShare = (page: Page) =>
  page.evaluate(() => {
    const { director, stage } = window.__map!;
    const f = director.framing(null, (director.turn * Math.PI) / 180);
    return stage.camera.position.distanceTo(director.look) / f.position.distanceTo(f.target);
  });

test.describe('zoom', () => {
  test('the wheel zooms the overview towards the pointer: the floor under it stays put, and the labels follow', async ({ page }) => {
    await open(page);
    const at = await emptyFloor(page);
    await page.mouse.move(at.x, at.y);
    await advance(page, 1); // the drift settles where the pointer is
    const p = await floorUnder(page, at);
    await page.mouse.wheel(0, -100);
    await settle(page);
    const z = await zoomNow(page);
    expect(z).toBeCloseTo(Math.exp(-100 * tuning.zoom.wheel), 3);
    expect(z).toBeGreaterThan(tuning.zoom.min);
    const now = await onScreen(page, p);
    expect(Math.hypot(now.x - at.x, now.y - at.y)).toBeLessThan(1.5);
    expect(await reachShare(page)).toBeCloseTo(z, 3);
    expect(await current(page)).toBeNull();
    // The labels follow: notary's keeps beside its model.
    const label = await page.evaluate(() => {
      const { stage, nodes } = window.__map!;
      const n = nodes.get('notary');
      const p = n.root.localToWorld(n.bounds.getCenter(n.root.position.clone())).project(stage.camera);
      const b = document.querySelector('button.label[data-go="notary"]')!.getBoundingClientRect();
      return { x: ((p.x + 1) / 2) * stage.viewport.width, y: ((1 - p.y) / 2) * stage.viewport.height, b: { l: b.left, r: b.right, t: b.top, bo: b.bottom } };
    });
    const gap = Math.max(label.b.l - label.x, label.x - label.b.r, label.b.t - label.y, label.y - label.b.bo, 0);
    expect(gap).toBeLessThan(120);
  });

  test('it stops at about a quarter of the distance, steady there, and at the composed overview', async ({ page }) => {
    test.setTimeout(60_000); // four eases to settle
    await open(page);
    const at = await emptyFloor(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -100);
    await settle(page);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);
    await settle(page);
    expect(await zoomNow(page)).toBe(tuning.zoom.min);
    expect(await reachShare(page)).toBeCloseTo(tuning.zoom.min, 3);
    // At the clamp more wheel, here or elsewhere, moves nothing: no creep towards the pointer.
    const about = () => page.evaluate(() => window.__map!.director.look.toArray());
    const held = await about();
    await page.mouse.wheel(0, -400);
    await settle(page);
    await page.mouse.move(at.x - 60, at.y + 30);
    await page.mouse.wheel(0, -400);
    await settle(page);
    const still = await about();
    await page.mouse.move(at.x, at.y);
    expect(await zoomNow(page)).toBe(tuning.zoom.min);
    expect(Math.hypot(...still.map((v: number, i: number) => v - held[i]!))).toBeLessThan(1e-6);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400);
    await settle(page);
    expect(await zoomNow(page)).toBe(1);
    // At the composed overview's distance again, looking where the wheel left it (a map's zoom out
    // keeps its place; travel brings the composed view back).
    const off = await page.evaluate(() => {
      const { director, stage } = window.__map!;
      const f = director.framing(null);
      const cam = stage.camera;
      const to = director.look.sub(cam.position);
      return {
        reach: Math.abs(to.length() - f.position.distanceTo(f.target)),
        look: (cam.getWorldDirection(cam.position.clone()).angleTo(to.normalize()) * 180) / Math.PI,
      };
    });
    expect(off.reach).toBeLessThan(1e-3);
    expect(off.look).toBeLessThan(0.01);
  });

  test('+ and - zoom towards the middle of the view; at a station they, and the wheel, do nothing', async ({ page }) => {
    await open(page);
    const mid = await page.evaluate(() => {
      const { stage } = window.__map!;
      return { x: (stage.viewport.width - stage.inset.right) / 2, y: (stage.viewport.height - stage.inset.bottom) / 2 };
    });
    const p = await floorUnder(page, mid);
    await page.keyboard.press('+');
    await settle(page);
    expect(await zoomNow(page)).toBeCloseTo(tuning.zoom.key, 6);
    await page.keyboard.press('=');
    await settle(page);
    expect(await zoomNow(page)).toBeCloseTo(tuning.zoom.key ** 2, 6);
    const now = await onScreen(page, p);
    expect(Math.hypot(now.x - mid.x, now.y - mid.y)).toBeLessThan(2);
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await settle(page);
    expect(await zoomNow(page)).toBeCloseTo(1, 6);
    await landAt(page, 'fettle');
    await page.mouse.move(mid.x / 2, mid.y);
    await advance(page, 1);
    const before = await cameraNow(page);
    await page.keyboard.press('+');
    await page.mouse.wheel(0, -300);
    await settle(page, 10);
    expect(await zoomNow(page)).toBe(1);
    const after = await cameraNow(page);
    expect(Math.hypot(...after.p.map((v, i) => v - before.p[i]!))).toBeLessThan(0.02); // the drift settling, no more
  });

  test('by the character typed: + on the key right of P (Italian, German, Spanish) zooms and never turns; ] there still turns; a dead key there turns by the key', async ({ page }) => {
    await open(page);
    const key = (key: string, code: string) =>
      page.evaluate(([key, code]) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })), [key, code]);
    await key('+', 'BracketRight');
    await settle(page);
    expect(await turn(page)).toBe(0);
    expect(await zoomNow(page)).toBeCloseTo(tuning.zoom.key, 6);
    await key('-', 'Slash'); // German's - key
    await settle(page);
    expect(await zoomNow(page)).toBeCloseTo(1, 6);
    await key(']', 'BracketRight');
    expect(await turn(page)).toBe(-tuning.turn.keyDeg);
    await key('Dead', 'BracketLeft'); // Spanish's ` key
    expect(await turn(page)).toBe(0);
    // At a station + does nothing, and still doesn't turn.
    await landAt(page, 'fettle');
    await key('+', 'BracketRight');
    await advance(page, 1);
    expect(await turn(page)).toBe(0);
  });

  test("[ ] + - are the map's only while it has focus (WCAG 2.1.4): not on the header's controls nor the panel's links; ← → still travel from anywhere", async ({ page }) => {
    await open(page);
    const focusOn = (sel: string) =>
      page.evaluate((sel) => {
        const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.getClientRects().length > 0)!;
        el.focus();
        return document.activeElement === el;
      }, sel);
    // The header's own controls: the keys are theirs.
    expect(await focusOn('header.top button')).toBe(true);
    await page.keyboard.press(']');
    await page.keyboard.press('+');
    await settle(page);
    expect(await turn(page)).toBe(0);
    expect(await zoomNow(page)).toBe(1);
    expect(await focusOn('header.top a[href]')).toBe(true);
    await page.keyboard.press('[');
    await page.keyboard.press('=');
    await settle(page);
    expect(await turn(page)).toBe(0);
    expect(await zoomNow(page)).toBe(1);
    // A label (the stations' nav, the map's own): they work.
    expect(await focusOn('button.label[data-go="notary"]')).toBe(true);
    await page.keyboard.press(']');
    await page.keyboard.press('+');
    await settle(page);
    expect(await turn(page)).toBe(-tuning.turn.keyDeg);
    expect(await zoomNow(page)).toBeCloseTo(tuning.zoom.key, 6);
    // At a station, a link in its panel: the turn keys are the link's; ← → still step.
    await landAt(page, 'fettle');
    expect(await focusOn('#fettle a[href]')).toBe(true);
    await page.keyboard.press('[');
    await advance(page, 1);
    expect(await turn(page)).toBe(0);
    await page.keyboard.press('ArrowRight');
    expect(await current(page)).toBe('idiff');
    // Travel put focus nowhere special (or on the heading): the map has it again.
    await advance(page, tuning.flight.max + 1);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('[');
    await advance(page, 1);
    expect(await turn(page)).toBeGreaterThan(0);
  });

  test('travel resets it: the flight leaves from the fully zoomed view and the overview comes back composed', async ({ page }) => {
    await open(page);
    const at = await emptyFloor(page);
    await page.mouse.move(at.x, at.y);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -400);
    await settle(page);
    expect(await zoomNow(page)).toBe(tuning.zoom.min); // from all the way in
    const zoomed = await cameraNow(page);
    await page.keyboard.press('ArrowRight');
    expect(await zoomNow(page)).toBe(1);
    await advance(page, 1 / 60);
    const first = await cameraNow(page);
    expect(Math.hypot(...first.p.map((v, i) => v - zoomed.p[i]!))).toBeLessThan(0.05);
    await advance(page, tuning.flight.max + 1);
    expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
    await landAt(page, null);
    expect(await zoomNow(page)).toBe(1);
    expect(await reachShare(page)).toBeCloseTo(1, 3);
    // And looking where the composed overview does.
    const off = await page.evaluate(() => window.__map!.director.look.distanceTo(window.__map!.director.framing(null).target));
    expect(off).toBeLessThan(1e-6);
  });

  test('turned and zoomed, a flight sets off from that view without a jump and lands composed', async ({ page }) => {
    await open(page);
    for (let i = 0; i < 18; i++) await page.keyboard.press(']'); // −90°
    await page.keyboard.press('+');
    await settle(page);
    await page.keyboard.press('+');
    await settle(page);
    expect(await turn(page)).toBe(-90);
    expect(await zoomNow(page)).toBeLessThan(0.8);
    const from = await cameraNow(page);
    await page.evaluate(() => window.__map!.stations.go('idiff'));
    await advance(page, 1 / 60);
    const first = await cameraNow(page);
    expect(Math.hypot(...first.p.map((v, i) => v - from.p[i]!))).toBeLessThan(0.05);
    const dot = first.f.reduce((s, v, i) => s + v * from.f[i]!, 0);
    expect((Math.acos(Math.min(dot, 1)) * 180) / Math.PI).toBeLessThan(2); // its view doesn't jump either
    await advance(page, 3);
    const off = await page.evaluate(() => {
      const { director, stage } = window.__map!;
      const f = director.framing('idiff');
      return Math.abs(stage.camera.position.distanceTo(f.target) - f.position.distanceTo(f.target));
    });
    expect(off).toBeLessThan(1e-3);
  });

  test("Ctrl with the wheel is the browser's, and the panel's wheel is the panel's", async ({ page }) => {
    await open(page);
    const at = await emptyFloor(page);
    const wheel = (ctrlKey: boolean) =>
      page.evaluate(
        ({ x, y, ctrlKey }) => {
          const e = new WheelEvent('wheel', { deltaY: -200, ctrlKey, clientX: x, clientY: y, bubbles: true, cancelable: true });
          window.__map!.stage.renderer.domElement.dispatchEvent(e);
          return e.defaultPrevented;
        },
        { ...at, ctrlKey },
      );
    expect(await wheel(true)).toBe(false);
    await settle(page, 10);
    expect(await zoomNow(page)).toBe(1);
    expect(await wheel(false)).toBe(true); // a plain wheel over the map is the map's
    await settle(page);
    expect(await zoomNow(page)).toBeLessThan(1);
    await landAt(page, 'fettle');
    await landAt(page, null);
    const panel = await page.evaluate(() => {
      const r = document.getElementById('stations')!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(panel.x, panel.y);
    await page.mouse.wheel(0, -300);
    await settle(page, 10);
    expect(await zoomNow(page)).toBe(1);
  });

  test('with motion reduced it zooms at once, without easing, and holds no frames', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const at = await emptyFloor(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => zoomNow(page)).toBeLessThan(1); // the chunk's fetch; the clock never steps
    expect(await zoomNow(page)).toBeCloseTo(Math.exp(-100 * tuning.zoom.wheel), 6);
    expect(await page.evaluate(() => window.__map!.director.animating)).toBe(false);
  });
});

test.describe('zoom on a phone, by touch', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('two fingers pinch the overview in and out about their middle; the page itself never zooms or scrolls', async ({ page }) => {
    await open(page, PHONE);
    const cdp = await page.context().newCDPSession(page);
    const at = await emptyFloor(page);
    const pinch = async (from: number, to: number, steps = 8) => {
      const pts = (d: number) => [
        { x: at.x - d / 2, y: at.y, radiusX: 12, radiusY: 12, id: 0 },
        { x: at.x + d / 2, y: at.y, radiusX: 12, radiusY: 12, id: 1 },
      ];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / steps) });
        await advance(page, 1 / 60);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    // The first pinch fetches the chunk; it zooms as soon as it's in.
    await pinch(60, 80);
    await settle(page, 10);
    const p = await floorUnder(page, at);
    const z0 = await zoomNow(page);
    await pinch(60, 90);
    await settle(page, 10);
    const z1 = await zoomNow(page);
    expect(z1).toBeCloseTo(Math.max((z0 * 60) / 90, tuning.zoom.min), 3);
    const now = await onScreen(page, p);
    expect(Math.hypot(now.x - at.x, now.y - at.y)).toBeLessThan(3); // about the fingers' middle
    expect(await turn(page)).toBe(0); // two fingers never turn it
    expect(await current(page)).toBeNull(); // nor travel
    await pinch(90, 60); // the fingers stay on the floor, clear of the labels' touch targets
    await settle(page, 10);
    expect(await zoomNow(page)).toBeCloseTo(Math.min((z1 * 90) / 60, 1), 3);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY, window.visualViewport?.scale ?? 1])).toEqual([0, 0, 1]);
  });

  test("one finger landing on a label's touch target pans the overview as on the floor; a tap there still travels", async ({ page }) => {
    await open(page, PHONE);
    const target = () =>
      page.evaluate(() => {
        const top = document.querySelector('.top')!.getBoundingClientRect().bottom;
        const floor = document.getElementById('stations')!.getBoundingClientRect().top;
        for (const b of document.querySelectorAll<HTMLElement>('nav li:not([data-nohit]):not([data-off]) button.label')) {
          const r = b.getBoundingClientRect();
          const p = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: b.dataset.go! };
          if (p.y > top + 60 && p.y < floor - 100 && p.x > 60 && p.x < innerWidth - 60 && document.elementFromPoint(p.x, p.y) === b) return p;
        }
        return null;
      });
    const at = (await target())!;
    expect(at).not.toBeNull();
    const look = () => page.evaluate(() => window.__map!.director.look.toArray());
    const before = await look();
    const cdp = await page.context().newCDPSession(page);
    const pt = (dx: number, dy: number) => [{ x: at.x + dx, y: at.y + dy, radiusX: 12, radiusY: 12 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(0, 0) });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(5 * i, 3 * i) });
      await advance(page, 1 / 60);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page, 30);
    const after = await look();
    expect(Math.hypot(after[0]! - before[0]!, after[2]! - before[2]!)).toBeGreaterThan(0.3); // it panned
    expect(await current(page)).toBeNull(); // and didn't travel
    expect(await turn(page)).toBe(0);
    // A tap on a label's target is still the label's: it travels.
    const tap = (await target())!;
    await page.touchscreen.tap(tap.x, tap.y);
    await expect.poll(() => current(page)).toBe(tap.id);
  });

  test("a pinch with a finger landing on a label's touch target zooms the map, never the page itself", async ({ page }) => {
    await open(page, PHONE);
    // A label's target well inside the map: one finger lands on it, the other below.
    const at = await page.evaluate(() => {
      const top = document.querySelector('.top')!.getBoundingClientRect().bottom;
      const floor = document.getElementById('stations')!.getBoundingClientRect().top;
      for (const b of document.querySelectorAll<HTMLElement>('nav li:not([data-nohit]):not([data-off]) button.label')) {
        const r = b.getBoundingClientRect();
        const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        if (p.y > top + 40 && p.y < floor - 200 && document.elementFromPoint(p.x, p.y) === b) return p;
      }
      return null;
    });
    expect(at).not.toBeNull();
    const z0 = await zoomNow(page);
    const cdp = await page.context().newCDPSession(page);
    const pts = (k: number) => [
      { x: at!.x, y: at!.y - 60 * k, radiusX: 12, radiusY: 12, id: 0 },
      { x: at!.x, y: at!.y + 120 + 60 * k, radiusX: 12, radiusY: 12, id: 1 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(i / 10) });
      await advance(page, 1 / 60);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await advance(page, 1);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY, window.visualViewport?.scale ?? 1])).toEqual([0, 0, 1]);
    expect(await current(page)).toBeNull(); // nor did it travel
    await settle(page, 30);
    expect(await zoomNow(page)).toBeLessThan(z0 * 0.8); // the map's pinch: in, about the fingers
  });
});

// --- turning while zoomed ----------------------------------------------------------------------
// The owner (2026-10-22): "Right click rotation while zoomed is really buggy, the rotation happens
// as if you were never zoomed. While it should rotate the zoomed perspective." Zoomed in or
// panned, a turn orbits the point at the centre of the view at the same distance, so what's there
// stays there, as big as it was; unzoomed and unpanned it still turns about the network's middle
// (the tests above).

/** Where node `id`'s floor point is on the canvas, how tall its model stands there (px), and the visible area's centre. */
const sight = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { stage, nodes } = window.__map!;
    const n = nodes.get(id);
    const { width, height } = stage.viewport;
    const px = (v: { x: number; y: number; z: number }) => {
      const p = stage.camera.position.clone().set(v.x, v.y, v.z).project(stage.camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    };
    const foot = px(n.home);
    const head = px(n.home.clone().setY(n.home.y + n.bounds.max.y));
    return { x: foot.x, y: foot.y, size: Math.hypot(head.x - foot.x, head.y - foot.y), centre: { x: (width - stage.inset.right) / 2, y: (height - stage.inset.bottom) / 2 } };
  }, id);

const offCentre = (s: { x: number; y: number; centre: { x: number; y: number } }) => Math.hypot(s.x - s.centre.x, s.y - s.centre.y);

/** Pans the overview with left drags on the empty floor until node `id` is at the centre of the view, held still before letting go so it doesn't glide. */
async function centreOn(page: Page, id: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const s = await sight(page, id);
    if (offCentre(s) < 4) break;
    const at = await emptyFloor(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + s.centre.x - s.x, at.y + s.centre.y - s.y, { steps: 12 });
    await settle(page, 10); // the chunk is in, the pan caught up
    await page.waitForTimeout(150); // held still: no glide
    await page.mouse.up();
    await advance(page, 1);
  }
}

test.describe('turning while zoomed', () => {
  test.describe.configure({ timeout: 120_000 }); // the pans, the eases and a turn a frame
  test('zoomed in with the wheel over the cluster, a right-drag of 90° turns about it: it stays at the centre, as big as it was', async ({ page }) => {
    await open(page);
    await centreOn(page, 'homelab');
    const s0 = await sight(page, 'homelab');
    expect(offCentre(s0)).toBeLessThan(12); // the drift towards the pointer moves it a little
    await page.mouse.move(s0.x, s0.y);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
    await settle(page);
    expect(await zoomNow(page)).toBeLessThan(0.5);
    const a = await sight(page, 'homelab');
    expect(offCentre(a)).toBeLessThan(40); // near it: the zoom spreads what's left
    const w = await visibleWidth(page);
    const from = await emptyFloor(page);
    await turnDrag(page, from, (90 / tuning.turn.overviewWidthDeg) * w + tuning.dragThresholdPx, 30);
    // Mid-turn, and after it: no jump, the cluster held where it was.
    expect(Math.abs(await turn(page))).toBeGreaterThan(85);
    const mid = await sight(page, 'homelab');
    await page.mouse.up({ button: 'right' });
    await advance(page, 2);
    const b = await sight(page, 'homelab');
    for (const [s, when] of [
      [mid, 'held'],
      [b, 'let go'],
    ] as const) {
      expect(offCentre(s), when).toBeLessThan(offCentre(a) + 4);
      expect(s.size / a.size, when).toBeGreaterThan(0.95);
      expect(s.size / a.size, when).toBeLessThan(1.05);
    }
  });

  test('zoomed in with + over the cluster, [ and ] turn about it the same way', async ({ page }) => {
    await open(page);
    await centreOn(page, 'homelab');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('+');
      await settle(page);
    }
    expect(await zoomNow(page)).toBeLessThan(0.5);
    const a = await sight(page, 'homelab');
    expect(offCentre(a)).toBeLessThan(40);
    for (const [key, presses] of [
      [']', 18],
      ['[', 36],
    ] as const) {
      for (let i = 0; i < presses; i++) {
        await page.keyboard.press(key);
        const s = await sight(page, 'homelab');
        expect(offCentre(s), `${key} ${i + 1}`).toBeLessThan(offCentre(a) + 4);
        expect(Math.abs(s.size / a.size - 1), `${key} ${i + 1}`).toBeLessThan(0.05);
      }
    }
    expect(await turn(page)).toBe(90);
  });

  test.describe('on a phone, by touch', () => {
    test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    test('pinched in on the hub, a twist turns about it: the zoom stays, the hub stays under the fingers, as big as it was', async ({ page }) => {
      await open(page, PHONE);
      const s0 = await sight(page, 'origin');
      expect(offCentre(s0)).toBeLessThan(2); // the phone starts centred on the hub
      const c = s0.centre;
      // The first pinch fetches the chunk; then in to about 2.5x.
      await twoFingers(page, () => [{ x: c.x - 30, y: c.y }, { x: c.x + 30, y: c.y }], 2);
      await settle(page, 10);
      await twoFingers(page, (k) => [{ x: c.x - 30 - 30 * k, y: c.y }, { x: c.x + 30 + 30 * k, y: c.y }], 10);
      await settle(page, 10);
      const z = await zoomNow(page);
      expect(z).toBeLessThan(0.5);
      const a = await sight(page, 'origin');
      // A quarter turn and the dead zone, the fingers 120 px apart all the way, held down at the end.
      const deg = 90 + tuning.pan.twistDeg;
      await twoFingers(page, (k) => {
        const r = ((k * deg) * Math.PI) / 180;
        return [
          { x: c.x - 60 * Math.cos(r), y: c.y - 60 * Math.sin(r) },
          { x: c.x + 60 * Math.cos(r), y: c.y + 60 * Math.sin(r) },
        ];
      }, 24, false);
      expect(await turn(page)).toBeGreaterThan(85);
      const b = await sight(page, 'origin');
      expect(await zoomNow(page)).toBeCloseTo(z, 6);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(4);
      expect(b.size / a.size).toBeGreaterThan(0.95);
      expect(b.size / a.size).toBeLessThan(1.05);
    });
  });
});
