// The sounds, all made in code (Task 17; the owner, 2026-10-21: nothing is recorded, every sound is
// made). Each is a few Web Audio nodes scheduled at a time, so none is downloaded. Plain Web Audio,
// not three's audio classes (moments.test.ts).
//
// What they're made of, each shaped on how the real thing sounds (sounds/SOURCES.md):
// - a burst: noise through a filter, struck (a contact, a scrape's grit, the air of a slap);
// - a tone: a short oscillator, swept (a thud's falling pitch, a beep);
// - modes: a few sines struck together, each ringing down on its own (a wooden door, a plastic
//   stop, a steel wire): a small modal resonator;
// - grains: many tiny noise clicks in one buffer, placed through a span (paper's crackle, a tear's
//   teeth, a bead chain);
// - a sweep: noise through a filter whose frequency and level move (air past a paper plane, a
//   tray's friction, fans).
//
// Every recipe draws into `out` from time `t`, its pitch scaled by `rate` (the play's variation),
// and returns its sources, so a voice can be cut short. Their levels: TRIM_DB, below.

type Ctx = BaseAudioContext;
type Sources = AudioScheduledSourceNode[];
export type Recipe = (ctx: Ctx, out: AudioNode, t: number, rate: number, length?: number) => Sources;

const noises = new WeakMap<Ctx, AudioBuffer>();

/** Two seconds of white noise per context, the same every time (a fixed seed). */
function noise(ctx: Ctx): AudioBuffer {
  let buffer = noises.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x2545f491;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 2 ** 31 - 1;
    }
    noises.set(ctx, buffer);
  }
  return buffer;
}

/** A different stretch of the noise for each start time. */
const offset = (t: number): number => (t * 7.31) % 0.2;

/** A gain that rises over `attack`, then falls by 60 dB over `decay`: a struck thing. */
function strike(ctx: Ctx, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay / 6.9);
  g.connect(out);
  return g;
}

interface Burst {
  type: BiquadFilterType;
  f: number;
  q?: number;
  peak: number;
  attack?: number;
  decay: number;
}

/** Noise through a filter, struck. */
function burst(ctx: Ctx, out: AudioNode, t: number, rate: number, b: Burst): AudioScheduledSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = b.type;
  filter.frequency.value = b.f * rate;
  filter.Q.value = b.q ?? 0.7;
  src.connect(filter).connect(strike(ctx, out, t, b.peak, b.attack ?? 0.001, b.decay));
  src.start(t, offset(t), (b.attack ?? 0.001) + b.decay + 0.02);
  return src;
}

interface Tone {
  wave: OscillatorType;
  f0: number;
  f1?: number;
  peak: number;
  attack?: number;
  decay: number;
}

/** An oscillator swept from f0 to f1 over its decay, struck. */
function tone(ctx: Ctx, out: AudioNode, t: number, rate: number, o: Tone): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  osc.type = o.wave;
  osc.frequency.setValueAtTime(o.f0 * rate, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1 * rate, t + o.decay);
  osc.connect(strike(ctx, out, t, o.peak, o.attack ?? 0.002, o.decay));
  osc.start(t);
  osc.stop(t + (o.attack ?? 0.002) + o.decay + 0.02);
  return osc;
}

/** [Hz, seconds to die away by 60 dB, peak]. */
type Mode = readonly [f: number, decay: number, peak: number];

/** Sines struck together, each ringing down on its own: a small modal resonator. */
function modes(ctx: Ctx, out: AudioNode, t: number, rate: number, list: readonly Mode[]): Sources {
  return list.map(([f, decay, peak]) => tone(ctx, out, t, rate, { wave: 'sine', f0: f, peak, attack: 0.0006, decay }));
}

interface Grains {
  /** How many clicks, over `length` seconds. */
  count: number;
  length: number;
  /** Each click's length, in seconds (it varies by ±40%). */
  grain: number;
  type?: BiquadFilterType;
  f: number;
  q?: number;
  peak: number;
  /** Each click's level by where it falls, u in 0..1 through the span. */
  shape?: (u: number) => number;
  /** Where the clicks fall: u through the span, bunched by this (1: evenly, 2: toward the start). */
  bunch?: number;
  /** How far each click strays from its even place, as a share of the gap (1: anywhere in it). */
  jitter?: number;
  /** A lowpass over it all, Hz: a click's highs tamed, so it's crisp but never hisses. */
  top?: number;
}

