import { Box3, Vector3 } from 'three';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import type { Pose } from '../../src/camera/fit';
import { STATION_ORDER } from '../../src/nav/stations';
import world from '../../src/data/world.json';
import { linkCurve, parentOf } from '../../src/data/layout';
import { BURST, createPower, FRONT, powerTimeline, RCD, SPEED, TRIP, tripTimeline, type PowerOptions } from '../../src/moments/power';
import { cue } from '../../src/sound-cue';

vi.mock('../../src/sound-cue', () => ({ cue: vi.fn() }));
// Reduced motion as each test sets it (the moment reads prefs.reduced as it starts).
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('../../src/motion/prefs', () => ({ prefs: motion, onPrefsChange: () => () => undefined }));

// The power switch's timeline (Task 15, approved 2026-10-20): the toggle snaps at 0.30 s, the nodes
// go dark in reverse station order 80 ms apart from 0.38 s, and the reboot comes after 1.2 s of
// dark.

const ids = [...STATION_ORDER];

describe('powerTimeline', () => {
  test('the dark rolls back toward the hub: exit first at 0.38 s, then 80 ms apart, fettle last', () => {
    const t = powerTimeline(ids, false);
    expect(t.snap).toBeCloseTo(0.3);
    expect(t.dark.get('exit')).toBeCloseTo(0.38);
    expect(t.dark.get('colophon')).toBeCloseTo(0.46);
    // The cluster's devices go dark before their hub.
    expect(t.dark.get('laptop')!).toBeLessThan(t.dark.get('homelab')!);
    expect(t.dark.get('ap')!).toBeLessThan(t.dark.get('homelab')!);
    expect(t.dark.get('fettle')).toBeCloseTo(0.38 + 0.08 * 15); // 1.58 s with the cluster's five
    expect(t.dark.get('origin')).toBeCloseTo(0.3);
    expect(t.reboot).toBeCloseTo(1.58 + 1.2);
  });

  // The cluster's tree (2026-10-21): station order puts each hub before what hangs off it, so in
  // reverse every device goes dark before its hub, the laptop before the AP before the switch.
  test('down the tree, every device goes dark before the hub its link leaves', () => {
    const t = powerTimeline(ids, false);
    for (const [id, hub] of Object.entries(world.linkFrom)) expect(t.dark.get(id)!, `${id} before ${hub}`).toBeLessThan(t.dark.get(hub)!);
    expect(['laptop', 'ap', 'switch', 'homelab'].map((id) => t.dark.get(id)!)).toEqual([...['laptop', 'ap', 'switch', 'homelab'].map((id) => t.dark.get(id)!)].sort((a, b) => a - b));
  });

  test('under reduced motion everything goes off at once at the snap, and the reboot is 1.2 s later', () => {
    const t = powerTimeline(ids, true);
    for (const id of ids) expect(t.dark.get(id)).toBeCloseTo(0.3);
    expect(t.reboot).toBeCloseTo(1.5);
  });

  test('without the cluster (twelve stations) fettle goes dark at 1.18 s and the reboot is at 2.38 s', () => {
    const twelve = ids.filter((id) => !['ap', 'desktop', 'server', 'switch', 'laptop'].includes(id));
    const t = powerTimeline(twelve, false);
    expect(t.dark.get('fettle')).toBeCloseTo(1.18);
    expect(t.reboot).toBeCloseTo(2.38);
  });
});

