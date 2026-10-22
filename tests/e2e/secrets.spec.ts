import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/main'; // window.__map's type

// The secrets (Task 17, approved by the owner 2026-10-20 with its recommendations and drafted
// words). Each is found by playing, recorded once per visit (window.__map.secrets(), the lazy
// registry Task 16's receipt reads), has a keyboard path, and keeps its outcome with motion
// reduced. On the manual clock (?test) with motion; under reduced motion the power moment runs on
// timers, so those tests wait in real time.

test.describe.configure({ timeout: 180_000 });

async function open(page: Page, size = { width: 1440, height: 900 }): Promise<void> {
  await page.setViewportSize(size);
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

/** Steps the manual clock, 30 frames a second (each one rendered). */
const advance = (page: Page, seconds: number) => page.evaluate((s) => window.__map!.advance(s, 1 / 30), seconds);

/** Travels to station `id` and lets its `arrive` play out. */
async function at(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const { stations, director, advance } = window.__map!;
    stations.go(id);
    for (let i = 0; i < 600 && director.state !== 'station'; i++) advance(1 / 60);
  }, id);
  await advance(page, 3);
  expect(await page.evaluate(() => [window.__map!.director.state, window.__map!.stations.current])).toEqual(['station', id]);
}

/** The CSS px point over object `name` of node `id` (its bounds' centre). */
const over = (page: Page, id: string, name: string) =>
  page.evaluate(
    ([id, name]) => {
      const { stage, nodes } = window.__map!;
      const node = nodes.get(id!);
      const o = node.root.getObjectByName(name!)!;
      o.updateWorldMatrix(true, true);
      const p = node.bounds.clone().setFromObject(o, true).getCenter(node.root.position.clone());
      p.project(stage.camera);
      const { width, height } = stage.viewport;
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    },
    [id, name],
  );

const click = async (page: Page, id: string, name: string) => {
  const p = await over(page, id, name);
  await page.mouse.click(p.x, p.y);
};

const found = (page: Page) => page.evaluate(() => window.__map!.secrets().then((l) => l.map((s) => s.id)));

/** The network as it stands: which nodes and links are lit, the statuses and traffic. */
const network = (page: Page) =>
  page.evaluate(() => {
    const { stations, nodes, links, traffic, director } = window.__map!;
    const ids = stations.ids;
    return {
      lit: ids.filter((id) => nodes.get(id).lit),
      linksLit: ids.filter((id) => id !== 'origin' && links.isLit(id)),
      statuses: ids.map((id) => document.querySelector(`button.label[data-go="${id}"] .status`)?.textContent ?? ''),
      traffic: traffic.enabled,
      state: director.state,
      current: stations.current,
    };
  });

/** How far the camera stands from Siel Eolie's station target, in its framing's distances: about
 *  1 at the station's framing (the drift orbits at that distance), more in the RCD's wider one. */
const wide = (page: Page) =>
  page.evaluate(() => {
    const { director, stage } = window.__map!;
    const f = director.framing('siel-eolie');
    return stage.camera.position.distanceTo(f.target) / f.position.distanceTo(f.target);
  });

const playing = (page: Page, id: string) => page.evaluate((id) => window.__map!.nodes.get(id).playing, id);

/** The origin's tape: its height in world units (folded out of sight at rest). */
const tapeScale = (page: Page) =>
  page.evaluate(() => {
    const { nodes } = window.__map!;
    const o = nodes.get('origin').root.getObjectByName('tape')!;
    o.updateWorldMatrix(true, true);
    const size = nodes.get('origin').bounds.clone().setFromObject(o, true).getSize(o.position.clone());
    return Math.max(size.x, size.y, size.z) * 10; // 0.1 tall unfolded: about 1
  });

/** The tape's pose: its morph weights (all 0: laid and pressed) and the roll's size (hidden at rest). */
const tapePose = (page: Page) =>
  page.evaluate(() => {
    const root = window.__map!.nodes.get('origin').root;
    const tape = root.getObjectByName('tape') as unknown as { morphTargetInfluences?: number[] };
    const roll = root.getObjectByName('tape_roll')!;
    return { weights: [...(tape.morphTargetInfluences ?? [])], roll: Math.max(roll.scale.x, roll.scale.y, roll.scale.z) };
  });

