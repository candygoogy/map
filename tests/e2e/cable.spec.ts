import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/main'; // window.__map's type

// The homelab's wiring (the owner's test notes, 2026-10-21 afternoon): a lazy chunk
// loaded after the arrival, four network cables and six power cords from two strips and the
// switch's brick, each end in its model's plug, following a pulled node and settling back with
// it. On the manual clock (?test).

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test');
  await page.waitForFunction(() => window.__map?.director !== undefined);
  await page.evaluate(async () => {
    const { director, advance } = window.__map!;
    await director.ready;
    director.skipArrival();
    advance(1 / 60);
  });
}

type P = { x: number; y: number; z: number };
const near = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Each line's drawn ends, and where its nodes' plugs are now (node position + `<at>_end`). */
const wiring = (page: Page) =>
  page.evaluate(() => {
    const { cable, nodes } = window.__map!;
    const plugs: Record<string, [string, string]> = {
      homelab_switch: ['homelab:cable', 'switch:port2'],
      switch_ap: ['switch:port3', 'ap:cable'],
      switch_desktop: ['switch:port1', 'desktop:cable'],
      server_switch: ['server:cable', 'switch:cable'],
      A_homelab: ['', 'homelab:power'],
      A_psu: ['', 'brick:psu:mains'],
      psu_switch: ['brick:psu:dc', 'switch:power'],
      A_desktop: ['', 'desktop:power'],
      B_laptop: ['', 'laptop:power'],
      B_server: ['', 'server:power'],
    };
    const plug = (spec: string) => {
      if (!spec) return null;
      if (spec.startsWith('brick:')) {
        // A brick's lead: its root's extras, where it lies (at full size).
        const [, id, at] = spec.split(':') as [string, string, string];
        const b = cable!.bricks.find((x) => x.name === `brick:${id}`)!;
        let v: number[] | undefined;
        b.traverse((o) => void (v ??= o.userData[`${at}_end`] as number[] | undefined));
        const w = b.position.clone().set(v![0]!, v![1]!, v![2]!).applyQuaternion(b.quaternion).add(b.position);
        return { x: w.x, y: w.y, z: w.z };
      }
      const [id, at] = spec.split(':') as [string, string];
      const n = nodes.get(id);
      let v: number[] | undefined;
      n.root.traverse((o) => void (v ??= o.userData[`${at}_end`] as number[] | undefined));
      const p = n.root.position;
      return { x: p.x + v![0]!, y: p.y + v![1]!, z: p.z + v![2]! };
    };
    return {
      strips: cable!.strips.map((s) => ({ name: s.name, visible: s.visible, x: s.position.x, z: s.position.z })),
      lines: cable!.lines.map((l) => {
        const g = l.line.geometry as unknown as {
          instanceCount: number;
          getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number };
        };
        const start = g.getAttribute('instanceStart');
        const end = g.getAttribute('instanceEnd');
        const last = end.count - 1;
        return {
          name: l.name,
          object: l.line.name,
          visible: l.line.visible,
          drawn: g.instanceCount,
          segments: end.count,
          from: { x: start.getX(0), y: start.getY(0), z: start.getZ(0) },
          to: { x: end.getX(last), y: end.getY(last), z: end.getZ(last) },
          plugs: plugs[l.name]!.map(plug),
        };
      }),
      switchAt: (({ x, y, z }) => ({ x, y, z }))(nodes.get('switch').root.position),
      switchHome: (({ x, y, z }) => ({ x, y, z }))(nodes.get('switch').home),
    };
  });

