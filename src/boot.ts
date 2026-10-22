// Runs first in <head>, synchronously, before the first paint: an external
// classic script (no import or export), since the CSP allows no inline
// script. Kept to plain JS (tests/unit/theme-switch.test.ts runs this source
// as it is). boot.js is src/theme-boot.ts (the saved theme, before the paint)
// and then this:
// - html.js: the theme switch shows only with JS (styles.css), and appears
//   with the first paint, so nothing shifts when src/theme-switch.ts runs.
// - When WebGL2 is there, it swaps html.no-3d for has-3d, so the full
//   station list never flashes up and then collapses into the canvas.
//   map.ts puts no-3d back if the stage fails or the context is lost.
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return;
    // The test context isn't needed again: hand it back now.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    root.classList.remove('no-3d');
    root.classList.add('has-3d');
  } catch {
    // No WebGL2: the HTML page stays.
  }
})();
