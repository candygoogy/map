import { describe, expect, test } from 'vitest';
import fixture from '../../src/data/fixture.json';
import world from '../../src/data/world.json';
import { withCluster } from '../../src/data/cluster';
import { parseFeed } from '../../src/data/feed';
import { HIDDEN, STATION_ORDER, createStations } from '../../src/nav/stations';

describe('stations', () => {
  test('next from exit wraps to origin', () => {
    const stations = createStations([...STATION_ORDER]);
    const seen: (string | null)[] = [];
    stations.subscribe((id) => seen.push(id));

    // Walk the whole loop from the overview: arriving at exit is an ordinary stop.
    for (let i = 0; i < STATION_ORDER.length; i++) stations.next();
    expect(stations.current).toBe('exit');
    expect(seen).toEqual([...STATION_ORDER]); // never 'receipt' on the way

    stations.next();
    expect(stations.current).toBe('origin');
    expect(seen).not.toContain('receipt');
  });

  // The homelab cluster (Batch B): its five sub-nodes are stations right after homelab, so the loop
  // has 17 stops. Since the real wiring's tree (2026-10-21) each hub comes before what hangs off
  // it: the switch, its desktop, server and AP, then the AP's laptop.
  test("the cluster's sub-nodes follow homelab in the loop, whatever order the feed lists them in", () => {
    const stations = createStations(withCluster(parseFeed(fixture), world).nodes.map((n) => n.id));
    expect(stations.ids).toHaveLength(17);
    const at = stations.ids.indexOf('homelab');
    expect(stations.ids.slice(at, at + 7)).toEqual(['homelab', 'switch', 'desktop', 'server', 'ap', 'laptop', 'colophon']);
    stations.go('homelab');
    stations.next();
    expect(stations.current).toBe('switch');
    stations.go('colophon');
    stations.prev();
    expect(stations.current).toBe('laptop');
  });

  test('unknown id sits before exit', () => {
    const feedIds = ['origin', 'fettle', 'exit', 'newthing', 'idiff'];
    const stations = createStations(feedIds);
    expect(stations.ids).toEqual(['origin', 'fettle', 'idiff', 'newthing', 'exit']);

    stations.go('exit');
    stations.prev();
    expect(stations.current).toBe('newthing');
  });

  test('go emits (to, from)', () => {
    const stations = createStations([...STATION_ORDER]);
    const calls: [string | null, string | null][] = [];
    stations.subscribe((to, from) => calls.push([to, from]));

    stations.go('notary');
    stations.go('fettle');
    stations.go('fettle'); // already there: nothing to tell
    stations.overview();
    expect(calls).toEqual([
      ['notary', null],
      ['fettle', 'notary'],
      [null, 'fettle'],
    ]);
  });

  // Task 17, secret 4: the duck is a node the map keeps hidden until it's found.
  describe('a hidden node (the duck)', () => {
    const feedIds = [...STATION_ORDER, 'duck'];

    test('is never in the ‹ › order, the counter or the loop', () => {
      expect(HIDDEN).toContain('duck');
      const stations = createStations(feedIds);
      expect(stations.ids).toEqual([...STATION_ORDER]);
      expect(stations.hidden).toEqual(['duck']);
      const seen = new Set<string | null>();
      stations.subscribe((id) => seen.add(id));
      for (let i = 0; i < 2 * STATION_ORDER.length; i++) stations.next();
      for (let i = 0; i < 2 * STATION_ORDER.length; i++) stations.prev();
      expect(seen.has('duck')).toBe(false);
      stations.reveal('duck');
      for (let i = 0; i < 2 * STATION_ORDER.length; i++) stations.next();
      expect(seen.has('duck')).toBe(false); // found, still never on the loop
    });

    test('go() reaches it only once revealed, and the reveal is told once', () => {
      const stations = createStations(feedIds);
      const told: string[] = [];
      stations.onReveal((id) => told.push(id));
      stations.go('duck');
      expect(stations.current).toBeNull();
      expect(stations.revealed('duck')).toBe(false);
      stations.reveal('duck');
      stations.reveal('duck');
      stations.reveal('fettle'); // not a hidden node: nothing
      expect(told).toEqual(['duck']);
      stations.go('duck');
      expect(stations.current).toBe('duck');
    });

    test('‹ › from it act as from the overview', () => {
      const stations = createStations(feedIds);
      stations.reveal('duck');
      stations.go('duck');
      stations.next();
      expect(stations.current).toBe(STATION_ORDER[0]);
      stations.go('duck');
      stations.prev();
      expect(stations.current).toBe('exit');
    });

    test('a feed without it has no hidden node', () => {
      expect(createStations([...STATION_ORDER]).hidden).toEqual([]);
    });
  });
});
