import { expect, test, type Page } from '@playwright/test';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// Poke (Task 14): a click on the current station's model plays its `poke`, or the `poke_<name>` of
// the `poke_<name>_hit` part it hit. On the manual clock (?test).

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
}

const advance = (page: Page, seconds: number) => page.evaluate((s) => window.__map!.advance(s), seconds);
const playing = (page: Page, id: string) => page.evaluate((id) => window.__map!.nodes.get(id).playing, id);

/** Travels to `id`, lands, and lets its `arrive` play out so idle has the pose. */
async function settleAt(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const { stations, director, advance } = window.__map!;
    stations.go(id);
    for (let i = 0; i < 600 && director.state !== 'station'; i++) advance(1 / 60);
  }, id);
  await advance(page, 3); // a separate step: the landing starts `arrive` on a promise
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('station');
}

/** The CSS px point over the middle of a node's model, or of its object `part` if given. */
const screenOf = (page: Page, id: string, part?: string) =>
  page.evaluate(
    ([id, part]) => {
      const { stage, nodes } = window.__map!;
      const node = nodes.get(id!);
      const p = node.root.position.clone();
      if (part) {
        const o = node.root.getObjectByName(part)!;
        o.updateWorldMatrix(true, true);
        node.bounds.clone().setFromObject(o, true).getCenter(p);
      } else {
        node.root.localToWorld(node.bounds.getCenter(p));
      }
      p.project(stage.camera);
      const { width, height } = stage.viewport;
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    },
    [id, part] as const,
  );

test('clicking the current station’s model plays poke', async ({ page }) => {
  await open(page);
  await settleAt(page, 'fettle');
  expect(await playing(page, 'fettle')).toBe('idle');
  const at = await screenOf(page, 'fettle');
  await page.mouse.click(at.x, at.y);
  expect(await playing(page, 'fettle')).toBe('poke');
  await advance(page, 1.5);
  expect(await playing(page, 'fettle')).toBe('idle'); // and idle has it back
  await expect(page).toHaveURL(/#fettle$/);
});

// The owner's recording (2026-10-21, the server): clicks on a poke still playing restarted it
// from rest, so the lid flipped open, half and shut under the cursor. A poke plays out.
test('a click while the poke plays is ignored: it plays out, not over from rest', async ({ page }) => {
  await open(page);
  await settleAt(page, 'server');
  const at = await screenOf(page, 'server');
  await page.mouse.click(at.x, at.y);
  expect(await playing(page, 'server')).toBe('poke');
  await advance(page, 0.4); // the lid is open
  const lid = () =>
    page.evaluate(() => window.__map!.nodes.get('server').root.getObjectByName('lid')!.quaternion.toArray());
  const opened = await lid();
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => window.__map!.nodes.get('server').poke(null))).toBe(false);
  await advance(page, 1 / 60);
  // Carried on from where it was (a restart would cross back toward the shut lid's frame 0).
  const after = await lid();
  expect(Math.abs(after.reduce((s, v, i) => s + v * opened[i]!, 0))).toBeGreaterThan(0.99);
  // poke runs 1.25 s from the first click; restarted at 0.4 s it would still run at 1.5 s.
  await advance(page, 1.1);
  expect(await playing(page, 'server')).toBe('idle');
  const again = await screenOf(page, 'server');
  await page.mouse.click(again.x, again.y); // and once it has, a click pokes again
  expect(await playing(page, 'server')).toBe('poke');
});

test('a hit on a part whose clip still plays is ignored too (idiff’s card stays out)', async ({ page }) => {
  await open(page);
  await settleAt(page, 'idiff');
  const card = () =>
    page.evaluate(() => {
      const n = window.__map!.nodes.get('idiff');
      const p = n.root.worldToLocal(n.root.getObjectByName('poke_card_hit')!.getWorldPosition(n.root.position.clone()));
      return Math.hypot(p.x, p.z);
    });
  const rest = await card();
  expect(await page.evaluate(() => window.__map!.nodes.get('idiff').poke('card'))).toBe(true);
  await advance(page, 0.2); // on its way out
  expect(await page.evaluate(() => window.__map!.nodes.get('idiff').poke('card'))).toBe(false);
  await advance(page, 1.5);
  expect(Math.abs((await card()) - rest)).toBeGreaterThan(0.05); // out, not put back
  expect(await page.evaluate(() => window.__map!.nodes.get('idiff').poke('card'))).toBe(true); // now it tidies
});

