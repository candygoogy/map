// The secrets (Task 17, approved by the owner 2026-10-20 with its recommendations and drafted
// words). Each is found by playing, never pointed at, and recorded here once per visit: its id, its
// name, the receipt's line and when. A lazy module: the moments that find them (power.ts) import
// it, and the runtime asks for it through loadMoment('secrets') when a poke finds one (the key
// under the mat).
//
// Task 16's trip reads it so (a module of the trip, also lazy, imports this one directly, or
// asks loadMoment('secrets')):
//   list()          every secret found so far this visit, in the order found;
//   onFound(fn)     calls fn(secret) as each is found from then on (once each); returns the off;
//   SECRET_IDS      every secret there is (for "1 of a few"; the receipt shouldn't say how many).
// A secret found before the trip's module loads is in list(), so subscribe, then read list().
// Each find also moves the overview welcome's counter (found-count.ts).

import { secretsCopy } from '../copy-secrets';
import { showFound } from './found-count';

export const SECRET_IDS = ['taped-switch', 'test-means-test', 'key-under-mat', 'plane-to-work', 'duck', 'lamp'] as const;
export type SecretId = (typeof SECRET_IDS)[number];

export interface Secret {
  id: SecretId;
  /** Its name, as the owner approved it. */
  name: string;
  /** The receipt's line for it. */
  line: string;
  /** When it was found: ms since the epoch (Date.now()). */
  at: number;
}

const COPY: Record<SecretId, { name: keyof typeof secretsCopy; line: keyof typeof secretsCopy }> = {
  'taped-switch': { name: 'secretTapedName', line: 'secretTapedLine' },
  'test-means-test': { name: 'secretTestName', line: 'secretTestLine' },
  'key-under-mat': { name: 'secretKeyName', line: 'secretKeyLine' },
  'plane-to-work': { name: 'secretPlaneName', line: 'secretPlaneLine' },
  duck: { name: 'secretDuckName', line: 'secretDuckLine' },
  lamp: { name: 'secretLampName', line: 'secretLampLine' },
};

const record: Secret[] = [];
const listeners = new Set<(s: Secret) => void>();

/** Records secret `id` as found: true the first time this visit, false after (nothing happens). */
export function found(id: SecretId): boolean {
  if (record.some((s) => s.id === id)) return false;
  const c = COPY[id];
  const secret: Secret = { id, name: secretsCopy[c.name].text, line: secretsCopy[c.line].text, at: Date.now() };
  record.push(secret);
  showFound(record.length, SECRET_IDS.length); // the overview welcome's counter
  for (const fn of listeners) fn(secret);
  return true;
}

/** Every secret found this visit, in the order found. */
export function list(): readonly Secret[] {
  return record;
}

/** Calls `fn` as each secret is found from now on; returns the unsubscribe. */
export function onFound(fn: (s: Secret) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
