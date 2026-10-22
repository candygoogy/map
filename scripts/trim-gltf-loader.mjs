#!/usr/bin/env node
// node scripts/trim-gltf-loader.mjs [--check]
// Writes src/vendor/GLTFLoader.js: three's GLTFLoader (node_modules/three, whatever version is
// installed) without the extension plugins our models never use, nor the paths of core glTF
// none of them takes: primitives other than triangles and CUBICSPLINE animation. They and the three.js classes only they reach stay out of the
// first-load JS. The models come out of scripts/compress.mjs, which writes
// EXT_meshopt_compression with KHR_mesh_quantization and EXT_texture_webp; Blender's export adds
// KHR_materials_specular, triangles only, and LINEAR or STEP clips. tests/unit/gltf-loader.test.ts
// fails if a shipped GLB uses an extension, a primitive mode or an interpolation that isn't kept
// here, and if three is upgraded without re-running this script.
//
// Re-sync after a three upgrade: run this, then `npx vitest run tests/unit/gltf-loader.test.ts`,
// the budget test and Playwright. If three renamed a plugin or changed how one is registered,
// this throws rather than writing a half-trimmed file: fix the names below.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const three = join(root, 'node_modules', 'three');
const source = readFileSync(join(three, 'examples', 'jsm', 'loaders', 'GLTFLoader.js'), 'utf8').replace(/\r\n/g, '\n');
const revision = /REVISION = '(\d+)'/.exec(readFileSync(join(three, 'build', 'three.core.js'), 'utf8'))?.[1];
if (!revision) throw new Error('trim-gltf-loader: no REVISION in three.core.js');

// The plugins that go, each registered in GLTFLoader's constructor.
const DROP = [
  'GLTFMaterialsClearcoatExtension',
  'GLTFMaterialsDispersionExtension',
  'GLTFTextureBasisUExtension',
  'GLTFTextureAVIFExtension',
  'GLTFMaterialsSheenExtension',
  'GLTFMaterialsTransmissionExtension',
  'GLTFMaterialsVolumeExtension',
  'GLTFMaterialsIorExtension',
  'GLTFMaterialsEmissiveStrengthExtension',
  'GLTFMaterialsIridescenceExtension',
  'GLTFMaterialsAnisotropyExtension',
  'GLTFMaterialsBumpExtension',
  'GLTFLightsExtension',
  'GLTFMeshGpuInstancing',
];
// Draco isn't a registered plugin: the parser builds it when a file lists the extension.
const DRACO = 'GLTFDracoMeshCompressionExtension';

// Two extensions the parser builds itself (not plugins), cut too (option D): a file that lists
// either throws, as one with Draco does.
const BUILT_IN = { KHR_MATERIALS_UNLIT: 'GLTFMaterialsUnlitExtension', KHR_TEXTURE_TRANSFORM: 'GLTFTextureTransformExtension' };
// What the trimmed loader still reads (the test checks every shipped GLB against these).
const SUPPORTED = [
  'KHR_binary_glTF',
  'KHR_materials_specular',
  'KHR_mesh_quantization',
  'EXT_texture_webp',
  'EXT_meshopt_compression',
  'KHR_meshopt_compression',
];

let out = source;

/** Cuts `class <name> {…}` (to the first `}` in column 0) and the doc comment right above it. */
function cutClass(name) {
  const start = out.indexOf(`\nclass ${name} `);
  if (start < 0) throw new Error(`trim-gltf-loader: no class ${name}`);
  const end = out.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`trim-gltf-loader: no end to class ${name}`);
  let from = start;
  const doc = out.lastIndexOf('\n/**', start);
  if (doc >= 0 && out.slice(doc, start).trimEnd().endsWith('*/') && !out.slice(doc + 4, start).includes('/**')) from = doc;
  out = out.slice(0, from) + out.slice(end + 2);
}

for (const name of DROP) {
  const register = new RegExp(`\\t\\tthis\\.register\\( function \\( parser \\) \\{\\s*return new ${name}\\( parser \\);\\s*\\} \\);\\n\\n?`);
  if (!register.test(out)) throw new Error(`trim-gltf-loader: ${name} isn't registered as expected`);
  out = out.replace(register, '');
  cutClass(name);
}

const dracoCase = 'extensions[ extensionName ] = new GLTFDracoMeshCompressionExtension( json, this.dracoLoader );';
if (!out.includes(dracoCase)) throw new Error('trim-gltf-loader: the parser no longer builds Draco as expected');
out = out.replace(
  dracoCase,
  "throw new Error( 'THREE.GLTFLoader: Draco is trimmed out of this loader (src/vendor/GLTFLoader.js).' );",
);
cutClass(DRACO);