test.describe('1, the taped-over switch', () => {
  test('three flips within a minute tape the switch over; the fourth strains against the tape, nothing switches, recorded once', async ({
    page,
  }) => {
    await open(page);
    expect(await tapeScale(page)).toBeLessThan(0.01); // folded out of sight
    const ids = await page.evaluate(() => [...window.__map!.stations.ids]);
    for (let i = 1; i <= 3; i++) {
      await at(page, 'origin');
      await page.getByRole('button', { name: 'Turn it off and on again' }).click();
      await expect.poll(() => playing(page, 'origin')).toBe('poke_power');
      await advance(page, 2);
      expect((await network(page)).lit, `flip ${i} went dark`).toEqual([]);
      if (i === 3) break; // its reboot's end is watched below
      expect(await tapeScale(page)).toBeLessThan(0.01);
      await advance(page, 5);
      expect((await network(page)).lit.length, `flip ${i} came back`).toBe(ids.length);
    }
    // The flip dove to the overview: as the third reboot ends the camera goes back to the origin,
    // and as it lands the tape goes on (tape_on: a roll lays it down the cover), where it's seen.
    await expect
      .poll(async () => (await advance(page, 0.1), playing(page, 'origin')), { timeout: 60_000 })
      .toBe('tape_on');
    expect((await network(page)).current).toBe('origin');
    expect((await network(page)).state).toBe('station');
    expect((await network(page)).lit.length, 'flip 3 came back').toBe(ids.length);
    await advance(page, 0.2);
    expect(await tapeScale(page)).toBeGreaterThan(0.3); // shown as it starts (the roll covers the first 0.15 s)
    // A flip while it goes on does nothing: it plays out.
    await page.getByRole('button', { name: 'Turn it off and on again' }).click();
    expect(await playing(page, 'origin')).toBe('tape_on');
    await advance(page, 1.5);
    expect(await tapeScale(page)).toBeGreaterThan(0.5); // across the cover
    const pose = await tapePose(page);
    expect(pose.weights.every((w) => Math.abs(w) < 1e-3)).toBe(true); // laid and pressed down
    expect(pose.roll).toBeLessThan(0.01); // the roll is gone
    expect(await found(page)).toEqual([]); // not found yet: it's found by flipping it again

    await at(page, 'origin');
    await click(page, 'origin', 'poke_power_hit');
    await expect.poll(() => playing(page, 'origin')).toBe('poke_power_taped');
    await advance(page, 2);
    const n = await network(page);
    expect(n.lit.length).toBe(ids.length); // nothing switched
    expect(n.state).toBe('station'); // no dive either
    expect(n.traffic).toBe(true);
    expect(await found(page)).toEqual(['taped-switch']);

    // The button (the keyboard's way to the switch) strains it too, and it's still found once.
    const button = page.getByRole('button', { name: 'Turn it off and on again' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => playing(page, 'origin')).toBe('poke_power_taped');
    await advance(page, 2);
    expect((await network(page)).lit.length).toBe(ids.length);
    expect(await tapeScale(page)).toBeGreaterThan(0.5); // it stays
    const list = await page.evaluate(() => window.__map!.secrets());
    expect(list.map((s) => s.id)).toEqual(['taped-switch']);
    expect(list[0]!.line).toBe('Taped over the power switch');
    expect(list[0]!.name).toBe('The taped-over switch');
  });
});

test.describe('1, the taped-over switch, motion reduced', () => {
  test('the third reboot leaves the tape on, laid, with no tape_on; the camera cuts back to the origin', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const ids = await page.evaluate(() => [...window.__map!.stations.ids]);
    for (let i = 1; i <= 3; i++) {
      await page.evaluate(() => window.__map!.stations.go('origin'));
      await advance(page, 1);
      expect((await network(page)).current).toBe('origin');
      await page.getByRole('button', { name: 'Turn it off and on again' }).click();
      await expect.poll(() => network(page).then((n) => n.lit), { timeout: 3000 }).toEqual([]);
      // on timers: the reboot is over once every status reads "Working" again (and a moment after)
      await expect
        .poll(() => network(page).then((n) => n.lit.length === ids.length && n.statuses.every((t) => t === 'Working')), { timeout: 15_000 })
        .toBe(true);
      await page.waitForTimeout(1500);
      if (i < 3) expect(await tapeScale(page)).toBeLessThan(0.01);
    }
    await expect.poll(() => tapeScale(page), { timeout: 3000 }).toBeGreaterThan(0.5);
    const n = await network(page);
    expect([n.state, n.current]).toEqual(['station', 'origin']); // back from the overview, a cut
    expect(await playing(page, 'origin')).not.toBe('tape_on');
    const pose = await tapePose(page);
    expect(pose.weights.every((w) => Math.abs(w) < 1e-3)).toBe(true); // its end pose
    expect(pose.roll).toBeLessThan(0.01);
  });
});

