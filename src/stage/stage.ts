// The stage: the WebGL2 renderer, the scene and its camera, the theme's clear colour (live
// through onThemeChange), resize and rotation, the pixel-ratio cap, the quality tier, and the
// panel inset the camera is framed around.
//
// Rendering is the clock's late step, so it always comes after every tick of the frame,
// whenever that tick was added. Later tasks follow the drawing buffer through onResize (it
// fires on resize, rotation, zoom and a tier drop) and the colours through onTheme.
//
// The panel inset (Task 5, used by fit.ts in Task 9): 460 px on the right at 900 px wide and
// up, otherwise a bottom sheet at its peek (overview, arrival) or open (a station,
// #receipt). setViewOffset slides the projection's centre to the middle of the part of the
// canvas the panel leaves visible, at the scale the camera has on the whole canvas, so
// opening the sheet pans the view and never zooms it; fitting the distance is fit.ts's job.

import { NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import world from '../data/world.json';
import { easeInOutCubic } from '../motion/ease';
import { prefs } from '../motion/prefs';
import { tuning } from '../tuning';
import type { Clock } from './clock';
import { onThemeChange, readTheme, type Theme } from './theme';

export type Tier = 'high' | 'low';
export type SheetState = 'peek' | 'open';

/** CSS px of the canvas the panel covers, on the right or at the bottom. */
export interface PanelInset {
  right: number;
  bottom: number;
}

/** The canvas in CSS px, and the pixel ratio its drawing buffer uses. */
export interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
  tier: Tier;
}

export interface Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** The current tokens; replaced, not mutated, when the scheme switches. */
  readonly theme: Theme;
  /** Starts high; drops to low (for good) when frames run slow. */
  readonly tier: Tier;
  readonly viewport: Viewport;
  /** The inset the camera is framed for right now (mid-animation while the sheet moves). */
  readonly inset: PanelInset;
  readonly sheet: SheetState;
  /** Frames the camera for this inset now. Resizing and setSheet set it again from the layout. */
  setPanelInset(px: PanelInset): void;
  /** Peek in the overview and arrival, open at a station; animates unless motion is reduced. */
  setSheet(state: SheetState): void;
  /** After the size or pixel ratio changes (resize, rotation, zoom, a tier drop). Returns an unsubscribe. */
  onResize(cb: (v: Viewport) => void): () => void;
  /** After the OS switches scheme, with the new tokens (the clear colour is already set). */
  onTheme(cb: (t: Theme) => void): () => void;
  /** Stops rendering, lets go of the GPU and removes the canvas. */
  dispose(): void;
}

/** `low` once the mean of the last `tuning.tierSamples` frame times is over `tuning.tierFrameMs`. */
export function tierFor(frameMs: number[]): Tier {
  const n = tuning.tierSamples;
  if (frameMs.length < n) return 'high'; // too few to judge
  let sum = 0;
  for (let i = frameMs.length - n; i < frameMs.length; i++) sum += frameMs[i]!;
  return sum / n > tuning.tierFrameMs ? 'low' : 'high';
}

/** Where the panel sits for a viewport of this size: on the right, or a sheet at the bottom. */
export function panelInsetFor(width: number, height: number, sheet: SheetState): PanelInset {
  if (width >= tuning.panelMinViewportPx) return { right: tuning.panelWidthPx, bottom: 0 };
  const peek = height >= width ? tuning.sheetPeek : tuning.sheetPeekWide; // portrait, as (orientation: portrait)
  return { right: 0, bottom: height * (sheet === 'open' ? tuning.sheetOpen : peek) };
}


type Vec3 = [number, number, number];

