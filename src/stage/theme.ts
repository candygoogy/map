// The theme's colours, read from the CSS custom properties in src/styles.css (Global
// Constraints → Theme), so the page and the scene share one source. Each comes back as a
// THREE.Color in the linear working space: Three.js decodes the token's sRGB hex on the way
// in and encodes it again on output, so a token renders as exactly its hex wherever nothing
// shades it. onThemeChange follows the OS switching scheme while the page is open, and the
// header's theme switch (src/theme-switch.ts), which only sets html[data-theme].

import { Color } from 'three';

export interface Theme {
  bg: Color;
  ink: Color;
  soft: Color;
  edge: Color;
  faint: Color;
  /** A switched-off link (the power switch): a step quieter than --faint, toward the floor. */
  ghost: Color;
  acc: Color;
  model: Color;
  detail: Color;
  paper: Color;
  /** An unlit light (the `lamp` role): dark in both themes, so a lit one (--paper) reads. */
  lamp: Color;
  /** What the bake's dark end and the contact shadows lean toward (shading.ts). */
  shadow: Color;
}

export type ThemeToken = keyof Theme;

export const THEME_TOKENS: readonly ThemeToken[] = [
  'bg',
  'ink',
  'soft',
  'edge',
  'faint',
  'ghost',
  'acc',
  'model',
  'detail',
  'paper',
  'lamp',
  'shadow',
];

/** The tokens as they compute on `el` (default: the root element), in the current scheme. */
export function readTheme(el: Element = document.documentElement): Theme {
  const style = getComputedStyle(el);
  const theme = {} as Theme;
  for (const token of THEME_TOKENS) {
    const value = style.getPropertyValue(`--${token}`).trim();
    // #rgb too: the production build's minifier shortens #000000 to #000.
    if (!/^#(?:[0-9a-f]{3}){1,2}$/i.test(value)) {
      throw new Error(`theme: --${token} should be a #rrggbb or #rgb colour, got "${value}"`);
    }
    theme[token] = new Color(value);
  }
  return theme;
}

/**
 * Calls `cb` with the re-read tokens of `el` whenever the OS switches between light and dark,
 * or the theme switch sets or clears html[data-theme], without a reload (Review Focus 5).
 * Returns an unsubscribe. A no-op outside a browser.
 */
export function onThemeChange(cb: (t: Theme) => void, el?: Element): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: dark)');
  const changed = () => cb(readTheme(el));
  query.addEventListener('change', changed);
  // A microtask after the attribute changes: inside the theme switch's View Transition update
  // callback, so the scene has its new colours before the new state is captured.
  const chosen = typeof MutationObserver === 'function' ? new MutationObserver(changed) : null;
  chosen?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    query.removeEventListener('change', changed);
    chosen?.disconnect();
  };
}
