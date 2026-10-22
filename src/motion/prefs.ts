// The visitor's motion preference, read live from the OS. The clock goes on-demand under it,
// and later tasks drop the arrival, traffic, idle loops and drift. Outside a browser (vitest's
// node environment) there's no matchMedia, and `reduced` stays false.

const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

let reduced = query?.matches ?? false;
const listeners = new Set<() => void>();

query?.addEventListener('change', (e) => {
  reduced = e.matches;
  for (const cb of [...listeners]) cb();
});

export const prefs = {
  /** True while the OS asks for reduced motion. Follows a change without a reload. */
  get reduced(): boolean {
    return reduced;
  },
};

/** Calls `cb` after the preference changes (read `prefs` for the new value). Returns an unsubscribe. */
export function onPrefsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
