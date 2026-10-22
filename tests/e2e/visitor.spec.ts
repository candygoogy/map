import { expect, test, type Page } from '@playwright/test';
import { Vector3 } from 'three';
import world from '../../src/data/world.json' with { type: 'json' };
import { linkCurve } from '../../src/data/layout';
import { tuning } from '../../src/tuning';
import { dockDistance } from '../../src/world/dock';
import type {} from '../../src/main'; // window.__map's type

// The visitor's signal (Task 11): the gondola rides the links ahead of the camera, hanging from its
// grip on the line, docks at the station, and a hold (pointer or Shift, never Space) boosts the
// flight. On the manual clock (?test): every hold and flight is stepped by __map.advance.

const FRAME = 1 / 60;
const positions = new Map(Object.entries(world.nodes).map(([id, [x, z]]) => [id, new Vector3(x, 0, z)]));
/** A station's dock, from its node along its link (src/world/visitor.ts dockDistance). */
const dockOf = (id: string) => dockDistance(linkCurve(id, positions, world), 'node');

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.visitor !== undefined);
  await page.evaluate(async () => {
    const { director, visitor, advance } = window.__map!;
    await director.ready;
    await visitor.ready;
    director.skipArrival();
    advance(1 / 60);
  });
}

/** Travels to `id` and lets the flight land. */
async function settleAt(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const { stations, director, advance } = window.__map!;
    stations.go(id);
    for (let i = 0; i < 600 && director.state !== 'station'; i++) advance(1 / 60);
  }, id);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
}

/** Steps the clock a frame at a time until the flight lands; returns the clock seconds it took. */
const flyOut = (page: Page) =>
  page.evaluate(() => {
    const { director, advance } = window.__map!;
    let seconds = 0;
    for (let i = 0; i < 600 && director.state === 'flying'; i++) {
      advance(1 / 60);
      seconds += 1 / 60;
    }
    return seconds;
  });

test('for the first 70% of a flight the visitor is visitorLead ± 0.1 units ahead of the camera’s progress along the link', async ({ page }) => {
  await open(page);
  await settleAt(page, 'fettle');
  // Each frame: how much further along the links the visitor is than the camera's progress
  // (both measured as the distance left to the node along the route's link stretches).
  const rows = await page.evaluate(() => {
    const { director, visitor, stations, advance } = window.__map!;
    stations.go('homelab');
    const out: { t: number; cam: number; lead: number; away: number | null }[] = [];
    for (let i = 0; i < 600 && director.flight; i++) {
      const f = director.flight;
      const left = (p: { id: string | null; at: number }) => {
        let r = 0;
        let found = false;
        for (const s of f.route.pieces) {
          if (found) r += Math.abs(s.to - s.from);
          else if (s.id === p.id) {
            found = true;
            r += Math.abs(s.to - p.at);
          }
        }
        return found ? r : NaN;
      };
      const cam = left(f.route.linkAt(f.along));
      out.push({ t: f.t, cam, lead: cam - left(visitor.at), away: visitor.breakaway });
      advance(1 / 60);
    }
    return out;
  });
  // It leaves its dock from rest, so it takes tuning.visitorLaunch of the flight to reach the
  // lead (more if that would average over visitorLaunchSpeed), and it breaks away for the dock at visitorBreakaway. In between it holds the lead
  // wherever there's room for it: the camera's route stops a clearance (about 2 units) short of
  // the node, so in the last of the way a lead of visitorLead would run past the dock
  // (visitorDock from homelab's node, the line on its masts high enough there for the hanging
  // cabin); there it gives way smoothly. Room: the camera has more than visitorLead + the dock
  // + 1.3 to go.
  const room = tuning.visitorLead + dockOf('homelab') + 1.3;
  const launched = rows.find((r) => Math.abs(r.lead - tuning.visitorLead) <= 0.1)!.t;
  expect(launched).toBeGreaterThanOrEqual(tuning.visitorLaunch - 0.05);
  expect(launched).toBeLessThanOrEqual(0.4);
  const held = rows.filter((r) => r.t >= launched && r.t < tuning.visitorBreakaway && r.cam > room);
  expect(held.length).toBeGreaterThan(15);
  for (const r of held) expect(Math.abs(r.lead - tuning.visitorLead), `t ${r.t.toFixed(3)}`).toBeLessThanOrEqual(0.1);
  expect(rows.find((r) => r.away !== null)!.t).toBeCloseTo(tuning.visitorBreakaway, 1);
  // Ahead of the camera from its launch on.
  for (const r of rows.filter((r) => r.t >= launched)) expect(r.lead, `t ${r.t.toFixed(3)}`).toBeGreaterThan(0);
});