/** Replaces `from`, which must be in the file exactly once, with `to`. */
function swap(from, to, what) {
  const at = out.indexOf(from);
  if (at < 0 || out.indexOf(from, at + 1) >= 0) throw new Error(`trim-gltf-loader: ${what} isn't in three's file as expected`);
  out = out.slice(0, at) + to + out.slice(at + from.length);
}

/** Cuts from `from` up to `to` (kept), each in the file exactly once, `to` after `from`. */
function cutTo(from, to, what) {
  const at = out.indexOf(from);
  const end = out.indexOf(to, at);
  if (at < 0 || end < 0 || out.indexOf(from, at + 1) >= 0 || out.indexOf(to, end + 1) >= 0) {
    throw new Error(`trim-gltf-loader: ${what} isn't in three's file as expected`);
  }
  out = out.slice(0, at) + out.slice(end);
}

const trimmed = (what) => `throw new Error( 'THREE.GLTFLoader: ${what} is trimmed out of this loader (src/vendor/GLTFLoader.js).' );`;

// KHR_materials_unlit: the parser's case throws, and a material is always read as PBR.
swap(`extensions[ extensionName ] = new ${BUILT_IN.KHR_MATERIALS_UNLIT}();`, trimmed('KHR_materials_unlit'), 'the unlit case');
swap(
  `\t\tif ( materialExtensions[ EXTENSIONS.KHR_MATERIALS_UNLIT ] ) {

\t\t\tconst kmuExtension = extensions[ EXTENSIONS.KHR_MATERIALS_UNLIT ];
\t\t\tmaterialType = kmuExtension.getMaterialType();
\t\t\tpending.push( kmuExtension.extendParams( materialParams, materialDef, parser ) );

\t\t} else {`,
  '\t\t{',
  "loadMaterial's unlit branch",
);
cutClass(BUILT_IN.KHR_MATERIALS_UNLIT);

// KHR_texture_transform: the parser's case throws, and assignTexture never transforms.
swap(`extensions[ extensionName ] = new ${BUILT_IN.KHR_TEXTURE_TRANSFORM}();`, trimmed('KHR_texture_transform'), 'the texture transform case');
cutTo('\t\t\tif ( parser.extensions[ EXTENSIONS.KHR_TEXTURE_TRANSFORM ] ) {', '\t\t\tif ( colorSpace !== undefined ) {', "assignTexture's transform");
cutClass(BUILT_IN.KHR_TEXTURE_TRANSFORM);

// Triangles only: strips and fans aren't converted, and lines and points aren't made, so
// loadMesh's own "Primitive mode unsupported" throws for them.
cutTo('\t\t\t\t// Convert strip/fan primitives to triangles', '\t\t\t\t// Cache this geometry', "loadGeometries' strip and fan conversion");
swap(
  `\t\t\t\tif ( primitive.mode === WEBGL_CONSTANTS.TRIANGLES ||
\t\t\t\t\t\tprimitive.mode === WEBGL_CONSTANTS.TRIANGLE_STRIP ||
\t\t\t\t\t\tprimitive.mode === WEBGL_CONSTANTS.TRIANGLE_FAN ||
\t\t\t\t\t\tprimitive.mode === undefined ) {`,
  `\t\t\t\tif ( primitive.mode === WEBGL_CONSTANTS.TRIANGLES ||
\t\t\t\t\t\tprimitive.mode === undefined ) {`,
  "loadMesh's triangle test",
);
cutTo('\t\t\t\t} else if ( primitive.mode === WEBGL_CONSTANTS.LINES ) {', "\t\t\t\t} else {\n\n\t\t\t\t\tthrow new Error( 'THREE.GLTFLoader: Primitive mode unsupported", "loadMesh's lines and points");
swap(
  "throw new Error( 'THREE.GLTFLoader: Primitive mode unsupported: ' + primitive.mode );",
  "throw new Error( 'THREE.GLTFLoader: Primitive mode unsupported (this trimmed loader keeps triangles only, src/vendor/GLTFLoader.js): ' + primitive.mode );",
  "loadMesh's unsupported mode",
);
cutTo('\t\tif ( mesh.isPoints ) {', '\t\t// Clone the material if it will be modified', "assignFinalMaterial's points and lines");
swap("import { toTrianglesDrawMode } from '../utils/BufferGeometryUtils.js';\n", '', 'the toTrianglesDrawMode import');

