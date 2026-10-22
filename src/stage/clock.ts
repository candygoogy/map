// The one render loop. Everything that moves registers a tick here, and the stage's render is a
// late step (addLate), run after every tick. Two modes:
//   continuous  a frame every display refresh while anything is registered;
//   on-demand   frames only while some tick returned true ("still animating") or after
//               invalidate(). Reduced motion (motion/prefs.ts) selects it, live, so a
//               still map runs no requestAnimationFrame at all.
// A hidden document requests no frames: the pending one is cancelled on visibilitychange
// and the loop resumes when the page shows again.
//
// dt is in seconds and never above tuning.dtMax, so a stall can't jump an animation. When
// the loop wakes from idle or a hidden tab, the first dt counts from the wake, not from the
// last frame. `t` is the sum of those dts: animation time, which a hidden tab doesn't move.

import { onPrefsChange, prefs } from '../motion/prefs';
import { tuning } from '../tuning';

/** Called once per frame. Return true while still animating (it keeps on-demand frames coming). */
export type Tick = (dt: number, t: number) => boolean | void;
export type ClockMode = 'continuous' | 'on-demand';

export interface Clock {
  /** Registers a tick and runs a frame so it gets a say. Returns its removal. */
  add(fn: Tick): () => void;
  /**
   * Registers a step that runs after every tick in each frame, whenever they were added (the
   * stage's render). It runs a frame so it gets a say, but never keeps frames coming itself.
   */
  addLate(fn: (dt: number, t: number) => void): () => void;
  /** Asks for one frame (coalesced: several calls before it runs make one frame). */
  invalidate(): void;
  mode: ClockMode;
  /** Frames actually run. */
  readonly frames: number;
  /** Cancels the pending frame and stops listening for visibility and preference changes. */
  dispose(): void;
}

export interface ClockOptions {
  /** Milliseconds, on the same time base as the rAF timestamps (performance.now in a browser). */
  now?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  doc?: Document;
}

export function createClock(opts: ClockOptions = {}): Clock {
  const now = opts.now ?? (() => performance.now());
  const raf = opts.raf ?? ((cb: FrameRequestCallback) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id: number) => cancelAnimationFrame(id));
  const doc = opts.doc ?? (typeof document === 'undefined' ? undefined : document);

  const ticks = new Set<Tick>();
  const late = new Set<(dt: number, t: number) => void>();
  let mode: ClockMode = prefs.reduced ? 'on-demand' : 'continuous';
  let pending: number | null = null;
  let inFrame = false;
  let wanted = false; // a frame is owed: invalidate(), add(), or a tick still animating
  let last = 0;
  let t = 0;
  let frames = 0;

  const hidden = () => doc?.hidden === true;
  const keepGoing = () => wanted || (mode === 'continuous' && ticks.size > 0);

  // Start the loop from idle. The frame being run requests its own successor instead.
  function wake(): void {
    if (pending !== null || inFrame || hidden()) return;
    last = now();
    pending = raf(frame);
  }

  function frame(ts: number): void {
    pending = null;
    const dt = Math.min(Math.max((ts - last) / 1000, 0), tuning.dtMax);
    last = ts;
    t += dt;
    frames++;
    wanted = false;
    inFrame = true;
    try {
      for (const tick of [...ticks]) if (tick(dt, t) === true) wanted = true;
      for (const step of [...late]) step(dt, t);
    } finally {
      inFrame = false;
    }
    if (keepGoing() && !hidden()) pending = raf(frame);
  }

  function onVisibility(): void {
    if (hidden()) {
      if (pending !== null) {
        caf(pending);
        pending = null;
        wanted = true; // owe the cancelled frame on return
      }
    } else if (keepGoing()) {
      wake();
    }
  }

  doc?.addEventListener('visibilitychange', onVisibility);
  const offPrefs = onPrefsChange(() => {
    clock.mode = prefs.reduced ? 'on-demand' : 'continuous';
  });

  const clock: Clock = {
    add(fn) {
      ticks.add(fn);
      clock.invalidate();
      return () => void ticks.delete(fn);
    },
    addLate(fn) {
      late.add(fn);
      clock.invalidate();
      return () => void late.delete(fn);
    },
    invalidate() {
      wanted = true;
      wake();
    },
    get mode() {
      return mode;
    },
    set mode(m) {
      mode = m;
      if (m === 'continuous' && ticks.size > 0) wake();
    },
    get frames() {
      return frames;
    },
    dispose() {
      if (pending !== null) caf(pending);
      pending = null;
      doc?.removeEventListener('visibilitychange', onVisibility);
      offPrefs();
    },
  };
  return clock;
}

/**
 * A time source that moves only when told to, for `?test` (Phase 1, "Deterministic e2e
 * timing"). Spread it into createClock in place of the real now/raf/caf; then
 * `advance(seconds)` steps time in frames of `step` (1/60 s by default) and runs whatever
 * frame the clock asked for at each step, synchronously. map.ts exposes it as
 * `window.__map.advance`.
 */
export interface ManualTime {
  now(): number;
  raf(cb: FrameRequestCallback): number;
  caf(id: number): void;
  advance(seconds: number, step?: number): void;
}

export function createManualTime(): ManualTime {
  let ms = 0;
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  return {
    now: () => ms,
    raf(cb) {
      queue.set(nextId, cb);
      return nextId++;
    },
    caf(id) {
      queue.delete(id);
    },
    advance(seconds, step = 1 / 60) {
      const end = ms + seconds * 1000;
      while (ms < end - 1e-6) {
        ms = Math.min(ms + step * 1000, end);
        const due = [...queue.values()];
        queue.clear();
        for (const cb of due) cb(ms);
      }
    },
  };
}
