// Dev-only single-model viewer (served by `npm run dev` only; the production build's only
// input is index.html). It shows one model the way the map will: role materials from
// src/shading.ts in the theme's tokens, the authored cameras from world.json, the model's
// own clips. Blender authors everything here; the viewer only plays it.
//
//   /dev/model.html?id=fettle&theme=light|dark&clip=arrive&camera=close|overview&shade=0.6
//
// Defaults: fettle, the OS theme, arrive, close, the stand-in shadeStrength. The clip plays
// once, then hands over to a looping idle. `close` is the station camera at the model's
// node; `overview` is the map's overview camera, with a 0.85-unit cube standing in for the
// origin. The toolbar replays clips and switches theme and camera, keeping the URL in step.
//
// `?test` stops the clips following the wall clock: they move only when
// window.__viewer.advance(seconds) steps them (like the map's ?test manual clock), so an e2e
// test sees the same clip state however slowly the machine draws frames.

import '../src/styles.css';
import {
  type AnimationAction,
  AnimationMixer,
  BoxGeometry,
  DataTexture,
  Group,
  LoopOnce,
  LoopRepeat,
  type Material,
  Mesh,
  NoColorSpace,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import world from '../src/data/world.json';
import { applyRoleMaterials, createRoleMaterial, DEFAULT_SHADE_STRENGTH, recolourRoleMaterial } from '../src/shading';
import { readTheme, type Theme } from '../src/stage/theme';
import { loadModel } from '../src/world/models';

type Scheme = 'light' | 'dark';
type CameraKind = 'close' | 'overview';

interface ViewerHook {
  /** Resolves once the model is loaded, shaded, playing its clip and drawn. */
  ready: Promise<void>;
  clips: string[];
  /** Each clip's length in seconds, by name. */
  durations: Record<string, number>;
  playing: string;
  /** Steps the clips by `seconds`, in frames of `step` (1/60 s), and draws. Only under ?test. */
  advance(seconds: number, step?: number): void;
}

declare global {
  interface Window {
    __viewer?: ViewerHook;
  }
}

/** Crossfade between clips, in seconds. Every clip starts and ends on the rest pose, so it
 *  only smooths a clip that's interrupted mid-way. */
const CLIP_FADE = 0.25;
/** The aspect the cameras were authored at: world.blend's renders (1600×1000) and the
 *  preview panels (960×600). Narrower screens dolly back along the line of sight. */
const AUTHORED_ASPECT = 1.6;
const ORIGIN_SIZE = 0.85;
/** One-shot clips first in this order; any others (poke_<name>) follow alphabetically. */
const CLIP_ORDER = ['appear', 'arrive', 'poke'];

// --- the URL ----------------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const testing = params.has('test');

function oneOf<T extends string>(value: string | null, options: readonly T[]): T | null {
  return options.includes(value as T) ? (value as T) : null;
}

const shadeParam = Number.parseFloat(params.get('shade') ?? '');
const state = {
  id: params.get('id') || 'fettle',
  /** null follows the OS. */
  scheme: oneOf(params.get('theme'), ['light', 'dark'] as const),
  clip: params.get('clip') || 'arrive',
  camera: oneOf(params.get('camera'), ['close', 'overview'] as const) ?? 'close',
  shadeStrength: Number.isFinite(shadeParam) ? Math.min(1, Math.max(0, shadeParam)) : DEFAULT_SHADE_STRENGTH,
};

function writeUrl(): void {
  if (state.scheme) params.set('theme', state.scheme);
  else params.delete('theme');
  params.set('camera', state.camera);
  history.replaceState(null, '', `?${params}`);
}

// --- forcing a theme --------------------------------------------------------------------------
// styles.css holds the dark tokens once, in @media (prefers-color-scheme: dark). To force a
// scheme the viewer rewrites that rule's condition in the CSSOM ('all' or 'not all'), so the
// token values stay in one place and the map's own page is untouched.

const darkRules = new Map<CSSMediaRule, string>();

function findDarkRules(): void {
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet
    }
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule && !darkRules.has(rule) && /prefers-color-scheme:\s*dark/.test(rule.conditionText)) {
        darkRules.set(rule, rule.media.mediaText);
      }
    }
  }
  if (darkRules.size === 0) throw new Error('styles.css has no @media (prefers-color-scheme: dark) rule');
}

