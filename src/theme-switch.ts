// The header's theme switch: Auto / Light / Dark, ported from candygoogy.dev's
// (src/components/ThemeSwitch.astro) as plain TS (approved 2026-10-20). Its markup is prerendered
// (src/fallback/html.ts) and shown only under html.js; boot.ts has already put a saved choice on
// before the paint. This runs from main.ts, so the plain page (no WebGL, or 3D failed) has it too,
// and it imports nothing: main stays one chunk.
//
// - The choice is html[data-theme] ("light" / "dark"; none is Auto), the color-scheme meta,
//   and localStorage.theme, the main site's key on the map's own origin. Blocked storage: the
//   choice lasts for the page.
// - The 3D scene recolours itself: src/stage/theme.ts watches html[data-theme] and re-reads the
//   tokens, through the path the OS switch already takes (stage.onTheme).
// - The pill slides first; 120 ms later the new theme comes down from the top like a blind, a
//   same-document View Transition (styles.css, html.theme-vt). The last click wins. No blind when
//   the look doesn't change (Auto and the theme it resolves to), under reduced motion, during the
//   arrival (html[data-arrival], set by the director: the wipe's still snapshot would freeze it),
//   or where the browser has no View Transitions: it just switches.
// - Phone header (under 900px, in 3D): one icon button, the pressed option; a tap cycles.
// - Every wipe starts here, the colophon lamp's pull too (src/moments/lamp.ts presses the pill's
//   option), so a skipped one's rejected promises are caught here for both.

export type Choice = 'auto' | 'light' | 'dark';
export type Look = 'light' | 'dark';

const KEY = 'theme';
/** The wipe starts while the pill is still landing (its slide is 220 ms). */
const SLIDE_MS = 120;
const CYCLE: readonly Choice[] = ['auto', 'light', 'dark'];

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A stored or attribute value as a choice: anything but light or dark is Auto. */
export const parseChoice = (value: unknown): Choice => (value === 'light' || value === 'dark' ? value : 'auto');

export function loadChoice(storage: Store | undefined): Choice {
  try {
    return parseChoice(storage?.getItem(KEY));
  } catch {
    return 'auto';
  }
}

export function saveChoice(storage: Store | undefined, choice: Choice): void {
  try {
    if (choice === 'auto') storage?.removeItem(KEY);
    else storage?.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** What the page looks like with `choice` while the OS is (or isn't) dark. */
export const lookOf = (choice: Choice, osDark: boolean): Look => (choice === 'auto' ? (osDark ? 'dark' : 'light') : choice);

/** Whether going from `from` to `to` drops the new theme in like a blind, or just switches. */
export function wantsWipe(
  from: Choice,
  to: Choice,
  env: { osDark: boolean; reduced: boolean; canTransition: boolean; arriving: boolean },
): boolean {
  return env.canTransition && !env.reduced && !env.arriving && lookOf(from, env.osDark) !== lookOf(to, env.osDark);
}

/** Puts `choice` on the page: html[data-theme] and the color-scheme meta (not the storage). */
export function applyChoice(
  root: { dataset: DOMStringMap },
  meta: { setAttribute(name: string, value: string): void } | null,
  choice: Choice,
): void {
  if (choice === 'auto') delete root.dataset.theme;
  else root.dataset.theme = choice;
  meta?.setAttribute('content', choice === 'auto' ? 'light dark' : choice);
}

function storage(): Store | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** Runs every [data-theme-switch] on the page. */
export function initThemeSwitch(doc: Document = document): void {
  const root = doc.documentElement;
  const meta = doc.querySelector('meta[name="color-scheme"]');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const current = (): Choice => parseChoice(root.dataset.theme);
  // Every switch on the page shows a theme put on by any of them.
  const syncs: (() => void)[] = [];

  const choose = (value: Choice): void => {
    applyChoice(root, meta, value);
    saveChoice(storage(), value);
    for (const s of syncs) s();
  };

  for (const group of doc.querySelectorAll<HTMLElement>('[data-theme-switch]')) {
    const buttons = group.querySelectorAll<HTMLButtonElement>('button[data-value]');
    const resolved = group.querySelector<HTMLElement>('[data-resolved]');
    let pending = 0;
    let latest = 0;
    // The wipe running now, if any.
    let active: ViewTransition | null = null;

    const press = (value: Choice): void => {
      group.dataset.current = value;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === value));
    };
    const sync = (): void => {
      press(current());
      if (resolved) resolved.textContent = (dark.matches ? resolved.dataset.dark : resolved.dataset.light) ?? '';
    };

    // Every click counts and the last one wins: a click back before the wipe has started just
    // cancels it, and a change during a wipe ends that one at once (on its new theme) and runs
    // its own.
    group.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-value]');
      if (!button) return;
      let value = parseChoice(button.dataset.value);
      // The phone's header shows only the pressed option (styles.css, header A): a tap on it
      // steps Auto → Light → Dark → Auto, and focus follows to the one now shown.
      const cycling = [...buttons].some((b) => !b.getClientRects().length);
      if (cycling && value === group.dataset.current) value = CYCLE[(CYCLE.indexOf(value) + 1) % 3]!;
      if (value === group.dataset.current) return;

      // 1. The pill (and its clipped labels) slide to the new option.
      press(value);
      if (cycling && doc.activeElement === button) group.querySelector<HTMLElement>(`[data-value="${value}"]`)?.focus();
      clearTimeout(pending);
      const run = ++latest;
      const before = current();
      if (value === before) return;

      const env = {
        osDark: dark.matches,
        reduced: calm.matches,
        canTransition: !!doc.startViewTransition,
        arriving: root.hasAttribute('data-arrival'),
      };
      if (!wantsWipe(before, value, env)) {
        active?.skipTransition();
        choose(value);
        return;
      }

      // 2. Once it lands, the new theme wipes down from the top. The new state is captured with
      //    every CSS transition off, so the snapshot is the final theme, not a frame of a fade.
      pending = window.setTimeout(() => {
        if (run !== latest) return; // a newer click took over
        root.classList.add('theme-vt', 'theme-switching');
        // Starting a wipe ends one still running; a wipe ended before it got to change the
        // theme leaves it to the newer click.
        const vt = doc.startViewTransition(() => {
          if (run === latest) choose(value);
        });
        active = vt;
        // A wipe skipped (a newer one, or a change that needs none: a fast change of mind, a
        // fast lamp pull) rejects `ready`; one whose update failed rejects the other two. Each
        // is handled, never an uncaught page error (the audit's item 13).
        const quiet = (): void => undefined;
        vt.ready.catch(quiet);
        vt.updateCallbackDone.catch(quiet);
        void vt.finished.catch(quiet).then(() => {
          if (active !== vt) return;
          active = null;
          root.classList.remove('theme-vt', 'theme-switching');
        });
      }, SLIDE_MS);
    });

    dark.addEventListener('change', sync);
    syncs.push(sync);
    sync();
    // Nothing slides until it has synced, so the pill's first placement never animates.
    requestAnimationFrame(() => {
      group.dataset.ready = '';
    });
  }

  // A page restored from the back/forward cache comes back with the theme it was left with; one
  // chosen since (in another tab) is put on at once, before it's seen: no wipe, no fades.
  addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    const value = loadChoice(storage());
    if (value === current()) return;
    root.classList.add('theme-switching', 'theme-restore');
    choose(value);
    void root.offsetWidth; // the new state is in place with transitions off
    requestAnimationFrame(() => root.classList.remove('theme-switching', 'theme-restore'));
  });
}
