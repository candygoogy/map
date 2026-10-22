#!/usr/bin/env node
// Runs the Blender pipeline headless.
//   npm run model -- <id> <stage> [patch NNN] [--rebuild] [--discard-hand-edits]
//   npm run model -- <id> colours   (render-only: the options in <id>.colours.json)
//   npm run model -- <id> clips     (render-only: each clip as shots/<id>/clip-<clip>.mp4)
//   npm run world -- --export | --render | --playblast | --lineup | --station-camera <id>
//                    [--rebuild] [--rebuild-arrival]
// Blender's path comes from the BLENDER env var; there is no fallback.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const blender = process.env.BLENDER;

function fail(msg) {
  console.error(`blender.mjs: ${msg}`);
  process.exit(2);
}

if (!blender) fail('BLENDER is not set. Point it at blender.exe, e.g. BLENDER="C:\\...\\blender.exe".');
if (!existsSync(blender)) fail(`BLENDER points at ${blender}, which doesn't exist.`);

const [kind, ...rest] = process.argv.slice(2);
let script;
let args;
if (kind === 'model') {
  const [id, stage, ...more] = rest;
  if (!id || !stage) fail('usage: npm run model -- <id> <blockout|bake|export|patch|colours|clips> [NNN] [--rebuild] [--discard-hand-edits]');
  script = join(root, 'blender', 'build.py');
  args = [id, '--stage', stage, ...more];
} else if (kind === 'world') {
  if (rest.length === 0) fail('usage: npm run world -- --export | --render | --playblast [--rebuild] [--rebuild-arrival]');
  script = join(root, 'blender', 'world', 'world.py');
  args = rest;
} else {
  fail(`unknown command "${kind ?? ''}" (expected "model" or "world")`);
}

const r = spawnSync(
  blender,
  ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', ...args],
  { cwd: root, stdio: 'inherit' },
);
if (r.error) fail(r.error.message);
process.exit(r.status ?? 1);
