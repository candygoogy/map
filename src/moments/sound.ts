// The sound engine (Task 17, approved 2026-10-20):
// a lazy moment (moments/load.ts), loaded the first time sound is switched on (src/sound-cue.ts),
// never before. Plain Web Audio into the header toggle's AudioContext (src/sound-toggle.ts).
//
// - A sound plays when a clip starts that has one: the runtime calls cue(node, clip) from the
//   clips themselves (nodes.ts, the gondola's `dock`), the power moment's end (`power post`) and
//   the plane's trip (moments/plane.ts: `plane out`, `plane lid`, `plane home`), and CUES below says what sounds at which second of the clip. So a sound lands on the frame
//   its model does it: the stamp's contact at frame 11, a breaker as its toggle snaps up.
// - Soft and short: about −18 LUFS, with a little pitch (±PITCH) and level (±LEVEL_DB) variation
//   each time, so a repeat doesn't sound machine-made.
// - At most one sound per node at a time: a new cue on a node fades out the one still playing
//   there (a poke mid-poke starts its sound over, as its clip does).
// - Silent unless the context runs: sound off or the tab hidden suspends it (the toggle), what was
//   playing is stopped, and nothing is scheduled then, so nothing bursts out when it comes back.
// - Every sound is made in code (sound-synth.ts; the owner, 2026-10-21: nothing is recorded).
//   The sprite's path for recordings stays (sound-sprite.ts, scripts/sound-sprite.mjs), unused:
//   with no sprite nothing is fetched.
// - Traffic, the camera's flights, hover and labels have no cues: always-on sounds tire fast.

import { make, type SoundId } from './sound-synth';
import { SPRITE } from './sound-sprite';

export interface Hit {
  /** Seconds into the clip. */
  at: number;
  sound: SoundId;
  /** dB against the sound's own level. */
  gain?: number;
  /** For a sound that lasts as long as its action (Fettle's feed), in seconds. */
  length?: number;
}

/** Blender's frames, at 24 fps, as seconds. */
const F = (frame: number): number => frame / 24;

/**
 * What sounds, keyed `<node> <clip>` (the gondola is `visitor`; `power` and `plane` are the
 * moments' own). The frames are the clips' own, from the models' Blender scripts.
 */