test('a click on another node still travels there', async ({ page }) => {
  await open(page);
  await settleAt(page, 'fettle');
  const at = await screenOf(page, 'eolietech'); // in frame behind fettle, clear of the panel
  await page.mouse.click(at.x, at.y);
  await expect(page).toHaveURL(/#eolietech$/);
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('flying');
  expect(await playing(page, 'fettle')).toBe('idle');
});

test('idiff’s card hops out on a click, stays out through idle and a poke, and a click on it tidies it', async ({ page }) => {
  await open(page);
  await settleAt(page, 'idiff');
  /** The card's place in idiff's own space. */
  const card = () =>
    page.evaluate(() => {
      const n = window.__map!.nodes.get('idiff');
      const p = n.root.worldToLocal(n.root.getObjectByName('poke_card_hit')!.getWorldPosition(n.root.position.clone()));
      return { x: p.x, y: p.y, z: p.z };
    });
  const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const rest = await card();

  let at = await screenOf(page, 'idiff', 'poke_card_hit');
  await page.mouse.click(at.x, at.y);
  await advance(page, 1.5);
  const out = await card();
  expect(dist(out, rest)).toBeGreaterThan(0.1);
  expect(await playing(page, 'idiff')).toBe('idle'); // idle carries on underneath

  await page.evaluate(() => window.__map!.nodes.get('idiff').poke(null)); // the trays slide apart
  expect(await playing(page, 'idiff')).toBe('poke');
  await advance(page, 6); // the poke, then idle's whole loop
  expect(await playing(page, 'idiff')).toBe('idle');
  expect(dist(await card(), out)).toBeLessThan(1e-3);

  at = await screenOf(page, 'idiff', 'poke_card_hit');
  await page.mouse.click(at.x, at.y);
  await advance(page, 1.5);
  expect(dist(await card(), rest)).toBeLessThan(1e-3);
});

test('a poke while idiff’s card is on the floor slides the trays and leaves the card where it lies', async ({ page }) => {
  await open(page);
  await settleAt(page, 'idiff');
  /** Where a part is in idiff's own space. */
  const where = (name: string) =>
    page.evaluate((name) => {
      const n = window.__map!.nodes.get('idiff');
      const p = n.root.worldToLocal(n.root.getObjectByName(name)!.getWorldPosition(n.root.position.clone()));
      return { x: p.x, y: p.y, z: p.z };
    }, name);
  const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  await page.evaluate(() => window.__map!.nodes.get('idiff').poke('card'));
  await advance(page, 1.5);
  const out = await where('poke_card_hit');
  const tray = await where('tray_bottom');

  await page.evaluate(() => window.__map!.nodes.get('idiff').poke(null));
  await advance(page, 0.3); // the trays are apart
  expect(await playing(page, 'idiff')).toBe('poke');
  expect(dist(await where('tray_bottom'), tray)).toBeGreaterThan(0.05);
  expect(dist(await where('poke_card_hit'), out)).toBeLessThan(1e-3); // not carried, not taken back
});

test('poked fast, the notary refuses, and pokes again once it has', async ({ page }) => {
  await open(page);
  await settleAt(page, 'notary');
  // Four pokes 0.2 s apart in one step: the refusal counts wall-clock time, which a busy
  // test machine would stretch between separate clicks.
  const seen = await page.evaluate(() => {
    const { nodes, advance } = window.__map!;
    const notary = nodes.get('notary');
    const out: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      notary.poke(null);
      advance(0.2);
      out.push(notary.playing);
    }
    return out;
  });
  // The third within tuning.pokeRefuse.seconds refuses; one during the refusal is ignored.
  expect(seen).toEqual(['poke', 'poke', 'poke_refuse', 'poke_refuse']);
  // It started at 0.4 s and runs 1.42 s; restarted by the fourth (0.6 s) it would still run at 1.9 s.
  await advance(page, 1.1);
  expect(await playing(page, 'notary')).toBe('idle');
  const at = await screenOf(page, 'notary');
  await page.mouse.click(at.x, at.y);
  expect(await playing(page, 'notary')).toBe('poke');
});