test('when the flight ends the visitor is within 0.05 of the node’s dock point and playing dock', async ({ page }) => {
  await open(page);
  await settleAt(page, 'fettle');
  await page.evaluate(() => window.__map!.stations.go('homelab'));
  await flyOut(page);
  const r = await page.evaluate((dock) => {
    const { links, visitor, director } = window.__map!;
    const c = links.curve('homelab');
    const L = c.getLength();
    const point = c.getPointAt((L - dock) / L);
    return { state: director.state, d: visitor.root.position.distanceTo(point), playing: visitor.playing };
  }, dockOf('homelab'));
  expect(r.state).toBe('station');
  expect(r.d).toBeLessThan(0.05);
  expect(r.playing).toBe('dock');
});

// With the links on their masts (tuning.linkMast) the line at visitorDock is higher than the
// cabin needs, so it docks there and hangs drop under the line, the belly 0.18 to 0.25 over
// the floor; never less than visitorDockGap.
test('docked, the cabin hangs its drop under the line, its belly at least visitorDockGap over the floor, the shadow on the floor under it', async ({ page }) => {
  await open(page);
  for (const id of ['notary', 'eolietech', 'candygoogy-bot', 'fettle', 'origin']) {
    await settleAt(page, id);
    await page.evaluate(() => window.__map!.advance(1)); // the dock clip settles
    const r = await page.evaluate(() => {
      const { visitor } = window.__map!;
      visitor.root.updateMatrixWorld(true);
      const V = visitor.root.position.constructor as new (x?: number, y?: number, z?: number) => Vector3;
      const p = new V();
      let belly = Infinity;
      visitor.root.getObjectByName('cabin')!.traverse((o) => {
        const pos = (o as unknown as { geometry?: { attributes: { position?: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } } }).geometry?.attributes.position;
        if (pos) for (let i = 0; i < pos.count; i++) belly = Math.min(belly, p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld).y);
      });
      return { belly, line: visitor.root.position.y, shadow: visitor.root.getObjectByName('shadow')!.getWorldPosition(p).y, at: visitor.at, playing: visitor.playing };
    });
    const where = `${id} ${JSON.stringify(r)}`;
    // The idle sway (1.2°) dips one end of the belly a few millimetres.
    expect(r.belly, where).toBeGreaterThan(tuning.visitorDockGap - 0.006);
    expect(Math.abs(r.belly - (r.line - tuning.visitorDrop)), where).toBeLessThan(0.01);
    expect(Math.abs(r.shadow), where).toBeLessThan(0.005);
  }
});

