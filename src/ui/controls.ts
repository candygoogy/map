// Travel controls: the station counter and ‹ › buttons, and the keys.
// They exist only in 3D: map.ts adds them under html.has-3d, and dispose() takes them out
// again when the page drops back to the plain version, which has no travel.
//
// - ‹ › are real buttons, 44 px square, named from copy. Their glyphs are aria-hidden.
// - The counter reads copy.stationCounter ("{n} of {total}") at a station. The copy has no
//   words for the overview or the receipt, so there it's empty; its slot keeps its width,
//   so the buttons never move. It's a polite live region, so travel is announced.
// - Keys: ← → for previous and next, Escape for the overview, `[` `]` turn the map (map
//   rotation; held, they repeat), and `+` `-` (with `=`, the + key unshifted, and the keypad's)
//   zoom the overview (elsewhere they're left alone). By the character typed
//   (e.key) first: a zoom character always zooms, never turns, wherever it sits (Italian, German
//   and Spanish type `+` on the key right of P). Only another character on the two keys right of
//   P (e.code BracketLeft, BracketRight; a layout with no bare brackets, or a dead key there)
//   turns by the key, as `[` `]` would on a US layout. Not while focus is in a
//   text field, and never with Ctrl, Alt or Meta (the browser's own shortcuts, its zoom too).
//   Those character keys are the map's only while it has focus (WCAG 2.1.4, "active only on
//   focus"; the audit's item 2): the page itself, the stations' nav (labels, ‹ ›), or a heading
//   travel focused. On a control of the header or the panel (a link, a button) they're its.
// - A skip link after ‹ ›, seen only while focused, takes focus past the 17 labels to the shown
//   pane's heading (a station's, or the welcome's in the overview), so a station's links are a
//   Tab away (the audit's item 3). Its click never reaches the hash (that would travel). Where
//   the shown pane has no heading (the phone's peek), styles.css drops it.
// - A label (Task 10's <button class="label" data-go="<id>">) travels on click. Being a
//   native button, Enter and Space already click it, so that's the keyboard path too, with
//   nothing to double up. Space does nothing else here: boosting is Shift (Task 11).
//   A click or tap leaves the label unfocused: Chrome makes a focused button :focus-visible
//   at the next key, so holding Shift to boost would ring a label the pointer chose.

import { runtimeCopy as copy } from '../copy-runtime';
import type { Stations } from '../nav/stations';

export interface Controls {
  readonly element: HTMLElement;
  dispose(): void;
}

/** The counter's words for this station, or '' where there's no station number (overview, receipt). */
export function counterText(stations: Pick<Stations, 'ids' | 'current'>): string {
  const i = stations.current === null ? -1 : stations.ids.indexOf(stations.current);
  if (i < 0) return '';
  return copy.stationCounter.text.replace('{n}', String(i + 1)).replace('{total}', String(stations.ids.length));
}

/** Focus is somewhere keys type into, so arrows and Escape belong to it. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches('input, textarea, select');
}

/** A control of its own, outside the stations' nav: a character key is its, not the map's. */
function elsewhere(target: EventTarget | null, nav: Element): boolean {
  if (!(target instanceof Element) || nav.contains(target)) return false;
  return target.matches('a[href], button, input, select, textarea, summary, [contenteditable], [tabindex]:not([tabindex="-1"])');
}

function stepButton(doc: Document, label: string, glyph: string, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  const mark = doc.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = glyph;
  button.append(mark);
  button.addEventListener('click', onClick);
  return button;
}

/** Builds the controls after `after` (the header, so they come early in the tab order). */
export function createControls(
  stations: Stations,
  after: Element,
  turn?: (steps: number) => void,
  /** `+` (1) or `-` (−1); false where the map doesn't zoom (the key is left alone). */
  zoom?: (dir: 1 | -1) => boolean,
): Controls {
  const doc = after.ownerDocument;
  const element = doc.createElement('div');
  element.className = 'travel';

  const count = doc.createElement('p');
  count.className = 'count';
  count.setAttribute('aria-live', 'polite');
  count.setAttribute('aria-atomic', 'true');

  element.append(
    count,
    stepButton(doc, copy.prevStation.text, '‹', () => stations.prev()),
    stepButton(doc, copy.nextStation.text, '›', () => stations.next()),
  );
  const skip = doc.createElement('a');
  skip.href = '#stations';
  skip.className = 'skip';
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    doc.querySelector<HTMLElement>('#stations > section:not(.sr-only) h2')?.focus({ preventScroll: true });
  });
  element.append(skip);
  after.after(element);

  const sync = (): void => {
    count.textContent = counterText(stations);
    skip.textContent = (stations.current === null ? copy.skipToWelcome : copy.skipToStation).text;
  };
  sync();
  const off = stations.subscribe(sync);

  function onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
    if (e.key === 'ArrowLeft') stations.prev();
    else if (e.key === 'ArrowRight') stations.next();
    else if (e.key === 'Escape' && stations.current !== null) stations.overview();
    else if (elsewhere(e.target, element.parentElement ?? element)) return;
    else if (/^[-+=_]$/.test(e.key)) {
      // A zoom character never turns, whatever key typed it (Italian, German and Spanish have
      // `+` on the key right of P, BracketRight), and outside the overview it's left alone.
      if (!zoom?.(e.key === '+' || e.key === '=' ? 1 : -1)) return;
    } else if (!turn) return;
    else if (e.key === '[' || e.key === ']') turn(e.key === '[' ? -1 : 1);
    else if (e.code === 'BracketLeft' || e.code === 'BracketRight') turn(e.code === 'BracketLeft' ? -1 : 1);
    else return;
    e.preventDefault();
  }

  function onClick(e: MouseEvent): void {
    const label = e.target instanceof Element ? e.target.closest<HTMLElement>('button.label[data-go]') : null;
    if (!label?.dataset.go) return;
    if (e.detail) label.blur(); // a pointer's click; Enter and Space give 0
    stations.go(label.dataset.go);
  }

  doc.addEventListener('keydown', onKey);
  doc.addEventListener('click', onClick);

  return {
    element,
    dispose() {
      off();
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('click', onClick);
      element.remove();
    },
  };
}
