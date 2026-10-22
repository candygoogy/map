import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannels, CUES, LEVEL_DB, PITCH, vary } from '../../src/moments/sound';
import { SOUNDS, TRIM_DB } from '../../src/moments/sound-synth';
import { OUT, STAY } from '../../src/moments/plane';
import { initSoundToggle, loadSound, parseSound, saveSound } from '../../src/sound-toggle';
import { ROOT } from './helpers/blender';

// Task 17's sound (approved by the owner 2026-10-20): off by default, kept in localStorage.sound, a
// little pitch and level variation per play, at most one sound per node at a time, and each sound
// tied to a clip its model really has. Every sound is made in code (the owner, 2026-10-21);
// tests/e2e/sound.spec.ts renders each one offline.

/** The cues of the moments themselves (the power moment's, the plane's trip), not a model's clip. */
const MOMENTS = ['power', 'plane'];

/** A Storage stand-in: a Map, or one that throws on every call (storage blocked). */
function storage(initial: Record<string, string> = {}, blocked = false) {
  const items = new Map(Object.entries(initial));
  const guard = () => {
    if (blocked) throw new DOMException('blocked', 'SecurityError');
  };
  return {
    items,
    getItem: (k: string) => (guard(), items.get(k) ?? null),
    setItem: (k: string, v: string) => void (guard(), items.set(k, v)),
    removeItem: (k: string) => void (guard(), items.delete(k)),
  };
}

describe('the store', () => {
  it('is off unless localStorage.sound is "on"', () => {
    expect(parseSound('on')).toBe(true);
    for (const v of [null, undefined, '', 'off', 'On', 'true', 1, true]) expect(parseSound(v)).toBe(false);
    expect(loadSound(storage())).toBe(false);
    expect(loadSound(storage({ sound: 'on' }))).toBe(true);
    expect(loadSound(undefined)).toBe(false);
  });

  it('keeps "on" under localStorage.sound; off removes it', () => {
    const s = storage();
    saveSound(s, true);
    expect(s.items.get('sound')).toBe('on');
    saveSound(s, false);
    expect(s.items.has('sound')).toBe(false);
  });

  it('blocked storage reads as off and saving does nothing', () => {
    const s = storage({ sound: 'on' }, true);
    expect(loadSound(s)).toBe(false);
    expect(() => saveSound(s, true)).not.toThrow();
  });
});

describe('the context', () => {
  afterEach(() => void vi.unstubAllGlobals());

  /** Sound kept on from an earlier visit, a page with one toggle, and its listeners to fire. */
  function page() {
    const on = new Map<string, ((e?: unknown) => void)[]>();
    const listen = (type: string, f: (e?: unknown) => void) => void on.set(type, [...(on.get(type) ?? []), f]);
    const resumed: string[] = [];
    vi.stubGlobal('localStorage', storage({ sound: 'on' }));
    vi.stubGlobal('window', {});
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        resume() {
          resumed.push(this.state);
          return Promise.resolve();
        }
        suspend() {
          return Promise.resolve();
        }
      },
    );
    const doc = {
      documentElement: { dataset: {} as DOMStringMap },
      visibilityState: 'visible',
      querySelectorAll: () => [{ setAttribute() {}, addEventListener: listen }],
      addEventListener: listen,
      dispatchEvent: () => true,
    };
    initSoundToggle(doc as unknown as Document);
    const fire = (type: string) => on.get(type)!.forEach((f) => f());
    const ctx = () => (window as { soundContext?: { state: string } }).soundContext!;
    return { fire, ctx, resumed };
  }

  it('is made in the first gesture, and woken in the next one from suspended or (Safari) interrupted, never from closed', () => {
    const { fire, ctx, resumed } = page();
    fire('pointerdown');
    expect(ctx().state).toBe('running');
    resumed.length = 0;
    for (const state of ['suspended', 'interrupted', 'running', 'closed']) {
      ctx().state = state;
      fire('pointerup');
    }
    // An iPhone interrupts it (a call, another app's audio, the tab put away): only a gesture brings it back.
    expect(resumed).toEqual(['suspended', 'interrupted']);
  });
});

