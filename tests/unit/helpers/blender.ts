import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../../..');
export const BLENDER = process.env.BLENDER;
/**
 * Whether this checkout has the Blender sources (blender/: the models' scripts and .blend
 * files). The public repo ships the built GLBs without them, so the tests that read them skip
 * there, as the tests that run Blender skip without BLENDER.
 */
export const BLENDER_SOURCES = existsSync(join(ROOT, 'blender'));

export interface BlenderRun {
  code: number | null;
  output: string;
}

/** Runs Blender headless with a Python file (or `--python-expr`) and returns its exit code and output. */
export function runBlender(args: string[], env: Record<string, string> = {}): BlenderRun {
  if (!BLENDER) throw new Error('BLENDER is not set');
  const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1', ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

/** Runs `blender/build.py -- <args>` with the given models and output dirs. */
export function runBuild(args: string[], sandbox: ProbeSandbox): BlenderRun {
  return runBlender(['--python', join(ROOT, 'blender', 'build.py'), '--', ...args], {
    MAP_MODELS_DIR: sandbox.models,
    MAP_OUT_DIR: sandbox.out,
    MAP_SHOTS_DIR: sandbox.shots,
  });
}

export interface ProbeSandbox {
  models: string;
  out: string;
  shots: string;
}

/**
 * A temporary copy of the committed probe (script, .blend and stamp), so the hand-edit
 * tests never dirty or retire the real one.
 */
const sandboxes: string[] = [];

export function makeProbeSandbox(): ProbeSandbox {
  const dir = mkdtempSync(join(tmpdir(), 'map-probe-'));
  sandboxes.push(dir);
  const sandbox = { models: join(dir, 'models'), out: join(dir, 'out'), shots: join(dir, 'shots') };
  for (const d of Object.values(sandbox)) mkdirSync(d, { recursive: true });
  for (const f of ['_probe.py', '_probe.blend', '_probe.stamp']) {
    copyFileSync(join(ROOT, 'blender', 'models', f), join(sandbox.models, f));
  }
  return sandbox;
}

/** Deletes every sandbox made by makeProbeSandbox (call from afterAll). */
export function removeProbeSandboxes(): void {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
}