test.describe('2, test means test', () => {
  test('pressing the RCD’s test trips the whole map from Siel Eolie outward along the links; nothing comes back until it’s pressed again', async ({ page }) => {
    await open(page);
    await at(page, 'siel-eolie');
    const ids = await page.evaluate(() => [...window.__map!.stations.ids]);
    // The farthest node along the links from Siel Eolie (down its link to the hub, then out along
    // another, a cluster's through homelab), and its nearest neighbour across the floor.
    const [far, crow] = await page.evaluate(() => {
      const { stations, nodes, links } = window.__map!;
      const up = (id: string): number => (id === 'origin' ? 0 : links.curve(id).getLength() + up(links.parent(id)));
      const others = stations.ids.filter((id) => id !== 'siel-eolie' && id !== 'origin');
      const s = nodes.get('siel-eolie').home;
      const d = (id: string) => nodes.get(id).home.distanceTo(s);
      return [others.reduce((a, b) => (up(b) > up(a) ? b : a)), others.reduce((a, b) => (d(b) < d(a) ? b : a))];
    });
    await click(page, 'siel-eolie', 'poke_test_hit');
    await expect.poll(() => found(page)).toEqual(['test-means-test']); // its chunk is in, the press played
    await advance(page, 0.3);
    let n = await network(page);
    expect(n.traffic).toBe(false);
    expect(n.lit.length).toBe(ids.length); // the toggle down, the pilot light sinking: nothing out yet
    await advance(page, 0.3);
    n = await network(page);
    expect(n.linksLit).not.toContain('siel-eolie'); // the dark leaves down its own link first
    expect(n.lit).toContain('origin');
    await advance(page, 0.4);
    n = await network(page);
    expect(n.lit).not.toContain('origin'); // at the hub,
    expect(n.lit).not.toContain('siel-eolie'); // (the board as its poke_test ended)
    expect(n.lit).toContain(crow); // while its nearest neighbour across the floor waits on its own link
    expect(n.lit).toContain(far);
    await advance(page, 2);
    n = await network(page);
    expect(n.lit).toEqual([]); // the board too: dark, every toggle down
    expect(n.linksLit).toEqual([]);
    expect(n.statuses.every((s) => s === '')).toBe(true);
    expect([n.state, n.current]).toEqual(['station', 'siel-eolie']); // you stay where you pressed,
    expect(await wide(page)).toBeGreaterThan(1.5); // pulled back round it to see the dark spread
    expect(await found(page)).toEqual(['test-means-test']);

    // Nothing reboots by itself, and the origin's switch can't fix it.
    await advance(page, 10);
    expect((await network(page)).lit).toEqual([]);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#origin button.power')!.click());
    await advance(page, 1);
    expect((await network(page)).lit).toEqual([]);

    // Pressed again, from where you are: reset, and the arrival's reboot runs.
    expect(await page.evaluate(() => window.__map!.stations.current)).toBe('siel-eolie');
    await click(page, 'siel-eolie', 'poke_test_hit');
    await advance(page, 8);
    n = await network(page);
    expect(n.lit.length).toBe(ids.length);
    expect(n.linksLit.length).toBe(ids.length - 1);
    expect(n.statuses.every((s) => s === 'Working')).toBe(true);
    expect(n.traffic).toBe(true);
    expect([n.state, n.current]).toEqual(['station', 'siel-eolie']);
    expect(await wide(page)).toBeCloseTo(1, 1); // back at the station's framing

    // A second trip trips again; it's still found once.
    await advance(page, 1);
    await click(page, 'siel-eolie', 'poke_test_hit');
    await advance(page, 3);
    expect((await network(page)).lit).toEqual([]);
    expect(await found(page)).toEqual(['test-means-test']);
  });

  test('under reduced motion everything goes off at once, and the reset brings it all back', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await page.evaluate(() => window.__map!.stations.go('siel-eolie'));
    const ids = await page.evaluate(() => [...window.__map!.stations.ids]);
    await click(page, 'siel-eolie', 'poke_test_hit');
    await expect.poll(() => network(page).then((n) => n.lit), { timeout: 2000 }).toEqual([]);
    await page.waitForTimeout(3000);
    let n = await network(page);
    expect(n.lit).toEqual([]);
    expect([n.state, n.current]).toEqual(['station', 'siel-eolie']); // still there,
    expect(await wide(page)).toBeGreaterThan(1.5); // cut out to the wider framing to see it all dark
    await advance(page, 1); // the press is the visitor's own: it plays on frames, motion reduced or not
    await click(page, 'siel-eolie', 'poke_test_hit');
    await expect.poll(() => wide(page), { timeout: 1000 }).toBeCloseTo(1, 1); // and cut back
    await expect.poll(() => network(page).then((n) => n.lit.length), { timeout: 4000 }).toBe(ids.length);
    await expect.poll(() => network(page).then((n) => n.statuses.every((s) => s === 'Working')), { timeout: 6000 }).toBe(true);
    n = await network(page);
    expect([n.state, n.current]).toEqual(['station', 'siel-eolie']);
    expect(await found(page)).toEqual(['test-means-test']);
  });

  test('the trip keeps the camera at Siel Eolie: out to a wider framing with its neighbours, held, and back as you reset', async ({ page }) => {
    await open(page);
    await at(page, 'siel-eolie');
    expect(await wide(page)).toBeCloseTo(1, 1);
    await click(page, 'siel-eolie', 'poke_test_hit');
    await expect.poll(() => found(page)).toEqual(['test-means-test']);
    await advance(page, 0.6);
    const early = await wide(page);
    expect(early).toBeGreaterThan(1.05); // easing out
    await advance(page, 2);
    const out = await wide(page);
    expect(out).toBeGreaterThan(early);
    expect(await page.evaluate(() => [window.__map!.director.state, window.__map!.stations.current])).toEqual(['station', 'siel-eolie']);
    // The board and its two nearest neighbours are in view, left of the panel.
    const seen = await page.evaluate(() => {
      const { stage, nodes } = window.__map!;
      return ['siel-eolie', 'eolietech', 'dolci-eoliani'].map((id) => {
        const p = nodes.get(id).home.clone().project(stage.camera);
        const x = ((p.x + 1) / 2) * innerWidth;
        const y = ((1 - p.y) / 2) * innerHeight;
        return x > 0 && x < innerWidth - 460 && y > 0 && y < innerHeight;
      });
    });
    expect(seen).toEqual([true, true, true]);
    await advance(page, 4);
    expect(await wide(page)).toBeCloseTo(out, 2); // held while it's dark

    // The dark board answers a press anywhere on it (its test button is small from out here).
    const board = await page.evaluate(() => {
      const { stage, nodes } = window.__map!;
      const n = nodes.get('siel-eolie');
      const p = n.bounds.getCenter(n.home.clone()).add(n.home).project(stage.camera);
      return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
    });
    await page.mouse.click(board.x, board.y);
    await expect.poll(() => network(page).then((n) => n.lit.includes('siel-eolie'))).toBe(true);
    await advance(page, 0.5);
    const back = await wide(page);
    expect(back).toBeLessThan(out);
    await advance(page, 1.5);
    expect(await wide(page)).toBeCloseTo(1, 1);

    // Tripped and left: the flights take over; back at the board it's the station's framing, and
    // the reset leaves it there.
    await advance(page, 8);
    await click(page, 'siel-eolie', 'poke_test_hit');
    await advance(page, 3);
    await at(page, 'eolietech');
    await at(page, 'siel-eolie');
    expect(await wide(page)).toBeCloseTo(1, 1);
    await click(page, 'siel-eolie', 'poke_test_hit');
    let most = 0;
    for (let i = 0; i < 6; i++) {
      await advance(page, 0.25);
      most = Math.max(most, await wide(page));
    }
    expect(most).toBeLessThan(1.1);
    expect((await network(page)).lit).toContain('siel-eolie');
  });

  test('from the keyboard: Enter on Siel Eolie’s label pokes it, and again presses the RCD’s test', async ({ page }) => {
    await open(page);
    await at(page, 'siel-eolie');
    const label = page.locator('button.label[data-go="siel-eolie"]');
    await label.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => playing(page, 'siel-eolie')).toBe('poke');
    await advance(page, 3);
    await page.keyboard.press('Enter');
    await expect.poll(() => found(page)).toEqual(['test-means-test']);
    await advance(page, 3);
    expect((await network(page)).lit).toEqual([]);
    expect(await found(page)).toEqual(['test-means-test']);
  });
});