function forceScheme(scheme: Scheme | null): void {
  findDarkRules();
  for (const [rule, original] of darkRules) {
    rule.media.mediaText = scheme === null ? original : scheme === 'dark' ? 'all' : 'not all';
  }
}

const osDark = matchMedia('(prefers-color-scheme: dark)');
const effectiveScheme = (): Scheme => state.scheme ?? (osDark.matches ? 'dark' : 'light');

// --- the scene --------------------------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const output = document.querySelector<HTMLOutputElement>('#playing')!;
document.querySelector('#model-id')!.textContent = state.id;

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping; // the colours must match the tokens

const scene = new Scene();
const camera = new PerspectiveCamera(30, 1, 0.05, 500);

const nodes = world.nodes as Record<string, number[] | undefined>;
const [nx = 0, nz = 0] = nodes[state.id] ?? [0, 0]; // not a node yet: stand at the origin
const nodeAt = new Vector3(nx, 0, nz);

const shading = () => ({ shadeStrength: state.shadeStrength });
let theme: Theme;
const materials: Material[] = [];

function applyTheme(): void {
  forceScheme(state.scheme);
  theme = readTheme();
  renderer.setClearColor(theme.bg); // the floor is the page
  for (const m of materials) recolourRoleMaterial(m, theme, shading());
  const now = effectiveScheme();
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
    b.setAttribute('aria-pressed', String(b.dataset.theme === now));
  }
}

applyTheme();

// The origin's stand-in: a cube in --model, each face lit from the bake's key direction (the
// Blender sources' key_direction, not in this repo) so it reads as a solid, the way world.blend's
// render shows it. Dev only: the origin's real model comes in Task 13.
function originCube(): Group {
  const ov = world.cameras.overview;
  const pos = new Vector3(...(ov.position as [number, number, number]));
  const f = new Vector3(...(ov.target as [number, number, number])).sub(pos).normalize();
  const r = f.clone().cross(new Vector3(0, 1, 0)).normalize();
  const u = r.clone().cross(f).normalize();
  const key = f.clone().negate().addScaledVector(u, 0.6).addScaledVector(r, -0.7).normalize();
  const normals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  const faces = normals.map(([x, y, z]) => {
    const lit = 0.35 + 0.65 * Math.max(0, key.dot(new Vector3(x, y, z)));
    const v = Math.round(lit * 255);
    const bake = new DataTexture(new Uint8Array([v, v, v, 255]), 1, 1);
    bake.colorSpace = NoColorSpace; // already the linear mix factor
    bake.needsUpdate = true;
    const m = createRoleMaterial('body', bake, theme, shading());
    materials.push(m);
    return m;
  });
  const cube = new Mesh(new BoxGeometry(ORIGIN_SIZE, ORIGIN_SIZE, ORIGIN_SIZE), faces);
  cube.position.y = ORIGIN_SIZE / 2;
  const g = new Group();
  g.add(cube);
  return g;
}

const origin = originCube();
scene.add(origin);

const model = new Group();
model.position.copy(nodeAt);
scene.add(model);

// --- the camera -------------------------------------------------------------------------------

const v3 = (a: number[]) => new Vector3(a[0], a[1], a[2]);

function frame(): void {
  const cams = world.cameras;
  const pose =
    state.camera === 'close'
      ? {
          position: v3(cams.station.position).add(nodeAt),
          target: v3(cams.station.target).add(nodeAt),
          fovY: cams.station.fovY,
        }
      : { position: v3(cams.overview.position), target: v3(cams.overview.target), fovY: cams.overview.fovY };
  // Code may fit, never re-author: keep the direction, target and fov, and only dolly back
  // along the line of sight when the screen is narrower than the authored frame.
  const dolly = Math.max(1, AUTHORED_ASPECT / camera.aspect);
  camera.position.copy(pose.target).addScaledVector(pose.position.sub(pose.target), dolly);
  camera.fov = pose.fovY;
  camera.lookAt(pose.target);
  camera.updateProjectionMatrix();
  origin.visible = state.camera === 'overview';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) {
    b.setAttribute('aria-pressed', String(b.dataset.camera === state.camera));
  }
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  frame();
}

