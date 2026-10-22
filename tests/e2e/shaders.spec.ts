import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { slimThreeShaders } from '../../vite-plugin-three-shaders';

// The build slims three's shader source (vite-plugin-three-shaders.ts, to keep the first-load JS
// small), and the dev server doesn't (three is pre-bundled there), so the other specs never
// compile the slimmed shaders. This one does: a blank page loads three.module.js and the map's
// LineMaterial.js (its trimmed copy in src/vendor/lines/) exactly as the plugin
// rewrites them for the build, and compiles every built-in material, lit, shadowed (the point
// light's shadow pass compiles MeshDistanceMaterial) and environment-mapped, plus PMREM's own
// shaders, the background's and LineMaterial with each define the map's lines set (dashes,
// vertex colours, alpha to coverage). Every program must link with no shader error.

const THREE = join(process.cwd(), 'node_modules', 'three');
const ORIGIN = 'http://shaders.test';

const files: Record<string, string> = {
  '/three.module.js': slimThreeShaders(readFileSync(join(THREE, 'build', 'three.module.js'), 'utf8'), true).code,
  '/three.core.js': readFileSync(join(THREE, 'build', 'three.core.js'), 'utf8'),
  '/LineMaterial.js': slimThreeShaders(readFileSync(join(process.cwd(), 'src', 'vendor', 'lines', 'LineMaterial.js'), 'utf8')).code,
};

const page = `<!doctype html>
<script type="importmap">{ "imports": { "three": "/three.module.js" } }</script>
<canvas width="64" height="64"></canvas>`;

test("three's slimmed shaders compile and link, every built-in material and LineMaterial", async ({ page: p }) => {
  const errors: string[] = [];
  p.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  p.on('pageerror', (e) => void errors.push(e.message));
  await p.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: page });
    const body = files[path];
    return body ? route.fulfill({ contentType: 'text/javascript', body }) : route.fulfill({ status: 404 });
  });
  await p.goto(`${ORIGIN}/`);

  const result = await p.evaluate(async () => {
    const THREE = await import('three' as string);
    const { LineMaterial } = await import('/LineMaterial.js' as string);
    const canvas = document.querySelector('canvas')!;
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 2, 6);
    camera.lookAt(0, 0, 0);
    for (const light of [new THREE.DirectionalLight(), new THREE.PointLight(), new THREE.SpotLight()]) {
      light.castShadow = true;
      light.position.set(2, 4, 3);
      scene.add(light);
    }
    scene.add(new THREE.HemisphereLight(), new THREE.AmbientLight());
    // PMREM's blur and cube shaders, and every lit material's environment-map path.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new THREE.Scene()).texture;
    scene.environment = env;
    scene.background = env;
    const box = new THREE.BoxGeometry();
    const materials = [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshLambertMaterial(),
      new THREE.MeshPhongMaterial(),
      new THREE.MeshToonMaterial(),
      new THREE.MeshStandardMaterial(),
      new THREE.MeshPhysicalMaterial({ specularIntensity: 0.5 }),
      new THREE.MeshPhysicalMaterial({ clearcoat: 0.5, sheen: 0.5, transmission: 0.5, iridescence: 0.5, anisotropy: 0.5 }),
      new THREE.MeshNormalMaterial(),
      new THREE.MeshMatcapMaterial(),
      new THREE.MeshDepthMaterial(),
      new THREE.ShadowMaterial(),
      new LineMaterial({ linewidth: 2 }),
      new LineMaterial({ linewidth: 2, dashed: true }),
      new LineMaterial({ linewidth: 2, vertexColors: true, alphaToCoverage: true }),
      new LineMaterial({ linewidth: 2, dashed: true, vertexColors: true, alphaToCoverage: true }),
    ];
    materials.forEach((material, i) => {
      const mesh = new THREE.Mesh(box, material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.x = i - materials.length / 2;
      scene.add(mesh);
    });
    scene.add(new THREE.Points(box, new THREE.PointsMaterial()));
    scene.add(new THREE.Line(box, new THREE.LineBasicMaterial()));
    scene.add(new THREE.LineSegments(box, new THREE.LineDashedMaterial()));
    scene.add(new THREE.Sprite(new THREE.SpriteMaterial()));
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const programs = renderer.info.programs as { program: WebGLProgram; name: string }[];
    return {
      programs: programs.length,
      unlinked: programs.filter((pr) => !gl.getProgramParameter(pr.program, gl.LINK_STATUS)).map((pr) => pr.name),
    };
  });

  expect(result.unlinked).toEqual([]);
  expect(result.programs).toBeGreaterThanOrEqual(20);
  expect(errors).toEqual([]);
});
