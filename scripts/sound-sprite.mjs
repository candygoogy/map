// Builds the recorded sounds into one sprite (Task 17):
//   node scripts/sound-sprite.mjs
//
// Reads sounds/recorded/<id>.<wav|flac|m4a|ogg|webm|mp3>, one file per sound, each named for a
// sound of src/moments/sound-synth.ts (stamp, breaker, rcd, feed, …): a recording replaces the
// made sound of that name. Each is decoded to mono 48 kHz, trimmed of leading and trailing
// silence, and set to peak at −6 dBFS, as the made ones are (TRIM_DB); then they're laid end to
// end, 0.2 s apart (so Opus's frames never bleed one into the next), and encoded once as Opus at
// 48 kbit/s in WebM: public/sounds/sprite-<hash>.webm. src/moments/sound-sprite.ts is rewritten
// with its URL and where each sound sits in it. No recordings: SPRITE is null, nothing ships.
// Needs ffmpeg on the PATH. Note each recording's source in sounds/SOURCES.md.
//
// SOUND_SRC, SOUND_OUT and SOUND_TS move the input folder, the output folder and the TS file
// (the unit test runs it in a temporary folder).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = process.env.SOUND_SRC ?? join(ROOT, 'sounds', 'recorded');
const OUT = process.env.SOUND_OUT ?? join(ROOT, 'public', 'sounds');
const TS = process.env.SOUND_TS ?? join(ROOT, 'src', 'moments', 'sound-sprite.ts');
const RATE = 48000;
const GAP = 0.2;
const PEAK = 10 ** (-6 / 20);
const SILENT = 10 ** (-50 / 20);
const EXT = new Set(['.wav', '.flac', '.m4a', '.ogg', '.webm', '.mp3']);

const known = new Set(
  [...readFileSync(join(ROOT, 'src', 'moments', 'sound-synth.ts'), 'utf8').matchAll(/^ {2}(\w+): -?[\d.]+,$/gm)].map((m) => m[1]),
);

function ffmpeg(args, input) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { input, maxBuffer: 1 << 28 });
  if (r.error) throw new Error(`sound-sprite: ffmpeg isn't on the PATH (${r.error.message})`);
  if (r.status !== 0) throw new Error(`sound-sprite: ffmpeg failed: ${r.stderr}`);
  return r.stdout;
}

/** A recording as mono 48 kHz float samples, trimmed and set to its peak. */
function decode(file) {
  const raw = ffmpeg(['-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);
  let x = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) throw new Error(`sound-sprite: ${file} is silent`);
  const floor = peak * SILENT;
  let a = 0;
  let b = x.length;
  while (a < b && Math.abs(x[a]) < floor) a++;
  while (b > a && Math.abs(x[b - 1]) < floor) b--;
  // Keep 5 ms before the attack and 20 ms of tail.
  x = x.slice(Math.max(0, a - RATE * 0.005), Math.min(x.length, b + RATE * 0.02));
  const k = PEAK / peak;
  return x.map((v) => v * k);
}

const files = existsSync(SRC) ? readdirSync(SRC).filter((f) => EXT.has(extname(f).toLowerCase())).sort() : [];
const cues = {};
const parts = [];
let at = 0;
for (const f of files) {
  const id = basename(f, extname(f));
  if (!known.has(id)) throw new Error(`sound-sprite: ${f} isn't named for a sound (one of ${[...known].join(', ')})`);
  if (cues[id]) throw new Error(`sound-sprite: two recordings of ${id}`);
  const x = decode(join(SRC, f));
  cues[id] = [Number(at.toFixed(4)), Number((x.length / RATE).toFixed(4))];
  parts.push(x, new Float32Array(RATE * GAP));
  at += x.length / RATE + GAP;
}

mkdirSync(OUT, { recursive: true });
for (const old of readdirSync(OUT).filter((f) => /^sprite-[0-9a-f]+\.webm$/.test(f))) rmSync(join(OUT, old));

let sprite = 'null';
if (parts.length > 0) {
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  const webm = ffmpeg(
    ['-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-', '-c:a', 'libopus', '-b:a', '48k', '-application', 'audio', '-f', 'webm', '-'],
    Buffer.from(all.buffer),
  );
  const name = `sprite-${createHash('sha256').update(webm).digest('hex').slice(0, 10)}.webm`;
  writeFileSync(join(OUT, name), webm);
  const list = Object.entries(cues)
    .map(([id, [s, l]]) => `    ${id}: [${s}, ${l}],`)
    .join('\n');
  sprite = `{\n  url: '/sounds/${name}',\n  cues: {\n${list}\n  },\n}`;
  console.info(`sound-sprite: ${files.length} sounds, ${(webm.length / 1000).toFixed(1)} kB → public/sounds/${name}`);
} else {
  console.info('sound-sprite: no recordings; every sound is made in code');
}

const ts = readFileSync(TS, 'utf8').replace(/export const SPRITE: Sprite \| null = [\s\S]*?;\n$/, `export const SPRITE: Sprite | null = ${sprite};\n`);
writeFileSync(TS, ts);
