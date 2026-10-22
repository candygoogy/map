// Where the runtime's clips meet the sound engine (Task 17). cue(node, clip) is called as a clip
// starts (nodes.ts, the gondola's `dock`, the power moment's end); it does nothing until the
// engine is in. bindSound (map.ts, once) loads the engine, a lazy moment, the first time sound is
// on with an AudioContext to play into (src/sound-toggle.ts makes it, in a gesture), so a visitor
// who never switches sound on never fetches it.

import type { SoundEngine } from './moments/sound';

let engine: SoundEngine | null = null;

/** Clip `clip` has started on `node` (or the gondola, `visitor`): its sounds, if sound is on. */
export function cue(node: string, clip: string): void {
  engine?.cue(node, clip);
}

/** Loads the engine through `load` once sound is on with a context; returns an unbind. */
export function bindSound(load: () => Promise<{ createSound(ctx: AudioContext): SoundEngine }>): () => void {
  let loading = false;
  const sync = (): void => {
    const ctx = window.soundContext;
    if (engine || loading || !ctx || document.documentElement.dataset.sound !== 'on') return;
    loading = true;
    load().then(
      (m) => void (engine = m.createSound(ctx)),
      (err: unknown) => ((loading = false), console.error(err)),
    );
  };
  document.addEventListener('soundchange', sync);
  sync();
  return () => {
    document.removeEventListener('soundchange', sync);
    engine?.dispose();
    engine = null;
  };
}
