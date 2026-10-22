import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { BOT, createPlaneTrip, SERVER } from '../../src/moments/plane';
import type { Tick } from '../../src/stage/clock';

// The plane goes to work (Task 17, secret 3): the second click on the stand launches it at the
// kick, a frame callback later. Disposed in between (a lost WebGL context), nothing takes off.

function node(id: string, x: number) {
  const root = new Group();
  root.position.set(x, 0, 0);
  const body = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial());
  body.name = id === BOT ? 'plane' : 'lid';
  root.add(body);
  return { id, root, home: new Vector3(x, 0, 0), bounds: new Box3(), lit: true, play: () => Promise.resolve() };
}

describe('the plane', () => {
  test('disposed between the launch and its kick, it never takes off', () => {
    const ticks = new Set<Tick>();
    const clock = {
      add: (fn: Tick) => (ticks.add(fn), () => void ticks.delete(fn)),
      invalidate: () => undefined,
    };
    const scene = new Scene();
    const nodes = new Map([BOT, SERVER].map((id, i) => [id, node(id, i * 4)]));
    const trip = createPlaneTrip({ stage: { scene, camera: new PerspectiveCamera() }, nodes: { get: (id: string) => nodes.get(id) as never }, clock });
    trip.stand();
    trip.stand(); // the second within AGAIN: the launch, at the kick
    expect(trip.flying).toBe(true);
    expect(ticks.size).toBe(1);
    trip.dispose();
    for (let i = 0; i < 60; i++) for (const fn of [...ticks]) if (!fn(1 / 30, 0)) ticks.delete(fn);
    expect(ticks.size).toBe(0);
    expect(scene.getObjectByName('plane-trip')).toBeUndefined();
    expect(nodes.get(BOT)!.root.getObjectByName('plane')!.visible).toBe(true);
  });
});