export const CUES: Record<string, Hit[]> = {
  // origin.py clip_poke_power: the cover up (open at 4), the toggle snaps down (7), the cover
  // drops back onto it (10, a small bounce to 12).
  'origin poke_power': [
    { at: F(4), sound: 'clack', gain: -4 },
    { at: F(7), sound: 'snap' },
    { at: F(10), sound: 'clack' },
  ],
  // As the origin goes off: the relay drops out, and one hum for the whole network dies away
  // (no sound per node: 16 clicks in 1.3 s would be noise).
  'origin off': [
    { at: 0, sound: 'relay' },
    { at: 0.02, sound: 'humDown' },
  ],
  // The reboot: the relay pulls in and the hum comes back.
  'origin on': [
    { at: 0, sound: 'relay', gain: -5 },
    { at: 0.05, sound: 'humUp' },
  ],
  // moments/power.ts, as the last link is in: one short POST beep.
  'power post': [{ at: 0, sound: 'beep' }],
  // visitor.py clip_dock: the grip brakes to a stop on the line at frame 8.
  'visitor dock': [{ at: F(8), sound: 'dock' }],
  // notary.py clip_poke: the stamp strikes (contact 11), and is set back on its pad (28).
  'notary poke': [
    { at: F(11), sound: 'stamp' },
    { at: F(28), sound: 'thump', gain: -9 },
  ],
  // clip_poke_refuse: the head shake as two dry taps, then the huff onto the pad (29).
  'notary poke_refuse': [
    { at: F(11), sound: 'tap' },
    { at: F(19), sound: 'tap', gain: -3 },
    { at: F(29), sound: 'thump', gain: -6 },
  ],
  // siel-eolie.py clip_poke: a wave along the row, each toggle snapping back up at 2i + 6 (the
  // locked breaker_6, eighth, can't move: its lockout jolts at 14).
  'siel-eolie poke': [
    ...[0, 1, 2, 3, 4, 5, 6, 8].map((i) => ({ at: F(2 * i + 6), sound: 'breaker' as const, gain: i < 2 ? 0 : -2 })),
    { at: F(15), sound: 'tap', gain: -4 },
  ],
  // clip_poke_test: the T button (in at 2), the RCD trips (down at 5), and the breakers it feeds
  // drop a frame apart (7 to 12).
  'siel-eolie poke_test': [
    { at: F(2), sound: 'click', gain: -4 },
    { at: F(5), sound: 'rcd' },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ at: F(7 + i), sound: 'breaker' as const, gain: -7 })),
  ],
  // The RCD's reset (power.ts cues it as Siel Eolie plays `on`; its `on` has no cue of its own, as
  // no node's but the origin's, or every reboot would click). On `on`'s frames (clip_on): the main
  // switch up (at 2), then the breakers left to right, two frames apart (12 to 22).
  'power reset': [
    { at: F(2), sound: 'breaker' },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ at: F(12 + 2 * i), sound: 'breaker' as const, gain: -3 })),
  ],
  // colophon.py clip_poke_lamp: the pull chain's switch clicks at the bottom of the pull (3), and
  // the ball chain rattles as it springs back (4-7) and swings on its socket.
  'colophon poke_lamp': [
    { at: F(3), sound: 'click' },
    { at: F(4), sound: 'chain', gain: -4 },
  ],
  // clip_poke: the top book's back board lifts (0-10), its last three leaves riffle, three frames
  // apart (each lifting from 12, 15, 18), and the board falls shut (44).
  'colophon poke': [
    ...[0, 1, 2].map((k) => ({ at: F(12 + 3 * k), sound: 'riffle' as const, gain: -2 * k })),
    { at: F(44), sound: 'thump', gain: -8 },
  ],
  // idiff.py clip_poke: the trays slide apart, the top one back (0-4) and the bottom one forward a
  // frame later (1-5), each onto its stop; then home (8-14, 9-15).
  'idiff poke': [
    { at: 0, sound: 'slide', length: F(4) },
    { at: F(1), sound: 'slide', gain: -2, length: F(4) },
    { at: F(8), sound: 'slide', gain: -5, length: F(6) },
    { at: F(9), sound: 'slide', gain: -7, length: F(6) },
  ],
  // clip_poke_card: the card rocks back (0-3) and flicks off the bundle (3), and lands on the
  // floor (13) with a small skid.
  'idiff poke_card': [
    { at: F(3), sound: 'flick' },
    { at: F(13), sound: 'pat', gain: -2 },
  ],
  // clip_poke_card_tidy: it hops off the floor (0) and falls back against the bundle (11).
  'idiff poke_card_tidy': [
    { at: 0, sound: 'flick', gain: -5 },
    { at: F(11), sound: 'pat', gain: -3 },
  ],
  // candygoogy-bot.py clip_poke: off the pin (2), the barrel roll (4-17), back onto the pin (19).
  'candygoogy-bot poke': [
    { at: F(4), sound: 'whoosh', length: F(13) },
    { at: F(19), sound: 'tap', gain: -14 },
  ],
  // clip_poke_stand: the launcher cocks on its spring (0-4) and kicks (STAND_KICK, 6).
  'candygoogy-bot poke_stand': [{ at: F(6), sound: 'click', gain: -6 }],
  // clip_arrive: the kick and the launch (6), the loop (6-60), the flare (50-60), the touchdown on
  // the pin (60).
  'candygoogy-bot arrive': [
    { at: F(6), sound: 'click', gain: -6 },
    { at: F(6), sound: 'whoosh', gain: -2, length: F(22) },
    { at: F(36), sound: 'whoosh', gain: -5, length: F(22) },
    { at: F(60), sound: 'tap', gain: -12 },
  ],
  // moments/plane.ts (secret 3): off the launcher and across the map (`plane out`); onto the
  // server's lid (`plane lid`) and off it again STAY (1.4 s) later; home onto its pin (`plane home`).
  'plane out': [{ at: 0, sound: 'whoosh', length: 0.8 }],
  'plane lid': [
    { at: 0, sound: 'pat', gain: -6 },
    { at: 1.4, sound: 'whoosh', gain: -3, length: 0.8 },
  ],
  'plane home': [{ at: 0, sound: 'tap', gain: -12 }],
  // eolietech.py clip_poke: the back card slips out of its pocket's wire (0), and slides back down
  // onto the floor wire (contact 50), rocking once (52).
  'eolietech poke': [
    { at: 0, sound: 'postcard', gain: -9 },
    { at: F(50), sound: 'postcard' },
    { at: F(52), sound: 'postcard', gain: -10 },
  ],
  // clip_arrive: the front card up out of its pocket (0), and back in, onto the floor wire (66),
  // rocking once (68).
  'eolietech arrive': [
    { at: 0, sound: 'postcard', gain: -9 },
    { at: F(66), sound: 'postcard' },
    { at: F(68), sound: 'postcard', gain: -10 },
  ],
  // The homelab cluster. desktop.py clip_poke: the fans spin up hard (0-5) and back to idle
  // (18-30) while the tower hops and lands (10).
  'desktop poke': [
    { at: 0, sound: 'fans', length: F(30) },
    { at: F(10), sound: 'thump', gain: -6 },
  ],
  // switch.py clip_poke_cable: port 3's plug pulls out (0-4, the contacts part at 1), and the cable
  // topples onto the floor (13).
  'switch poke_cable': [
    { at: F(1), sound: 'plug' },
    { at: F(13), sound: 'pat', gain: -8 },
  ],
  // clip_poke_cable_tidy: it stands back up and pushes home (10-14), the latch clicking in.
  'switch poke_cable_tidy': [{ at: F(14), sound: 'plug' }],
  // No poke of the cluster's presses a key (the desktop's, the laptop's and the server's move
  // fans and lids); experiments' keycap does. experiments.py clip_pokes, poke_keyboard: two fast
  // presses, down at 3 and 9.
  'experiments poke_keyboard': [
    { at: F(3), sound: 'key' },
    { at: F(9), sound: 'key', gain: -1 },
  ],
  // exit.py clip_poke: three knocks from behind (3, 8, 13), then the knob turns (22-25), drawing
  // the latch, and springs back (27-30), the latch snapping out again.
  'exit poke': [
    { at: F(3), sound: 'knock' },
    { at: F(8), sound: 'knock', gain: -1 },
    { at: F(13), sound: 'knock' },
    { at: F(23), sound: 'latch', gain: -6 },
    { at: F(30), sound: 'latch' },
  ],
  // fettle.py clip_poke: the feed key (in at 2) and the line it prints (11-14). It no longer
  // hops (the owner's test notes), so there's no landing to thump.
  'fettle poke': [
    { at: F(2), sound: 'click', gain: -6 },
    { at: F(11), sound: 'feed', length: F(3) },
  ],
  // clip_arrive: the back-feed (0-6), then three feeds of a third each (13, 21, 29).
  'fettle arrive': [
    { at: 0, sound: 'feed', gain: -4, length: F(6) },
    { at: F(13), sound: 'feed', length: F(3) },
    { at: F(21), sound: 'feed', length: F(3) },
    { at: F(29), sound: 'feed', length: F(3) },
  ],
  // fettle.py clip_trip (Task 16): the back-feed (0-6), then a line burst every 5 frames from 12,
  // 3 frames each. The runtime stops the clip after the burst that has fed the receipt out, 4 at
  // the least (moments/receipt.ts), so only those 4 sound: a cue can't be cut short.
  'fettle trip': [
    { at: 0, sound: 'feed', gain: -4, length: F(6) },
    ...[0, 1, 2, 3].map((i) => ({ at: F(12 + 5 * i), sound: 'feed' as const, length: F(3) })),
  ],
  // clip_tear (Task 16: the tear-off drag and "Keep the receipt" both play it): the tug (0-3),
  // the paper tearing along the bar to the snap (3), then the fresh stub fed (18-21).
  'fettle tear': [
    { at: F(0.5), sound: 'tear' },
    { at: F(18), sound: 'feed', gain: -3, length: F(3) },
  ],
};