// The owner's test notes: at its station a press on the model is a click, a
// poke; it never pulls the model out from under the next one.
test('a drag on the current station’s model does not move it, and does not poke', async ({ page }) => {
  await open(page);
  await settleAt(page, 'fettle');
  const at = await screenOf(page, 'fettle');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(tuning.pullHold * 1000 + 100); // past the hold, so only the station stops it
  await page.mouse.move(at.x + 80, at.y + 30, { steps: 8 });
  await advance(page, 0.3);
  const pulled = await page.evaluate(() => {
    const n = window.__map!.nodes.get('fettle');
    return n.root.position.distanceTo(n.home);
  });
  expect(pulled).toBe(0);
  await page.mouse.up();
  expect(await playing(page, 'fettle')).toBe('idle'); // it travelled: not a click either
  await expect(page).toHaveURL(/#fettle$/);
});

// The owner, 2026-10-21: at a station, a quick second press on the model being flown to pulled
// it, since it isn't the station until the camera lands. Nothing pulls mid-flight.
test('a drag on the model being flown to does not move it', async ({ page }) => {
  await open(page);
  await settleAt(page, 'fettle');
  await page.evaluate(() => window.__map!.stations.go('idiff'));
  const left = await page.evaluate(() => window.__map!.director.flight!.duration);
  await advance(page, left * 0.8); // late in the flight: idiff well in view, not landed
  expect(await page.evaluate(() => window.__map!.director.state)).toBe('flying');
  const at = await screenOf(page, 'idiff');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(tuning.pullHold * 1000 + 100); // past the hold
  await page.mouse.move(at.x + 80, at.y + 30, { steps: 8 });
  await advance(page, 0.05); // a pull would spring it toward the pointer (still flying)
  const pulled = await page.evaluate(() => {
    const n = window.__map!.nodes.get('idiff');
    return n.root.position.distanceTo(n.home);
  });
  await page.mouse.up();
  expect(pulled).toBe(0);
});

// The owner's test notes: a model that moves under the pointer is hard to hover and
// click. What's under it is the model's rest box at home (pointer.ts), so a poke's hop or a
// lift never changes it; the part is still named from the meshes where they are.

/** Which node each point of a grid over `id`'s rest box on screen hovers, from synthetic moves. */
const hoverGrid = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { stage, nodes } = window.__map!;
    const n = nodes.get(id);
    const { width, height } = stage.viewport;
    const xs: number[] = [];
    const ys: number[] = [];
    const p = n.home.clone();
    for (const x of [n.bounds.min.x, n.bounds.max.x])
      for (const y of [n.bounds.min.y, n.bounds.max.y])
        for (const z of [n.bounds.min.z, n.bounds.max.z]) {
          p.set(x, y, z).add(n.home).project(stage.camera);
          xs.push(((p.x + 1) / 2) * width);
          ys.push(((1 - p.y) / 2) * height);
        }
    const canvas = stage.renderer.domElement;
    const out: (string | null)[] = [];
    for (let y = Math.min(...ys) - 40; y < Math.max(...ys) + 20; y += 4)
      for (let x = Math.min(...xs) - 20; x < Math.max(...xs) + 20; x += 6) {
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true }));
        out.push(nodes.hovered);
      }
    canvas.dispatchEvent(new PointerEvent('pointerleave'));
    return out;
  }, id);