test('after the arrival the cables and cords run plug to plug, follow a dragged switch and settle back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  // The chunk loads at the first idle moment after the arrival; then it draws out.
  await page.waitForFunction(() => !!window.__map!.cable && !!window.__map!.stage.scene.getObjectByName('cable:server_switch'));
  await page.evaluate(() => window.__map!.advance(1.5));

  const rest = await wiring(page);
  expect(rest.lines.map((l) => l.object).sort()).toEqual([
    'cable:homelab_switch', 'cable:server_switch', 'cable:switch_ap', 'cable:switch_desktop',
    'cord:A_desktop', 'cord:A_homelab', 'cord:A_psu', 'cord:B_laptop', 'cord:B_server', 'cord:psu_switch',
  ]);
  expect(rest.strips.map((s) => s.name).sort()).toEqual(['strip:A', 'strip:B']);
  for (const l of rest.lines) {
    expect(l.visible, l.name).toBe(true);
    expect(l.drawn, l.name).toBe(l.segments); // drawn out whole
    const [a, b] = l.plugs;
    if (a) expect(near(l.from, a), l.name).toBeLessThan(1e-4);
    expect(near(l.to, b!), l.name).toBeLessThan(1e-4);
  }
  // A cord leaves its strip (the brick's DC lead leaves the brick).
  for (const l of rest.lines.filter((x) => /^cord:[AB]_/.test(x.object))) {
    const strip = rest.strips.find((s) => s.name === `strip:${l.name[0]}`)!;
    expect(Math.hypot(l.from.x - strip.x, l.from.z - strip.z), l.name).toBeLessThan(0.3);
  }

  // Drag the switch 1 unit away: its plugs go with it, and its lines' ends with the plugs.
  await page.evaluate(() => {
    const { nodes, advance } = window.__map!;
    const n = nodes.get('switch');
    n.dragTo(n.home.clone().add({ x: 0.6, y: 0, z: 0.8 } as never));
    advance(1);
  });
  const pulled = await wiring(page);
  expect(near(pulled.switchAt, pulled.switchHome)).toBeGreaterThan(0.5);
  for (const [l, was] of pulled.lines.map((l, i) => [l, rest.lines[i]!] as const)) {
    const [a, b] = l.plugs;
    if (a) expect(near(l.from, a), l.name).toBeLessThan(1e-4);
    expect(near(l.to, b!), l.name).toBeLessThan(1e-4);
    const mine = l.name.includes('switch');
    const moved = Math.max(near(l.from, was.from), near(l.to, was.to));
    if (mine) expect(moved, l.name).toBeGreaterThan(0.5);
    else expect(moved, l.name).toBeLessThan(1e-4);
  }

  // Let go: the switch springs home, and its lines with it.
  await page.evaluate(() => {
    const { nodes, advance } = window.__map!;
    nodes.get('switch').dragTo(null);
    advance(4);
  });
  const back = await wiring(page);
  expect(near(back.switchAt, back.switchHome)).toBeLessThan(1e-3);
  for (const [l, was] of back.lines.map((l, i) => [l, rest.lines[i]!] as const)) {
    expect(near(l.from, was.from), l.name).toBeLessThan(1e-3);
    expect(near(l.to, was.to), l.name).toBeLessThan(1e-3);
  }
  expect(errors).toEqual([]);
});

test('the strips are no stations: no label, no link, and a click on one picks nothing', async ({ page }) => {
  await open(page);
  await page.waitForFunction(() => (window.__map!.cable?.strips.length ?? 0) === 2);
  await page.evaluate(() => window.__map!.advance(1.5));
  const info = await page.evaluate(() => {
    const { cable, stations, stage } = window.__map!;
    return {
      stations: [...stations.ids].filter((id) => id.startsWith('strip')),
      labels: document.querySelectorAll('button.label[data-go^="strip"]').length,
      links: ['link:strip:A', 'link:strip:B', 'link:A', 'link:B'].filter((n) => stage.scene.getObjectByName(n)).length,
      names: cable!.strips.map((s) => s.name),
    };
  });
  expect(info.stations).toEqual([]);
  expect(info.labels).toBe(0);
  expect(info.links).toBe(0);
  expect(info.names.sort()).toEqual(['strip:A', 'strip:B']);

  // A click on strip A: nothing is picked, the view stays in the overview.
  const at = await page.evaluate(() => {
    const { cable, stage } = window.__map!;
    const p = cable!.strips.find((s) => s.name === 'strip:A')!.position.clone().setY(0.03).project(stage.camera);
    const r = stage.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, before: window.__map!.stations.current };
  });
  await page.mouse.click(at.x, at.y);
  await page.evaluate(() => window.__map!.advance(1));
  expect(await page.evaluate(() => window.__map!.stations.current)).toBe(at.before);
});