// Task 17's "test means test" (approved; the owner's test notes, 2026-10-21, "make it more
// obvious"): the RCD at Siel Eolie trips the map from there outward along the links. Once its pilot
// light has sunk (FRONT) a front runs along the network at SPEED: down its own link to the hub and
// out along the others, a sub-hub's after it.
describe('tripTimeline', () => {
  // o the hub; a, b and h on it (links 2, 4 and 3 long); h's own x (1 long).
  const parent = (id: string) => (id === 'o' ? null : id === 'x' ? 'h' : 'o');
  const length = (id: string) => ({ a: 2, b: 4, h: 3, x: 1 })[id] ?? 0;
  const ids = ['o', 'a', 'b', 'h', 'x'];

  test('each node goes dark as the front reaches it along the links, from the source out', () => {
    const t = tripTimeline(ids, 'a', parent, length, false);
    const at = (d: number) => FRONT + d / SPEED;
    expect(t.nodes.get('a')).toBeCloseTo(FRONT); // the front leaves it
    expect(t.nodes.get('o')).toBeCloseTo(at(2)); // down its link to the hub
    expect(t.nodes.get('h')).toBeCloseTo(at(5));
    expect(t.nodes.get('b')).toBeCloseTo(at(6));
    expect(t.nodes.get('x')).toBeCloseTo(at(6)); // behind its sub-hub
    // A link goes as the front enters it: the source's at once, the others from the hub's end.
    expect(t.links.get('a')).toBeCloseTo(FRONT);
    expect(t.links.get('b')).toBeCloseTo(at(2));
    expect(t.links.get('h')).toBeCloseTo(at(2));
    expect(t.links.get('x')).toBeCloseTo(at(5));
    expect(t.links.has('o')).toBe(false); // the hub has no link of its own
  });

  test('from inside the cluster it climbs to its sub-hub first', () => {
    const t = tripTimeline(ids, 'x', parent, length, false);
    expect(t.links.get('x')).toBeCloseTo(FRONT);
    expect(t.nodes.get('h')).toBeCloseTo(FRONT + 1 / SPEED);
    expect(t.links.get('h')).toBeCloseTo(FRONT + 1 / SPEED); // entered from h's end
    expect(t.nodes.get('o')).toBeCloseTo(FRONT + 4 / SPEED);
    expect(t.nodes.get('b')).toBeCloseTo(FRONT + 8 / SPEED);
  });

  // The homelab cluster wired as in reality (2026-10-21): router → switch → desktop / server / AP,
  // AP → laptop. From Siel Eolie the dark runs down to the hub, out along homelab's link and on
  // down the tree, each link going as the front enters it from its hub's end.
  test("on the map's own tree it runs down every level of the cluster in turn", () => {
    const positions = new Map(Object.entries(world.nodes).map(([id, [x, z]]) => [id, new Vector3(x, 0, z)]));
    const len = (id: string) => linkCurve(id, positions, world).getLength();
    const up = (id: string) => (id === 'origin' ? null : parentOf(world, id));
    const all = [...STATION_ORDER];
    const t = tripTimeline(all, RCD, up, len, false);
    const at = (d: number) => FRONT + d / SPEED;
    const down = len(RCD);
    expect(t.nodes.get('homelab')).toBeCloseTo(at(down + len('homelab')));
    expect(t.nodes.get('switch')).toBeCloseTo(at(down + len('homelab') + len('switch')));
    expect(t.nodes.get('laptop')).toBeCloseTo(at(down + len('homelab') + len('switch') + len('ap') + len('laptop')));
    for (const [id, hub] of Object.entries(world.linkFrom)) {
      expect(t.nodes.get(id)!, `${id} after ${hub}`).toBeGreaterThan(t.nodes.get(hub)!);
      // Its link goes as the front leaves its hub, its node a link's length later.
      expect(t.links.get(id)!, id).toBeCloseTo(t.nodes.get(hub)!);
      expect(t.nodes.get(id)! - t.links.get(id)!, id).toBeCloseTo(len(id) / SPEED);
    }
    // And from inside the cluster (the tree, whichever node it starts at): up to the switch,
    // then out to its other devices and up to the router.
    const fromLaptop = tripTimeline(all, 'laptop', up, len, false);
    expect(fromLaptop.nodes.get('ap')).toBeCloseTo(at(len('laptop')));
    expect(fromLaptop.nodes.get('switch')).toBeCloseTo(at(len('laptop') + len('ap')));
    expect(fromLaptop.nodes.get('desktop')).toBeCloseTo(at(len('laptop') + len('ap') + len('desktop')));
    expect(fromLaptop.nodes.get('homelab')).toBeCloseTo(at(len('laptop') + len('ap') + len('switch')));
    expect(fromLaptop.links.get('switch')).toBeCloseTo(at(len('laptop') + len('ap'))); // entered from the switch's end
  });

  test('under reduced motion everything goes off at the trip', () => {
    const t = tripTimeline(ids, 'a', parent, length, true);
    for (const id of ids) expect(t.nodes.get(id)).toBeCloseTo(TRIP);
    for (const v of t.links.values()) expect(v).toBeCloseTo(TRIP);
  });
});