test.describe('5, the key under the mat', () => {
  test('poking exit’s mat flips its corner and finds the key, recorded once; Enter on the label gets there too', async ({ page }) => {
    await open(page);
    await at(page, 'exit');
    await click(page, 'exit', 'poke_mat_hit');
    await expect.poll(() => found(page)).toEqual(['key-under-mat']);
    await advance(page, 2);
    await click(page, 'exit', 'poke_mat_hit'); // the corner flaps back
    await advance(page, 2);
    await click(page, 'exit', 'poke_mat_hit');
    await advance(page, 1);
    const list = await page.evaluate(() => window.__map!.secrets());
    expect(list.map((s) => [s.id, s.name, s.line])).toEqual([['key-under-mat', 'The key under the mat', 'Left the key under the mat']]);
    expect(list[0]!.at).toBeGreaterThan(0);
  });

  // The overview welcome's counter: prerendered at 0, moved by the secrets' lazy chunk as one is
  // found, and never the total.
  test('finding it moves the welcome’s counter from 0 to 1', async ({ page }) => {
    await open(page);
    const value = page.locator('#welcome [data-found]');
    const sr = page.locator('#welcome [data-found-sr]');
    await expect(value).toHaveText('0 of a few');
    await expect(sr).toHaveText('Hidden things found: 0 of a few');
    await at(page, 'exit');
    await click(page, 'exit', 'poke_mat_hit');
    await expect.poll(() => found(page)).toEqual(['key-under-mat']);
    await expect(value).toHaveText('1 of a few');
    await expect(sr).toHaveText('Hidden things found: 1 of a few');
    // Back in the overview, the welcome shows it.
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const { director, advance } = window.__map!;
      for (let i = 0; i < 600 && director.state !== 'overview'; i++) advance(1 / 60);
    });
    await expect(page.locator('#welcome')).not.toHaveClass(/sr-only/);
    await expect(value).toBeVisible();
    await expect(value).toHaveText('1 of a few');
  });

  test('from the keyboard: the second Enter on exit’s label lifts the mat', async ({ page }) => {
    await open(page);
    await at(page, 'exit');
    const label = page.locator('button.label[data-go="exit"]');
    await label.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => playing(page, 'exit')).toBe('poke');
    await advance(page, 2);
    expect(await found(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect.poll(() => found(page)).toEqual(['key-under-mat']);
  });
});

