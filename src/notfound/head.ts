// The 404's pre-paint script, after src/theme-boot.ts (the saved theme) in the one external
// classic file the 404's head loads first (vite-plugin-prerender.ts; the CSP allows no inline
// script). A classic script (no import or export), kept to plain JS:
// - html.js, as the site's head script sets it: the theme switch shows (styles.css), and the
//   "404" and the route check wait for their entrance (src/notfound.css) from the first paint.
// - The browser's bar follows a chosen theme, not the OS: both theme-color metas take its page
//   colour (--bg), as on the site; src/notfound/main.ts keeps them in step with the switch.
(() => {
  const root = document.documentElement;
  if ('IntersectionObserver' in window) root.classList.add('js');
  const theme = root.dataset.theme;
  if (theme !== 'light' && theme !== 'dark') return;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', theme === 'light' ? '#f4f4f5' : '#121214');
  }
})();
