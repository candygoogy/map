// The overview welcome's counter (Version A of the welcome's words): "Found so far ··· 0 of
// a few", prerendered at 0 (src/fallback/html.ts) and kept current here, in the secrets' lazy
// chunk (secrets.ts calls it as each secret is found), so the first load carries none of it.
// Secrets are per visit, in memory, so every load starts at 0 again. Not a live region (the
// draft's call): secrets are found at stations, where the welcome is hidden and the station's
// own announcements play; the count is current whenever the welcome is read.

import { secretsCopy } from '../copy-secrets';

const fill = (text: string, found: number, total: number): string =>
  text.replace('{found}', String(found)).replace('{total}', String(total));

/** Writes `found` of `total` into the welcome's counter, if the page has one. */
export function showFound(found: number, total: number, doc: Document | undefined = globalThis.document): void {
  const value = doc?.querySelector<HTMLElement>('#welcome [data-found]');
  const sr = doc?.querySelector<HTMLElement>('#welcome [data-found-sr]');
  if (!value || !sr) return;
  const all = found >= total;
  value.textContent = fill(all ? secretsCopy.welcomeFoundAll.text : secretsCopy.welcomeFoundCount.text, found, total);
  sr.textContent = fill(all ? secretsCopy.welcomeFoundAllSr.text : secretsCopy.welcomeFoundSr.text, found, total);
}
