// The panel: the current station's own prerendered section, shown beside the map. Nothing is
// copied or re-rendered: the HTML page is the panel's content, so the words on screen are
// always the feed's.
//
// - Where: #stations becomes the panel. At tuning.panelMinViewportPx and up it's the right
//   column, tuning.panelWidthPx wide; below, a bottom sheet, open (tuning.sheetOpen) at a
//   station and at its peek (tuning.sheetPeek) in the overview. Those are the stage's inset
//   numbers, handed to styles.css as custom properties, so the panel covers exactly the part
//   of the canvas the camera is framed to leave free. The camera director moves the sheet
//   (setSheet), together with the stage's inset: it opens as the camera settles at a station
//   and peeks in the overview and while the camera travels (station to station the stage
//   stays framed for the open sheet). Only the sheet moves: the section shown stays as it is,
//   nothing leaves the accessibility tree and focus isn't moved.
// - What: the current station's section. The others get .sr-only: still read by screen
//   readers, never `hidden`, `inert` or display:none. Their links leave the Tab order while
//   they're off screen (the labels travel to them), and come back when shown.
// - The overview: on the right column it shows the welcome (section#welcome, ahead of the
//   stations: what the map is and what to do on it), prerendered, so its heading is also the
//   Largest Contentful Paint. The origin's own section waits for its station, /#origin. The
//   peek sheet on phones shows no station, only the welcome's short form (.peek-hint,
//   aria-hidden) beside ‹ ›, on their row; the welcome itself is .sr-only there, read first.
//   Welcome, hint and stations are all panes: one shows, the rest are .sr-only, and they
//   swap alike.
// - The swap: the old section fades out over tuning.panelOutMs, then the new one fades in and
//   rises tuning.panelRisePx over tuning.panelInMs, both on tuning.panelEase. With a flight to
//   follow (follow()), the old text stays while the camera travels and the swap starts when the
//   time left is the swap's own, so the new text finishes rising as the camera lands (motion
//   audit #4). A travel mid-swap retargets from where the fade is. None of it under reduced
//   motion, nor for what the page loads into; the counter (controls.ts) still announces the
//   station at once.
// - Focus: after keyboard travel (arrows, Escape, Enter on a label) it moves to the new
//   section's heading, so a screen reader starts reading the station. Not after a click, and
//   not when ‹ › themselves have focus: a keyboard user stepping with them keeps their place,
//   and the counter's live region announces the station. Focus never stays in a section as
//   it's hidden (.sr-only:focus-within would show it over the panel): it goes to the new
//   section's heading, or, to the phone's peek, to the label of the station it was in. The
//   welcome's heading takes focus as a station's does (Escape by keyboard on the column).

import type { FlightInfo } from '../camera/director';
import { prefs } from '../motion/prefs';
import type { Stations } from '../nav/stations';
import { tuning } from '../tuning';
import { clearReach, reachLeaders } from './leaders';

export interface Panel {
  /** The section shown in the panel now: a station's id, 'welcome', or null (the peek sheet). */
  readonly shown: string | null;
  /** Peek or open, on phones (the camera director calls it with stage.setSheet). */
  setSheet(state: 'peek' | 'open'): void;
  /** Times the swap to the camera's flights: it ends as the camera lands. */
  follow(flights: Flights): void;
  /**
   * Takes in what a moment adds (Task 16): a new `section.station[data-node]` becomes a pane
   * (the receipt's), and anything added inside a pane (exit's "Leave") is parked with it while
   * it's off screen.
   */
  add(el: HTMLElement): void;
  /** Gives the page back: every section readable again, as the plain version. */
  dispose(): void;
}

/** What the panel needs of the camera director to time its swap. */
export interface Flights {
  readonly flight: FlightInfo | null;
  onFlight(cb: (f: FlightInfo | null) => void): () => void;
}

