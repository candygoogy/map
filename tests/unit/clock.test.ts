import { describe, expect, it } from 'vitest';
import { createClock, createManualTime } from '../../src/stage/clock';

// A stand-in for `document`: just `hidden` and the visibilitychange listeners.
function fakeDoc(hidden = false) {
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (_type: string, cb: () => void) => void listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => void listeners.delete(cb),
  };
  const set = (h: boolean) => {
    doc.hidden = h;
    for (const cb of listeners) cb();
  };
  return { doc: doc as unknown as Document, hide: () => set(true), show: () => set(false) };
}

describe('clock', () => {
  it('clamps dt to 0.1 after a 5 s gap', () => {
    const time = createManualTime();
    const clock = createClock({ ...time, doc: fakeDoc().doc });
    const dts: number[] = [];
    clock.add((dt) => void dts.push(dt));
    time.advance(1 / 60);
    time.advance(5, 5); // one 5 s step: a stalled main thread
    expect(dts).toHaveLength(2);
    expect(dts[0]).toBeCloseTo(1 / 60, 9);
    expect(dts[1]).toBe(0.1);
  });

  it('requests no frames while document.hidden', () => {
    const time = createManualTime();
    const page = fakeDoc(true);
    let requested = 0;
    const raf = (cb: FrameRequestCallback) => (requested++, time.raf(cb));
    const clock = createClock({ ...time, raf, doc: page.doc });
    const dts: number[] = [];
    clock.add((dt) => (dts.push(dt), true));
    clock.invalidate();
    time.advance(1);
    expect(requested).toBe(0);
    expect(clock.frames).toBe(0);

    page.show();
    time.advance(0.5);
    expect(clock.frames).toBe(30);

    // Hidden mid-animation: the pending frame is cancelled and nothing more is asked for.
    page.hide();
    const before = requested;
    time.advance(5);
    expect(requested).toBe(before);
    expect(clock.frames).toBe(30);

    // Back again: it resumes, and the hidden 5 s doesn't land in one step.
    page.show();
    time.advance(1 / 60);
    expect(clock.frames).toBe(31);
    expect(dts.at(-1)).toBeLessThanOrEqual(0.1);
  });

  it('on-demand mode stops after the last animating fn returns false', () => {
    const time = createManualTime();
    const clock = createClock({ ...time, doc: fakeDoc().doc });
    clock.mode = 'on-demand';
    let a = 3;
    let b = 5;
    let still = 0;
    clock.add(() => --a > 0); // animating for 2 frames
    clock.add(() => --b > 0); // animating for 4 frames
    clock.add(() => void still++); // never animating
    time.advance(2);
    expect(clock.frames).toBe(5);
    expect(still).toBe(5);
  });

  it('invalidate renders exactly one frame', () => {
    const time = createManualTime();
    const clock = createClock({ ...time, doc: fakeDoc().doc });
    clock.mode = 'on-demand';
    let calls = 0;
    clock.add(() => void calls++);
    time.advance(1); // adding runs one frame, so the new fn gets a say
    expect(calls).toBe(1);

    clock.invalidate();
    clock.invalidate(); // coalesces with the first
    time.advance(1);
    expect(calls).toBe(2);
    expect(clock.frames).toBe(2);
  });

  it('a late step runs after every tick, even ticks added after it, and keeps nothing going', () => {
    const time = createManualTime();
    const clock = createClock({ ...time, doc: fakeDoc().doc });
    clock.mode = 'on-demand';
    const order: string[] = [];
    const offLate = clock.addLate(() => void order.push('render'));
    time.advance(1); // adding it runs one frame
    expect(order).toEqual(['render']);

    let left = 2;
    clock.add(() => (order.push('tick'), --left > 0));
    order.length = 0;
    time.advance(1);
    expect(order).toEqual(['tick', 'render', 'tick', 'render']);

    offLate();
    order.length = 0;
    clock.invalidate();
    time.advance(1);
    expect(order).toEqual(['tick']);
  });

  it('a manual time source advances only when told to', async () => {
    const time = createManualTime();
    const clock = createClock({ ...time, doc: fakeDoc().doc });
    const ts: number[] = [];
    clock.add((_dt, t) => (ts.push(t), true));
    await new Promise((resolve) => setTimeout(resolve, 50)); // real time passes
    expect(time.now()).toBe(0);
    expect(clock.frames).toBe(0);

    time.advance(0.5);
    expect(time.now()).toBeCloseTo(500, 9);
    expect(clock.frames).toBe(30);
    expect(ts.at(-1)).toBeCloseTo(0.5, 9);
  });
});