describe('variation', () => {
  it('stays within ±PITCH of the rate and ±LEVEL_DB of the level, small enough to stay the same sound', () => {
    expect(PITCH).toBeGreaterThan(0);
    expect(PITCH).toBeLessThanOrEqual(0.06); // under a semitone
    expect(LEVEL_DB).toBeGreaterThan(0);
    expect(LEVEL_DB).toBeLessThanOrEqual(2);
    const db = (g: number) => 20 * Math.log10(g);
    for (const r of [0, 1e-9, 0.25, 0.5, 0.75, 1 - 1e-9]) {
      const v = vary(() => r);
      expect(Math.abs(v.rate - 1)).toBeLessThanOrEqual(PITCH + 1e-12);
      expect(Math.abs(db(v.gain))).toBeLessThanOrEqual(LEVEL_DB + 1e-9);
    }
    expect(vary(() => 0.5)).toEqual({ rate: 1, gain: 1 });
  });

  it('varies from play to play', () => {
    const plays = Array.from({ length: 20 }, () => vary());
    expect(new Set(plays.map((p) => p.rate)).size).toBeGreaterThan(1);
    expect(new Set(plays.map((p) => p.gain)).size).toBeGreaterThan(1);
  });
});

describe('one sound per node', () => {
  const voice = () => {
    const v = { stopped: 0, stop: () => void (v.stopped += 1) };
    return v;
  };

  it('a new sound on a node stops the one still playing there, and leaves other nodes alone', () => {
    const ch = createChannels();
    const a = voice();
    const b = voice();
    const c = voice();
    ch.start('notary', a);
    ch.start('fettle', c);
    ch.start('notary', b);
    expect(a.stopped).toBe(1);
    expect(b.stopped).toBe(0);
    expect(c.stopped).toBe(0);
    expect(ch.playing('notary')).toBe(b);
    expect(ch.playing('fettle')).toBe(c);
  });

  it('a voice that ends frees its node, but not one that has been replaced', () => {
    const ch = createChannels();
    const a = voice();
    const b = voice();
    ch.start('notary', a);
    ch.start('notary', b);
    ch.end('notary', a); // a's late end doesn't free b's node
    expect(ch.playing('notary')).toBe(b);
    ch.end('notary', b);
    expect(ch.playing('notary')).toBeNull();
  });

  it('stopAll stops every node', () => {
    const ch = createChannels();
    const a = voice();
    const b = voice();
    ch.start('notary', a);
    ch.start('fettle', b);
    ch.stopAll();
    expect([a.stopped, b.stopped]).toEqual([1, 1]);
    expect(ch.playing('notary')).toBeNull();
  });
});

/** Each clip's length in seconds, from a GLB's JSON chunk (the samplers' input maxima). */
function clips(id: string): Map<string, number> {
  const b = readFileSync(join(ROOT, 'public', 'models', `${id}.glb`));
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()) as {
    animations?: { name: string; samplers: { input: number }[] }[];
    accessors: { max?: number[] }[];
  };
  return new Map(
    (json.animations ?? []).map((a) => [a.name, Math.max(...a.samplers.map((s) => json.accessors[s.input]!.max?.[0] ?? 0))]),
  );
}

