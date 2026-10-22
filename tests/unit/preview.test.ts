import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { sha256File } from './helpers/glb';
import { BLENDER, BLENDER_SOURCES, makeProbeSandbox, removeProbeSandboxes, runBuild } from './helpers/blender';

// Blender isn't installed in CI.
describe.skipIf(!BLENDER || !BLENDER_SOURCES)('colour options (runs Blender on a temporary copy of the probe)', () => {
  afterAll(removeProbeSandboxes);

  test('an override recolours only its theme, and nothing is saved', { timeout: 300_000 }, async () => {
    const box = makeProbeSandbox();
    const blend = join(box.models, '_probe.blend');
    const before = await sha256File(blend);
    writeFileSync(
      join(box.models, '_probe.colours.json'),
      JSON.stringify({ A: {}, B: { light: { body: '#ff0000' } } }),
    );

    const r = runBuild(['_probe', '--stage', 'colours'], box);
    expect(r.code, r.output).toBe(0);

    const shot = (name: string) => readFileSync(join(box.shots, '_probe', `${name}.png`));
    expect(shot('colourB-light').equals(shot('colourA-light')), 'the light override changed the render').toBe(false);
    expect(shot('colourB-dark').equals(shot('colourA-dark')), 'dark has no override, so it renders as before').toBe(true);
    expect(await sha256File(blend)).toBe(before);
    expect(readFileSync(join(box.models, '_probe.stamp'), 'utf8').trim()).toBe(before);
  });

  test('the clips stage writes one MP4 per clip and camera, and nothing is saved', { timeout: 300_000 }, async () => {
    const box = makeProbeSandbox();
    const blend = join(box.models, '_probe.blend');
    const before = await sha256File(blend);

    const r = runBuild(['_probe', '--stage', 'clips'], box);
    expect(r.code, r.output).toBe(0);

    const dir = join(box.shots, '_probe');
    const clips = ['appear', 'arrive', 'idle'];
    expect(readdirSync(dir).sort()).toEqual(clips.flatMap((c) => [`clip-${c}-station.mp4`, `clip-${c}.mp4`]).sort());
    for (const f of readdirSync(dir)) {
      const head = readFileSync(join(dir, f)).subarray(4, 8).toString('latin1');
      expect(head, `${f} is an MP4`).toBe('ftyp');
      expect(statSync(join(dir, f)).size, f).toBeGreaterThan(1000);
    }
    expect(await sha256File(blend)).toBe(before);
    expect(readFileSync(join(box.models, '_probe.stamp'), 'utf8').trim()).toBe(before);
  });
});
