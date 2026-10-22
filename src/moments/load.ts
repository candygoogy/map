// The moments: the power switch (Task 15), the trip receipt and its canvas (Task 16),
// sound and the secrets (Task 17). None of them is on the first load. Each is its own chunk,
// fetched by a dynamic import() only after the arrival, so a visitor who never pokes anything
// never downloads them. Together they stay within 60 KB gzipped (tests/unit/budget.test.ts).
//
// A moment registers below as `name: () => import('./name')`, and the runtime asks for it with
// loadMoment(name): one import per moment, the same module for every caller. Asked for during
// the arrival, it waits. map.ts opens the gate with the director's `arrived`, at the first idle
// moment after it. Nothing is preloaded: a chunk is fetched when something asks for it.
//
// A tab left open across a deploy asks for chunks by the names of the build it loaded, which
// the new deploy no longer has (a 404). So a failed import reloads the page once, its hash kept
// (src/reload.ts): the new build's page lands at the same station. The mark is this build's
// runtime URL, so a reload that brings the same build back (the chunk is gone for some other
// reason) doesn't reload again, and the moment just fails quietly, as it does offline, where
// nothing reloads at all (a reload would only show the browser's offline page).

import { reloadOnce } from '../reload';

const moments = {
  power: () => import('./power'), // Task 15: turn it off and on again
  cable: () => import('../world/cable'), // the homelab's cables, power cords and strips
  sound: () => import('./sound'), // Task 17: the sound engine, once sound is switched on
  plane: () => import('./plane'), // Task 17: the plane goes to work
  secrets: () => import('./secrets'), // Task 17: the secrets found this visit (power.ts imports it too)
  receipt: () => import('./receipt'), // the trip and its receipt (Task 16)
  duck: () => import('./duck'), // Task 17, secret 4: the rubber duck, behind a stray signal
  lamp: () => import('./lamp'), // Task 17, secret 6: the colophon lamp's cord, the theme switch's twin
  zoom: () => import('../input/zoom'), // the overview's zoom and pan (the owner's test notes), as the arrival ends in the overview, else on the first wheel, pinch, press or + -
} satisfies Record<string, () => Promise<unknown>>;

export type MomentName = keyof typeof moments;
export type Moment<N extends MomentName> = Awaited<ReturnType<(typeof moments)[N]>>;

let open = (): void => undefined;
const opened = new Promise<void>((resolve) => (open = resolve));
const cache = new Map<MomentName, Promise<unknown>>();

/** After the arrival's end, past whatever it set off (the status ripple, a deep link's flight). */
function whenIdle(cb: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(cb, { timeout: 500 });
  else setTimeout(cb, 0);
}

/** Lets the moments load from the first idle moment after `arrived`. Called once, by map.ts. */
export function openMoments(arrived: Promise<unknown>): void {
  void arrived.then(() => whenIdle(open));
}

/** The moment's module, imported once. A failed fetch isn't kept, so the next ask retries. */
export function loadMoment<N extends MomentName>(name: N): Promise<Moment<N>> {
  let mod = cache.get(name);
  if (!mod) {
    mod = opened.then((): Promise<unknown> => moments[name]()).catch((err: unknown) => {
      cache.delete(name);
      if (navigator.onLine !== false) reloadOnce('map:reloaded', import.meta.url);
      throw err;
    });
    cache.set(name, mod);
  }
  return mod as Promise<Moment<N>>;
}