/** The plane's trip (secret 3): where the flying plane is, whether the one on the stand shows. */
const trip = (page: Page) =>
  page.evaluate(() => {
    const { stage, nodes } = window.__map!;
    const flying = stage.scene.getObjectByName('plane-trip');
    const p = flying ? flying.getWorldPosition(flying.position.clone()) : null;
    const server = nodes.get('server').home;
    return {
      flying: !!flying,
      toServer: p ? Math.hypot(p.x - server.x, p.z - server.z) : null,
      y: p?.y ?? null,
      onStand: nodes.get('candygoogy-bot').root.getObjectByName('plane')!.visible,
      server: nodes.get('server').playing,
    };
  });

/** Where the camera is: the director's state, the station, the hash. */
const where = (page: Page) =>
  page.evaluate(() => [window.__map!.director.state, window.__map!.stations.current, location.hash] as const);

/**
 * The ride along (the camera follows the plane): steps the manual clock a frame at a time from
 * the launch until the plane sits on the server's lid, counting the frames the plane is on
 * screen (its centre inside the canvas, in front of the camera). Returns the share, and whether
 * it's in view as it lands.
 */
const ride = (page: Page) =>
  page.evaluate(() => {
    const { stage, advance } = window.__map!;
    const server = window.__map!.nodes.get('server').home;
    let frames = 0;
    let seen = 0;
    let landed = false;
    let landedInView = false;
    for (let i = 0; i < 30 * 8 && !landed; i++) {
      advance(1 / 30);
      const g = stage.scene.getObjectByName('plane-trip');
      if (!g) continue;
      const p = g.getWorldPosition(g.position.clone());
      landed = Math.hypot(p.x - server.x, p.z - server.z) < 0.3 && p.y > server.y;
      const v = p.clone().project(stage.camera);
      const on = v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
      frames++;
      if (on) seen++;
      if (landed) landedInView = on;
    }
    return { frames, share: frames ? seen / frames : 0, landed, landedInView };
  });