const WELCOME = 'welcome';
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function createPanel(stations: Stations, doc: Document = document): Panel {
  const main = doc.getElementById('stations');
  if (!main) throw new Error('panel: the page has no #stations');
  const win = doc.defaultView ?? window;
  const sections = new Map<string, HTMLElement>();
  for (const el of main.querySelectorAll<HTMLElement>('section.station[data-node]')) sections.set(el.dataset.node!, el);
  // The overview's panes (src/fallback/html.ts): the column's welcome and the peek's hint.
  const welcome = main.querySelector<HTMLElement>('section.welcome');
  const hint = main.querySelector<HTMLElement>('.peek-hint');
  const panes = [welcome, hint, ...sections.values()].filter((el): el is HTMLElement => el !== null);

  // The stage's geometry, from tuning, on the root: the travel row (outside the panel) is
  // centred in a short peek. The breakpoint itself is a media query in styles.css.
  const root = doc.documentElement;
  const vars: Record<string, string> = {
    '--panel-w': `${tuning.panelWidthPx}px`,
    '--sheet-h': `${tuning.sheetOpen * 100}%`,
    // --sheet-peek and its shift are styles.css's alone: they follow the orientation.
    '--sheet-ms': `${tuning.sheetSeconds * 1000}ms`,
    '--panel-ease': tuning.panelEase,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  main.dataset.panel = '';

  const side = win.matchMedia(`(min-width: ${tuning.panelMinViewportPx}px)`);

  // Every heading can take focus from code (never from Tab).
  const headings = new Map<HTMLElement, string | null>();
  for (const el of panes) {
    const h = el.querySelector<HTMLElement>('h2');
    if (!h) continue;
    headings.set(h, h.getAttribute('tabindex'));
    h.setAttribute('tabindex', '-1');
  }

  // Links in an off-screen section leave the Tab order; their own tabindex is kept to restore.
  const parked = new Map<HTMLElement, string | null>();
  function park(el: HTMLElement): void {
    for (const f of el.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (parked.has(f)) continue;
      parked.set(f, f.getAttribute('tabindex'));
      f.setAttribute('tabindex', '-1');
    }
  }
  function unpark(el: HTMLElement): void {
    for (const [f, was] of parked) {
      if (!el.contains(f)) continue;
      if (was === null) f.removeAttribute('tabindex');
      else f.setAttribute('tabindex', was);
      parked.delete(f);
    }
  }

  const hide = (el: HTMLElement) => {
    el.classList.add('sr-only');
    park(el);
  };
  const reveal = (el: HTMLElement) => {
    el.classList.remove('sr-only');
    unpark(el);
  };

  /** What the panel shows for a station state. */
  function wanted(id: string | null): HTMLElement | null {
    if (id !== null) return sections.get(id) ?? null;
    return side.matches ? welcome : hint;
  }

  main.dataset.sheet = 'peek'; // until the camera director says otherwise

  // The swap. `displayed` is the section on screen (perhaps mid-fade), `target` the one wanted.
  let displayed: HTMLElement | null = null;
  let target: HTMLElement | null = null;
  let running: Animation | null = null;
  let focusNext = false;

  // The out-fade hands over on a timer, not on its finish event: that event waits for a
  // rendering update, and a page that renders only on demand may not have one coming.
  let handover = 0;

  function stop(): void {
    win.clearTimeout(handover);
    running?.cancel();
    running = null;
  }

  function settle(el: HTMLElement | null): void {
    let left: HTMLElement | undefined;
    for (const s of panes) {
      if (s === el) continue;
      if (s.contains(doc.activeElement)) left = s;
      hide(s);
    }
    if (el) {
      reveal(el);
      reachLeaders(el);
    }
    displayed = el;
    if (left)
      (el?.querySelector('h2') ?? doc.querySelector<HTMLElement>(`button.label[data-go="${left.dataset.node}"]`))?.focus({
        preventScroll: true,
      });
  }

  function focusHeading(el: HTMLElement | null): void {
    if (!focusNext || !el) return;
    focusNext = false;
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  function fadeIn(el: HTMLElement, from: number): void {
    settle(el);
    el.scrollTop = 0;
    focusHeading(el);
    const rise = from === 0 ? tuning.panelRisePx : 0;
    running = el.animate(
      [
        { opacity: from, transform: `translateY(${rise}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: tuning.panelInMs, easing: tuning.panelEase },
    );
  }

  function show(animate: boolean): void {
    held = false;
    target = wanted(stations.current);
    // What's on screen right now, mid-fade included, before the fade is cancelled.
    const opacity = displayed ? Number(win.getComputedStyle(displayed).opacity) : 0;
    stop();
    if (!animate || prefs.reduced) {
      settle(target);
      if (target) target.scrollTop = 0;
      focusHeading(target);
      return;
    }
    if (displayed === target) {
      if (target && opacity < 1) fadeIn(target, opacity);
      else focusHeading(target);
      return;
    }
    if (!displayed || opacity === 0) {
      if (target) fadeIn(target, 0);
      else settle(null);
      return;
    }
    const out = tuning.panelOutMs * opacity;
    const fade = displayed.animate([{ opacity }, { opacity: 0 }], {
      duration: out,
      easing: tuning.panelEase,
      fill: 'forwards',
    });
    running = fade;
    handover = win.setTimeout(() => {
      if (target) fadeIn(target, 0);
      else settle(null);
      fade.cancel(); // after the swap, so the old section never flashes back for a frame
    }, out);
  }

  // Keyboard or pointer: which one moved the visitor decides whether focus follows.
  let keyed = false;
  const onKey = () => {
    keyed = true;
  };
  const onPointer = () => {
    keyed = false;
  };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onPointer, true);

  // Whatever the page loads into (the URL's hash, applied by bindHash in the same task) just
  // appears: only travel after that swaps.
  let loading = true;
  queueMicrotask(() => {
    loading = false;
  });

  // The swap waits for the flight a travel starts (the director subscribes after the panel,
  // so it's looked for a microtask later), and runs when the time left is its own length.
  let flights: Flights | null = null;
  let offFlights: (() => void) | null = null;
  let held = false;
  const lead = tuning.panelOutMs + tuning.panelInMs;

  const off = stations.subscribe(() => {
    const onSteps = doc.activeElement?.closest('.travel') != null;
    focusNext = !loading && keyed && !onSteps;
    if (loading || !flights || prefs.reduced) {
      show(!loading);
      return;
    }
    held = true;
    queueMicrotask(() => {
      if (held && !flights?.flight) show(true); // no flight (a cut, or the arrival still running)
    });
  });

  function onFlight(f: FlightInfo | null): void {
    if (!held) return;
    if (f && ((1 - f.t) * f.duration * 1000) / f.rate > lead) return; // in real time, boosted or not
    show(!prefs.reduced);
  }

  // The breakpoint: the overview's panel comes and goes with the right column.
  const onBreakpoint = () => show(false);
  side.addEventListener('change', onBreakpoint);

  show(false); // the state the page loaded in (bindHash may move it again at once)

  // Wrapped values move with the column's width and the web fonts' arrival.
  const remeasure = () => {
    if (displayed) reachLeaders(displayed);
  };
  let width = 0;
  const resizes = new ResizeObserver(([entry]) => {
    const w = entry?.contentRect.width ?? 0;
    if (w === width) return;
    width = w;
    remeasure();
  });
  resizes.observe(main);
  void doc.fonts?.ready.then(remeasure);
  doc.fonts?.addEventListener('loadingdone', remeasure);

  return {
    get shown() {
      return displayed === welcome ? WELCOME : (displayed?.dataset.node ?? null);
    },
    setSheet(state) {
      main.dataset.sheet = state;
    },
    add(el) {
      const pane = el.closest<HTMLElement>('section.station[data-node]');
      if (!pane) return;
      if (!panes.includes(pane)) {
        sections.set(pane.dataset.node!, pane);
        panes.push(pane);
        const h = pane.querySelector<HTMLElement>('h2');
        if (h) {
          headings.set(h, h.getAttribute('tabindex'));
          h.setAttribute('tabindex', '-1');
        }
      }
      if (pane !== displayed) hide(pane);
      else reachLeaders(pane);
    },
    follow(f) {
      offFlights?.();
      flights = f;
      offFlights = f.onFlight(onFlight);
    },
    dispose() {
      off();
      offFlights?.();
      stop();
      resizes.disconnect();
      doc.fonts?.removeEventListener('loadingdone', remeasure);
      side.removeEventListener('change', onBreakpoint);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('pointerdown', onPointer, true);
      for (const s of panes) {
        s.classList.remove('sr-only');
        unpark(s);
        for (const row of s.querySelectorAll<HTMLElement>('dl.leaders > div')) clearReach(row);
      }
      for (const [h, was] of headings) {
        if (was === null) h.removeAttribute('tabindex');
        else h.setAttribute('tabindex', was);
      }
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
      delete main.dataset.panel;
      delete main.dataset.sheet;
    },
  };
}
