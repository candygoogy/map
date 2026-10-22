import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/main'; // window.__map's type

// The trip receipt (Task 16). Arriving at exit only opens the door; clicking the door, or exit's
// "Leave", prints the trip at #receipt, where "Keep the receipt" saves it as a PNG. Back returns to
// #exit; a fresh /#receipt lands on #exit. On the manual clock (?test).

async function open(page: Page, hash = '', receipt = true): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?test${hash}`);
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    const { director, nodes, advance } = window.__map!;
    await director.ready;
    await nodes.ready;
    director.skipArrival();
    advance(1 / 60);
  });
  // The receipt is a lazy chunk, loaded once the arrival is over.
  if (receipt) await page.waitForFunction(() => window.__map!.receipt !== null);
}

const advance = (page: Page, seconds: number) => page.evaluate((s) => window.__map!.advance(s), seconds);
const state = (page: Page) => page.evaluate(() => window.__map!.director.state);

/** Steps the clock until the camera rests (station, receipt or overview). */
async function land(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { director, advance } = window.__map!;
    for (let i = 0; i < 900 && (director.flight || director.state === 'flying'); i++) advance(1 / 60);
  });
  await advance(page, 0.5);
}

async function go(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => window.__map!.stations.go(id), id);
  await land(page);
}

/** The CSS px point over the middle of a node's object `part`. */
const screenOf = (page: Page, id: string, part: string) =>
  page.evaluate(
    ([id, part]) => {
      const { stage, nodes } = window.__map!;
      const o = nodes.get(id!).root.getObjectByName(part!)!;
      o.updateWorldMatrix(true, true);
      const p = nodes.get(id!).bounds.clone().setFromObject(o, true).getCenter(o.position.clone());
      p.project(stage.camera);
      const { width, height } = stage.viewport;
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    },
    [id, part] as const,
  );

const nameOf = (page: Page, id: string) => page.evaluate((id) => window.__map!.feed.nodes.find((n) => n.id === id)!.name, id);

test('visiting three stations, then exit, then clicking the door prints a receipt listing them at #receipt; tearing downloads a PNG', async ({ page }) => {
  test.setTimeout(60_000); // four flights, the print and the tear
  await open(page);
  for (const id of ['fettle', 'idiff', 'notary', 'exit']) await go(page, id);
  expect(await state(page)).toBe('station');
  await advance(page, 3); // the door's `arrive` plays out
  const door = await screenOf(page, 'exit', 'poke_door_hit');
  await page.mouse.click(door.x, door.y);
  await expect(page).toHaveURL(/#receipt$/);
  await land(page);
  expect(await state(page)).toBe('receipt');

  // Fettle prints it: `trip` plays and holds fully fed out, the receipt on its paper (uv1).
  await page.waitForFunction(() => window.__map!.nodes.get('fettle').playing === 'trip');
  await advance(page, 5);
  const paper = () =>
    page.evaluate(() => {
      const fettle = window.__map!.nodes.get('fettle');
      let printed = false;
      fettle.root.traverse((o) => {
        const m = (o as unknown as { material?: { name: string; aoMap: { channel: number } | null } }).material;
        if (m?.name === 'paper' && m.aoMap?.channel === 1) printed = true;
      });
      return { playing: fettle.playing, printed };
    });
  expect(await paper()).toEqual({ playing: 'trip', printed: true }); // held, idle kept off

  // The panel shows the receipt: the verdict, then each station seen, in order.
  const receipt = page.locator('section#receipt');
  await expect(receipt).toBeVisible();
  await expect(receipt.locator('h2')).toHaveText('Just passing through.');
  const names = await Promise.all(['fettle', 'idiff', 'notary', 'exit'].map((id) => nameOf(page, id)));
  await expect(receipt.locator('dl.receipt-visited dt')).toHaveText(names);
  await expect(page.locator('section.station[data-node="exit"]')).toHaveClass(/sr-only/);

  // The printed canvas: every value on one right edge, every leader reaching its value.
  const rows = await page.evaluate(async () => {
    const canvas = await window.__map!.receipt!.canvas!;
    return JSON.parse(canvas.dataset.rows!) as { valueStart: number; valueEnd: number; leaderEnd: number }[];
  });
  expect(rows.length).toBeGreaterThan(5);
  for (const r of rows) {
    expect(r.valueEnd).toBe(rows[0]!.valueEnd);
    expect(r.valueStart - r.leaderEnd).toBeCloseTo(12, 5);
  }

  // Keeping it (the keyboard's way to tear it off): a PNG named candygoogy-trip.png.
  const keep = receipt.getByRole('button', { name: 'Keep the receipt' });
  await keep.focus();
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(download.suggestedFilename()).toBe('candygoogy-trip.png');
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const png = readFileSync(path);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  await expect(receipt.getByRole('status')).toHaveText('Saved as candygoogy-trip.png.');
  await expect(keep).toBeFocused();
  // Fettle tore it off: `tear` played, and the fresh stub is blank.
  expect((await paper()).playing).toBe('tear');
  await advance(page, 1.5);
  expect(await paper()).toEqual({ playing: 'idle', printed: false });
});

test('exit’s Leave button leaves too, and the trip counts pokes', async ({ page }) => {
  await open(page);
  await go(page, 'fettle');
  await page.evaluate(() => window.__map!.nodes.get('fettle').poke());
  await page.evaluate(() => {
    // as a click on the model does (map.ts counts it)
    window.__map!.receipt!.poked();
  });
  await go(page, 'exit');
  await page.locator('section.station[data-node="exit"]').getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/#receipt$/);
  await land(page);
  expect(await state(page)).toBe('receipt');
  await expect(page.locator('section#receipt')).toContainText('Things poked');
});

test('arriving at exit with → prints nothing, and → again goes to origin', async ({ page }) => {
  await open(page, '#colophon');
  await land(page);
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/#exit$/);
  await land(page);
  expect(await state(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.receipt!.canShow())).toBe(false);
  await expect(page.locator('section#receipt')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/#origin$/);
});

test('Back from #receipt returns to #exit with the exit panel', async ({ page }) => {
  await open(page);
  await go(page, 'idiff');
  await go(page, 'exit');
  await page.evaluate(() => window.__map!.receipt!.leave());
  await expect(page).toHaveURL(/#receipt$/);
  await land(page);
  await page.goBack();
  await expect(page).toHaveURL(/#exit$/);
  await land(page);
  expect(await state(page)).toBe('station');
  expect(await page.evaluate(() => window.__map!.panel.shown)).toBe('exit');
  await expect(page.locator('section.station[data-node="exit"]').getByRole('button', { name: 'Leave' })).toBeVisible();
});

test('loading /#receipt directly lands on #exit', async ({ page }) => {
  await open(page, '#receipt');
  await expect(page).toHaveURL(/#exit$/);
  await land(page);
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe('exit');
});

test('the header’s Back to the site leaves at once, with no receipt', async ({ page }) => {
  await open(page);
  await go(page, 'exit');
  const back = page.locator('header.top a.back');
  const href = await back.getAttribute('href');
  await page.route(`${href}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>site</p>' }));
  await back.click();
  await expect(page).toHaveURL(href!);
});

