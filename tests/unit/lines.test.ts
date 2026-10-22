// The trimmed wide lines (src/vendor/lines/, made by scripts/trim-lines.mjs, to keep the first-load
// JS small): three's Line2 family without raycasting, the geometries' from…() builders and world
// units, none of which the map takes. The rest must be three's: the same shader program for every
// define the map's lines use, and the same geometry. A copy of three's files, so upgrading three
// without re-running the script fails here too.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { InterleavedBufferAttribute, Raycaster } from 'three';
import { Line2 as ThreeLine2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry as ThreeLineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { describe, expect, test } from 'vitest';
import { Line2 } from '../../src/vendor/lines/Line2.js';
import { LineGeometry } from '../../src/vendor/lines/LineGeometry.js';
import { LineMaterial } from '../../src/vendor/lines/LineMaterial.js';
import { ROOT } from './helpers/blender';

const THREE_LINES = join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'lines');
const VENDOR = join(ROOT, 'src', 'vendor', 'lines');

/** A file's `/* glsl *\/` templates: the vertex and the fragment shader. */
const shaders = (path: string) => [...readFileSync(path, 'utf8').replace(/\r\n/g, '\n').matchAll(/\/\* glsl \*\/\s*`([^`]*)`/g)].map((m) => m[1]!);

/** The lines the compiler gets once the preprocessor has taken `#ifdef`/`#ifndef`/`#else`/`#endif`
 *  with `defines` set: trimmed, without blank and `//`-only lines (`#include`s kept as they are). */
function preprocess(glsl: string, defines: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const branches: boolean[] = [];
  for (const raw of glsl.split('\n')) {
    const line = raw.trim();
    const m = /^#(ifdef|ifndef) (\w+)$/.exec(line);
    if (m) branches.push(defines.has(m[2]!) === (m[1] === 'ifdef'));
    else if (line === '#else') branches.push(!branches.pop());
    else if (line === '#endif') branches.pop();
    else if (/^#(if|elif)\b/.test(line)) throw new Error(`lines.test: no handling for ${line}`);
    else if (branches.every(Boolean) && line !== '' && !line.startsWith('//')) out.push(line);
  }
  expect(branches).toEqual([]);
  return out;
}

/** Every combination of the defines the map's lines set (dashes, vertex colours, alpha to coverage). */
const COMBOS = [0, 1, 2, 3, 4, 5, 6, 7].map((bits) => new Set(['USE_DASH', 'USE_COLOR', 'USE_ALPHA_TO_COVERAGE'].filter((_, i) => bits & (1 << i))));

describe('the trimmed wide lines', () => {
  test("are the script's output for the installed three", () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'trim-lines.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  test("nothing in src/ imports three's own lines (one copy of the classes, one ShaderLib.line)", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.(ts|js)$/.test(f) ? [join(dir, f)] : []));
    const importing = files(join(ROOT, 'src')).filter((f) => !f.endsWith('.d.ts') && /from 'three\/examples\/jsm\/lines\//.test(readFileSync(f, 'utf8')));
    expect(importing).toEqual([]);
  });

  test('nothing raycasts a line: the pointer raycasts only the nodes, whose roots hold no line', () => {
    // A raycast against a trimmed line throws; this keeps any new raycast in sight.
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const path = join(dir, f);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.ts$/.test(f) && !f.endsWith('.d.ts')) {
          for (const m of readFileSync(path, 'utf8').matchAll(/\.(intersectObjects?|raycast)\(([^,)]*)/g)) hits.push(`${f}: ${m[1]}(${m[2]}`);
        }
      }
    };
    walk(join(ROOT, 'src'));
    expect(hits).toEqual(['pointer.ts: intersectObject(n.root']);
  });

  test("the shaders preprocess to three's program for every define the map uses", () => {
    const [vertex, fragment] = shaders(join(VENDOR, 'LineMaterial.js'));
    const [threeVertex, threeFragment] = shaders(join(THREE_LINES, 'LineMaterial.js'));
    expect([vertex, fragment].every(Boolean)).toBe(true);
    // Without world units, three's fragment shader declares closestLineToLine and never calls it.
    const declared = /\n\t\tvec2 closestLineToLine\([\s\S]*?\n\t\t\}\n/;
    for (const defines of COMBOS) {
      expect(preprocess(threeFragment!, defines).filter((l) => l.includes('closestLineToLine'))).toEqual([
        'vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {',
      ]);
      expect(preprocess(vertex!, defines), [...defines].join(' ')).toEqual(preprocess(threeVertex!, defines));
      expect(preprocess(fragment!, defines), [...defines].join(' ')).toEqual(preprocess(threeFragment!.replace(declared, '\n'), defines));
    }
    expect(`${vertex}${fragment}`).not.toMatch(/WORLD_UNITS|closestLineToLine/);
  });

  test("a line's geometry and dash distances are three's", () => {
    const points = [0, 0, 0, 1, 0.5, 0, 2, 0.5, 1, 3, -1, 2];
    const colours = points.map((_, i) => (i % 3) / 3);
    const make = (L: typeof Line2, G: typeof LineGeometry) => {
      const g = new G();
      g.setPositions(points);
      g.setColors(colours);
      const line = new L(g, new LineMaterial({ worldUnits: false, dashed: true }));
      line.computeLineDistances();
      g.computeBoundingSphere();
      return g;
    };
    const mine = make(Line2, LineGeometry);
    const theirs = make(ThreeLine2, ThreeLineGeometry);
    for (const name of ['instanceStart', 'instanceEnd', 'instanceColorStart', 'instanceDistanceStart', 'instanceDistanceEnd', 'position', 'uv']) {
      const a = mine.getAttribute(name) as InterleavedBufferAttribute;
      const b = theirs.getAttribute(name) as InterleavedBufferAttribute;
      expect([...(a.data?.array ?? a.array)], name).toEqual([...(b.data?.array ?? b.array)]);
    }
    expect([...mine.index!.array]).toEqual([...theirs.index!.array]);
    expect(mine.boundingSphere!.radius).toBeCloseTo(theirs.boundingSphere!.radius, 12);
    expect(mine.boundingSphere!.center.toArray()).toEqual(theirs.boundingSphere!.center.toArray());
  });

  test('what was cut fails loudly: a raycast, world units', () => {
    const line = new Line2(new LineGeometry(), new LineMaterial());
    expect(() => line.raycast(new Raycaster(), [])).toThrow(/trimmed/);
    const material = new LineMaterial({ worldUnits: false });
    expect(material.worldUnits).toBe(false);
    expect(() => (material.worldUnits = true)).toThrow(/trimmed/);
  });
});