test('in flight the grip pitches along the link, nose first, while the cabin hangs level', async ({ page }) => {
  await open(page);
  await settleAt(page, 'fettle');
  const rows = await page.evaluate(() => {
    const { director, visitor, stations, links, advance } = window.__map!;
    stations.go('homelab');
    const grip = visitor.root.getObjectByName('grip')!;
    const cabin = visitor.root.getObjectByName('cabin')!;
    const V = visitor.root.position.constructor as new (x?: number, y?: number, z?: number) => Vector3;
    const out: { t: number; id: string; grip: number; link: number; level: number; ahead: number }[] = [];
    const prev = visitor.root.position.clone();
    for (let i = 0; i < 600 && director.flight; i++) {
      advance(1 / 60);
      const f = director.flight;
      if (!f) break;
      visitor.root.updateMatrixWorld(true);
      const nose = new V(0, 0, 1).transformDirection(grip.matrixWorld);
      const { id, at } = visitor.at;
      const moved = visitor.root.position.clone().sub(prev);
      let tan: Vector3;
      if (id === 'turnaround') {
        // Round the hub on the turnaround (links.ts): level, along the ring's tangent.
        const { centre } = links.turnaround;
        const p = visitor.root.position;
        tan = new V(-(p.z - centre.z), 0, p.x - centre.x);
      } else {
        const c = links.curve(id!);
        const L = c.getLength();
        tan = c.getPointAt(Math.min(at + 0.05, L) / L).sub(c.getPointAt(Math.max(at - 0.05, 0) / L));
      }
      prev.copy(visitor.root.position);
      if (tan.dot(moved) < 0) tan.negate(); // the way it's heading
      out.push({
        t: f.t,
        id: id!,
        grip: Math.asin(nose.y),
        link: Math.atan2(tan.y, Math.hypot(tan.x, tan.z)),
        level: new V(0, 1, 0).transformDirection(cabin.matrixWorld).y,
        ahead: moved.length() > 1e-4 ? nose.dot(moved.normalize()) : 1,
      });
    }
    return out;
  });
  expect(rows.length).toBeGreaterThan(30);
  // Out of the node, round the hub on the turnaround and down into the next node, the grip
  // follows the line's pitch, nose down toward the hub, level round the ring, and up out of it.
  // It eases into each turn (as the heading does), so at full speed it trails the line by up to
  // about 0.13 rad; once it has slowed for the dock it's on it. It turns round as it leaves its
  // dock (its nose faced the node), so from t 0.1, and the way turns a right angle onto the ring
  // and off it, so not for 0.06 of the flight after either.
  // The level-ended links (044ab68) are 0.1 rad steep at most (fettle's; homelab's 0.056), and
  // the eased grip trails that at speed, so it pitches some 0.03 to 0.05 either way.
  expect(Math.min(...rows.map((r) => r.grip))).toBeLessThan(-0.02);
  expect(Math.max(...rows.map((r) => r.grip))).toBeGreaterThan(0.02);
  const on = rows.find((r) => r.id === 'turnaround')!.t;
  const off = rows.find((r) => r.id === 'homelab')!.t;
  const kinked = (t: number) => (t >= on && t <= on + 0.06) || (t >= off && t <= off + 0.06);
  for (const r of rows.filter((r) => r.t > 0.1 && !kinked(r.t))) {
    expect(Math.abs(r.grip - r.link), `grip at t ${r.t.toFixed(3)}`).toBeLessThan(r.t > 0.75 ? 0.01 : 0.16);
    expect(r.ahead, `nose leads at t ${r.t.toFixed(3)}`).toBeGreaterThan(0.85);
  }
  // No clip turns the cabin while it rides (once its idle sway has faded, over 0.2 s), and the
  // outer group never pitches: level, within 0.1°.
  for (const r of rows.filter((r) => r.t > 0.15)) expect(r.level, `cabin level at t ${r.t.toFixed(3)}`).toBeGreaterThan(Math.cos((0.1 * Math.PI) / 180));
});