/** Clicks the stand twice and lets the press play to its kick: the plane is off. */
async function launch(page: Page): Promise<void> {
  await click(page, 'candygoogy-bot', 'poke_stand_hit');
  await advance(page, 1.5);
  await click(page, 'candygoogy-bot', 'poke_stand_hit');
  await expect.poll(() => found(page)).toEqual(['plane-to-work']);
}

test.describe('3, the plane goes to work', () => {
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`poking the launch stand twice sends the plane to the server’s lid, the camera riding along to the server’s station, and home (${size.width}×${size.height})`, async ({
      page,
    }) => {
      await open(page, size);
      await at(page, 'candygoogy-bot');
      await click(page, 'candygoogy-bot', 'poke_stand_hit');
      await expect.poll(() => playing(page, 'candygoogy-bot')).toBe('poke_stand');
      await advance(page, 1.5);
      expect((await trip(page)).flying).toBe(false); // once is a hop
      expect(await found(page)).toEqual([]);
      expect(await where(page)).toEqual(['station', 'candygoogy-bot', '#candygoogy-bot']);

      await click(page, 'candygoogy-bot', 'poke_stand_hit');
      await expect.poll(() => found(page)).toEqual(['plane-to-work']);
      // The camera rides along: a flight to the server's station, the plane on screen most of the
      // way, and its landing in view; the server's light blinks.
      const r = await ride(page);
      expect(r.landed).toBe(true);
      expect(r.frames).toBeGreaterThan(60);
      expect(r.share).toBeGreaterThanOrEqual(0.8);
      expect(r.landedInView).toBe(true);
      expect((await trip(page)).onStand).toBe(false);
      let blink = false;
      for (let i = 0; i < 10 && !blink; i++) blink = (await advance(page, 0.1), await playing(page, 'server')) === 'blink';
      expect(blink).toBe(true);
      // Left at the server's station, as after any arrival: the hash, the label, the panel.
      await advance(page, 1);
      expect(await where(page)).toEqual(['station', 'server', '#server']);
      await expect(page.locator('button.label[data-go="server"]')).toHaveAttribute('aria-current', 'location');
      await expect(page.locator('section.station#server')).not.toHaveClass(/sr-only/);
      // And the plane flies home, back on its stand; the camera stays at the server.
      await advance(page, 6);
      const t = await trip(page);
      expect(t.flying).toBe(false);
      expect(t.onStand).toBe(true);
      expect(await where(page)).toEqual(['station', 'server', '#server']);
      expect(await found(page)).toEqual(['plane-to-work']);
    });
  }

  for (const [key, want] of [
    ['ArrowLeft', 'desktop'],
    ['Escape', null],
  ] as const) {
    test(`${key} mid-ride travels on from the ride as from any flight; the plane still lands and comes home`, async ({ page }) => {
      await open(page);
      await at(page, 'candygoogy-bot');
      await launch(page);
      await advance(page, 1.4); // mid-ride
      expect(await where(page)).toEqual(['flying', 'server', '#server']);
      await page.keyboard.press(key);
      await advance(page, 8);
      expect(await where(page)).toEqual([want === null ? 'overview' : 'station', want, want === null ? '' : `#${want}`]);
      const t = await trip(page);
      expect(t.flying).toBe(false);
      expect(t.onStand).toBe(true);
      // Travel still works from there.
      await page.evaluate(() => window.__map!.stations.go('fettle'));
      await advance(page, 8);
      expect(await where(page)).toEqual(['station', 'fettle', '#fettle']);
      expect(await found(page)).toEqual(['plane-to-work']);
    });
  }

  test('a click on another model mid-ride flies there instead', async ({ page }) => {
    await open(page);
    await at(page, 'candygoogy-bot');
    await launch(page);
    await advance(page, 1);
    await page.evaluate(() => window.__map!.stations.go('notary')); // as a click on its model or label does
    await advance(page, 9);
    expect(await where(page)).toEqual(['station', 'notary', '#notary']);
    expect((await trip(page)).onStand).toBe(true);
  });

  test('under reduced motion the plane cuts to the lid, the server blinks, the view cuts to the server, and the plane cuts back home', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await page.evaluate(() => window.__map!.stations.go('candygoogy-bot'));
    await advance(page, 0.5);
    await click(page, 'candygoogy-bot', 'poke_stand_hit');
    await advance(page, 1);
    await click(page, 'candygoogy-bot', 'poke_stand_hit');
    await expect.poll(() => found(page)).toEqual(['plane-to-work']);
    await advance(page, 0.4); // the press plays on frames (the visitor's own), to its kick
    await expect.poll(() => trip(page).then((t) => t.toServer !== null && t.toServer < 0.3), { timeout: 3000 }).toBe(true);
    expect((await trip(page)).onStand).toBe(false);
    expect(await where(page)).toEqual(['station', 'server', '#server']); // no ride: a cut
    await expect(page.locator('section.station#server')).not.toHaveClass(/sr-only/);
    await expect.poll(() => trip(page).then((t) => !t.flying && t.onStand), { timeout: 8000 }).toBe(true);
    expect(await found(page)).toEqual(['plane-to-work']);
  });

  test('from the keyboard: Enter on the label pokes the plane, then the stand, in turn; the stand twice launches it', async ({ page }) => {
    await open(page);
    await at(page, 'candygoogy-bot');
    await page.locator('button.label[data-go="candygoogy-bot"]').focus();
    for (const want of ['poke', 'poke_stand', 'poke']) {
      await page.keyboard.press('Enter');
      await expect.poll(() => playing(page, 'candygoogy-bot')).toBe(want);
      await advance(page, 1.4);
    }
    expect((await trip(page)).flying).toBe(false);
    await page.keyboard.press('Enter'); // the stand again
    await expect.poll(() => found(page)).toEqual(['plane-to-work']);
    await advance(page, 0.6);
    expect((await trip(page)).flying).toBe(true);
  });
});