export function createStage(canvasHost: HTMLElement, clock: Clock): Stage {
  let theme = readTheme(); // throws on a malformed token, before anything needs undoing

  // Task 6's hairlines rely on MSAA on high; the stencil keeps links off the models (links.ts).
  const renderer = new WebGLRenderer({ antialias: true, stencil: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping; // the colours must match the tokens
  renderer.setClearColor(theme.bg); // the floor is the page
  canvasHost.append(renderer.domElement);

  const scene = new Scene();
  // The authored overview until the director (Task 9) takes the camera over.
  const overview = world.cameras.overview;
  const camera = new PerspectiveCamera(overview.fovY, 1, 0.1, 200);
  camera.position.set(...(overview.position as Vec3));
  camera.lookAt(...(overview.target as Vec3));

  let tier: Tier = 'high';
  let sheet: SheetState = 'peek';
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  const inset: PanelInset = { right: 0, bottom: 0 };
  const resizeListeners = new Set<(v: Viewport) => void>();
  const themeListeners = new Set<(t: Theme) => void>();
  const viewport = (): Viewport => ({ width, height, pixelRatio, tier });

  function frameInset(px: PanelInset): void {
    inset.right = px.right;
    inset.bottom = px.bottom;
    if (width > 0 && height > 0) camera.setViewOffset(width, height, px.right / 2, px.bottom / 2, width, height);
  }

  // The sheet's move between heights: a tick only while it runs, so a still stage asks for no frames.
  let tween: { from: number; to: number; p: number } | null = null;
  let offTween: (() => void) | null = null;
  function stopTween(): void {
    offTween?.();
    offTween = null;
    tween = null;
  }
  function tweenTick(dt: number): boolean {
    if (!tween) return false;
    tween.p = Math.min(tween.p + dt / tuning.sheetSeconds, 1);
    frameInset({ right: 0, bottom: tween.from + (tween.to - tween.from) * easeInOutCubic(tween.p) });
    if (tween.p < 1) return true;
    stopTween();
    return false;
  }

  function layout(w: number, h: number): void {
    width = w;
    height = h;
    pixelRatio = Math.min(devicePixelRatio, tuning.dpr[tier]);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false); // CSS sizes the canvas
    stopTween(); // a resize lands the sheet where the layout puts it
    frameInset(panelInsetFor(w, h, sheet));
    for (const cb of [...resizeListeners]) cb(viewport());
    clock.invalidate();
  }

  // Zoom or a move to another screen changes the pixel ratio, sometimes without a resize.
  let dprQuery: MediaQueryList | null = null;
  function watchPixelRatio(): void {
    dprQuery?.removeEventListener('change', onPixelRatio);
    dprQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onPixelRatio);
  }
  function onPixelRatio(): void {
    layout(width, height);
    watchPixelRatio();
  }

  const box = canvasHost.getBoundingClientRect();
  layout(box.width, box.height);
  watchPixelRatio();
  const resizes = new ResizeObserver((entries) => {
    const rect = entries.at(-1)?.contentRect;
    if (rect && (rect.width !== width || rect.height !== height)) layout(rect.width, rect.height);
  });
  resizes.observe(canvasHost);

  const offTheme = onThemeChange((t) => {
    theme = t;
    renderer.setClearColor(t.bg);
    for (const cb of [...themeListeners]) cb(t);
    clock.invalidate();
  });

  // Frame times for the tier, from continuous frames only: an on-demand frame's dt counts
  // from its wake, not from a previous frame. Under ?test the manual clock's steps are exact.
  const frameMs: number[] = [];
  const offRender = clock.addLate((dt) => {
    if (tier === 'high' && clock.mode === 'continuous' && dt > 0) {
      frameMs.push(dt * 1000);
      if (frameMs.length > tuning.tierSamples) frameMs.shift();
      if (tierFor(frameMs) === 'low') {
        tier = 'low';
        frameMs.length = 0;
        layout(width, height); // the lower pixel ratio, and onResize for the lines
      }
    }
    renderer.render(scene, camera);
  });

  return {
    renderer,
    scene,
    camera,
    get theme() {
      return theme;
    },
    get tier() {
      return tier;
    },
    get viewport() {
      return viewport();
    },
    get inset() {
      return { ...inset };
    },
    get sheet() {
      return sheet;
    },
    setPanelInset(px) {
      stopTween();
      frameInset(px);
      clock.invalidate();
    },
    setSheet(state) {
      sheet = state;
      const to = panelInsetFor(width, height, sheet);
      // Only a sheet animates, and only from a sheet: the right panel and the panel's arrival
      // across the breakpoint land at once, as does everything under reduced motion.
      if (prefs.reduced || to.right > 0 || inset.right > 0 || to.bottom === inset.bottom) {
        stopTween();
        frameInset(to);
        clock.invalidate();
        return;
      }
      tween = { from: inset.bottom, to: to.bottom, p: 0 };
      offTween ??= clock.add(tweenTick);
    },
    onResize(cb) {
      resizeListeners.add(cb);
      return () => void resizeListeners.delete(cb);
    },
    onTheme(cb) {
      themeListeners.add(cb);
      return () => void themeListeners.delete(cb);
    },
    dispose() {
      stopTween();
      offRender();
      offTheme();
      resizes.disconnect();
      dprQuery?.removeEventListener('change', onPixelRatio);
      resizeListeners.clear();
      themeListeners.clear();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