test('dragging the printed strip up past 0.6 tears it off and downloads it; a short drag springs back', async ({ page }) => {
  await open(page);
  await go(page, 'exit');
  await page.evaluate(() => window.__map!.receipt!.leave());
  await land(page);
  await page.waitForFunction(() => window.__map!.nodes.get('fettle').playing === 'trip');
  await advance(page, 5);
  const at = (await page.evaluate(() => window.__map!.receipt!.paperOnScreen()))!;
  expect(at).not.toBeNull();

  // A short pull: the strip gives a little, and springs back when let go. Nothing travels.
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y - at.perUnit * 0.3, { steps: 5 });
  await page.mouse.up();
  await expect(page).toHaveURL(/#receipt$/);
  expect(await page.evaluate(() => window.__map!.nodes.get('fettle').playing)).toBe('trip');

  // A long one tears it off: Fettle plays `tear` and the PNG downloads.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y - at.perUnit * 0.7, { steps: 8 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.mouse.up()]);
  expect(download.suggestedFilename()).toBe('candygoogy-trip.png');
  expect(await page.evaluate(() => window.__map!.nodes.get('fettle').playing)).toBe('tear');
  await expect(page).toHaveURL(/#receipt$/);
  expect(downloads).toBe(1);
});

test('with motion reduced the receipt is shown printed at once, and kept, the stub is blank at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await go(page, 'exit');
  await page.evaluate(() => window.__map!.receipt!.leave());
  await expect(page).toHaveURL(/#receipt$/);
  await advance(page, 0.1);
  expect(await state(page)).toBe('receipt'); // a cut, no flight
  await page.waitForFunction(() => window.__map!.nodes.get('fettle').playing === 'trip');
  // Fed out at once, as far as the receipt needs: well over the rest strip's 0.65.
  const height = () =>
    page.evaluate(() => {
      const fettle = window.__map!.nodes.get('fettle');
      const end = fettle.root.getObjectByName('paper_curl_12')!;
      return end.getWorldPosition(end.position.clone()).y - fettle.home.y;
    });
  expect(await height()).toBeGreaterThan(0.85);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Keep the receipt' }).click()]);
  expect(download.suggestedFilename()).toBe('candygoogy-trip.png');
  await advance(page, 0.1);
  expect(await height()).toBeLessThan(0.8); // the fresh stub, at once
});

test('axe finds no violations at #receipt and at #exit with its Leave button, light and dark', async ({ page }) => {
  test.setTimeout(150_000);
  for (const scheme of ['light', 'dark'] as const) {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.emulateMedia({ colorScheme: scheme });
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
      await page.waitForFunction(() => window.__map!.receipt !== null);
      for (const at of ['exit', 'receipt']) {
        if (at === 'exit') await go(page, 'exit');
        else {
          await page.evaluate(() => window.__map!.receipt!.leave());
          await land(page);
        }
        await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe(at);
        await expect(page.locator(`#stations section[data-node="${at}"]`)).toHaveCSS('opacity', '1');
        const { violations } = await new AxeBuilder({ page }).exclude('#stage').analyze();
        expect(violations.map((v) => `${scheme} ${size.width} #${at}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      }
    }
  }
});

test('the receipt counts a power cycle and prints the secrets found in their own words', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await go(page, 'origin');
  // Task 15's switch, from the keyboard's button in the origin's panel; the reboot plays out.
  await page.locator('section.station[data-node="origin"] button.power').click();
  await expect.poll(() => page.evaluate(() => window.__map!.nodes.get('origin').playing)).toBe('poke_power'); // its chunk is in
  // A second at a time, so what the moment starts on promises (the dive, the landing) runs between.
  for (let i = 0; i < 12; i++) await page.evaluate(() => window.__map!.advance(1, 1 / 30));
  await expect.poll(() => page.evaluate(() => window.__map!.receipt!.trip.summary().powerCycles)).toBe(1);
  // Task 17's key under exit's mat.
  await go(page, 'exit');
  await advance(page, 3);
  // Its label pokes the model, then each of its parts in turn: the second press is the mat.
  const label = page.locator('button.label[data-go="exit"]');
  await label.click();
  await label.click();
  await expect.poll(() => page.evaluate(async () => (await window.__map!.secrets()).map((s) => s.id))).toEqual(['key-under-mat']);
  await page.locator('section.station[data-node="exit"]').getByRole('button', { name: 'Leave' }).click();
  await land(page);
  const receipt = page.locator('section#receipt');
  await expect(receipt).toContainText('Turned off and on again');
  await expect(receipt).toContainText('Left the key under the mat');
  await expect(receipt).toContainText('1 of a few');
});

/** Fettle as the receipt has it: lit, the clip with the pose, and whether a strip stands out to tear. */
const fettle = (page: Page) =>
  page.evaluate(() => {
    const f = window.__map!.nodes.get('fettle');
    return { lit: f.lit, playing: f.playing, strip: window.__map!.receipt!.paperOnScreen() !== null };
  });

test('leaving while the map is dark: the receipt panel works, and Fettle, dark, prints nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await go(page, 'siel-eolie');
  await advance(page, 3);
  // Task 17's RCD trips the whole map; nothing comes back until it's reset at the board.
  const button = await screenOf(page, 'siel-eolie', 'poke_test_hit');
  await page.mouse.click(button.x, button.y);
  await expect.poll(() => page.evaluate(async () => (await window.__map!.secrets()).map((s) => s.id))).toContain('test-means-test');
  await advance(page, 3);
  expect(await page.evaluate(() => window.__map!.stations.ids.filter((id) => window.__map!.nodes.get(id).lit))).toEqual([]);
  await go(page, 'exit');
  await page.locator('section.station[data-node="exit"]').getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/#receipt$/);
  await land(page);
  expect(await state(page)).toBe('receipt');
  await advance(page, 5);
  // Dark, it holds its `off`: no feed, no strip.
  expect(await fettle(page)).toEqual({ lit: false, playing: 'off', strip: false });
  // The receipt is still the panel's, and kept, still downloads.
  const receipt = page.locator('section#receipt');
  await expect(receipt).toBeVisible();
  await expect(receipt.locator('h2')).not.toBeEmpty();
  const [download] = await Promise.all([page.waitForEvent('download'), receipt.getByRole('button', { name: 'Keep the receipt' }).click()]);
  expect(download.suggestedFilename()).toBe('candygoogy-trip.png');
  expect(await fettle(page)).toEqual({ lit: false, playing: 'off', strip: false });
});

test('a reboot at the receipt: Fettle prints it once it’s back on, and Keep tears it off', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await go(page, 'origin');
  await page.locator('section.station[data-node="origin"] button.power').click();
  await expect.poll(() => page.evaluate(() => window.__map!.nodes.get('origin').playing)).toBe('poke_power');
  // Leaving at once: the camera flies to Fettle as the network goes dark behind it.
  await page.evaluate(() => window.__map!.receipt!.leave());
  await expect(page).toHaveURL(/#receipt$/);
  // A second at a time, so what the moment starts on promises runs between.
  for (let i = 0; i < 12; i++) await page.evaluate(() => window.__map!.advance(1, 1 / 30));
  expect(await state(page)).toBe('receipt');
  expect(await page.evaluate(() => window.__map!.receipt!.trip.summary().powerCycles)).toBe(1);
  expect(await fettle(page)).toEqual({ lit: true, playing: 'trip', strip: true });
  await advance(page, 5); // fed fully out, and held
  expect(await fettle(page)).toEqual({ lit: true, playing: 'trip', strip: true });
  await page.getByRole('button', { name: 'Keep the receipt' }).click();
  expect((await fettle(page)).playing).toBe('tear');
  await advance(page, 1.5);
  expect(await fettle(page)).toEqual({ lit: true, playing: 'idle', strip: false });
});

test('the WebGL context lost before the receipt’s chunk is in: no receipt UI joins the plain page', async ({ page }) => {
  // The chunk held back until the page has gone plain.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let asked = false;
  await page.route(/\/src\/moments\/receipt\.ts/, async (route) => {
    asked = true;
    await held;
    await route.continue();
  });
  await open(page, '', false);
  await expect.poll(() => asked).toBe(true);
  await page.evaluate(() => window.__map!.stage.renderer.getContext().getExtension('WEBGL_lose_context')!.loseContext());
  await expect(page.locator('html')).toHaveClass(/\bno-3d\b/);
  release();
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((e) => /\/src\/moments\/receipt\.ts/.test(e.name)))).toBe(true);
  await page.waitForTimeout(500); // past its then
  await expect(page.locator('section#receipt')).toHaveCount(0);
  await expect(page.locator('.receipt-leave')).toHaveCount(0);
});

test('“Things poked” counts the pokes a model answered: none mid-poke or mid-refusal, none while it’s dark', async ({ page }) => {
  await open(page);
  await go(page, 'notary');
  await advance(page, 3);
  const pokes = () => page.evaluate(() => window.__map!.receipt!.trip.summary().pokes);
  // Four presses of its label 0.2 s apart in one step (the refusal counts wall-clock time): a
  // poke, one it ignores while that plays out (it still counts toward the refusal), the refusal,
  // and one it ignores while refusing.
  const seen = await page.evaluate(() => {
    const { nodes, advance } = window.__map!;
    const label = document.querySelector<HTMLButtonElement>('button.label[data-go="notary"]')!;
    const out: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      label.click();
      advance(0.2);
      out.push(nodes.get('notary').playing);
    }
    return out;
  });
  expect(seen).toEqual(['poke', 'poke', 'poke_refuse', 'poke_refuse']);
  expect(await pokes()).toBe(2);
  await advance(page, 2);
  // Dark, it doesn't react, and it isn't counted.
  await page.evaluate(() => window.__map!.nodes.get('notary').setLit(false));
  await advance(page, 2);
  await page.locator('button.label[data-go="notary"]').click();
  expect(await pokes()).toBe(2);
});

test('the printed lines run level on screen at #receipt, and the map’s labels step back from the paper', async ({ page }) => {
  await open(page);
  await go(page, 'exit');
  await page.evaluate(() => window.__map!.receipt!.leave());
  await land(page);
  // Two points across the paper at one height, at its foot and near its top: level on screen.
  const tilt = await page.evaluate(() => {
    const { nodes, stage } = window.__map!;
    const home = nodes.get('fettle').home;
    return [0.6, 1.2].map((y) => {
      const [l, r] = [-0.19, 0.19].map((x) => home.clone().add({ x, y, z: 0 } as never).project(stage.camera));
      return Math.abs(((l!.y - r!.y) / 2) * stage.viewport.height);
    });
  });
  for (const px of tilt) expect(px).toBeLessThan(0.5);
  await expect(page.locator('button.label[data-go="eolietech"]')).toHaveCSS('opacity', '0');
  await page.evaluate(() => window.__map!.stations.go('exit'));
  await expect(page.locator('button.label[data-go="exit"]')).not.toHaveCSS('opacity', '0');
});

test('“Keep the receipt” is in view at #receipt without scrolling, on desktop and in a phone’s sheet, upright or on its side', async ({ page }) => {
  test.setTimeout(90_000);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 }, // a landscape phone's sheet is 175px tall (polish-2)
  ]) {
    await page.setViewportSize(size);
    await open(page);
    await page.setViewportSize(size); // open() sets desktop
    await go(page, 'exit');
    await page.evaluate(() => window.__map!.receipt!.leave());
    await land(page);
    await expect.poll(() => page.evaluate(() => window.__map!.panel.shown)).toBe('receipt');
    const keep = page.locator('section#receipt').getByRole('button', { name: 'Keep the receipt' });
    await expect(keep).toBeInViewport({ ratio: 1 });
    expect(await page.locator('section#receipt').evaluate((s) => s.scrollTop)).toBe(0);
    // Clear of the counter and ‹ ›.
    const k = (await keep.boundingBox())!;
    for (const b of await page.locator('.travel > *').all()) {
      const r = (await b.boundingBox())!;
      const meet = k.x < r.x + r.width && r.x < k.x + k.width && k.y < r.y + r.height && r.y < k.y + k.height;
      expect(meet, `${size.width}×${size.height}`).toBe(false);
    }
    // Heading, then the action, then the receipt's details.
    const order = await page.locator('section#receipt').evaluate((s) =>
      [...s.querySelectorAll('h2, button, dl')].map((e) => e.tagName.toLowerCase()).slice(0, 3),
    );
    expect(order).toEqual(['h2', 'button', 'dl']);
  }
});
