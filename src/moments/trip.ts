// The trip (Task 16): what Fettle's receipt prints, recorded as the visitor travels. Part of
// the lazy receipt moment (src/moments/load.ts), so it's made after the arrival: the station a
// deep link landed on is counted from the start, and `startedAt` is the page's own start (the
// caller passes performance.timeOrigin), not the chunk's.
//
// A stop is every station travelled to (stations' own moves, so ‹ › and clicks alike). The
// overview and the receipt are no stops. `visited` keeps each station's first time only (the
// stations' `ids`: a hidden node found, the duck, is a stop and a secret, not a station);
// `route` keeps every stop in order, revisits included. Leaving through the door fixes the
// end (leave()); travelling on after that carries the same trip on. Secrets are Task 17's
// (src/moments/secrets.ts records them); the trip only reads its list, and prints each
// secret's receipt line.

import { RECEIPT, type Stations } from '../nav/stations';
import * as secretsApi from './secrets';

export interface TripSummary {
  /** When the visitor arrived and when they left through the door (epoch ms). */
  startedAt: number;
  endedAt: number;
  /** Each station (of `ids`, never a hidden node) on its first visit, in order, with ms since startedAt. */
  visited: { id: string; name: string; at: number }[];
  /** Every station landed on, in order, revisits included (names). */
  route: string[];
  /** Stations on the map (the order's length). */
  total: number;
  /** Things poked, and power switch flips (Task 15). */
  pokes: number;
  powerCycles: number;
  /** Secrets found (Task 17), with ms since startedAt. */
  secretsFound: { id: string; name: string; at: number }[];
}

export interface TripOptions {
  /** A station's name as the receipt prints it (default: its id). */
  name?: (id: string) => string;
  /** Epoch ms (default Date.now). */
  now?: () => number;
  /** When the visit began (default: now). */
  startedAt?: number;
  /** Where the secrets found are read (default: src/moments/secrets.ts); `at` is epoch ms,
   *  `line` the receipt's words for it (Task 17), else its `name`. */
  secrets?: { list(): readonly { id: string; at: number; name?: string; line?: string }[] };
  /** A secret's name as the receipt prints it, where the list gives none (default: its id). */
  secretName?: (id: string) => string;
}

export interface Trip {
  /** Station ids on their first visit, in order. */
  readonly visited: readonly string[];
  /** Every stop's id, in order, revisits included. */
  readonly route: readonly string[];
  readonly startedAt: number;
  /** Secret ids found, in order (Task 17). */
  readonly secretsFound: readonly string[];
  /** True from leave() until the visitor travels on. */
  readonly left: boolean;
  /** A model poked. */
  poke(): void;
  /** The power switch flipped (Task 15). */
  powerCycle(): void;
  /** Leaving through the door: the end is now, and stays until the visitor travels on. */
  leave(): TripSummary;
  summary(): TripSummary;
  dispose(): void;
}

export function createTrip(stations: Pick<Stations, 'ids' | 'current' | 'subscribe'>, opts: TripOptions = {}): Trip {
  const now = opts.now ?? Date.now;
  const name = opts.name ?? ((id: string) => id);
  const startedAt = opts.startedAt ?? now();
  const visits: { id: string; at: number }[] = [];
  const route: string[] = [];
  const secrets: NonNullable<TripOptions['secrets']> = opts.secrets ?? secretsApi;
  const secretName = opts.secretName ?? ((id: string) => id);
  let pokes = 0;
  let powerCycles = 0;
  let endedAt: number | null = null;

  function stop(id: string | null): void {
    if (id === null || id === RECEIPT) return;
    endedAt = null;
    route.push(id);
    // Only the map's stations count: a hidden node found (the duck) is a stop on the route and
    // a secret on the receipt, never one of the "n of 17".
    if (stations.ids.includes(id) && !visits.some((v) => v.id === id)) visits.push({ id, at: now() - startedAt });
  }

  stop(stations.current);
  const off = stations.subscribe((id) => stop(id));

  function summary(): TripSummary {
    return {
      startedAt,
      endedAt: endedAt ?? now(),
      visited: visits.map((v) => ({ id: v.id, name: name(v.id), at: v.at })),
      route: route.map(name),
      total: stations.ids.length,
      pokes,
      powerCycles,
      secretsFound: secrets.list().map((f) => ({ id: f.id, name: f.line ?? f.name ?? secretName(f.id), at: f.at - startedAt })),
    };
  }

  return {
    get visited() {
      return visits.map((v) => v.id);
    },
    get route() {
      return [...route];
    },
    startedAt,
    get secretsFound() {
      return secrets.list().map((f) => f.id);
    },
    get left() {
      return endedAt !== null;
    },
    poke: () => void pokes++,
    powerCycle: () => void powerCycles++,
    leave() {
      endedAt = now();
      return summary();
    },
    summary,
    dispose: off,
  };
}
