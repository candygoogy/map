import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../src/copy';
import { parseFeed } from '../../src/data/feed';
import { renderStations } from '../../src/fallback/html';
import type {} from '../../src/main'; // window.__map's type

// The fallback parcel (box.glb, Batch C): a project the map doesn't know yet stands as a
// cardboard parcel. A click on its "this way up" arrows (poke_arrows) flips the whole parcel
// upside down, its root, and the runtime holds it there through idle and a plain poke (which
// plays around it) until the next click on the arrows plays poke_arrows_tidy. On the manual
// clock (?test).

/** Opens the map under ?test, waits for every node's model, skips the arrival, renders a frame. */
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

test('the parcel stays upside down after poke_arrows, through idle and a poke, until the next', async ({ page }) => {
  test.setTimeout(90_000); // a load, the arrival skipped, and 14 s of clock
  // A feed with a project the map doesn't know yet (as in nodes.spec.ts).
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const snapshot = /<script type="application\/json" id="feed-snapshot">([\s\S]*?)<\/script>/.exec(html)!;
      const feed = parseFeed(JSON.parse(snapshot[1]!));
      feed.nodes.splice(feed.nodes.length - 1, 0, { id: 'newthing', kind: 'project', name: 'New thing', links: [] });
      const json = JSON.stringify(feed).replace(/</g, '\u003c');
      const body = html
        .replace(snapshot[0], () => `<script type="application/json" id="feed-snapshot">${json}</script>`)
        .replace(/<main id="stations">[\s\S]*?<\/main>/, () => `<main id="stations">${renderStations(feed, copy)}</main>`);
      await route.fulfill({ response, body });
    },
  );
  await open(page);
  /** How far the parcel's own up points up: 1 upright, -1 upside down. Its root is the flaps'
   * parent (the GLB's scene is named `box` too, so the loader renames the node). */
  const state = () => page.evaluate(() => {
    const n = window.__map!.nodes.get('newthing');
    const b = n.root.getObjectByName('flap_front')!.parent!;
    b.updateWorldMatrix(true, false);
    const e = b.matrixWorld.elements;
    return +(e[5]! / Math.hypot(e[4]!, e[5]!, e[6]!)).toFixed(3);
  });
  const advance = (s: number) => page.evaluate((s) => window.__map!.advance(s), s);
  await advance(3);
  const log = [await state()];
  await page.evaluate(() => window.__map!.nodes.get('newthing').poke('arrows'));
  await advance(2);
  log.push(await state());
  await advance(6);
  log.push(await state());
  await page.evaluate(() => window.__map!.nodes.get('newthing').poke(null));
  await advance(2);
  log.push(await state());
  await page.evaluate(() => window.__map!.nodes.get('newthing').poke('arrows'));
  await advance(2);
  log.push(await state());
  expect(log.map((u) => Math.sign(u))).toEqual([1, -1, -1, -1, 1]);
});
