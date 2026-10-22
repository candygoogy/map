// three.js's shader source, without the indentation and comment lines that only a reader needs,
// to keep the first-load JS small. The minifier can't touch the inside of a string, so
// three's GLSL ships as written: tab-indented, with blank lines and `//` comment lines. This
// takes them out of:
// - ShaderChunk, in three.module.js: one `var name = "…";` string per chunk (ShaderLib's own
//   vertex and fragment shaders among them);
// - the `/* glsl */` template strings in three.module.js (PMREM, the background, the shadow
//   blur) and in three's addons the map imports, and their trimmed copies in src/vendor/lines/
//   (LineMaterial, option F).
// Each line is trimmed, and blank lines and lines that are only a `//` comment go. Nothing else
// changes: every other line keeps its text and its order, each `#` directive (#include,
// #ifdef, #define, …) stays on a line of its own, and no line is joined to another, so the
// preprocessor and the compiler see the same program. A comment after code on the same line
// stays (line by line, a `//` inside a block comment can't be told from a real one).
// Build only: in dev, three comes pre-bundled and isn't transformed. tests/unit/
// three-shaders.test.ts checks the transform on three's own files, and tests/e2e/
// shaders.spec.ts compiles its output in a browser.

import type { Plugin } from 'vite';

/** GLSL source with each line trimmed, and blank and `//`-only lines removed. */
export function slimGlsl(glsl: string): string {
  return glsl
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'))
    .join('\n');
}

// `var alphahash_fragment = "…";` (or const) on one line, the string holding at least one `\n`.
const CHUNK = /^((?:var|const) [\w$]+ = )("(?:[^"\\\n]|\\.)*\\n(?:[^"\\\n]|\\.)*");$/gm;
// `/* glsl */` and a template string with no `${}` and no escapes in it.
const TEMPLATE = /\/\* glsl \*\/(\s*)`([^`\\$]*)`/g;

/**
 * three's file with its shader strings slimmed: the `/* glsl *\/` templates and, with `chunks`
 * (three.module.js only), the ShaderChunk strings. The counts say how many of each changed.
 */
export function slimThreeShaders(code: string, chunks = false): { code: string; chunks: number; templates: number } {
  let chunked = 0;
  let templates = 0;
  let out = code;
  if (chunks) {
    out = out.replace(CHUNK, (whole, decl: string, literal: string) => {
      let glsl: string;
      try {
        glsl = JSON.parse(literal) as string;
      } catch {
        return whole; // a JS escape JSON doesn't share: left as it is
      }
      chunked++;
      return `${decl}${JSON.stringify(slimGlsl(glsl))};`;
    });
  }
  out = out.replace(TEMPLATE, (_whole, space: string, glsl: string) => {
    templates++;
    return `/* glsl */${space}\`${slimGlsl(glsl)}\``;
  });
  return { code: out, chunks: chunked, templates };
}

const MODULE = '/node_modules/three/build/three.module.js';
const ADDONS = /\/(?:node_modules\/three\/examples\/jsm|src\/vendor\/lines)\/.+\.js$/;

export function threeShaders(): Plugin {
  return {
    name: 'map:three-shaders',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const path = id.replace(/\\/g, '/').replace(/\?.*$/, '');
      const module = path.endsWith(MODULE);
      if (!module && !(ADDONS.test(path) && code.includes('/* glsl */'))) return;
      const slim = slimThreeShaders(code, module);
      if (slim.chunks + slim.templates === 0) return;
      return { code: slim.code, map: null };
    },
  };
}
