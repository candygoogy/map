// The build's slimming of three's shader source (vite-plugin-three-shaders.ts, to keep the
// first-load JS small), on a sample and on three's own files: it may drop indentation, blank lines
// and `//`-only lines, and nothing else. tests/e2e/shaders.spec.ts compiles the result.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShaderChunk } from 'three';
import { describe, expect, test } from 'vitest';
import { slimGlsl, slimThreeShaders, threeShaders } from '../../vite-plugin-three-shaders';
import { ROOT } from './helpers/blender';

const THREE = join(ROOT, 'node_modules', 'three');
const read = (path: string) => readFileSync(join(THREE, path), 'utf8');

/** The lines that matter to the compiler: trimmed, without blank and `//`-only lines. */
const meaningful = (glsl: string) =>
  glsl
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('//'));

const directives = (glsl: string) => glsl.split('\n').filter((l) => l.trim().startsWith('#')).map((l) => l.trim());

describe('slimGlsl', () => {
  const sample = [
    '#ifdef USE_MAP',
    '',
    '\t// sample the map',
    '\tvec4 texel = texture2D( map, vUv ); // after code: kept',
    '\t#include <colorspace_fragment>',
    '  #define SCALE 0.5',
    '\t/* a block',
    '\t   comment */',
    '#endif',
  ].join('\n');

  test('keeps every directive and code line, in order, each on its own line', () => {
    expect(slimGlsl(sample)).toBe(
      [
        '#ifdef USE_MAP',
        'vec4 texel = texture2D( map, vUv ); // after code: kept',
        '#include <colorspace_fragment>',
        '#define SCALE 0.5',
        '/* a block',
        'comment */',
        '#endif',
      ].join('\n'),
    );
  });

  test('is idempotent', () => {
    expect(slimGlsl(slimGlsl(sample))).toBe(slimGlsl(sample));
  });
});

describe("three.module.js's shaders", () => {
  const source = read('build/three.module.js');
  const slim = slimThreeShaders(source, true);

  test('every ShaderChunk entry is slimmed', () => {
    const entries = Object.values(ShaderChunk) as string[];
    const multiline = entries.filter((g) => g.includes('\n'));
    expect(slim.chunks).toBeGreaterThanOrEqual(multiline.length);
    for (const glsl of multiline) expect(slim.code).toContain(JSON.stringify(slimGlsl(glsl)));
    expect(slim.templates).toBe(source.split('/* glsl */').length - 1); // every one of them
    expect(slim.code.length).toBeLessThan(source.length);
  });

  test('each slimmed chunk keeps its directives and code lines exactly', () => {
    for (const glsl of Object.values(ShaderChunk) as string[]) {
      const out = slimGlsl(glsl);
      expect(out.split('\n')).toEqual(meaningful(glsl));
      expect(directives(out)).toEqual(directives(glsl));
      // A directive must start its line: no line was joined onto another.
      for (const line of out.split('\n')) expect(line.indexOf('#')).not.toBeGreaterThan(0);
    }
  });

  test('the JS around the shaders is untouched', () => {
    const outside = (code: string) => code.replace(/^(?:var|const) [\w$]+ = ".*";$/gm, '').replace(/\/\* glsl \*\/\s*`[^`]*`/g, '');
    expect(outside(slim.code)).toBe(outside(source));
  });
});

// three's file, and the map's trimmed copy of it (src/vendor/lines/), which the build
// slims too.
const LINE_MATERIALS = {
  "three's": join(THREE, 'examples', 'jsm', 'lines', 'LineMaterial.js'),
  'the trimmed': join(ROOT, 'src', 'vendor', 'lines', 'LineMaterial.js'),
};

test.each(Object.entries(LINE_MATERIALS))("%s LineMaterial's two shaders are slimmed the same way", (_, path) => {
  const source = readFileSync(path, 'utf8');
  const slim = slimThreeShaders(source);
  expect(slim).toMatchObject({ chunks: 0, templates: 2 });
  const templates = (code: string) => [...code.matchAll(/\/\* glsl \*\/\s*`([^`]*)`/g)].map((m) => m[1]!);
  const before = templates(source);
  const after = templates(slim.code);
  expect(after).toHaveLength(2);
  after.forEach((glsl, i) => {
    expect(glsl.split('\n')).toEqual(meaningful(before[i]!));
    expect(directives(glsl)).toEqual(directives(before[i]!));
  });
});

test('the build slims both LineMaterials, and none of our own files', () => {
  const transform = threeShaders().transform as (code: string, id: string) => { code: string } | undefined;
  for (const path of Object.values(LINE_MATERIALS)) {
    const source = readFileSync(path, 'utf8');
    expect(transform(source, path)?.code, path).toBe(slimThreeShaders(source).code);
  }
  const ours = join(ROOT, 'src', 'world', 'cable.ts');
  expect(transform(readFileSync(ours, 'utf8'), ours)).toBeUndefined();
});