/** Tiny noise clicks in one buffer, filtered: crackle, grit, teeth. Seeded from `t`. */
function grains(ctx: Ctx, out: AudioNode, t: number, rate: number, g: Grains): AudioScheduledSourceNode {
  const sr = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.ceil((g.length + g.grain * 3) * sr), sr);
  const data = buffer.getChannelData(0);
  let seed = (Math.imul(Math.floor(t * 9973), 0x9e3779b1) + g.count) >>> 0;
  const rand = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < g.count; i++) {
    const u = Math.min(1, Math.max(0, (i + 0.5 + (rand() - 0.5) * (g.jitter ?? 1)) / g.count)) ** (g.bunch ?? 1);
    const level = (g.shape?.(u) ?? 1) * (0.55 + 0.45 * rand());
    const n = Math.max(8, g.grain * (0.6 + 0.8 * rand()) * sr);
    const at = Math.floor(u * g.length * sr);
    for (let k = 0; k < n && at + k < data.length; k++) data[at + k]! += level * (rand() * 2 - 1) * Math.exp((-5 * k) / n);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const filter = ctx.createBiquadFilter();
  filter.type = g.type ?? 'bandpass';
  filter.frequency.value = g.f * rate;
  filter.Q.value = g.q ?? 0.7;
  const top = ctx.createBiquadFilter();
  top.type = 'lowpass';
  top.frequency.value = (g.top ?? 7000) * rate;
  const level = ctx.createGain();
  level.gain.value = g.peak;
  src.connect(filter).connect(top).connect(level).connect(out);
  src.start(t);
  return src;
}

/** [seconds from the start, value]. */
type Points = readonly (readonly [at: number, v: number])[];

/** An AudioParam through points from t, linearly, each value times `scale`. */
function path(p: AudioParam, t: number, points: Points, scale = 1): void {
  p.setValueAtTime(points[0]![1] * scale, t);
  for (const [at, v] of points.slice(1)) p.linearRampToValueAtTime(v * scale, t + at);
}

interface Sweep {
  type: BiquadFilterType;
  q?: number;
  /** The filter's frequency, Hz. */
  f: Points;
  /** The level; it ends where its last point does. */
  g: Points;
}

/** Noise through a filter (two in a row, for steep sides) that moves as its level does: air, friction. */
function sweep(ctx: Ctx, out: AudioNode, t: number, rate: number, s: Sweep): AudioScheduledSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  let into: AudioNode = src;
  for (let i = 0; i < 2; i++) {
    const filter = ctx.createBiquadFilter();
    filter.type = s.type;
    filter.Q.value = s.q ?? 0.7;
    path(filter.frequency, t, s.f, rate);
    into = into.connect(filter);
  }
  const env = ctx.createGain();
  path(env.gain, t, s.g);
  into.connect(env).connect(out);
  src.start(t, offset(t));
  src.stop(t + s.g[s.g.length - 1]![0] + 0.02);
  return src;
}

/** The low hum of a room full of powered things: mains at 50 Hz and its harmonics, lowpassed. */
function hum(ctx: Ctx, out: AudioNode, t: number, rate: number, up: boolean): Sources {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  const env = ctx.createGain();
  lp.connect(env).connect(out);
  const g = env.gain;
  const peak = 0.32;
  const end = up ? 2.6 : 1.5;
  if (up) {
    // Back in as the reboot starts, and away again under the reboot's own sounds.
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + 0.7);
    g.setValueAtTime(peak, t + 1.1);
    g.linearRampToValueAtTime(0, t + end);
  } else {
    // The power goes: the hum sags in pitch and dies away.
    g.setValueAtTime(peak, t);
    g.linearRampToValueAtTime(peak * 0.9, t + 0.15);
    g.exponentialRampToValueAtTime(0.001, t + end);
    g.linearRampToValueAtTime(0, t + end + 0.02);
  }
  const sources: Sources = [];
  for (const [wave, f, level] of [
    ['sawtooth', 50, 0.5],
    ['sine', 100, 0.8],
    ['sine', 150, 0.25],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = wave;
    const from = f * rate * (up ? 0.85 : 1);
    const to = f * rate * (up ? 1 : 0.8);
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.linearRampToValueAtTime(to, t + (up ? 0.7 : end));
    const lv = ctx.createGain();
    lv.gain.value = level;
    osc.connect(lv).connect(lp);
    osc.start(t);
    osc.stop(t + end + 0.05);
    sources.push(osc);
  }
  return sources;
}