test('holding the pointer during a flight shortens it by the boost factor and the hash still lands on the target', async ({ page }) => {
  await open(page);
  await settleAt(page, 'fettle');
  await page.evaluate(() => window.__map!.stations.go('homelab'));
  const duration = await page.evaluate(() => window.__map!.director.flight!.duration);
  // A press on empty canvas, held still: a boost once it has lasted tuning.boostHoldMs.
  await page.mouse.move(12, 450);
  await page.mouse.down();
  const took = await flyOut(page);
  await page.mouse.up();
  const hold = tuning.boostHoldMs / 1000;
  const expected = hold + (duration - hold) / tuning.boost;
  expect(Math.abs(took - expected), `took ${took.toFixed(3)} s, expected ${expected.toFixed(3)} s of ${duration.toFixed(3)}`).toBeLessThan(0.06);
  await expect(page).toHaveURL(/#homelab$/);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
});

test('holding Shift boosts; pressing Space on a focused label travels and does not boost', async ({ page }) => {
  await open(page);
  await settleAt(page, 'fettle');
  await page.evaluate(() => window.__map!.stations.go('homelab'));
  await page.keyboard.down('Shift');
  await page.evaluate(() => window.__map!.advance(0.3));
  const held = await page.evaluate(() => ({ boost: window.__map!.visitor.boost, scale: window.__map!.director.timeScale }));
  expect(held.boost).toBeGreaterThan(0.8);
  expect(held.scale).toBeGreaterThan(1.6);
  await page.keyboard.up('Shift');
  await flyOut(page);
  await page.evaluate(() => window.__map!.advance(0.5));
  expect(await page.evaluate(() => window.__map!.visitor.boost)).toBeLessThan(0.01);

  await page.locator('button.label[data-go="idiff"]').focus();
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('flying');
  const duration = await page.evaluate(() => window.__map!.director.flight!.duration);
  const took = await flyOut(page);
  expect(Math.abs(took - duration)).toBeLessThanOrEqual(2 * FRAME);
  expect(await page.evaluate(() => window.__map!.visitor.boost)).toBe(0);
  await expect(page).toHaveURL(/#idiff$/);
});

test('at 390×844 the docked gondola is fully in view above the open sheet at fettle, homelab and exit', async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const top = 844 * (1 - tuning.sheetOpen);
  for (const id of ['fettle', 'homelab', 'exit']) {
    await settleAt(page, id);
    await page.evaluate(() => window.__map!.advance(1)); // the dock clip settles
    // The gondola's box on screen: 0.2 either side of its pin on the line, from its grip
    // 0.04 above the pin to its belly tuning.visitorDrop below.
    const box = await page.evaluate((drop) => {
      const { stage, visitor } = window.__map!;
      const c = stage.camera;
      c.updateMatrixWorld();
      const xs: number[] = [];
      const ys: number[] = [];
      for (const dx of [-0.2, 0.2]) for (const dy of [-drop, 0.04]) for (const dz of [-0.2, 0.2]) {
        const p = visitor.root.position.clone().set(visitor.root.position.x + dx, visitor.root.position.y + dy, visitor.root.position.z + dz).project(c);
        xs.push(((p.x + 1) / 2) * stage.viewport.width);
        ys.push(((1 - p.y) / 2) * stage.viewport.height);
      }
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    }, tuning.visitorDrop);
    expect(box.left, `${id} left`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${id} right`).toBeLessThanOrEqual(390);
    expect(box.top, `${id} top`).toBeGreaterThanOrEqual(0);
    expect(box.bottom, `${id} under the sheet`).toBeLessThanOrEqual(top);
  }
});

/** True if the element matches :focus-visible (its focus ring shows). */
const ringed = (page: Page, selector: string) => page.locator(selector).evaluate((el) => el.matches(':focus-visible'));

test('holding Shift during the flight after a click on a label shows no focus ring; Tab still does', async ({ page }) => {
  await open(page);
  const label = 'button.label[data-go="fettle"]';
  await page.locator(label).click();
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('flying');
  await page.keyboard.down('Shift');
  await page.evaluate(() => window.__map!.advance(0.3));
  expect(await page.evaluate(() => window.__map!.visitor.boost)).toBeGreaterThan(0.8); // it boosts
  expect(await ringed(page, label)).toBe(false);
  expect(await page.evaluate(() => document.querySelector('.labels :focus-visible'))).toBeNull();
  await page.keyboard.up('Shift');
  await flyOut(page);

  // The keyboard still sees where it is.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible'))).toBe(true);
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('holding Shift after a tap on a label shows no focus ring on it', async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // The stage sees the resize at the next frame (a ResizeObserver): wait for the phone's sheet.
    await page.waitForFunction(() => window.__map!.stage.inset.bottom > 0);
    await page.evaluate(() => window.__map!.advance(1 / 60));
    const label = 'button.label[data-go="fettle"]';
    const box = (await page.locator(label).boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.evaluate(() => window.__map!.stations.current)).toBe('fettle');
    await page.keyboard.down('Shift');
    await page.evaluate(() => window.__map!.advance(0.3));
    expect(await ringed(page, label)).toBe(false);
    await page.keyboard.up('Shift');
  });
});