/** The pitch's variation each play, ± a share of its rate (±0.04 is about ±0.7 semitone). */
export const PITCH = 0.04;
/** The level's, ± dB. */
export const LEVEL_DB = 1.5;
/** The whole engine's level. */
export const MASTER = 0.5;
/** How fast a sound cut short by the next one on its node fades out, in seconds. */
const CUT = 0.03;

/** A play's variation: its playback rate and its gain, each spread evenly within its bounds. */
export function vary(rand: () => number = Math.random): { rate: number; gain: number } {
  const spread = (): number => rand() * 2 - 1;
  return { rate: 1 + spread() * PITCH, gain: 10 ** ((spread() * LEVEL_DB) / 20) };
}

export interface Voice {
  stop(): void;
}

/** One voice per channel (a node): starting one stops the one before. */
export function createChannels() {
  const voices = new Map<string, Voice>();
  return {
    start(channel: string, voice: Voice): void {
      voices.get(channel)?.stop();
      voices.set(channel, voice);
    },
    /** A voice has finished: its channel is free, unless another has taken it since. */
    end(channel: string, voice: Voice): void {
      if (voices.get(channel) === voice) voices.delete(channel);
    },
    playing: (channel: string): Voice | null => voices.get(channel) ?? null,
    stopAll(): void {
      for (const v of voices.values()) v.stop();
      voices.clear();
    },
  };
}