resize();
addEventListener('resize', resize);

// --- clips ------------------------------------------------------------------------------------

let mixer: AnimationMixer | null = null;
const actions = new Map<string, AnimationAction>();
let current: AnimationAction | null = null;

const hook: ViewerHook = {
  ready: Promise.resolve(),
  clips: [],
  durations: {},
  playing: '',
  advance(seconds, step = 1 / 60) {
    if (!testing) throw new Error('__viewer.advance needs ?test (the manual clock)');
    for (let left = seconds; left > 1e-9; left -= step) mixer?.update(Math.min(step, left));
    renderer.render(scene, camera);
  },
};
window.__viewer = hook;

function setPlaying(name: string): void {
  hook.playing = name;
  output.textContent = name === 'idle' ? 'idle (loop)' : name;
}

function play(name: string): void {
  const next = actions.get(name);
  if (!next) throw new Error(`${state.id} has no clip "${name}" (it has ${hook.clips.join(', ')})`);
  const loop = name === 'idle';
  // appear starts the model below the floor at no size, so it cuts in rather than fading.
  const fade = current && name !== 'appear' ? CLIP_FADE : 0;
  for (const a of actions.values()) {
    if (a === next || !a.isScheduled()) continue;
    if (fade && a.enabled) a.fadeOut(fade);
    else a.stop();
  }
  next.reset();
  next.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = !loop;
  next.play();
  if (fade) next.fadeIn(fade);
  current = next;
  setPlaying(name);
}

function clipButtons(): void {
  const group = document.querySelector('#clips')!;
  const rank = (n: string) => (CLIP_ORDER.includes(n) ? CLIP_ORDER.indexOf(n) : CLIP_ORDER.length);
  const oneShots = hook.clips.filter((n) => n !== 'idle').sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const name of oneShots) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => play(name));
    group.append(b);
  }
}

// --- loading ----------------------------------------------------------------------------------

async function load(): Promise<void> {
  const gltf = await loadModel(state.id);
  materials.push(...applyRoleMaterials(gltf.scene, theme, shading()));
  model.add(gltf.scene);

  mixer = new AnimationMixer(gltf.scene);
  for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
  hook.clips = gltf.animations.map((c) => c.name);
  hook.durations = Object.fromEntries(gltf.animations.map((c) => [c.name, c.duration]));
  mixer.addEventListener('finished', (e) => {
    if (e.action === current && actions.has('idle')) play('idle');
  });
  clipButtons();
  play(state.clip);

  // Compile everything up front, so the first frames of the clip don't stutter.
  renderer.compile(scene, camera);
  await new Promise<void>((done) => requestAnimationFrame(() => done()));
}

let last = -1;
renderer.setAnimationLoop((time) => {
  const dt = last < 0 ? 0 : Math.min((time - last) / 1000, 0.1); // a hidden tab doesn't jump
  last = time;
  if (!testing) mixer?.update(dt); // under ?test only advance() moves the clips
  renderer.render(scene, camera);
});

hook.ready = load();
hook.ready.catch((e: unknown) => {
  output.textContent = e instanceof Error ? e.message : String(e);
  output.classList.add('error');
  console.error(e);
});

// --- the toolbar ------------------------------------------------------------------------------

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
  b.addEventListener('click', () => {
    state.scheme = b.dataset.theme as Scheme;
    applyTheme();
    writeUrl();
  });
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) {
  b.addEventListener('click', () => {
    state.camera = b.dataset.camera as CameraKind;
    frame();
    writeUrl();
  });
}

osDark.addEventListener('change', () => {
  if (state.scheme === null) applyTheme();
});

// Editing styles.css swaps its sheet: find the dark rule again and re-read the tokens.
import.meta.hot?.on('vite:afterUpdate', () => applyTheme());