// CUBICSPLINE animation throws; LINEAR and STEP read as before.
swap('this._createCubicSplineTrackInterpolant( track );', trimmed('CUBICSPLINE animation'), 'the cubic spline track');
{
  // GLTFParser's last method, to its closing brace (the first one a tab in).
  const at = out.indexOf('\n\t_createCubicSplineTrackInterpolant( track ) {');
  const end = out.indexOf('\n\t}\n', at);
  if (at < 0 || end < 0 || out.indexOf('_createCubicSplineTrackInterpolant') !== at + 2) {
    throw new Error("trim-gltf-loader: the cubic spline factory isn't in three's file as expected");
  }
  out = out.slice(0, at) + out.slice(end + 3);
}
cutClass('GLTFCubicSplineQuaternionInterpolant');
swap('const _quaternion = new Quaternion();\n\n', '', "the quaternion interpolant's scratch");
cutClass('GLTFCubicSplineInterpolant');

for (const name of [...DROP, DRACO, ...Object.values(BUILT_IN), 'GLTFCubicSplineInterpolant', 'GLTFCubicSplineQuaternionInterpolant', 'toTrianglesDrawMode']) {
  if (new RegExp(`\\b${name}\\b`).test(out)) throw new Error(`trim-gltf-loader: ${name} is still referenced`);
}

// The utils it imports, from three's own copies.
out = out.replace(/from '\.\.\/utils\/(\w+\.js)'/g, "from 'three/examples/jsm/utils/$1'");

// Drop the names from three's import list that nothing uses now.
const imports = /^import \{\n([^}]*)\} from 'three';\n/m.exec(out);
if (!imports) throw new Error("trim-gltf-loader: no import from 'three'");
const body = out.slice(imports.index + imports[0].length);
const names = imports[1].split(',').map((s) => s.trim()).filter(Boolean);
// A name only the doc comments mention (Line, Points) isn't used.
const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const used = names.filter((n) => new RegExp(`\\b${n}\\b`).test(code));
out = out.slice(0, imports.index) + `import {\n${used.map((n) => `\t${n}`).join(',\n')}\n} from 'three';\n` + body;

out = out.replace(
  /\nexport \{ GLTFLoader \};\n?$/,
  `\n/** The glTF extensions this trimmed loader reads (scripts/trim-gltf-loader.mjs). */\nconst SUPPORTED_EXTENSIONS = [\n${SUPPORTED.map((e) => `\t'${e}',`).join('\n')}\n];\n\nexport { GLTFLoader, SUPPORTED_EXTENSIONS };\n`,
);
if (!out.includes('export { GLTFLoader, SUPPORTED_EXTENSIONS };')) throw new Error('trim-gltf-loader: no export line');

/** `words` joined with ', ' and wrapped into `// ` lines of at most 99 characters. */
function wrap(words) {
  const lines = [];
  let line = '//';
  for (const [i, w] of words.entries()) {
    const word = ` ${w}${i < words.length - 1 ? ',' : '.'}`;
    if (line.length + word.length > 99) lines.push(line), (line = '//');
    line += word;
  }
  return [...lines, line].join('\n');
}

const header = `// three.js r${revision} examples/jsm/loaders/GLTFLoader.js (MIT, the three.js authors), trimmed by
// scripts/trim-gltf-loader.mjs. Don't edit it by hand: after upgrading three, re-run the script.
//
// Cut: Draco (a file that lists KHR_draco_mesh_compression throws) and the plugins for
${wrap(DROP.map((n) => n.replace(/^GLTF|Extension$/g, '')))}
// Cut too (a file using one throws): KHR_materials_unlit, KHR_texture_transform, primitives
// other than triangles (strips, fans, lines, points) and CUBICSPLINE animation. They and the
// three.js classes only they reach stay out of the first-load JS. Kept:
${wrap(SUPPORTED)}
// tests/unit/gltf-loader.test.ts checks every shipped GLB against SUPPORTED_EXTENSIONS (and its
// primitives and clips), and this file's revision against the installed three's.
// three-revision: ${revision}

`;
const target = join(root, 'src', 'vendor', 'GLTFLoader.js');
// --check: exit 1 if the committed file isn't what this script makes from the installed three.
if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== header + out) {
    console.error('src/vendor/GLTFLoader.js is out of date: run node scripts/trim-gltf-loader.mjs');
    process.exit(1);
  }
  console.log(`src/vendor/GLTFLoader.js matches three r${revision}`);
  process.exit(0);
}
writeFileSync(target, header + out);
console.log(`src/vendor/GLTFLoader.js: r${revision}, ${DROP.length} plugins, Draco, unlit, texture transform, non-triangle primitives and CUBICSPLINE cut, ${names.length - used.length} three imports dropped`);