describe('the cues', () => {
  it('fire only on clips the models have, within each clip, with sounds that exist', () => {
    const ids = new Set(Object.keys(SOUNDS));
    for (const [key, hits] of Object.entries(CUES)) {
      const [node, clip] = key.split(' ') as [string, string];
      expect(hits.length, key).toBeGreaterThan(0);
      for (const h of hits) expect(ids.has(h.sound), `${key}: ${h.sound}`).toBe(true);
      if (MOMENTS.includes(node)) continue; // the moments' own cues, not a clip's
      const length = clips(node).get(clip);
      expect(length, `${node}.glb has a clip "${clip}"`).toBeDefined();
      for (const h of hits) {
        expect(h.at, `${key} at ${h.at}`).toBeGreaterThanOrEqual(0);
        expect(h.at, `${key} at ${h.at}`).toBeLessThanOrEqual(length!);
        // A sound that lasts as long as its action ends with it, within its clip.
        if (h.length !== undefined) expect(h.at + h.length, `${key}: ${h.sound} ends`).toBeLessThanOrEqual(length! + 1e-9);
      }
    }
  });

  it('play every sound there is, each with its trim, and never louder than the sound itself', () => {
    const used = new Set(Object.values(CUES).flatMap((hits) => hits.map((h) => h.sound)));
    expect([...used].sort()).toEqual(Object.keys(SOUNDS).sort());
    expect(Object.keys(TRIM_DB).sort()).toEqual(Object.keys(SOUNDS).sort());
    for (const [key, hits] of Object.entries(CUES)) for (const h of hits) expect(h.gain ?? 0, `${key}: ${h.sound}`).toBeLessThanOrEqual(0);
  });

  it('are the approved list’s sounds, and nothing for traffic, the camera’s flights or hover', () => {
    expect(Object.keys(CUES).sort()).toEqual(
      [
        'candygoogy-bot arrive', // the paper plane's launch, its loop and its touchdown
        'candygoogy-bot poke', // its barrel roll
        'candygoogy-bot poke_stand', // the launcher's kick
        'colophon poke', // the book's riffle
        'colophon poke_lamp', // the lamp's chain (secret 6)
        'desktop poke', // the homelab cluster's fans
        'eolietech arrive', // the postcard against the rack
        'eolietech poke',
        'exit poke', // three knocks and the latch
        'experiments poke_keyboard', // the key press (no poke in the cluster presses a key)
        'fettle arrive',
        'fettle poke',
        'fettle tear', // Task 16's receipt torn off
        'fettle trip',
        'idiff poke', // the trays' slide
        'idiff poke_card', // the card's flick
        'idiff poke_card_tidy',
        'notary poke',
        'notary poke_refuse',
        'origin off',
        'origin on',
        'origin poke_power',
        'plane home', // secret 3's flight (moments/plane.ts)
        'plane lid',
        'plane out',
        'power post',
        'power reset', // the RCD's reset, as Siel Eolie plays `on` (its `poke_test_tidy` never plays)
        'siel-eolie poke',
        'siel-eolie poke_test',
        'switch poke_cable', // the cable unplugged, and plugged back in
        'switch poke_cable_tidy',
        'visitor dock',
      ].sort(),
    );
    // No node's `off` or `on` but the origin's: one hum for the whole network, not 16 clicks.
    expect(Object.keys(CUES).filter((k) => / (off|on)$/.test(k))).toEqual(['origin off', 'origin on']);
  });

  it('time the plane’s trip to moments/plane.ts: a whoosh out within OUT, and off the lid after STAY', () => {
    const [out] = CUES['plane out']!;
    expect(out!.sound).toBe('whoosh');
    expect(out!.at + out!.length!).toBeLessThanOrEqual(OUT);
    const again = CUES['plane lid']!.find((h) => h.sound === 'whoosh')!;
    expect(again.at).toBeCloseTo(STAY, 6);
  });

  it('are each listed in sounds/SOURCES.md as made, with where it fires', () => {
    const doc = readFileSync(join(ROOT, 'sounds', 'SOURCES.md'), 'utf8');
    for (const id of Object.keys(SOUNDS)) expect(doc, id).toMatch(new RegExp(`^\\| \`${id}\` \\| made \\|`, 'm'));
    expect(doc).not.toMatch(/stand-in|Not yet/i);
  });

  it('time the RCD’s reset to Siel Eolie’s `on`, the clip the reset plays', () => {
    const on = clips('siel-eolie').get('on')!;
    expect(on).toBeGreaterThan(0);
    const hits = CUES['power reset']!;
    expect(hits).toHaveLength(7); // the reset's clunk and the six breakers back up
    for (const h of hits) expect(h.at).toBeLessThanOrEqual(on);
  });
});
