// Role materials: how a model's greyscale bake becomes the theme's colours. Shared by the model
// viewer and, later, nodes.ts.
//
// Every model's materials are named by role. Each surface role is shaded as
//   mix(shade, lit, bake)
// where `lit` is the role's token, `shade` is `lit` mixed toward --shadow by shadeStrength,
// and `bake` is the baked light (0 dark, 1 fully lit). Not a plain multiply, which would
// flatten the dark theme, where --model is already dark. The Blender preview script (not in this
// repo) renders its review shots with the same formula, so the browser and the renders agree.
//
// Colour management: the bake image is stored sRGB-encoded. It's greyscale, so the GPU keeps one
// channel of it (R8: a 1024 px bake with its mipmaps takes 1.4 MB, as a 512 px RGBA one did),
// and R8 has no sRGB format, so the shader decodes it: a texel becomes the linear mix factor.
// The mix happens in linear and the renderer encodes the result to sRGB, so where the bake is
// 1 a role renders as exactly its token's hex.
//
// `shadow` is the floor's contact shadow: its texture is black with the strength in alpha.
// It multiplies whatever is under it toward --shadow, in the framebuffer's own encoding:
// the same result as the Blender renders' alpha blend, and it darkens floor lines rather
// than painting over them.
//
// The materials extend MeshBasicMaterial (unlit; the light is all in the bake), so skinning
// and morphs keep working: Fettle's paper is a SkinnedMesh.

import {
  Color,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  MultiplyBlending,
  NoColorSpace,
  type Object3D,
  RedFormat,
  type Texture,
} from 'three';
import type { Theme, ThemeToken } from './stage/theme';

export const ROLES = ['body', 'detail', 'accent', 'paper', 'lamp', 'shadow'] as const;
export type Role = (typeof ROLES)[number];

/** The theme token each role is drawn in. */
export const ROLE_TOKEN: Record<Role, ThemeToken> = {
  body: 'model',
  detail: 'detail',
  accent: 'acc',
  paper: 'paper',
  lamp: 'lamp',
  shadow: 'shadow',
};

/** Stand-in for tuning.shadeStrength until Tasks 4 and 12 settle it; the same value as
 *  SHADE_STRENGTH in the Blender preview script (not in this repo), so the renders and the
 *  browser agree. */
export const DEFAULT_SHADE_STRENGTH = 0.6;

export interface RoleOptions {
  /** How far a fully dark bake leans toward --shadow: 0 flat, 1 all the way. */
  shadeStrength?: number;
}

export const isRole = (name: string): name is Role => (ROLES as readonly string[]).includes(name);

/** A surface role's two ends, in linear: `lit` where the bake is 1, `shade` where it's 0. */
export function roleColours(role: Role, theme: Theme, opts: RoleOptions = {}): { lit: Color; shade: Color } {
  const k = opts.shadeStrength ?? DEFAULT_SHADE_STRENGTH;
  const lit = theme[ROLE_TOKEN[role]].clone();
  return { lit, shade: lit.clone().lerp(theme.shadow, k) };
}

// The bake's one channel (WebP's luma, as the browser decodes it), sRGB-decoded.
const BAKE_FACTOR = 'sRGBTransferEOTF( texture2D( map, vMapUv ) ).r';

interface RoleState {
  role: Role;
  lit?: { value: Color };
  shade?: { value: Color };
}

const states = new WeakMap<Material, RoleState>();

function surfaceMaterial(role: Role, bake: Texture): MeshBasicMaterial {
  const lit = { value: new Color() };
  const shade = { value: new Color() };
  // Uploaded as R8, before its first upload (a texture shared by the roles: set once each).
  bake.format = RedFormat;
  bake.colorSpace = NoColorSpace;
  const m = new MeshBasicMaterial({ map: bake, fog: false, toneMapped: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.roleLit = lit;
    shader.uniforms.roleShade = shade;
    shader.fragmentShader =
      'uniform vec3 roleLit;\nuniform vec3 roleShade;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `diffuseColor.rgb = mix( roleShade, roleLit, ${BAKE_FACTOR} );`,
      );
  };
  m.customProgramCacheKey = () => 'map:role-surface';
  states.set(m, { role, lit, shade });
  return m;
}

function shadowMaterial(texture: Texture): MeshBasicMaterial {
  // Premultiplied MultiplyBlending computes dst × (src.rgb + 1 − src.a) with src.rgb =
  // --shadow × a: the floor times mix(1, --shadow, a). `opacity` scales `a`, which is how
  // the runtime fades the shadow as a model lifts.
  const m = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: MultiplyBlending,
    premultipliedAlpha: true,
    fog: false,
    toneMapped: false,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      'diffuseColor.a *= texture2D( map, vMapUv ).a;',
    );
  };
  m.customProgramCacheKey = () => 'map:role-shadow';
  states.set(m, { role: 'shadow' });
  return m;
}

/**
 * The material for one role. `bake` is the model's bake texture (for `shadow`, its own
 * shadow texture), as the GLTFLoader decoded it. Recolour it later with recolourRoleMaterial.
 */
export function createRoleMaterial(role: Role, bake: Texture, theme: Theme, opts: RoleOptions = {}): Material {
  const m = role === 'shadow' ? shadowMaterial(bake) : surfaceMaterial(role, bake);
  m.name = role;
  recolourRoleMaterial(m, theme, opts);
  return m;
}

/** Points a role material at a new theme or shadeStrength. Uniforms only: no recompile. */
export function recolourRoleMaterial(material: Material, theme: Theme, opts: RoleOptions = {}): void {
  const state = states.get(material);
  if (!state) throw new Error(`shading: "${material.name}" isn't a role material`);
  if (state.role === 'shadow') {
    (material as MeshBasicMaterial).color.copy(theme.shadow);
    return;
  }
  const { lit, shade } = roleColours(state.role, theme, opts);
  state.lit!.value.copy(lit);
  state.shade!.value.copy(shade);
}

/**
 * Swaps every material under `root` (a loaded glTF scene) for its role material, keeping
 * the original's sidedness and bake texture. A glTF material shared by several meshes
 * stays shared. Throws on a material that isn't named for a role or has no bake: the model
 * pipeline allows neither. Returns the new materials, for recolourRoleMaterial.
 */
export function applyRoleMaterials(root: Object3D, theme: Theme, opts: RoleOptions = {}): Material[] {
  const made = new Map<Material, Material>();
  const swap = (original: Material): Material => {
    const existing = made.get(original);
    if (existing) return existing;
    if (!isRole(original.name)) {
      throw new Error(`shading: material "${original.name}" isn't a role (${ROLES.join(', ')})`);
    }
    const map = (original as MeshBasicMaterial).map;
    if (!map) throw new Error(`shading: the "${original.name}" material has no bake texture`);
    const m = createRoleMaterial(original.name, map, theme, opts);
    m.side = original.side;
    made.set(original, m);
    original.dispose();
    return m;
  };
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return [...made.values()];
}