/** The theme switch's state: the html's theme, the pill's pressed option, the saved choice. */
const theme = (page: Page) =>
  page.evaluate(() => ({
    html: document.documentElement.dataset.theme ?? 'auto',
    pressed: document.querySelector('[data-theme-switch] button[aria-pressed="true"]')?.getAttribute('data-value') ?? null,
    saved: localStorage.getItem('theme'),
  }));

test.describe('6, the colophon lamp', () => {
  test('pulling the lamp’s cord switches the whole map to dark, the pill with it; again, back to light; recorded once', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    await at(page, 'colophon');
    expect(await theme(page)).toEqual({ html: 'auto', pressed: 'auto', saved: null });
    await click(page, 'colophon', 'lamp_glow');
    await expect.poll(() => playing(page, 'colophon')).toBe('poke_lamp');
    await expect.poll(() => theme(page)).toEqual({ html: 'dark', pressed: 'dark', saved: 'dark' });
    // The scene too: the renderer clears to the dark background.
    await expect
      .poll(() => page.evaluate(() => `#${window.__map!.stage.renderer.getClearColor(window.__map!.stage.theme.bg.clone()).getHexString()}`))
      .toBe('#121214');
    expect(await found(page)).toEqual(['lamp']);

    await advance(page, 1.5);
    await click(page, 'colophon', 'lamp_glow');
    await expect.poll(() => theme(page)).toEqual({ html: 'light', pressed: 'light', saved: 'light' });
    await advance(page, 1.5);
    const list = await page.evaluate(() => window.__map!.secrets());
    expect(list.map((s) => [s.id, s.name, s.line])).toEqual([['lamp', 'The colophon lamp', 'Pulled the lamp cord']]);
  });

  test('from the keyboard: Enter on colophon’s label pokes its parts in turn, the lamp among them', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    await at(page, 'colophon');
    await page.locator('button.label[data-go="colophon"]').focus();
    // The model, the stick and the lamp, each once in some order: the theme flips once.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Enter');
      await advance(page, 1.5);
    }
    await expect.poll(() => theme(page)).toEqual({ html: 'dark', pressed: 'dark', saved: 'dark' });
    expect(await found(page)).toEqual(['lamp']);
  });

  test('under reduced motion the pull still switches the theme, at once', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await open(page);
    await page.evaluate(() => window.__map!.stations.go('colophon'));
    await advance(page, 1);
    await click(page, 'colophon', 'lamp_glow');
    await expect.poll(() => theme(page), { timeout: 1000 }).toEqual({ html: 'light', pressed: 'light', saved: 'light' });
    expect(await found(page)).toEqual(['lamp']);
  });
});