// The RCD's reset is heard (Task 17's sounds): Siel Eolie's `on` has no cue of its own (no node's
// but the origin's, or every reboot would click), so the moment cues the reset's clunks itself.
describe('the RCD', () => {
  test('its reset cues `power reset` as the board comes back on; its trip does not', () => {
    const ticks = new Set<(dt: number) => boolean>();
    const lit = new Map<string, boolean>(ids.map((id) => [id, true]));
    const power = createPower({
      clock: { add: (fn) => (ticks.add(fn as (dt: number) => boolean), () => void ticks.delete(fn as (dt: number) => boolean)) },
      nodes: {
        get: (id: string) =>
          ({
            id,
            home: { x: 0, z: (ids as string[]).indexOf(id) },
            get lit() {
              return lit.get(id)!;
            },
            setLit: (on: boolean) => void lit.set(id, on),
            poke: () => undefined,
            play: () => Promise.resolve(),
            playing: null,
            root: { getObjectByName: () => undefined },
          }) as never,
      },
      links: { setLit: () => undefined, drawProgress: () => undefined },
      traffic: { enabled: true, burst: () => undefined },
      director: { arrivalTimes: () => ({ reach: new Map(), links: new Map() }), cancelStatusRipple: () => undefined },
      labels: { setStatus: () => undefined },
      stations: { ids, current: null, overview: () => undefined },
    });
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 30) for (const fn of [...ticks]) if (!fn(1 / 30)) ticks.delete(fn);
    };
    const resets = () => vi.mocked(cue).mock.calls.filter((c) => c[0] === 'power' && c[1] === 'reset').length;
    expect(power.rcd()).toBe(true); // the trip
    run(3);
    expect(power.tripped).toBe(true);
    expect(resets()).toBe(0);
    expect(power.rcd()).toBe(true); // the reset
    expect(lit.get(RCD)).toBe(true);
    expect(resets()).toBe(1);
    power.dispose();
  });
});

