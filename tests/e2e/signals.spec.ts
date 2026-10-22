import { expect, test, type Page } from '@playwright/test';
import { tuning } from '../../src/tuning';
import type {} from '../../src/main'; // window.__map's type

// A signal's size on screen (traffic.ts, nearScale). Day review's finding (Task 18): near a
// station's camera, 6-11 units out, a signal at its world size read as a big blue pill. Nearer than
// tuning.signalNear it shrinks with its depth, so on screen it's never longer than the pill (0.26,
// the signal model's length) at signalNear: 0.26 × H / (2 × signalNear × tan 15°) CSS px on a
// canvas H px tall (fovY 30), as it would be drawn at the middle of the view.
// On the manual clock (?test), the frames undrawn: the test reads the scene, not its pixels.

const PILL = 0.26;

async function station(page: Page, id: string, width: number, height: number): Promise<void> {
  // Every route due at once (the hub still spaces them), so the links fill early.
  await page.addInitScript(() => {
    Math.random = () => 0.01;
  });
  await page.setViewportSize({ width, height });
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.visitor !== undefined);
  await page.evaluate(async () => {
    const { director, visitor, stage, advance } = window.__map!;
    await director.ready;
    await visitor.ready;
    stage.renderer.render = (scene, camera) => {
      if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
      if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
    };
    director.skipArrival();
    advance(1 / 60);
  });
  await page.waitForFunction(() => (window.__map!.stage.scene.getObjectByName('traffic')?.children.length ?? 0) > 0);
  const state = await page.evaluate((id) => {
    const { director, stations, advance } = window.__map!;
    stations.go(id);
    for (let i = 0; i < 900 && (director.flight || director.state === 'flying'); i++) advance(1 / 60);
    advance(2); // the dock clip
    return director.state;
  }, id);
  expect(state).toBe('station');
}

for (const [id, width, height] of [
  ['exit', 1440, 900],
  ['fettle', 1440, 900],
  ['exit', 390, 844],
  ['fettle', 390, 844],
] as const) {
  test(`at ${id} (${width}×${height}) no signal on screen is longer than at signalNear`, async ({ page }) => {
    await station(page, id, width, height);
    const seen = await page.evaluate((pill) => {
      const { stage, advance } = window.__map!;
      const { camera, renderer } = stage;
      const traffic = stage.scene.getObjectByName('traffic')!;
      const W = renderer.domElement.clientWidth;
      const H = renderer.domElement.clientHeight;
      const V = camera.position.constructor as new () => typeof camera.position;
      const [a, b, c] = [new V(), new V(), new V()];
      let longest = 0;
      let nearest = Infinity;
      let count = 0;
      for (let i = 0; i < 900; i++) {
        advance(1 / 60);
        for (const s of traffic.children) {
          if (!s.visible) continue;
          c.copy(s.position).project(camera);
          if (Math.abs(c.x) > 1 || Math.abs(c.y) > 1 || c.z > 1) continue; // off the screen
          a.set(0, 0, pill / 2);
          b.set(0, 0, -pill / 2);
          s.localToWorld(a).project(camera);
          s.localToWorld(b).project(camera);
          // Off the view's axis every shape draws stretched, by up to √(1 + tx² + ty²) (tx, ty: its
          // view-space x / depth, y / depth); a pill at signalNear would be too, so it's divided out.
          c.copy(s.position).applyMatrix4(camera.matrixWorldInverse);
          const stretch = Math.hypot(1, c.x / c.z, c.y / c.z);
          longest = Math.max(longest, Math.hypot(((a.x - b.x) * W) / 2, ((a.y - b.y) * H) / 2) / stretch);
          nearest = Math.min(nearest, -c.z);
          count++;
        }
      }
      return { longest, nearest, count, H };
    }, PILL);
    expect(seen.count, 'signals on screen').toBeGreaterThan(0);
    expect(seen.nearest, 'a signal came nearer than signalNear').toBeLessThan(tuning.signalNear);
    const cap = (PILL * seen.H) / (2 * tuning.signalNear * Math.tan(Math.PI / 12));
    expect(seen.longest).toBeLessThanOrEqual(cap * 1.02);
  });
}

