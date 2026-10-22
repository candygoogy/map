// The stations: their travel order, where the visitor is, and the URL hash that names it.
// `null` is the overview. Travel only changes this state and tells the subscribers; the camera
// (Task 9), panel (Task 10) and controls follow it.
//
// `exit` is an ordinary station: arriving there opens the door, and → wraps on to origin.
// `#receipt` (Task 16) is a pseudo-station outside the order: reached only by leaving through
// the door, ‹ › from it act as from exit, and Back from it returns to #exit.

export const STATION_ORDER = [
  'origin',
  'fettle',
  'idiff',
  'notary',
  'candygoogy-bot',
  'dolci-eoliani',
  'siel-eolie',
  'eolietech',
  'experiments',
  'homelab',
  // The homelab cluster (Task 13 Batch B, option A): the machines behind the router, each a
  // station of its own. Wired as in reality since 2026-10-21 (layout R1), a tree: the switch
  // first (the router's one cable), then its desktop, server and AP round it from the front to
  // the back, and the laptop on the AP's Wi-Fi last. Each hub comes before what hangs off it,
  // as the arrival and the power switch's cascade need (world.py's STATION_ORDER).
  'switch',
  'desktop',
  'server',
  'ap',
  'laptop',
  'colophon',
  'exit',
] as const;

/** The trip receipt's pseudo-station (Task 16). Not in STATION_ORDER and never in `ids`. */
export const RECEIPT = 'receipt';

/** The node a station stands at: the receipt is printed at Fettle. */
export const stationNode = (id: string): string => (id === RECEIPT ? 'fettle' : id);

/**
 * Nodes kept hidden until they're found (Task 17, secret 4: the rubber duck, reached only by
 * following a stray signal down its undrawn link). Never in `ids`, so never in ‹ ›, the counter,
 * the arrival or the overview's fit; once revealed (reveal()) a station like any other for go(),
 * the URL hash and Back, for the rest of the visit. ‹ › from one act as from the overview.
 */
export const HIDDEN: readonly string[] = ['duck'];

/**
 * Orders ids by STATION_ORDER. Ids it doesn't know (a new project) keep
 * their own order and go just before exit, or at the end without one.
 */
export function orderIds(ids: readonly string[]): string[] {
  const known = new Set<string>(STATION_ORDER);
  const present = new Set(ids);
  const ordered = STATION_ORDER.filter((id) => present.has(id) && id !== 'exit');
  const unknown = ids.filter((id, i) => !known.has(id) && ids.indexOf(id) === i);
  return [...ordered, ...unknown, ...(present.has('exit') ? ['exit'] : [])];
}

/** Called after every move, with where the visitor is now and where they were (null: the overview). */
export type StationListener = (id: string | null, from: string | null) => void;

export interface Stations {
  /** The stations in travel order (unknown ids just before exit). */
  readonly ids: readonly string[];
  /** The station the visitor is at, RECEIPT, or null in the overview. */
  readonly current: string | null;
  /** On to the next station, wrapping from the last to the first; from the overview, the first. */
  next(): void;
  /** Back to the previous station, wrapping from the first to the last; from the overview, the last. */
  prev(): void;
  /** Travels to a station (or RECEIPT, or a revealed hidden node). An id it doesn't know, or the current one, does nothing. */
  go(id: string): void;
  /** The HIDDEN nodes the feed has, found or not. */
  readonly hidden: readonly string[];
  /** Whether hidden node `id` has been found (revealed). */
  revealed(id: string): boolean;
  /** A hidden node is found: from now on go() and the hash reach it. Tells onReveal's listeners once. */
  reveal(id: string): void;
  /** Called once per hidden node as it's revealed. Returns an unsubscribe. */
  onReveal(cb: (id: string) => void): () => void;
  overview(): void;
  /** Returns an unsubscribe. */
  subscribe(cb: StationListener): () => void;
}

export function createStations(feedIds: readonly string[]): Stations {
  const ids = orderIds(feedIds.filter((id) => !HIDDEN.includes(id)));
  const hidden = HIDDEN.filter((id) => feedIds.includes(id));
  const found = new Set<string>();
  const revealListeners = new Set<(id: string) => void>();
  const listeners = new Set<StationListener>();
  let current: string | null = null;

  function move(to: string | null): void {
    if (to === current) return;
    const from = current;
    current = to;
    for (const cb of [...listeners]) cb(to, from);
  }

  /** Where ‹ › count from: the receipt stands in for exit. */
  function index(): number {
    const at = current === RECEIPT ? 'exit' : current;
    return at === null ? -1 : ids.indexOf(at);
  }

  function step(by: 1 | -1): void {
    const n = ids.length;
    if (!n) return;
    const i = index();
    const from = i < 0 ? (by > 0 ? -1 : n) : i; // the overview sits just outside both ends
    move(ids[(from + by + n) % n]!);
  }

  return {
    ids,
    get current() {
      return current;
    },
    next: () => step(1),
    prev: () => step(-1),
    go(id) {
      if (id === RECEIPT || ids.includes(id) || found.has(id)) move(id);
    },
    hidden,
    revealed: (id) => found.has(id),
    reveal(id) {
      if (!hidden.includes(id) || found.has(id)) return;
      found.add(id);
      for (const cb of [...revealListeners]) cb(id);
    },
    onReveal(cb) {
      revealListeners.add(cb);
      return () => void revealListeners.delete(cb);
    },
    overview: () => move(null),
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}

export interface HashOptions {
  /**
   * Whether there's a trip to print, so #receipt can be shown (Task 16 passes the trip's
   * answer). Without one, a #receipt in the URL (a fresh load, or Forward back onto it)
   * lands on #exit instead, with replaceState. Phase 1 has no trips.
   */
  canReceipt?: () => boolean;
}

/**
 * Keeps the URL hash and the stations in step: `#<id>` is a station, no hash the overview.
 * Travel pushes a history entry; Back and Forward (popstate) travel without pushing. The hash
 * the page loads with is applied at once, with no entry of its own. Returns an unbind.
 */
export function bindHash(stations: Stations, win: Window = window, opts: HashOptions = {}): () => void {
  const canReceipt = opts.canReceipt ?? (() => false);
  const { history, location } = win;
  let syncing = false; // applying the URL: the state follows it, so nothing is pushed

  const urlFor = (id: string | null) => location.pathname + location.search + (id ? `#${id}` : '');

  /** Travels to what the URL names. Station ids are [a-z0-9-], so the hash needs no decoding. */
  function apply(): void {
    const raw = location.hash.slice(1);
    let id: string | null = raw || null;
    if (id === RECEIPT && !canReceipt()) id = 'exit';
    else if (id !== null && id !== RECEIPT && !stations.ids.includes(id) && !stations.revealed(id)) id = null;
    syncing = true;
    try {
      if (id === null) stations.overview();
      else stations.go(id);
    } finally {
      syncing = false;
    }
    // A hash that names nothing showable is rewritten to what's shown, without a new entry.
    if ((id ?? '') !== raw) history.replaceState(history.state, '', urlFor(id));
  }

  const off = stations.subscribe((to, from) => {
    if (syncing) return;
    // Back from the receipt always lands on exit, wherever the door was clicked from.
    if (to === RECEIPT && from !== 'exit') history.pushState(null, '', urlFor('exit'));
    history.pushState(null, '', urlFor(to));
  });
  win.addEventListener('popstate', apply);
  apply();

  return () => {
    off();
    win.removeEventListener('popstate', apply);
  };
}
