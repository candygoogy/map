// The theme switch's saved choice, put on before the first paint: localStorage.theme ("light" or
// "dark"; none is Auto) goes on html[data-theme] and the color-scheme meta, so a chosen theme
// never flashes in the OS's first. Blocked storage or anything else: Auto, which CSS follows.
// A classic script (no import or export), kept to plain JS (tests/unit/theme-switch.test.ts runs
// this source as it is). vite-plugin-prerender.ts ships it twice: at the head of boot.js on the
// map's page, and alone as assets/theme-<hash>.js on the 404, which has no other script. Both
// are external files from 'self', so the CSP (public/_headers) needs no hash.
(() => {
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
    }
  } catch {
    // Storage blocked: Auto.
  }
})();
