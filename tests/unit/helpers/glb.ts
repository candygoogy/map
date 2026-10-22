import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const TRIANGLES = 4;

export interface GlbReport {
  triangles: number;
  /** How many glTF meshes the file holds (world.glb, cameras and clips only, has none). */
  meshes: number;
  bytes: number;
  materials: string[];
  clips: string[];
  textureSizes: [number, number][];
  /** Texture sizes per material name, so a test can tell the shadow's 128px map from the bake. */
  materialTextures: Record<string, [number, number][]>;
  /** `asset.extras.sourceHash`: the SHA-256 of the .blend the GLB was exported from. */
  sourceHash: string | undefined;
}

export async function readGlb(path: string): Promise<Document> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(path);
}

export async function inspectGlb(path: string): Promise<GlbReport> {
  const doc = await readGlb(path);
  const root = doc.getRoot();

  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== TRIANGLES) continue;
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
      triangles += count / 3;
    }
  }

  const sizeOf = (t: ReturnType<typeof root.listTextures>[number]): [number, number] => {
    const s = t.getSize();
    return s ? [s[0], s[1]] : [0, 0];
  };

  const materialTextures: Record<string, [number, number][]> = {};
  for (const m of root.listMaterials()) {
    const textures = [
      m.getBaseColorTexture(),
      m.getEmissiveTexture(),
      m.getOcclusionTexture(),
      m.getNormalTexture(),
      m.getMetallicRoughnessTexture(),
    ].filter((t) => t !== null);
    materialTextures[m.getName()] = textures.map(sizeOf);
  }

  const extras = root.getAsset().extras as Record<string, unknown> | undefined;
  const hash = extras?.['sourceHash'];

  return {
    triangles,
    meshes: root.listMeshes().length,
    bytes: (await stat(path)).size,
    materials: root.listMaterials().map((m) => m.getName()),
    clips: root.listAnimations().map((a) => a.getName()),
    textureSizes: root.listTextures().map(sizeOf),
    materialTextures,
    sourceHash: typeof hash === 'string' ? hash : undefined,
  };
}

/** One camera clip, sampled as exported: the node's translation and rotation at each time. */
export interface CameraClip {
  times: number[];
  positions: [number, number, number][];
  /** Quaternions [x, y, z, w]. */
  rotations: [number, number, number, number][];
  /** The animated node's glTF camera's vertical fov, in radians. */
  yfov: number;
  /** Whether the animated node hangs straight off the scene (so its TRS is its world pose). */
  isRoot: boolean;
}

/** Reads animation `name` from a GLB whose one animated node is a camera (world.glb). */
export async function cameraClip(path: string, name: string): Promise<CameraClip> {
  const doc = await readGlb(path);
  const root = doc.getRoot();
  const anim = root.listAnimations().find((a) => a.getName() === name);
  if (!anim) throw new Error(`${path} has no animation ${name}`);
  const read = (target: 'translation' | 'rotation', size: number) => {
    const ch = anim.listChannels().find((c) => c.getTargetPath() === target);
    if (!ch) throw new Error(`${name} has no ${target} channel`);
    const sampler = ch.getSampler()!;
    const times = Array.from(sampler.getInput()!.getArray()!);
    const flat = Array.from(sampler.getOutput()!.getArray()!);
    const values = times.map((_, i) => flat.slice(i * size, i * size + size));
    return { node: ch.getTargetNode()!, times, values };
  };
  const t = read('translation', 3);
  const r = read('rotation', 4);
  if (t.node !== r.node) throw new Error(`${name} animates more than one node`);
  if (t.times.length !== r.times.length || t.times.some((x, i) => Math.abs(x - r.times[i]!) > 1e-6)) {
    throw new Error(`${name}: translation and rotation are sampled at different times`);
  }
  const camera = t.node.getCamera();
  if (!camera) throw new Error(`${name} animates ${t.node.getName()}, which has no camera`);
  const scenes = root.listScenes();
  return {
    times: t.times,
    positions: t.values as [number, number, number][],
    rotations: r.values as [number, number, number, number][],
    yfov: camera.getYFov(),
    isRoot: scenes.some((s) => s.listChildren().includes(t.node)),
  };
}

/** World-space bounding box of every mesh in the GLB's rest pose, in glTF (Y-up) space. */
/**
 * The GLB's bounds as exported. `without` leaves out primitives with these material names:
 * ['shadow'] gives the model as nodes.ts measures it (NodeView.bounds), without its floor shadow.
 */
export async function glbBounds(path: string, without: readonly string[] = []): Promise<{ min: number[]; max: number[] }> {
  const doc = await readGlb(path);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (without.includes(prim.getMaterial()?.getName() ?? '')) continue;
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const p: number[] = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        const [x, y, z] = p as [number, number, number];
        const w = [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ];
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, w[k]!);
          max[k] = Math.max(max[k]!, w[k]!);
        }
      }
    }
  }
  return { min, max };
}

export async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