export interface SoundEngine {
  /** Clip `clip` has started on `node`: its sounds, if it has any and sound is on. */
  cue(node: string, clip: string): void;
  dispose(): void;
}

declare global {
  interface Window {
    /** Under ?test and in dev: every hit the engine has played, as `<node> <clip> <sound>`. */
    __sound?: { played: string[] };
  }
}

export function createSound(ctx: AudioContext): SoundEngine {
  const master = ctx.createGain();
  master.gain.value = MASTER;
  master.connect(ctx.destination);
  const channels = createChannels();
  const debug =
    import.meta.env.DEV || new URLSearchParams(location.search).has('test') ? (window.__sound ??= { played: [] }) : null;

  // The recordings, if there are any: fetched once, now that sound is on.
  let sprite: AudioBuffer | null = null;
  const url = SPRITE?.url;
  if (url) {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`sound: ${url} ${r.status}`))))
      .then((data) => ctx.decodeAudioData(data))
      .then((b) => void (sprite = b), console.error); // the made sounds play meanwhile, and after a failure
  }

  function play(out: AudioNode, hit: Hit, t: number): AudioScheduledSourceNode[] {
    const { rate, gain } = vary();
    const level = ctx.createGain();
    level.gain.value = gain * 10 ** ((hit.gain ?? 0) / 20);
    level.connect(out);
    const cut = SPRITE?.cues[hit.sound];
    if (sprite && cut) {
      const src = ctx.createBufferSource();
      src.buffer = sprite;
      src.playbackRate.value = rate;
      src.connect(level);
      src.start(t, cut[0], cut[1]);
      return [src];
    }
    return make(ctx, level, hit.sound, t, rate, hit.length);
  }

  function cue(node: string, clip: string): void {
    const hits = CUES[`${node} ${clip}`];
    if (!hits || ctx.state !== 'running' || document.documentElement.dataset.sound !== 'on') return;
    const bus = ctx.createGain();
    bus.connect(master);
    const now = ctx.currentTime + 0.005;
    const sources = hits.flatMap((h) => play(bus, h, now + h.at));
    let done = false;
    const voice: Voice = {
      stop() {
        if (done) return;
        done = true;
        const t = ctx.currentTime;
        bus.gain.setTargetAtTime(0, t, CUT / 4);
        for (const s of sources) {
          try {
            s.stop(t + CUT);
          } catch {
            // not started yet, or already stopped
          }
        }
        setTimeout(() => bus.disconnect(), CUT * 1000 + 50);
      },
    };
    channels.start(node, voice);
    let left = sources.length;
    for (const s of sources) {
      s.addEventListener('ended', () => {
        if (--left > 0 || done) return;
        done = true;
        channels.end(node, voice);
        bus.disconnect();
      });
    }
    debug?.played.push(...hits.map((h) => `${node} ${clip} ${h.sound}`));
  }

  // Switched off or hidden mid-sound: what's playing goes, rather than resuming later.
  const quiet = (): void => {
    if (document.documentElement.dataset.sound !== 'on' || document.hidden) channels.stopAll();
  };
  document.addEventListener('soundchange', quiet);

  return {
    cue,
    dispose() {
      document.removeEventListener('soundchange', quiet);
      channels.stopAll();
      master.disconnect();
    },
  };
}