// The owner's test notes ("make it more obvious"): as the reboot's last link lands,
// traffic comes back with a burst, BURST signals out of the hub at once (traffic.burst paces
// them hubSpacing apart). Not under reduced motion, where no signal runs.
describe('the reboot', () => {
  function rig() {
    const ticks = new Set<(dt: number) => boolean>();
    const lit = new Map<string, boolean>(ids.map((id) => [id, true]));
    const drawn = new Map<string, number[]>(); // each link's drawProgress calls, in order
    const traffic = { enabled: true, bursts: [] as number[], burst: (n: number) => void traffic.bursts.push(n) };
    // Fettle's link first, then the others 0.1 s apart, each 0.5 s long.
    const links = new Map(ids.filter((id) => id !== 'origin').map((id, i) => [id, { start: 0.1 * i, span: 0.5 }]));
    const opts: PowerOptions = {
      clock: { add: (fn) => (ticks.add(fn as (dt: number) => boolean), () => void ticks.delete(fn as (dt: number) => boolean)) },
      nodes: {
        get: (id: string) =>
          ({
            id,
            get lit() {
              return lit.get(id)!;
            },
            setLit: (on: boolean) => void lit.set(id, on),
            poke: () => undefined,
            play: () => Promise.resolve(),
            playing: null,
            root: { getObjectByName: () => undefined },
          }) as never,
      },
      links: { setLit: () => undefined, drawProgress: (id, p) => void drawn.set(id, [...(drawn.get(id) ?? []), p]) },
      traffic,
      director: {
        arrivalTimes: () => ({ reach: new Map([...links].map(([id, l]) => [id, l.start + l.span])), links }),
        cancelStatusRipple: () => undefined,
      },
      labels: { setStatus: () => undefined },
      stations: { ids, current: null, overview: () => undefined },
    };
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 30) for (const fn of [...ticks]) if (!fn(1 / 30)) ticks.delete(fn);
    };
    return { power: createPower(opts), traffic, drawn, links, run };
  }

  test('redraws each link from the hub out at its own start, then sends one burst as the last lands', () => {
    motion.reduced = false;
    const { power, traffic, drawn, links, run } = rig();
    expect(power.flip()).toBe(true);
    const reboot = powerTimeline(ids, false).reboot;
    run(reboot + 0.05);
    for (const id of links.keys()) expect(drawn.get(id)?.[0], id).toBe(0); // all gone at the reboot, to redraw
    expect(traffic.bursts).toEqual([]);
    run(0.4);
    // Fettle's started first; the last link's not yet begun.
    expect(drawn.get('fettle')!.at(-1)!).toBeGreaterThan(0);
    expect(drawn.get(ids.at(-1)!)!.at(-1)!).toBeLessThanOrEqual(0); // (links.drawProgress clamps)
    run(0.1 * links.size + 1);
    const clamp = (p: number) => Math.min(Math.max(p, 0), 1); // as links.drawProgress takes it
    for (const [id, raw] of drawn) {
      const calls = raw.map(clamp);
      expect(calls.at(-1), id).toBe(1);
      expect(calls.every((p, i) => i === 0 || p >= calls[i - 1]!), `${id} only ever draws on`).toBe(true);
    }
    expect(traffic.enabled).toBe(true);
    expect(traffic.bursts).toEqual([BURST]);
    expect(power.busy).toBe(false);
    power.dispose();
  });

  test('under reduced motion nothing is redrawn and no burst is sent', () => {
    vi.useFakeTimers();
    try {
      motion.reduced = true;
      const { power, traffic, drawn, run } = rig();
      expect(power.flip()).toBe(true);
      vi.advanceTimersByTime(10_000);
      run(1); // no frames are asked for, but nothing would draw if they were
      expect(power.busy).toBe(false);
      expect(power.reboots).toBe(1);
      expect(traffic.enabled).toBe(true);
      expect(traffic.bursts).toEqual([]);
      expect([...drawn.values()].flat().filter((p) => p < 1)).toEqual([]);
      power.dispose();
    } finally {
      motion.reduced = false;
      vi.useRealTimers();
    }
  });
});

