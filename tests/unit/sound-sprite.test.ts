import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { SPRITE } from '../../src/moments/sound-sprite';
import { ROOT } from './helpers/blender';

// Task 17: the recorded sounds' pipeline (scripts/sound-sprite.mjs), run on two made-up
// recordings in a temporary folder, so a recording the owner drops in sounds/recorded/ slots in.

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const dir = mkdtempSync(join(tmpdir(), 'sound-sprite-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test('ships no sprite while nothing is recorded', () => {
  expect(SPRITE).toBeNull();
  expect(existsSync(join(ROOT, 'public', 'sounds')) ? readdirSync(join(ROOT, 'public', 'sounds')).filter((f) => f.endsWith('.webm')) : []).toEqual([]);
});

test.skipIf(!hasFfmpeg)('lays the recordings end to end in one Opus WebM and writes where each one is', () => {
  const src = join(dir, 'recorded');
  const out = join(dir, 'out');
  mkdirSync(src);
  const ts = join(dir, 'sound-sprite.ts');
  copyFileSync(join(ROOT, 'src', 'moments', 'sound-sprite.ts'), ts);
  // A 0.1 s and a 0.3 s tone, with silence around them to trim.
  for (const [id, len] of [
    ['stamp', 0.1],
    ['feed', 0.3],
  ] as const) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      `aevalsrc='if(between(t,0.2,${0.2 + len}),0.3*sin(2*PI*440*t),0)':s=44100:d=${0.6 + len}`, join(src, `${id}.wav`)]);
    expect(r.status, String(r.stderr)).toBe(0);
  }
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'sound-sprite.mjs')], {
    env: { ...process.env, SOUND_SRC: src, SOUND_OUT: out, SOUND_TS: ts },
  });
  expect(r.status, String(r.stderr)).toBe(0);
  const files = readdirSync(out);
  expect(files).toEqual([expect.stringMatching(/^sprite-[0-9a-f]{10}\.webm$/)]);
  const code = readFileSync(ts, 'utf8');
  expect(code).toContain(`url: '/sounds/${files[0]}'`);
  const cue = (id: string) => JSON.parse(new RegExp(id + String.raw`: (\[[^\]]+\])`).exec(code)![1]!) as [number, number];
  const [feedAt, feedLen] = cue('feed');
  const [stampAt, stampLen] = cue('stamp');
  expect(feedAt).toBe(0); // in name order
  expect(feedLen).toBeCloseTo(0.325, 1); // trimmed to the tone, plus its margins
  expect(stampAt).toBeCloseTo(feedLen + 0.2, 3);
  expect(stampLen).toBeCloseTo(0.125, 1);
});
