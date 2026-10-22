#!/usr/bin/env node
// node scripts/trim-lines.mjs [--check]
// Writes src/vendor/lines/: three's wide lines (examples/jsm/lines: Line2, LineSegments2,
// LineGeometry, LineSegmentsGeometry, LineMaterial, from node_modules/three, whatever version is
// installed) without the parts the map never takes, so they and the three.js classes only they
// reach stay out of the first-load JS:
// - raycasting a line (LineSegments2.raycast and its helpers, and Line3 with them): the pointer
//   raycasts only the nodes' models (src/input/pointer.ts), and no line is ever under one. The
//   trimmed raycast throws;
// - the geometries' from…() builders (fromWireframeGeometry, fromEdgesGeometry, fromMesh,
//   fromLineSegments, fromLine, and WireframeGeometry with them): every line sets its points
//   itself (setPositions);
// - world units (LineMaterial's worldUnits, its WORLD_UNITS shader branches and the fragment
//   shader's closestLineToLine, which only they call): every line is in screen px. The trimmed
//   setter throws for true.
// Everything else is three's file as it is: dashes, vertex colours, alpha to coverage, the line
// distances, the bounds. tests/unit/lines.test.ts checks that the files are this script's output
// for the installed three, that the shaders preprocess to the same program as three's for every
// define the map uses, and that the lines build the same geometry.
//
// Re-sync after a three upgrade: run this, then `npx vitest run tests/unit/lines.test.ts`, the
// budget test and Playwright. If three changed one of the parts cut here, this throws rather than
// writing a half-trimmed file: fix the patterns below.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const three = join(root, 'node_modules', 'three');
const lines = join(three, 'examples', 'jsm', 'lines');
const revision = /REVISION = '(\d+)'/.exec(readFileSync(join(three, 'build', 'three.core.js'), 'utf8'))?.[1];
if (!revision) throw new Error('trim-lines: no REVISION in three.core.js');
const read = (file) => readFileSync(join(lines, file), 'utf8').replace(/\r\n/g, '\n');

/** Replaces `from`, which must be in `text` exactly once, with `to`. */
function swap(text, from, to, what) {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`trim-lines: ${what} isn't in three's file as expected`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** Cuts from `from` (in `text` exactly once) up to the first `to` after it (kept). */
function cutTo(text, from, to, what) {
  const at = text.indexOf(from);
  const end = text.indexOf(to, at + from.length);
  if (at < 0 || end < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`trim-lines: ${what} isn't in three's file as expected`);
  return text.slice(0, at) + text.slice(end);
}

/** Cuts the class's method `name` (a tab in, to its closing brace) and the doc comment right above it. */
function cutMethod(text, name) {
  const start = text.indexOf(`\n\t${name}(`);
  if (start < 0 || text.indexOf(`\n\t${name}(`, start + 1) >= 0) throw new Error(`trim-lines: no method ${name}`);
  const end = text.indexOf('\n\t}\n', start);
  if (end < 0) throw new Error(`trim-lines: no end to method ${name}`);
  let from = start;
  const doc = text.lastIndexOf('\n\t/**', start);
  if (doc >= 0 && text.slice(doc, start).trimEnd().endsWith('*/') && !text.slice(doc + 5, start).includes('/**')) from = doc;
  return text.slice(0, from) + text.slice(end + 3);
}

/** `text`'s import list from three without the names nothing else in it uses now. */
function pruneImports(text, file) {
  const imports = /^import \{\n([^}]*)\} from 'three';\n/m.exec(text);
  if (!imports) throw new Error(`trim-lines: no import from 'three' in ${file}`);
  const body = text.slice(imports.index + imports[0].length);
  const names = imports[1].split(',').map((s) => s.trim()).filter(Boolean);
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const used = names.filter((n) => new RegExp(`\\b${n}\\b`).test(code));
  return text.slice(0, imports.index) + `import {\n${used.map((n) => `\t${n}`).join(',\n')}\n} from 'three';\n` + body;
}

/** GLSL's `#ifdef name … [#else …] #endif` blocks replaced by their #else part (or nothing). */
function dropIfdef(text, name) {
  const src = text.split('\n');
  const out = [];
  let blocks = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i].trim() !== `#ifdef ${name}`) {
      out.push(src[i]);
      continue;
    }
    let depth = 1;
    let other = -1;
    let j = i + 1;
    for (; j < src.length; j++) {
      const t = src[j].trim();
      if (t.startsWith('#if')) depth++;
      else if (t === '#endif' && --depth === 0) break;
      else if (t === '#else' && depth === 1) other = j;
    }
    if (j === src.length) throw new Error(`trim-lines: an #ifdef ${name} with no #endif`);
    // The #else part, one tab less indented, as it would read without the block around it.
    if (other >= 0) for (let k = other + 1; k < j; k++) out.push(src[k].replace(/^\t/, ''));
    blocks++;
    i = j;
  }
  if (blocks === 0) throw new Error(`trim-lines: no #ifdef ${name}`);
  return out.join('\n');
}

const trimmed = (what, file) => `throw new Error( '${what} is trimmed out of this copy (src/vendor/lines/${file}).' );`;

