import { describe, expect, test } from 'vitest';
import { createStations, RECEIPT, STATION_ORDER } from '../../src/nav/stations';
import { createTrip } from '../../src/moments/trip';

// The trip (Task 16): what the receipt prints, recorded as the visitor travels.

/** A clock the test moves by hand, in ms. */
function clock(start: number) {
  let t = start;
  return { now: () => t, tick: (ms: number) => void (t += ms) };
}

const names: Record<string, string> = { origin: 'candygoogy.dev', fettle: 'Fettle', idiff: 'Install diff', exit: 'Exit' };

describe('trip', () => {
  test('records visits in order without duplicates, the route including revisits, and elapsed time', () => {
    const c = clock(1_000_000);
    const stations = createStations([...STATION_ORDER]);
    const trip = createTrip(stations, { now: c.now, name: (id) => names[id] ?? id });
    expect(trip.startedAt).toBe(1_000_000);

    c.tick(5_000);
    stations.go('fettle');
    c.tick(20_000);
    stations.go('idiff');
    c.tick(10_000);
    stations.overview(); // the overview is no stop
    stations.go('fettle'); // a revisit: on the route again, not in visited
    c.tick(15_000);
    stations.go('exit');
    c.tick(2_000);
    stations.go(RECEIPT); // leaving: never a stop either

    expect(trip.visited).toEqual(['fettle', 'idiff', 'exit']);
    expect(trip.route).toEqual(['fettle', 'idiff', 'fettle', 'exit']);
    expect(trip.secretsFound).toEqual([]);

    const s = trip.summary();
    expect(s.startedAt).toBe(1_000_000);
    expect(s.endedAt).toBe(1_052_000);
    expect(s.visited).toEqual([
      { id: 'fettle', name: 'Fettle', at: 5_000 },
      { id: 'idiff', name: 'Install diff', at: 25_000 },
      { id: 'exit', name: 'Exit', at: 50_000 },
    ]);
    expect(s.route).toEqual(['Fettle', 'Install diff', 'Fettle', 'Exit']);
    expect(s.total).toBe(STATION_ORDER.length);
    expect(s.pokes).toBe(0);
    expect(s.powerCycles).toBe(0);
    expect(s.secretsFound).toEqual([]);
  });

  test('a deep link’s station counts from the start; pokes, power cycles and secrets add up', () => {
    const c = clock(0);
    const stations = createStations([...STATION_ORDER]);
    stations.go('idiff'); // the page loaded at /#idiff, before the trip was made
    const found: { id: string; at: number }[] = []; // as src/moments/secrets.ts records them
    const trip = createTrip(stations, {
      now: c.now,
      startedAt: -3_000,
      secrets: { list: () => found.map((f) => ({ ...f })) },
      secretName: (id) => (id === 'mat-key' ? 'The key under the mat' : id),
    });
    expect(trip.visited).toEqual(['idiff']);
    expect(trip.summary().visited[0]).toEqual({ id: 'idiff', name: 'idiff', at: 3_000 });
    trip.poke();
    trip.poke();
    trip.powerCycle();
    c.tick(1_000);
    found.push({ id: 'mat-key', at: c.now() });
    const s = trip.summary();
    expect(s.pokes).toBe(2);
    expect(s.powerCycles).toBe(1);
    expect(s.secretsFound).toEqual([{ id: 'mat-key', name: 'The key under the mat', at: 4_000 }]);
    expect(trip.secretsFound).toEqual(['mat-key']);
  });

  test('leaving fixes the end; a trip has something to print only once left', () => {
    const c = clock(0);
    const stations = createStations([...STATION_ORDER]);
    const trip = createTrip(stations, { now: c.now });
    expect(trip.left).toBe(false);
    stations.go('exit');
    c.tick(4_000);
    const s = trip.leave();
    expect(trip.left).toBe(true);
    expect(s.endedAt).toBe(4_000);
    c.tick(60_000);
    expect(trip.summary().endedAt).toBe(4_000); // the receipt prints when you left
    stations.go('fettle'); // travelling on after the receipt starts a new leg of the same trip
    expect(trip.left).toBe(false);
    expect(trip.summary().endedAt).toBe(64_000);
  });

  test('the hidden duck is no station: never counted in visited, so 17 of 17 means every real one', () => {
    const c = clock(0);
    const stations = createStations([...STATION_ORDER, 'duck']);
    const trip = createTrip(stations, { now: c.now });
    for (const id of STATION_ORDER.slice(0, -1)) stations.go(id); // 16 of the 17
    stations.reveal('duck');
    stations.go('duck');
    stations.go('exit'); // and the 17th
    const s = trip.summary();
    expect(s.total).toBe(STATION_ORDER.length);
    expect(s.visited.map((v) => v.id)).toEqual([...STATION_ORDER]);
    expect(trip.visited).not.toContain('duck');
    expect(trip.route).toContain('duck'); // a stop on the way all the same

    const missed = createStations([...STATION_ORDER, 'duck']);
    const t2 = createTrip(missed, { now: c.now });
    for (const id of STATION_ORDER.slice(1)) missed.go(id); // every station but the origin
    missed.reveal('duck');
    missed.go('duck');
    expect(t2.summary().visited.length).toBe(STATION_ORDER.length - 1); // 16 of 17, not "17 of 17"
  });

  test('dispose stops recording', () => {
    const stations = createStations([...STATION_ORDER]);
    const trip = createTrip(stations, { now: () => 0 });
    trip.dispose();
    stations.go('fettle');
    expect(trip.route).toEqual([]);
  });
});

describe('secrets (Task 17’s, as the receipt reads them)', () => {
  test('the trip reads the secrets found, once each, and prints each one’s receipt line', async () => {
    const secrets = await import('../../src/moments/secrets');
    const { secretsCopy } = await import('../../src/copy-secrets');
    const stations = createStations([...STATION_ORDER]);
    const trip = createTrip(stations, { startedAt: 0 });
    secrets.found('key-under-mat');
    secrets.found('taped-switch');
    secrets.found('key-under-mat');
    expect(trip.secretsFound).toEqual(['key-under-mat', 'taped-switch']);
    expect(trip.summary().secretsFound.map((s) => s.name)).toEqual([
      secretsCopy.secretKeyLine.text,
      secretsCopy.secretTapedLine.text,
    ]);
  });
});
