import { expect, type Page, test } from '@playwright/test';

// The dev model viewer (dev/model.html): loads a compressed GLB, shades it with the role
// materials and plays its clips. window.__viewer is its test hook. Under ?test the clips move
// only when __viewer.advance(seconds) steps them, so a loaded machine dropping frames can't
// finish a clip before the test looks at it.
type Hook = { ready: Promise<void>; clips: string[]; durations: Record<string, number>; playing: string };
const advance = (page: Page, seconds: number) =>
  page.evaluate(
    (s: number) => (window as unknown as { __viewer: { advance(s: number): void } }).__viewer.advance(s),
    seconds,
  );
const viewer = <K extends keyof Hook>(page: Page, key: K) =>
  page.evaluate(
    (k: string) => (window as unknown as { __viewer: Record<string, unknown> }).__viewer[k],
    key,
  ) as Promise<Awaited<Hook[K]>>;

test('fettle loads with clips arrive, idle and poke and no console errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Headless Chromium renders WebGL in software and reports its own driver notes ("GPU
    // stall due to ReadPixels") as warnings; they come from the browser, not the page.
    if (/GL Driver Message/.test(m.text())) return;
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });

  const res = await page.goto('/dev/model.html?id=fettle&clip=arrive&test');
  expect(res?.status()).toBe(200);
  await viewer(page, 'ready');

  const clips = await viewer(page, 'clips');
  expect(clips).toEqual(expect.arrayContaining(['arrive', 'idle', 'poke']));
  expect(await viewer(page, 'playing')).toBe('arrive');

  // arrive plays once, then hands over to the looping idle.
  const arrive = (await viewer(page, 'durations')).arrive ?? 0;
  expect(arrive).toBeGreaterThan(0.1);
  await advance(page, arrive - 0.05);
  expect(await viewer(page, 'playing')).toBe('arrive');
  await advance(page, 0.1);
  expect(await viewer(page, 'playing')).toBe('idle');
  await expect(page.getByRole('status')).toHaveText('idle (loop)');

  // The toolbar replays a clip with a real button.
  await page.getByRole('button', { name: 'poke', exact: true }).click();
  expect(await viewer(page, 'playing')).toBe('poke');

  expect(problems).toEqual([]);
});

// The meshopt decoder embeds only its SIMD wasm and fetches the scalar build where
// WebAssembly.validate says there's no SIMD (Safari before 16.4; src/vendor/meshopt_decoder.js).
// Chromium has SIMD, so the fallback is forced by making validate say no before the page runs.
for (const simd of [true, false]) {
  test(`with${simd ? '' : 'out'} wasm SIMD, fettle decodes and the scalar build is ${simd ? 'never' : 'once'} fetched`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (/GL Driver Message/.test(m.text())) return;
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
    });
    const scalar: string[] = [];
    page.on('response', (r) => {
      if (/meshopt_decoder_base\b/.test(new URL(r.url()).pathname) && r.ok()) scalar.push(r.url());
    });
    if (!simd) await page.addInitScript(() => (WebAssembly.validate = () => false));

    await page.goto('/dev/model.html?id=fettle&clip=arrive&test');
    await viewer(page, 'ready');
    expect(await viewer(page, 'clips')).toEqual(expect.arrayContaining(['arrive', 'idle', 'poke']));
    expect(scalar).toHaveLength(simd ? 0 : 1);
    expect(problems).toEqual([]);
  });
}