// Zoomed in (the overview's zoom, up to tuning.zoom.min of its distance), signals grow with the
// map as everything else does (map-tweaks), the stray too, up to
// tuning.signalZoomMax times their overview size: at full zoom (4x) the longest on screen about
// 2.5 times the overview's, not 4 times. They used to keep the size they had at the overview's front edge.
async function overview(page: Page, busy: boolean): Promise<void> {
  if (busy) {
    await page.addInitScript(() => {
      Math.random = () => 0.01;
    });
  }
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
  await page.waitForFunction(() => (window.__map!.stage.scene.getObjectByName('traffic')?.children.length ?? 0) > 0);
}

test('at full zoom the overview’s signals are at most about 2.5 times their unzoomed size on screen', async ({ page }) => {
  test.setTimeout(60_000); // 600 frames, busy
  await overview(page, true);
  const longest = (zoom: number) =>
    page.evaluate(
      ({ zoom, pill }) => {
        const { director, stage, advance } = window.__map!;
        director.viewTo(zoom, director.framing(null).target);
        const { camera, renderer } = stage;
        const traffic = stage.scene.getObjectByName('traffic')!;
        const W = renderer.domElement.clientWidth;
        const H = renderer.domElement.clientHeight;
        const V = camera.position.constructor as new () => typeof camera.position;
        const [a, b] = [new V(), new V()];
        let most = 0;
        for (let i = 0; i < 300; i++) {
          advance(1 / 60);
          for (const s of traffic.children) {
            if (!s.visible) continue;
            a.set(0, 0, pill / 2);
            b.set(0, 0, -pill / 2);
            s.localToWorld(a).project(camera);
            s.localToWorld(b).project(camera);
            if (Math.abs(a.x) > 1 || Math.abs(a.y) > 1) continue; // off the screen
            most = Math.max(most, Math.hypot(((a.x - b.x) * W) / 2, ((a.y - b.y) * H) / 2));
          }
        }
        return { most, zoom: director.zoom };
      },
      { zoom, pill: PILL },
    );
  const flat = await longest(1);
  const zoomed = await longest(tuning.zoom.min);
  expect(zoomed.zoom).toBe(tuning.zoom.min);
  expect(flat.most).toBeGreaterThan(5);
  const ratio = zoomed.most / flat.most;
  expect(ratio).toBeGreaterThan(2);
  expect(ratio).toBeLessThan(2.7);
});

test('at 2x a stray nearer than signalNear is still whole (world-sized)', async ({ page }) => {
  await overview(page, false);
  await page.evaluate(() => {
    const { director } = window.__map!;
    director.viewTo(0.5, director.framing(null).target);
  });
  await expect.poll(() => page.evaluate(() => window.__map!.traffic.sendStray())).toBe(true);
  const seen = await page.evaluate(() => {
    const { traffic, stage, advance } = window.__map!;
    advance(1);
    const root = traffic.stray!;
    const depth = root.position.clone().sub(stage.camera.position).dot(stage.camera.getWorldDirection(root.position.clone()));
    return { scale: root.scale.x, depth };
  });
  expect(seen.depth, 'nearer than signalNear').toBeLessThan(tuning.signalNear);
  expect(seen.scale).toBeCloseTo(1, 3);
});

test('at full zoom a stray keeps the signals’ cap (zoomedScale)', async ({ page }) => {
  await overview(page, false);
  await page.evaluate((min) => {
    const { director } = window.__map!;
    director.viewTo(min, director.framing(null).target);
  }, tuning.zoom.min);
  await expect.poll(() => page.evaluate(() => window.__map!.traffic.sendStray())).toBe(true);
  const seen = await page.evaluate(() => {
    const { traffic, stage, advance } = window.__map!;
    advance(1);
    const root = traffic.stray!;
    const depth = root.position.clone().sub(stage.camera.position).dot(stage.camera.getWorldDirection(root.position.clone()));
    return { scale: root.scale.x, depth };
  });
  const min = tuning.zoom.min;
  expect(seen.depth).toBeGreaterThan(0);
  const max = tuning.signalZoomMax;
  expect(seen.scale).toBeCloseTo(Math.min(seen.depth / (tuning.signalNear * Math.max(min, 1.2 / max)), 1, min * max), 3);
});