/** An oscillator whose frequency follows `f` and whose level follows `g`, into `out`. */
function drone(ctx: Ctx, out: AudioNode, t: number, rate: number, wave: OscillatorType, f: Points, g: Points): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  osc.type = wave;
  path(osc.frequency, t, f, rate);
  const env = ctx.createGain();
  path(env.gain, t, g);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + g[g.length - 1]![0] + 0.02);
  return osc;
}

/** Every sound, by name. */
export const SOUNDS = {
  /** The power switch's cover: a hard plastic lid hitting its stop. */
  clack: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'bandpass', f: 2600, q: 2.2, peak: 1, decay: 0.045 }),
    burst(ctx, out, t, r, { type: 'bandpass', f: 900, q: 1.4, peak: 0.55, decay: 0.03 }),
    tone(ctx, out, t, r, { wave: 'sine', f0: 1750, f1: 1500, peak: 0.25, decay: 0.02 }),
  ],
  /** The toggle snapping over its spring: sharp and bright. */
  snap: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'highpass', f: 3800, peak: 1, decay: 0.014 }),
    tone(ctx, out, t, r, { wave: 'triangle', f0: 2500, f1: 1800, peak: 0.45, decay: 0.022 }),
    burst(ctx, out, t + 0.004, r, { type: 'bandpass', f: 1300, q: 3, peak: 0.4, decay: 0.035 }),
  ],
  /** A relay pulling in or dropping out: a low clunk with a click on top. */
  relay: (ctx, out, t, r) => [
    tone(ctx, out, t, r, { wave: 'sine', f0: 150, f1: 55, peak: 1, decay: 0.14 }),
    burst(ctx, out, t, r, { type: 'lowpass', f: 900, peak: 0.6, decay: 0.06 }),
    burst(ctx, out, t, r, { type: 'bandpass', f: 3200, q: 2, peak: 0.3, decay: 0.01 }),
  ],
  /** The network's hum dying away as the power goes. */
  humDown: (ctx, out, t, r) => hum(ctx, out, t, r, false),
  /** And coming back for the reboot. */
  humUp: (ctx, out, t, r) => hum(ctx, out, t, r, true),
  /** One short POST beep: all's well. A PC speaker's square wave, softened. */
  beep: (ctx, out, t, r) => {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.16, t + 0.004);
    env.gain.setValueAtTime(0.16, t + 0.13);
    env.gain.linearRampToValueAtTime(0, t + 0.145);
    lp.connect(env).connect(out);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 988 * r;
    osc.connect(lp);
    osc.start(t);
    osc.stop(t + 0.16);
    return [osc];
  },
  /** The gondola's grip closing on its dock: a small metal clunk. */
  dock: (ctx, out, t, r) => [
    tone(ctx, out, t, r, { wave: 'sine', f0: 230, f1: 175, peak: 0.9, decay: 0.16 }),
    tone(ctx, out, t, r, { wave: 'sine', f0: 610, f1: 590, peak: 0.28, decay: 0.12 }),
    tone(ctx, out, t, r, { wave: 'sine', f0: 1470, peak: 0.1, decay: 0.08 }),
    burst(ctx, out, t, r, { type: 'bandpass', f: 1500, q: 2.5, peak: 0.6, decay: 0.03 }),
  ],
  /**
   * The notary's rubber stamp on paper over a felt pad: a dull, short thud (the felt swallows the
   * ring and the highs), the paper's slap under it, a hint of the wooden handle, and the rubber
   * peeling off the inked page a beat later (the clip's press is held 11-14, peeled 14-20).
   */
  stamp: (ctx, out, t, r) => [
    tone(ctx, out, t, r, { wave: 'sine', f0: 112, f1: 66, peak: 1, attack: 0.0025, decay: 0.075 }),
    burst(ctx, out, t, r, { type: 'lowpass', f: 620, q: 0.6, peak: 0.75, attack: 0.0015, decay: 0.045 }),
    burst(ctx, out, t, r, { type: 'bandpass', f: 1500, q: 0.9, peak: 0.24, decay: 0.018 }),
    ...modes(ctx, out, t, r, [
      [420, 0.05, 0.12],
      [1010, 0.03, 0.05],
    ]),
    grains(ctx, out, t + 0.17, r, { count: 7, length: 0.045, grain: 0.0012, f: 2300, q: 1.1, peak: 0.16, bunch: 1.6 }),
  ],
  /** A dry little knock, a knuckle on wood (the notary's head shake, Siel Eolie's lockout jolting). */
  tap: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'bandpass', f: 1800, q: 1.2, peak: 0.6, decay: 0.012 }),
    ...modes(ctx, out, t, r, [
      [540, 0.045, 0.7],
      [1230, 0.028, 0.35],
      [2150, 0.016, 0.18],
    ]),
  ],
  /** A soft thump: something set down, or landing. */
  thump: (ctx, out, t, r) => [
    tone(ctx, out, t, r, { wave: 'sine', f0: 125, f1: 68, peak: 1, attack: 0.004, decay: 0.09 }),
    burst(ctx, out, t, r, { type: 'lowpass', f: 420, peak: 0.6, attack: 0.003, decay: 0.05 }),
    burst(ctx, out, t, r, { type: 'bandpass', f: 1100, q: 1, peak: 0.12, attack: 0.002, decay: 0.02 }),
  ],
  /**
   * A DIN-rail breaker's toggle switched: its spring mechanism lets go with a tiny bright click,
   * and 7 ms later the handle hits its stop, a hard plastic clack, with the rail and the panel
   * behind it giving a short low knock.
   */
  breaker: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'highpass', f: 3500, peak: 0.5, decay: 0.004 }),
    burst(ctx, out, t + 0.007, r, { type: 'bandpass', f: 2100, q: 1.8, peak: 1, decay: 0.02 }),
    ...modes(ctx, out, t + 0.007, r, [
      [1650, 0.03, 0.3],
      [2900, 0.02, 0.18],
      [4300, 0.012, 0.08],
      [240, 0.05, 0.35],
      [520, 0.035, 0.18],
    ]),
  ],
  /**
   * The RCD tripping on its test button: a stronger spring than a breaker's, so a sharper crack,
   * its latch ringing, a heavier two-module body thunk, the handle slamming down 12 ms later, and
   * the panel's door rattling on its hinges with the bang (the clip knocks it, 3-7).
   */
  rcd: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'highpass', f: 2500, peak: 0.9, decay: 0.006 }),
    burst(ctx, out, t, r, { type: 'bandpass', f: 1200, q: 1, peak: 0.8, decay: 0.03 }),
    tone(ctx, out, t, r, { wave: 'sine', f0: 150, f1: 92, peak: 0.9, attack: 0.001, decay: 0.11 }),
    ...modes(ctx, out, t + 0.004, r, [
      [1350, 0.05, 0.32],
      [2450, 0.035, 0.22],
      [3900, 0.02, 0.1],
      [310, 0.07, 0.3],
    ]),
    burst(ctx, out, t + 0.012, r, { type: 'bandpass', f: 2000, q: 2, peak: 0.55, decay: 0.02 }),
    grains(ctx, out, t + 0.06, r, { count: 5, length: 0.07, grain: 0.002, f: 1500, q: 2, peak: 0.5, shape: (u) => 1 - 0.7 * u }),
  ],
  /** A small button's click (Fettle's feed key, the RCD's test button, the lamp's chain switch). */
  click: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'bandpass', f: 3600, q: 3, peak: 1, decay: 0.006 }),
    ...modes(ctx, out, t, r, [
      [2900, 0.01, 0.25],
      [5200, 0.006, 0.08],
    ]),
    burst(ctx, out, t + 0.006, r, { type: 'bandpass', f: 2400, q: 2, peak: 0.35, decay: 0.005 }),
  ],
  /**
   * A thermal receipt printer feeding, for `length` seconds: its stepper's buzz at the step rate
   * (it spins up in 20 ms and slows a little before it stops), the gear train's rumble chopping
   * it, the paper hissing through, and the motor's tick at the start and at the stop.
   */
  feed: (ctx, out, t, r, length = 0.125) => {
    const L = Math.max(length, 0.04);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900 * r;
    bp.Q.value = 1.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    const env = ctx.createGain();
    path(env.gain, t, [
      [0, 0],
      [0.006, 0.5],
      [L, 0.45],
      [L + 0.015, 0],
    ]);
    // The gear train: the buzz chopped at 55 a second, not quite to silence.
    const chop = ctx.createGain();
    chop.gain.value = 0.75;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 55 * r;
    const depth = ctx.createGain();
    depth.gain.value = 0.25;
    lfo.connect(depth).connect(chop.gain);
    bp.connect(lp).connect(chop).connect(env).connect(out);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    path(
      osc.frequency,
      t,
      [
        [0, 380],
        [0.02, 640],
        [Math.max(0.02, L - 0.015), 640],
        [L + 0.015, 540],
      ],
      r,
    );
    osc.connect(bp);
    const end = t + L + 0.03;
    for (const s of [osc, lfo]) {
      s.start(t);
      s.stop(end);
    }
    return [
      osc,
      lfo,
      sweep(ctx, out, t, r, {
        type: 'highpass',
        f: [[0, 3200]],
        g: [
          [0, 0],
          [0.01, 0.07],
          [L, 0.06],
          [L + 0.015, 0],
        ],
      }),
      burst(ctx, out, t, r, { type: 'bandpass', f: 2600, q: 2, peak: 0.25, decay: 0.006 }),
      burst(ctx, out, t + L, r, { type: 'bandpass', f: 2300, q: 2, peak: 0.2, decay: 0.006 }),
    ];
  },
  /**
   * A stacking tray sliding on its runners for `length` seconds and stopping: plastic friction,
   * loudest as it starts and dropping in pitch as it slows (the clip eases out), with the grit of
   * stick-slip in it, and a small knock as it reaches its stop.
   */
  slide: (ctx, out, t, r, length = 4 / 24) => {
    const L = Math.max(length, 0.06);
    return [
      sweep(ctx, out, t, r, {
        type: 'bandpass',
        q: 0.9,
        f: [
          [0, 2400],
          [L, 1400],
        ],
        g: [
          [0, 0],
          [0.008, 0.5],
          [L * 0.6, 0.3],
          [L, 0.06],
          [L + 0.01, 0],
        ],
      }),
      grains(ctx, out, t, r, { count: Math.round(L * 220), length: L, grain: 0.0015, f: 3000, q: 1.5, peak: 0.6, shape: (u) => 1 - 0.7 * u }),
      ...modes(ctx, out, t + L, r, [
        [880, 0.035, 0.35],
        [2050, 0.02, 0.2],
      ]),
      burst(ctx, out, t + L, r, { type: 'bandpass', f: 1500, q: 1.5, peak: 0.3, decay: 0.012 }),
    ];
  },
  /** A card flicked off its bundle: the edge's snap, the card's flex, the air as it flips. */
  flick: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'bandpass', f: 3400, q: 0.9, peak: 0.8, decay: 0.01 }),
    burst(ctx, out, t, r, { type: 'bandpass', f: 900, q: 1.2, peak: 0.5, decay: 0.025 }),
    sweep(ctx, out, t, r, {
      type: 'bandpass',
      q: 1,
      f: [
        [0, 1800],
        [0.09, 3200],
      ],
      g: [
        [0, 0],
        [0.012, 0.14],
        [0.09, 0],
      ],
    }),
  ],
  /** A card or a sheet landing flat: a soft, airy pat, and a little skid. */
  pat: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'bandpass', f: 650, q: 0.9, peak: 0.8, attack: 0.002, decay: 0.03 }),
    burst(ctx, out, t, r, { type: 'bandpass', f: 2600, q: 1, peak: 0.2, decay: 0.012 }),
    grains(ctx, out, t + 0.01, r, { count: 8, length: 0.08, grain: 0.0015, f: 3200, q: 1, peak: 0.25, shape: (u) => 1 - u }),
  ],
  /**
   * A paper plane through the air for `length` seconds: a soft breath of band-passed noise that
   * rises in pitch and level as it comes past and falls away, its body a lower rush under it.
   */
  whoosh: (ctx, out, t, r, length = 0.55) => {
    const L = Math.max(length, 0.15);
    const swell: Points = [
      [0, 0],
      [L * 0.45, 1],
      [L, 0],
    ];
    const at = (k: number): Points => swell.map(([a, v]) => [a, v * k] as const);
    return [
      sweep(ctx, out, t, r, {
        type: 'bandpass',
        q: 2,
        f: [
          [0, 600],
          [L * 0.45, 2000],
          [L, 800],
        ],
        g: at(0.8),
      }),
      sweep(ctx, out, t, r, {
        type: 'bandpass',
        q: 0.8,
        f: [
          [0, 350],
          [L * 0.45, 800],
          [L, 400],
        ],
        g: at(0.25),
      }),
    ];
  },
  /**
   * A postcard knocking against a wire rack: the card's dull tick, its edge's brighter one, and
   * the thin steel wire ringing faintly after.
   */
  postcard: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'bandpass', f: 1200, q: 1, peak: 0.6, decay: 0.02 }),
    burst(ctx, out, t, r, { type: 'highpass', f: 4000, peak: 0.35, decay: 0.004 }),
    ...modes(ctx, out, t, r, [
      [2350, 0.09, 0.1],
      [3720, 0.07, 0.07],
      [5480, 0.05, 0.05],
    ]),
  ],
  /**
   * The desktop's fans spun up hard and back to idle over `length` seconds: the air's rush
   * opening up as they speed, their blade-pass tone rising with it, and both easing back down.
   * (The map is silent at idle, so it fades out as they settle.)
   */
  fans: (ctx, out, t, r, length = 30 / 24) => {
    const L = Math.max(length, 0.5);
    const up = Math.min(0.21, L * 0.2);
    const hold = L * 0.6;
    const level: Points = [
      [0, 0],
      [up, 1],
      [hold, 1],
      [L, 0.25],
      [L + 0.2, 0],
    ];
    const scale = (k: number): Points => level.map(([a, v]) => [a, v * k] as const);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(out);
    return [
      sweep(ctx, out, t, r, {
        type: 'bandpass',
        q: 0.6,
        f: [
          [0, 500],
          [up, 1400],
          [hold, 1500],
          [L, 600],
        ],
        g: scale(0.5),
      }),
      sweep(ctx, out, t, r, { type: 'lowpass', q: 0.5, f: [[0, 180]], g: scale(0.3) }),
      drone(
        ctx,
        lp,
        t,
        r,
        'triangle',
        [
          [0, 90],
          [up, 330],
          [hold, 340],
          [L, 140],
        ],
        scale(0.12),
      ),
      drone(
        ctx,
        lp,
        t,
        r,
        'sine',
        [
          [0, 180],
          [up, 660],
          [hold, 680],
          [L, 280],
        ],
        scale(0.04),
      ),
    ];
  },
  /** An RJ45 plug's latch clicking free of its port (or home into it), its contacts scraping. */
  plug: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'bandpass', f: 3200, q: 2.5, peak: 0.9, decay: 0.007 }),
    ...modes(ctx, out, t, r, [
      [2600, 0.02, 0.25],
      [4400, 0.012, 0.12],
      [700, 0.03, 0.2],
    ]),
    grains(ctx, out, t + 0.012, r, { count: 6, length: 0.03, grain: 0.0012, f: 4500, q: 1.5, peak: 0.45 }),
  ],
  /** A mechanical keycap bottoming out: a plastic clack, the case's thud, a faint spring ping. */
  key: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'bandpass', f: 2200, q: 1.5, peak: 0.7, decay: 0.012 }),
    ...modes(ctx, out, t, r, [
      [1450, 0.025, 0.4],
      [2700, 0.018, 0.2],
      [260, 0.04, 0.3],
      [5200, 0.06, 0.03],
    ]),
  ],
  /** One leaf of a book riffling: a quick flutter of paper crackle, and the air it moves. */
  riffle: (ctx, out, t, r) => [
    grains(ctx, out, t, r, {
      count: 28,
      length: 0.22,
      grain: 0.0018,
      f: 2600,
      q: 0.8,
      peak: 0.6,
      shape: (u) => Math.sin(Math.PI * u) ** 0.7,
    }),
    sweep(ctx, out, t, r, {
      type: 'bandpass',
      q: 1,
      f: [
        [0, 1200],
        [0.1, 2600],
        [0.25, 1500],
      ],
      g: [
        [0, 0],
        [0.08, 0.18],
        [0.25, 0],
      ],
    }),
  ],
  /** A ball chain springing back up and swinging: its beads ticking, many at first, then fewer. */
  chain: (ctx, out, t, r) => [
    grains(ctx, out, t, r, {
      count: 14,
      length: 0.3,
      grain: 0.0009,
      f: 5200,
      q: 3,
      peak: 1,
      bunch: 1.6,
      shape: (u) => (1 - u) ** 1.5,
    }),
  ],
  /**
   * A knuckle on a wooden door, heard from the other side: the panel's low modes ringing briefly,
   * and the knuckle's contact with the highs taken off by the door.
   */
  knock: (ctx, out, t, r) => [
    ...modes(ctx, out, t, r, [
      [105, 0.12, 0.6],
      [182, 0.09, 0.45],
      [265, 0.07, 0.3],
      [410, 0.05, 0.18],
      [690, 0.03, 0.08],
    ]),
    burst(ctx, out, t, r, { type: 'lowpass', f: 1400, peak: 0.6, attack: 0.001, decay: 0.02 }),
  ],
  /** A door's latch bolt: a soft metal click, its ring, the lock's body, and the bolt seating. */
  latch: (ctx, out, t, r) => [
    burst(ctx, out, t, r, { type: 'highpass', f: 3000, peak: 0.5, decay: 0.004 }),
    ...modes(ctx, out, t, r, [
      [2750, 0.035, 0.3],
      [4620, 0.025, 0.18],
      [6950, 0.015, 0.08],
      [880, 0.03, 0.25],
    ]),
    burst(ctx, out, t + 0.013, r, { type: 'bandpass', f: 3500, q: 2, peak: 0.35, decay: 0.006 }),
  ],
  /**
   * Fettle's receipt torn off on its serrated bar: a quick run of ticks, a tooth at a time,
   * louder toward the end, over the paper's rasp, and the snap as it comes away.
   */
  tear: (ctx, out, t, r) => [
    grains(ctx, out, t, r, {
      count: 22,
      length: 0.11,
      grain: 0.0014,
      f: 2600,
      q: 0.7,
      peak: 0.8,
      jitter: 0.5,
      top: 6000,
      shape: (u) => 0.5 + 0.5 * u,
    }),
    sweep(ctx, out, t, r, {
      type: 'bandpass',
      q: 0.8,
      f: [
        [0, 1800],
        [0.11, 3400],
      ],
      g: [
        [0, 0],
        [0.02, 0.15],
        [0.1, 0.3],
        [0.115, 0],
      ],
    }),
    burst(ctx, out, t + 0.11, r, { type: 'bandpass', f: 3000, q: 0.8, peak: 0.6, decay: 0.008 }),
  ],
} satisfies Record<string, Recipe>;