/** What a synthetic mouse move to `p` (CSS px) hovers. */
const hoveredAt = (page: Page, p: { x: number; y: number }) =>
  page.evaluate((p) => {
    const { stage, nodes } = window.__map!;
    stage.renderer.domElement.dispatchEvent(
      new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, pointerType: 'mouse', bubbles: true }),
    );
    return nodes.hovered;
  }, p);

test('mid-poke, the origin is under the pointer exactly where it is at rest', async ({ page }) => {
  // Motion reduced: the camera's drift (which follows the pointer) and idle stay still, so
  // only the poke moves; a poke plays with motion reduced too. Pokes move parts now, not whole
  // models (the owner's test notes); the origin's raises its light 0.12 on its
  // stalk, out of the top of its rest box, and the light isn't a poke part, so nothing about
  // what's under the pointer changes.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await settleAt(page, 'origin');
  const top = () =>
    page.evaluate(() => {
      const n = window.__map!.nodes.get('origin');
      return n.bounds.clone().setFromObject(n.root.getObjectByName('light')!, true).max.y;
    });
  const atRest = await hoverGrid(page, 'origin');
  const restTop = await top();
  expect(await page.evaluate(() => window.__map!.nodes.get('origin').poke(null))).toBe(true);
  await advance(page, 0.5); // the light is up
  expect((await top()) - restTop).toBeGreaterThan(0.08);
  expect(await hoverGrid(page, 'origin')).toEqual(atRest);
});

test('the tower’s poke rattles its glass and spins its fans, and the tower stays put', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await settleAt(page, 'desktop');
  const pose = () =>
    page.evaluate(() => {
      const n = window.__map!.nodes.get('desktop');
      const model = n.root.children[0]!;
      const hinge = model.getObjectByName('glass_hinge')!;
      const fan = model.getObjectByName('fan_rear')!;
      const tower = model.getObjectByName('desktop') ?? model;
      return {
        tower: [...tower.position.toArray(), ...tower.quaternion.toArray()],
        hinge: hinge.rotation.toArray().slice(0, 3) as number[],
        fan: fan.quaternion.toArray(),
      };
    });
  const rest = await pose();
  expect(await page.evaluate(() => window.__map!.nodes.get('desktop').poke(null))).toBe(true);
  await advance(page, 5 / 24); // the glass at its widest
  const mid = await pose();
  expect(mid.tower).toEqual(rest.tower);
  expect(Math.max(...mid.hinge.map((v, i) => Math.abs(v - rest.hinge[i]!)))).toBeGreaterThan(0.05);
  expect(mid.fan).not.toEqual(rest.fan);
});

test('a lifted model is hit at its rest box on the floor, not where it is lifted to', async ({ page }) => {
  await open(page);
  await settleAt(page, 'desktop');
  const points = await page.evaluate(() => {
    const { stage, nodes, advance } = window.__map!;
    const n = nodes.get('desktop');
    n.dragTo(n.home.clone()); // lifted tuning.dragLift over home: the volume stays put
    advance(1);
    const { width, height } = stage.viewport;
    const screen = (y: number) => {
      const p = n.bounds.getCenter(n.home.clone()).add(n.home);
      p.y = y;
      p.project(stage.camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    };
    const tops: number[] = [];
    for (const x of [n.bounds.min.x, n.bounds.max.x])
      for (const z of [n.bounds.min.z, n.bounds.max.z]) {
        const p = n.home.clone().add({ x, y: n.bounds.max.y, z } as never).project(stage.camera);
        tops.push(((1 - p.y) / 2) * height);
      }
    return {
      floor: screen(n.home.y + n.bounds.max.y / 2), // inside the rest box, under the lifted model
      lifted: screen(n.root.position.y + n.bounds.max.y * 0.6), // on the model, over the box
      boxTop: Math.min(...tops),
      lift: n.root.position.y - n.home.y,
    };
  });
  expect(points.lift).toBeGreaterThan(0.5);
  expect(points.lifted.y).toBeLessThan(points.boxTop - 5); // clear of the box on screen
  expect(await hoveredAt(page, points.floor)).toBe('desktop');
  expect(await hoveredAt(page, points.lifted)).toBe(null);
});
