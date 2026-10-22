// The 404's script (dist/404.html, src/fallback/notfound.ts): the header's theme switch, as on
// the map (src/theme-switch.ts), and the 404's motion, as on candygoogy.dev's 404 and the
// experiments' (experiments/shared/notfound.ts): the reveals (reveal.ts) and the route check
// with its restart (trace.ts). Built by vite-plugin-prerender.ts as an entry of its own, every
// module a copy of its own, so the map's chunks come out as they would without it; only
// 404.html loads it. The pre-paint part (the saved theme, html.js) is head.ts.
import { initThemeSwitch } from '../theme-switch';
import initReveal from './reveal';
import initTrace from './trace';

initThemeSwitch();

// The browser's bar follows the page's theme, as on the site (its ThemeSwitch.astro): a chosen
// one sets both theme-color metas to its --bg; Auto puts back each one's own.
const root = document.documentElement;
const bars = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
const own = bars.map((m) => m.media.includes('dark') ? '#121214' : '#f4f4f5');
new MutationObserver(() => {
  const theme = root.dataset['theme'];
  bars.forEach((m, i) => {
    m.content = theme === 'light' ? '#f4f4f5' : theme === 'dark' ? '#121214' : own[i]!;
  });
}).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

// The motion starts once the page has first painted, as the site's motion loader does (its
// Base.astro and scripts/loader.ts), so the first paint never waits for it and what's on screen
// then is shown settled. The load event often comes before the first paint, so it's only the
// fallback: 1s after it if the paint is never reported (as in a background tab), or at once
// without paint timing.
let started = false;
const start = (): void => {
  if (started) return;
  started = true;
  // The motion setting changed during the visit (either way): the one-time CSS entrance (the
  // "404") is done for good, so turning reduced motion off never plays it again
  // (html.motion-settled).
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
    'change',
    () => root.classList.add('motion-settled'),
    { once: true },
  );
  // iOS Safari only applies :active (the restart's press) when the page listens for touches.
  document.addEventListener('touchstart', () => {}, { passive: true });
  initReveal();
  const trace = document.querySelector<HTMLElement>('[data-trace]');
  if (trace) initTrace(trace);
};
let fallback = 0;
try {
  new PerformanceObserver((list, observer) => {
    if (!list.getEntriesByName('first-contentful-paint').length) return;
    observer.disconnect();
    start();
  }).observe({ type: 'paint', buffered: true });
  fallback = 1000;
} catch {
  // No paint timing: the load event starts it.
}
if (document.readyState === 'complete') setTimeout(start, fallback);
else addEventListener('load', () => setTimeout(start, fallback), { once: true });