export type SoundId = keyof typeof SOUNDS;

/**
 * Each sound's trim in dB, at the engine's master level (measured offline by
 * tests/e2e/sound.spec.ts). The approved "about −18 LUFS" is the ceiling: the hum, the longest,
 * sits at it (momentary, 400 ms), the beep just under. A click can't be measured that way (a
 * 10 ms tick at −18 LUFS momentary would peak past full scale), so the short ones are set by
 * their peaks instead, about −6 dBFS, which puts them at −25 to −33 LUFS momentary: they're
 * heard as the same loudness as the hum, not louder. The fans, long and soft, sit well under the
 * hum.
 */
export const TRIM_DB: Record<SoundId, number> = {
  clack: 7.5,
  snap: -1,
  relay: 1,
  humDown: 0,
  humUp: 0,
  beep: 8,
  dock: 0.5,
  stamp: 2,
  tap: -2,
  thump: 1,
  breaker: 0.5,
  rcd: -3,
  click: 8,
  // feed was 4.5: up to −0.7 dBFS at some start times, before the ±1.5 dB variation.
  feed: 2.5,
  slide: 5,
  flick: 8.5,
  pat: 13,
  whoosh: 4,
  // postcard was 8: up to −0.6 dBFS, so the variation could clip it.
  postcard: 5,
  fans: -1,
  plug: 4,
  key: 0.5,
  riffle: 11,
  chain: 12,
  knock: -4,
  latch: 0,
  tear: 8,
};

/** Makes sound `id` into `out` at `t`, at its trimmed level. */
export function make(ctx: Ctx, out: AudioNode, id: SoundId, t: number, rate = 1, length?: number): Sources {
  const trim = ctx.createGain();
  trim.gain.value = 10 ** (TRIM_DB[id] / 20);
  trim.connect(out);
  return SOUNDS[id](ctx, trim, t, rate, length);
}
