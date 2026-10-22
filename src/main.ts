// The map's entry, a module script (deferred, so the prerendered HTML paints first), kept to a
// few lines so it runs at once. boot.ts has already chosen: html.no-3d keeps the plain page,
// and nothing more is fetched; html.has-3d imports the map's runtime (src/map.ts, its own
// chunk) once the first paint is on screen, so the HTML heading paints without waiting on it
// (the LCP is the HTML heading, never held up by WebGL). The runtime is still part
// of the first load (tests/unit/budget.test.ts counts it inside the 210 kB): it's fetched
// automatically, just after the paint rather than before it.
//
// "On screen" is the first-contentful-paint entry, which the browser reports once that frame
// is presented: a frame callback alone comes before the paint, and on a busy GPU the frame
// can reach the screen several frames later, so the fetch would still start ahead of it.
// Where paint timing isn't reported, a task after the first frame callback stands in. A tab
// opened in the background starts when it's first shown. If the runtime can't be fetched, the
// page drops back to no-3d: the stations become the readable page again.
//
// The header's theme switch runs from here, not from the runtime, so the plain page has it too.
// It's bundled into this chunk (the budget test allows main 4 kB; owner, 2026-10-21), and so is
// the sound toggle (Task 17), whose engine is a lazy moment the runtime loads once it's on.

import { initSoundToggle } from './sound-toggle';
import { initThemeSwitch } from './theme-switch';

export type { MapDebug } from './map';

initThemeSwitch();
initSoundToggle();

const root = document.documentElement;

function load(): void {
  if (!root.classList.contains('has-3d')) return;
  import('./map').then(
    (map) => map.start(),
    (err: unknown) => {
      root.classList.remove('has-3d');
      root.classList.add('no-3d');
      console.error(err); // for whoever opens the console; the page itself just stays plain
    },
  );
}

/** Runs `cb` in a task once the first contentful paint is on screen (or 1 s after the first frame). */
function afterFirstPaint(cb: () => void): void {
  let observer: PerformanceObserver | undefined;
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    observer?.disconnect();
    setTimeout(cb);
  };
  if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('paint')) {
    observer = new PerformanceObserver((list) => {
      if (list.getEntriesByName('first-contentful-paint').length > 0) go();
    });
    observer.observe({ type: 'paint', buffered: true });
  }
  setTimeout(go, observer ? 1000 : 0);
}

requestAnimationFrame(() => afterFirstPaint(load));
