// Written by scripts/sound-sprite.mjs: the recorded sounds, one Opus file of them all
// (public/sounds/), and where each one sits in it, in seconds. A sound listed here plays from
// the recording; any other is made in code (sound-synth.ts). Nothing is recorded (the owner,
// 2026-10-21: every sound is made; sounds/SOURCES.md), so nothing is fetched.

import type { SoundId } from './sound-synth';

export interface Sprite {
  /** The file, under the site's root. */
  url: string;
  /** Each recorded sound's start and length in it, in seconds. */
  cues: Partial<Record<SoundId, readonly [start: number, length: number]>>;
}

export const SPRITE: Sprite | null = null;
