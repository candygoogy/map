// The header's sound toggle (Task 17, approved 2026-10-20): a 44×44 speaker button named "Sound",
// aria-pressed. Off by default; the choice is kept in localStorage.sound ("on", or nothing). Its
// markup is prerendered (src/fallback/html.ts) and styles.css shows it only in 3D (the plain page
// has no sounds). It runs from main.ts, beside the theme switch, and imports nothing: main stays
// one chunk.
//
// - It owns the AudioContext, made in a gesture as browsers require: the toggle's own click, or,
//   with sound kept on from an earlier visit, the visitor's first press or key on the page.
//   Nothing makes one while sound is off, and nothing audio is fetched.
// - The context runs only while sound is on and the tab is visible: off or hidden, it's
//   suspended, so nothing plays and nothing piles up for later.
// - window.soundContext and the `soundchange` event on document are how the runtime hears of it
//   (src/sound-cue.ts): it loads the engine, a lazy moment (src/moments/sound.ts), the first time
//   sound is on with a context to play into.

declare global {
  interface Window {
    /** The page's one AudioContext, once sound has been switched on in a gesture. */
    soundContext?: AudioContext;
  }
}

const KEY = 'sound';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Only "on" is on. */
export const parseSound = (value: unknown): boolean => value === 'on';

export function loadSound(storage: Store | undefined): boolean {
  try {
    return parseSound(storage?.getItem(KEY));
  } catch {
    return false;
  }
}

export function saveSound(storage: Store | undefined, on: boolean): void {
  try {
    if (on) storage?.setItem(KEY, 'on');
    else storage?.removeItem(KEY);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

function store(): Store | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** Runs every button[data-sound] on the page. */
export function initSoundToggle(doc: Document = document): void {
  const buttons = doc.querySelectorAll<HTMLButtonElement>('button[data-sound]');
  if (buttons.length === 0) return;
  const root = doc.documentElement;
  let on = loadSound(store());

  const live = (): boolean => on && doc.visibilityState === 'visible';
  // In a gesture: the context is made (or woken) here, where the browser lets it start.
  const wake = (): void => {
    if (!live() || typeof AudioContext !== 'function') return;
    const ctx = window.soundContext;
    if (ctx) {
      // Suspended, or Safari's `interrupted` (a call, another app's audio, the tab put away on
      // an iPhone), which only a gesture brings back. Never a closed one.
      if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume();
      return;
    }
    window.soundContext = new AudioContext();
    doc.dispatchEvent(new Event('soundchange'));
  };
  const sync = (): void => {
    root.dataset.sound = on ? 'on' : 'off';
    for (const b of buttons) b.setAttribute('aria-pressed', String(on));
    const ctx = window.soundContext;
    if (ctx) void (live() ? ctx.resume() : ctx.suspend());
    doc.dispatchEvent(new Event('soundchange'));
  };

  for (const b of buttons) {
    b.addEventListener('click', () => {
      on = !on;
      saveSound(store(), on);
      sync();
      wake();
    });
  }
  for (const type of ['pointerdown', 'pointerup', 'keydown']) doc.addEventListener(type, wake, true);
  doc.addEventListener('visibilitychange', sync);
  sync();
}