// LineSegments2: no raycast. Its helpers and their scratch go, and raycast() throws.
let segments = read('LineSegments2.js');
segments = cutTo(segments, 'const _start4 = new Vector4();', '/**\n * A series of lines drawn between pairs of vertices.', "LineSegments2's raycast helpers");
segments = cutTo(
  segments,
  '\t/**\n\t * Computes intersection points between a casted ray and this instance.',
  '\tonBeforeRender( renderer ) {',
  "LineSegments2's raycast",
);
segments = swap(
  segments,
  '\tonBeforeRender( renderer ) {',
  `\t/**\n\t * Trimmed: nothing on the map raycasts its lines.\n\t */\n\traycast() {\n\n\t\t${trimmed('LineSegments2: raycasting', 'LineSegments2.js')}\n\n\t}\n\n\tonBeforeRender( renderer ) {`,
  "LineSegments2's onBeforeRender",
);
segments = pruneImports(segments, 'LineSegments2.js');

// The geometries: no from…() builders.
let segmentsGeometry = read('LineSegmentsGeometry.js');
for (const name of ['fromWireframeGeometry', 'fromEdgesGeometry', 'fromMesh', 'fromLineSegments']) segmentsGeometry = cutMethod(segmentsGeometry, name);
segmentsGeometry = pruneImports(segmentsGeometry, 'LineSegmentsGeometry.js');
let geometry = read('LineGeometry.js');
geometry = cutMethod(geometry, 'fromLine');

// LineMaterial: screen px only.
let material = read('LineMaterial.js');
material = dropIfdef(material, 'WORLD_UNITS');
material = cutTo(material, '\t\tvec2 closestLineToLine(', '\t\tvoid main() {', "the fragment shader's closestLineToLine");
material = swap(
  material,
  `\tset worldUnits( value ) {

\t\tif ( ( value === true ) !== this.worldUnits ) {

\t\t\tthis.needsUpdate = true;

\t\t}

\t\tif ( value === true ) {

\t\t\tthis.defines.WORLD_UNITS = '';

\t\t} else {

\t\t\tdelete this.defines.WORLD_UNITS;

\t\t}

\t}`,
  `\tset worldUnits( value ) {

\t\tif ( value === true ) ${trimmed('LineMaterial: worldUnits', 'LineMaterial.js')}

\t}`,
  "LineMaterial's worldUnits setter",
);

const out = {
  'Line2.js': read('Line2.js'),
  'LineSegments2.js': segments,
  'LineGeometry.js': geometry,
  'LineSegmentsGeometry.js': segmentsGeometry,
  'LineMaterial.js': material,
};
for (const [file, text] of Object.entries(out)) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const name of ['raycastScreenSpace', 'raycastWorldUnits', 'getWorldSpaceHalfWidth', 'Line3', 'WireframeGeometry', 'WORLD_UNITS ', 'closestLineToLine', 'fromWireframeGeometry', 'fromMesh', 'fromLine(']) {
    if (code.includes(name)) throw new Error(`trim-lines: ${file} still has ${name.trim()}`);
  }
  if (/from '\.\.?\/(?!Line)/.test(text)) throw new Error(`trim-lines: ${file} imports a file outside lines/`);
}

const cuts = {
  'Line2.js': 'Unchanged: here so that it extends the trimmed LineSegments2.',
  'LineSegments2.js': 'Cut: raycast() (it throws) and its helpers: nothing on the map raycasts its lines.',
  'LineGeometry.js': 'Cut: fromLine(): every line sets its points itself.',
  'LineSegmentsGeometry.js': 'Cut: fromWireframeGeometry(), fromEdgesGeometry(), fromMesh(), fromLineSegments(): every\n// line sets its points itself.',
  'LineMaterial.js': "Cut: world units (setting worldUnits true throws), the shaders' WORLD_UNITS branches and\n// closestLineToLine, which only they call: every line is in screen px.",
};
const header = (file) => `// three.js r${revision} examples/jsm/lines/${file} (MIT, the three.js authors), ${file === 'Line2.js' ? 'copied' : 'trimmed'} by
// scripts/trim-lines.mjs. Don't edit it by hand: after upgrading three, re-run the script.
// ${cuts[file]}
// What the five files cut, and the three.js classes only that reaches, stay out of the first-load
// JS; tests/unit/lines.test.ts checks them against three's.
// three-revision: ${revision}

`;
const dir = join(root, 'src', 'vendor', 'lines');
const files = Object.entries(out).map(([file, text]) => [join(dir, file), header(file) + text]);

// --check: exit 1 if the committed files aren't what this script makes from the installed three.
if (process.argv.includes('--check')) {
  const stale = files.filter(([path, text]) => (existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '') !== text);
  if (stale.length > 0) {
    console.error('src/vendor/lines/ is out of date: run node scripts/trim-lines.mjs');
    process.exit(1);
  }
  console.log(`src/vendor/lines/ matches three r${revision}`);
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
for (const [path, text] of files) writeFileSync(path, text);
console.log(`src/vendor/lines/: r${revision}, raycasting, the from…() builders and world units cut`);
