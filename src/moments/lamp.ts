// The colophon lamp (Task 17, secret 6, approved 2026-10-20: "the lamp secret later", once the
// theme switch existed). At colophon, pull the desk lamp's chain (its `poke_lamp`): the whole map
// switches between light and dark; pull again to switch back. A lazy moment: map.ts loads it on the
// first pull.
//
// The pull goes through the header's theme switch itself (src/theme-switch.ts): it presses the
// pill's option for the other look, so it's the same path as a click there. The pill slides and
// shows the new state, the new theme drops in like a blind (cut under reduced motion), and the
// choice is kept in localStorage.theme, as the pill's would be (a call made while building: the
// pull sets the explicit choice, so the pill stays truthful; Auto is one click away on it).

import { found } from './secrets';

export type Look = 'light' | 'dark';

/** The look the page shows now, by the pill's choice (ahead of html[data-theme] while it slides). */
export function lookNow(choice: string | undefined, osDark: boolean): Look {
  return choice === 'light' || choice === 'dark' ? choice : osDark ? 'dark' : 'light';
}

/** Pulls the cord: the theme switch turns to the other look, and the secret is found. Returns
 *  the look switched to, or null where the page has no theme switch. */
export function pull(doc: Document = document): Look | null {
  const group = doc.querySelector<HTMLElement>('[data-theme-switch]');
  const choice = group?.dataset.current ?? doc.documentElement.dataset.theme;
  const to: Look = lookNow(choice, matchMedia('(prefers-color-scheme: dark)').matches) === 'dark' ? 'light' : 'dark';
  const option = group?.querySelector<HTMLButtonElement>(`button[data-value="${to}"]`);
  if (!option) return null;
  option.click();
  found('lamp');
  return to;
}