// The owner's test notes, 2026-10-21 ("it brings me back to view again ... may be impractical"):
// the trip no longer dives to the overview. The camera stays at Siel Eolie's station and eases out
// to a wider framing round it (director.closeUp), holds it while the map is dark, and eases back to
// the station's framing as the reset is pressed. With motion reduced it cuts out and back.
describe('the RCD’s wider framing', () => {
  function rig() {
    const ticks = new Set<(dt: number) => boolean>();
    const lit = new Map<string, boolean>(ids.map((id) => [id, true]));
    const homes = new Map<string, Vector3>(ids.map((id, i) => [id, new Vector3(Math.cos(i) * 6, 0, Math.sin(i) * 6)]));
    homes.set('origin', new Vector3());
    const subs = new Set<() => void>();
    const poses: (Pose | null)[] = [];
    const station = (): Pose => {
      const target = homes.get(RCD)!.clone();
      return { position: target.clone().add(new Vector3(0, 2, 4)), target, fovY: 30 };
    };
    const director = {
      arrivalTimes: () => ({ reach: new Map(), links: new Map() }),
      cancelStatusRipple: () => undefined,
      state: 'station' as 'station' | 'flying' | 'overview',
      turn: 0,
      framing: () => station(),
      closeUp: (p: Pose | null) => void poses.push(p),
    };
    const stations = {
      ids,
      current: RCD as string | null,
      overview: vi.fn(),
      go: vi.fn(),
      subscribe: ((fn: () => void) => (subs.add(fn), () => void subs.delete(fn))) as never,
    };
    const power = createPower({
      clock: { add: (fn) => (ticks.add(fn as (dt: number) => boolean), () => void ticks.delete(fn as (dt: number) => boolean)) },
      nodes: {
        get: (id: string) =>
          ({
            id,
            home: homes.get(id)!,
            bounds: new Box3(new Vector3(-0.4, 0, -0.3), new Vector3(0.4, 0.5, 0.3)),
            get lit() {
              return lit.get(id)!;
            },
            setLit: (on: boolean) => void lit.set(id, on),
            poke: () => undefined,
            play: () => Promise.resolve(),
            playing: null,
            root: { getObjectByName: () => undefined },
          }) as never,
      },
      links: { setLit: () => undefined, drawProgress: () => undefined },
      traffic: { enabled: true, burst: () => undefined },
      director,
      labels: { setStatus: () => undefined },
      stations,
    });
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 30) for (const fn of [...ticks]) if (!fn(1 / 30)) ticks.delete(fn);
    };
    /** How far the camera stands from the station's target, in station framings' distances. */
    const out = (p: Pose | null | undefined) => (p ? p.position.distanceTo(station().target) / station().position.distanceTo(station().target) : 1);
    const leave = () => {
      stations.current = 'eolietech';
      director.state = 'flying';
      for (const fn of subs) fn();
    };
    return { power, run, poses, out, stations, director, leave, ticks };
  }

  beforeAll(() => Object.assign(globalThis, { innerWidth: 1440, innerHeight: 900 }));

  test('the trip eases out from the station, never to the overview; the hold asks for no frames; the reset eases back', () => {
    motion.reduced = false;
    const { power, run, poses, out, stations, ticks } = rig();
    expect(power.rcd()).toBe(true);
    run(0.5);
    const early = out(poses.at(-1));
    expect(early).toBeGreaterThan(1);
    run(3);
    const wide = out(poses.at(-1));
    expect(wide).toBeGreaterThan(early);
    expect(wide).toBeGreaterThan(1.5);
    expect(poses.every((p) => p !== null)).toBe(true);
    expect(stations.overview).not.toHaveBeenCalled();
    expect(stations.go).not.toHaveBeenCalled();
    const n = poses.length;
    run(5);
    expect(poses.length).toBe(n); // held: nothing more to ease
    expect(ticks.size).toBe(0);
    expect(power.rcd()).toBe(true); // the reset
    run(0.5);
    const back = out(poses.at(-1));
    expect(back).toBeLessThan(wide);
    expect(back).toBeGreaterThan(1);
    run(2);
    expect(poses.at(-1)).toBeNull(); // the station's own framing again
    power.dispose();
  });

  test('travel during the trip hands over to the flights: back at the board, the reset leaves the framing alone', () => {
    motion.reduced = false;
    const { power, run, poses, stations, director, leave } = rig();
    power.rcd();
    run(3);
    leave();
    stations.current = RCD; // back again, landed
    director.state = 'station';
    const n = poses.length;
    power.rcd();
    run(3);
    expect(poses.slice(n)).toEqual([]); // no ease from a framing it isn't at
    power.dispose();
  });

  test('under reduced motion it cuts out to the wider framing as it trips, and back as it resets', () => {
    vi.useFakeTimers();
    try {
      motion.reduced = true;
      const { power, poses, out } = rig();
      power.rcd();
      vi.advanceTimersByTime(200);
      expect(poses.length).toBe(1);
      expect(out(poses[0])).toBeGreaterThan(1.5);
      power.rcd();
      expect(poses.length).toBe(2);
      expect(poses[1]).toBeNull();
      power.dispose();
    } finally {
      motion.reduced = false;
      vi.useRealTimers();
    }
  });
});
