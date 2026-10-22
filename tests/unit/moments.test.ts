// The moments use only three.js classes the first load already has (the JS budget, approved
// 2026-10-21). three ships as two prebundled modules, and a module sits in exactly one chunk, the
// runtime's: a class only a lazy moment uses still lands in the first load (CanvasTexture,
// AudioListener, PositionalAudio and Spherical, used by the cable alone, put 2.3 kB on it). So
// every name a moment imports from three (or three's addons) must already be imported by a module
// of the first load.
//
// The first load is every module src/map.ts (the runtime) and src/main.ts reach by static
// imports. A moment is each `() => import('…')` in src/moments/load.ts, with the modules it
// reaches that the first load doesn't. Type-only imports are erased, so they don't count.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { ROOT } from './helpers/blender';

const SRC = join(ROOT, 'src');

/** The module file a relative specifier names from `from`, or null (a package, an asset). */
function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const f of [base, `${base}.ts`, join(base, 'index.ts')]) if (existsSync(f) && /\.(ts|js)$/.test(f)) return f;
  return null;
}

interface Imports {
  /** Local modules imported statically for their values. */
  local: string[];
  /** `three…` specifier → the value names imported from it. */
  three: Map<string, Set<string>>;
}

const IMPORT = /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)';?/gm;

function importsOf(file: string): Imports {
  const code = readFileSync(file, 'utf8');
  const out: Imports = { local: [], three: new Map() };
  for (const m of code.matchAll(IMPORT)) {
    const [, typeOnly, clause, spec] = m as unknown as [string, string | undefined, string, string];
    if (typeOnly) continue;
    const names = [...(/\{([\s\S]*)\}/.exec(clause)?.[1] ?? '').split(',')]
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('type '))
      .map((s) => s.split(/\s+as\s+/)[0]!.trim());
    const deflt = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim();
    if (deflt && !deflt.startsWith('*')) names.push('default');
    if (spec.startsWith('three')) {
      if (!out.three.has(spec)) out.three.set(spec, new Set());
      for (const n of names) out.three.get(spec)!.add(n);
      continue;
    }
    const local = resolveLocal(file, spec);
    if (local && (names.length > 0 || deflt)) out.local.push(local);
  }
  // Side-effect imports (`import './x'`) are static too.
  for (const m of code.matchAll(/^\s*import\s+'([^']+)';?/gm)) {
    const local = resolveLocal(file, m[1]!);
    if (local) out.local.push(local);
  }
  return out;
}

/** Every module reached from `entries` by static value imports, and the three names they import. */
function reach(entries: string[], skip = new Set<string>()): { files: Set<string>; three: Map<string, Set<string>> } {
  const files = new Set<string>();
  const three = new Map<string, Set<string>>();
  const visit = (f: string): void => {
    if (files.has(f) || skip.has(f)) return;
    files.add(f);
    const imp = importsOf(f);
    for (const [spec, names] of imp.three) {
      if (!three.has(spec)) three.set(spec, new Set());
      for (const n of names) three.get(spec)!.add(n);
    }
    imp.local.forEach(visit);
  };
  entries.forEach(visit);
  return { files, three };
}

const LOAD = join(SRC, 'moments', 'load.ts');
const momentEntries = [...readFileSync(LOAD, 'utf8').matchAll(/^\s*\w+:\s*\(\)\s*=>\s*import\('([^']+)'\)/gm)].map(
  (m) => resolveLocal(LOAD, m[1]!)!,
);

test('load.ts registers the moments it lists (power, the cable and sound)', () => {
  expect(momentEntries.map((f) => f.replace(/\\/g, '/').replace(/^.*\/src\//, ''))).toEqual(
    expect.arrayContaining(['moments/power.ts', 'world/cable.ts', 'moments/sound.ts']),
  );
});

test('every three.js name a moment imports is already imported by the first load', () => {
  const first = reach([join(SRC, 'main.ts'), join(SRC, 'map.ts')]);
  expect(first.files.has(join(SRC, 'world', 'nodes.ts'))).toBe(true); // the walk follows map.ts
  for (const entry of momentEntries) {
    expect(first.files.has(entry), `${entry} is lazy, not on the first load`).toBe(false);
    const lazy = reach([entry], first.files);
    for (const [spec, names] of lazy.three) {
      const have = first.three.get(spec) ?? new Set();
      const missing = [...names].filter((n) => !have.has(n));
      expect(missing, `${entry} imports from ${spec} what the first load doesn't`).toEqual([]);
    }
  }
});
