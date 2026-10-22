// The map's runtime: its own chunk, which main.ts imports after the first paint, only under
// html.has-3d (boot.ts's choice). start() builds the scene from the feed snapshot embedded
// in the page (no runtime fetch, so the HTML and the scene always agree). If the stage can't
// be built, or the WebGL context is lost later, the page drops back to no-3d: the stations
// become the readable page again, and no error is shown (a lost context's page is scrolled to
// the visitor's station, and reloads into 3D if the browser restores the context).
//
// start() builds in five tasks, not one (the module's evaluation; the stage; the links; the
// nodes, stations and panel; the rest), so none is a long task on a mid phone (TBT,
// TTI). The clock's frames wait for the last one, so the first frame
// is the whole map, as it was when start() was one task.
//
// `?test` runs the clock on a manual time source, stepped by window.__map.advance(seconds)
// (Phase 1, "Deterministic e2e timing"). window.__map exists in dev builds and under ?test only.

import { withCluster } from './data/cluster';
import { DUCK_BOUNDS, hiddenSection, withHidden } from './data/hidden';
import type { MapFeed } from './data/feed';
import { layout } from './data/layout';
import world from './data/world.json';
import { createDirector, type Director } from './camera/director';
import { createClock, createManualTime, type Clock } from './stage/clock';
import { createStage, type SheetState, type Stage } from './stage/stage';
import { createPointer } from './input/pointer';
import { createLinks, type Links } from './world/links';
import { createNodes, type Nodes } from './world/nodes';
import { loadModel } from './world/models';
import { applyRoleMaterials, recolourRoleMaterial } from './shading';
import { tuning } from './tuning';
import { createTraffic, type StrayWay, type Traffic } from './world/traffic';
import type { Cables } from './world/cable';
import { dockPose } from './world/dock';
import { createVisitor, type Visitor } from './world/visitor';
import { bindHash, createStations, HIDDEN, stationNode, type Stations } from './nav/stations';
import { createControls } from './ui/controls';
import { createLabels, type Labels } from './ui/labels';
import { createPanel, type Panel } from './ui/panel';
import { loadMoment, openMoments } from './moments/load';
import type { PlaneTrip } from './moments/plane';
import type { Power } from './moments/power';
import type { Receipt } from './moments/receipt';
import type { Secret } from './moments/secrets';
import type { Duck } from './moments/duck';
import type { Zoom } from './input/zoom';
import { runtimeCopy } from './copy-runtime';
import { bindSound } from './sound-cue';
import { reloadOnce } from './reload';

/** What tests and the dev console reach through window.__map. Later tasks add more. */
export interface MapDebug {
  feed: MapFeed;
  clock: Clock;
  stage: Stage;
  links: Links;
  traffic: Traffic;
  nodes: Nodes;
  stations: Stations;
  panel: Panel;
  labels: Labels;
  director: Director;
  visitor: Visitor;
  /** The homelab's cables, power cords and strips, once their lazy chunk is in (null before, or without one). */
  readonly cable: Cables | null;
  /** The secrets found this visit (Task 17; loads their lazy chunk). */
  secrets(): Promise<readonly Secret[]>;
  /** The trip receipt moment (Task 16), once its chunk is in. */
  readonly receipt: Receipt | null;
  /** The rubber duck's moment (Task 17), once the first stray signal has fetched it. */
  readonly duck: Promise<Duck> | null;
  /** Steps the manual clock by `seconds`, in frames of `step` (1/60 s). Only under ?test. */
  advance(seconds: number, step?: number): void;
}

declare global {
  interface Window {
    __map?: MapDebug;
  }
}

const root = document.documentElement;
const testing = new URLSearchParams(location.search).has('test');

// The snapshot is the build's own output: the prerender ran parseFeed on it (resolving links
// and failing the build on a bad feed), so the page trusts it rather than bundling the
// validator twice. Anything unreadable still throws, and start() drops to the plain page.
function readFeed(): MapFeed {
  const json = document.getElementById('feed-snapshot')?.textContent;
  if (!json) throw new Error('main: the page has no #feed-snapshot');
  return JSON.parse(json) as MapFeed;
}

/** Back to the plain page: the stations are the page again. */
function plain(): void {
  root.classList.remove('has-3d');
  root.classList.add('no-3d');
}

/** Ends the task: start()'s next step runs in a new one. */
const task = (): Promise<void> => new Promise((go) => setTimeout(go));

/** The browser's frames for the clock, held until open(): a frame asked for before then is
 *  asked for as start() ends. Its id stays -1 for the clock, and cancels either way. */
function heldFrames() {
  let shut = true;
  let wait: FrameRequestCallback | null = null;
  let id = 0;
  return {
    raf: (cb: FrameRequestCallback): number => (shut ? ((wait = cb), -1) : requestAnimationFrame(cb)),
    caf: (n: number): void => (n < 0 ? ((wait = null), cancelAnimationFrame(id)) : cancelAnimationFrame(n)),
    open(): void {
      shut = false;
      if (wait) id = requestAnimationFrame(wait);
      wait = null;
    },
  };
}

export async function start(): Promise<void> {
  if (!root.classList.contains('has-3d')) return;
  let clock: Clock | undefined;
  let stage: Stage | undefined;
  try {
    await task(); // past the module's evaluation
    const frames = heldFrames();
    // The links, traffic and nodes come from it, the homelab cluster's devices as nodes of their
    // own (as the prerender gave them sections).
    // And the map's hidden node (Task 17, secret 4: the rubber duck), found only by playing.
    const feed = withHidden(withCluster(readFeed(), world), world, runtimeCopy.duckName.text);
    const host = document.getElementById('stage');
    if (!host) throw new Error('main: the page has no #stage');
    const header = document.querySelector('header.top'); // the travel controls follow it
    if (!header) throw new Error('main: the page has no header.top');
    const time = testing ? createManualTime() : undefined;
    clock = createClock(time ?? frames); // ?test's frames come only from advance(), after start()
    stage = createStage(host, clock);
    const positions = layout(feed, world);
    await task();
    const links = createLinks(stage, positions, world, clock);
    // A hidden node leaves no mark until it's found: no link, no mast, no ground ring.
    const hidden = HIDDEN.filter((id) => positions.has(id));
    for (const id of hidden) {
      links.drawProgress(id, 0);
      links.showRing(id, false);
    }
    await task();
    // The homelab's cables and cords (a lazy chunk, below) follow its nodes' pulls as the links do.
    let cable: Cables | null = null;
    // A hidden node's model (the duck's, 59 KB) isn't fetched with the rest: most visitors never
    // find it. It loads as the first stray sets out (below), with its bounds known till then.
    // The rest load as the arrival shows them (the owner's model budgets): the origin (reach 0),
    // which the arrival waits for, then each node as its link lands; the traffic's models last.
    const reach: Record<string, number> = world.arrival.reach;
    const nodes = createNodes(
      stage,
      feed,
      positions,
      clock,
      {
        emphasize: links.emphasize,
        setEnd: (id, p) => (links.setEnd(id, p), cable?.update(id)),
      },
      { deferred: new Map(hidden.map((id) => [id, DUCK_BOUNDS])), order: Object.keys(reach).sort((a, b) => reach[a]! - reach[b]!) },
    );
    // Once a model is in, its link stops at its edge and its mast hides (links.ts, Footprints):
    // its footprint is its bounds on the floor, as traffic's signals have it, or, for a model you
    // see through, the circle its root's extras `open_radius` give.
    for (const n of nodes.all()) {
      void n.ready.then(() => {
        let open: unknown;
        n.root.traverse((o) => void (open ??= o.userData['open_radius']));
        if (typeof open === 'number' && open > 0) links.setFootprint(n.id, open);
        else if (!n.bounds.isEmpty()) {
          const { min, max } = n.bounds;
          const { x, z } = n.home;
          links.setFootprint(n.id, (p) => p.x - x >= min.x && p.x - x <= max.x && p.z - z >= min.z && p.z - z <= max.z);
        }
      });
    }
    // Its model stands hidden too (the arrival only shows the stations'), whatever the motion.
    for (const id of hidden) nodes.get(id).root.visible = false;
    const stations = createStations(feed.nodes.map((n) => n.id));
    // Task 15: the origin's power switch, from its `poke_power_hit` or, for the keyboard, a button
    // at the end of the origin's panel (3D only, so made here). The moment is a lazy chunk,
    // fetched on the first flip; a flip while one plays does nothing.
    const origin = document.querySelector<HTMLElement>('section.station[data-node="origin"]');
    const powerButton = document.createElement('button');
    powerButton.type = 'button';
    powerButton.className = 'power';
    powerButton.textContent = runtimeCopy.powerButton.text;
    (origin?.querySelector('.body') ?? origin)?.append(powerButton);
    let power: Promise<Power> | null = null;
    const withPower = (run: (p: Power) => unknown): void => {
      power ??= loadMoment('power').then((m) =>
        m.createPower({
          clock: clock!,
          nodes,
          links,
          traffic,
          director,
          labels,
          stations,
          cable: () => cable,
          speak: powerButton.parentElement,
          onReboot: () => receipt?.trip.powerCycle(), // "Turned off and on again" (Task 16)
        }),
      );
      power.then(run, (err: unknown) => ((power = null), console.error(err)));
    };
    const flip = (): void => withPower((p) => p.flip());
    powerButton.addEventListener('click', flip);
    // The duck's panel, kept `hidden` (no words on the page, nothing for a screen reader) until
    // it's found; the panel takes it with the stations' sections.
    const duckSection = hidden.length
      ? hiddenSection(document, hidden[0]!, runtimeCopy.duckName.text, [runtimeCopy.duckLine1.text, runtimeCopy.duckLine2.text])
      : null;
    if (duckSection) document.getElementById('stations')?.append(duckSection);
    const panel = createPanel(stations);
    await task();
    // The stations' navigation, after the header: ‹ › and the counter, then a label on every
    // node in station order, so Tab meets them before the panel's own links.
    const labels = createLabels(stage, nodes, stations, feed, clock, document, links);
    header.after(labels.element);
    // The overview's zoom and pan (the owner's test notes, 2026-10-22 morning):
    // a lazy chunk, fetched as the arrival ends in the overview, or else on the first wheel, pinch,
    // press, floor drag or `+` `-` there. The wheel's listener stays here, to keep the page from
    // scrolling at once; Ctrl with it is the browser's zoom (a trackpad's pinch too), left alone.
    let zoom: Promise<Zoom> | null = null;
    const zoomable = (): boolean => director.state === 'overview';
    const withZoom = (run: (z: Zoom) => void): boolean => {
      if (!zoomable()) return false;
      zoom ??= loadMoment('zoom').then((m) => m.createZoom(stage!, director, clock!, nodes));
      zoom.then(run, (err: unknown) => ((zoom = null), console.error(err)));
      return true;
    };
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || !zoomable()) return;
      e.preventDefault();
      // The wheel that skipped the arrival (director.ts) and a trackpad's coast after it: no zoom.
      const skipped = director.skippedAt;
      if (skipped !== null && e.timeStamp - skipped < tuning.wheelAfterSkip * 1000) return;
      const w = { deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY };
      withZoom((z) => z.wheel(w));
    };
    const controls = createControls(
      stations,
      header,
      (steps) => director.turnBy(steps),
      (dir) => withZoom((z) => z.key(dir)),
    );
    labels.element.prepend(controls.element);
    // Task 14: a click on the station you're at plays with its model (its label too, so Enter
    // pokes); anywhere else it travels. Task 16: at `exit`, a hit on the door (part 'door', its
    // `poke_door_hit` object) leaves instead, once the receipt's chunk is in; the trip counts
    // the other pokes the model answers (not a dark one's, nor one ignored mid-refusal).
    // Task 17: Siel Eolie's RCD test button trips the whole map (power.ts), the key under exit's
    // mat is a secret found (moments/secrets.ts, lazy), and candygoogy-bot's stand, clicked twice,
    // sends the plane to the server (moments/plane.ts, lazy), and pulling colophon's lamp chain
    // switches the map between light and dark through the header's theme switch (moments/lamp.ts).
    let receipt: Receipt | null = null;
    let plane: Promise<PlaneTrip> | null = null;
    /** Whether `id` is the station the camera is at (a press on its model pokes it, never pulls). */
    const atStation = (id: string): boolean => id === stations.current && director.state === 'station';
    const poke = (id: string, part: string | null): boolean => {
      if (!atStation(id)) return false;
      if (id === 'exit' && part === 'door' && receipt) receipt.leave();
      else if (id === 'origin' && part === 'power') flip();
      else if (id === 'siel-eolie' && (part === 'test' || !nodes.get(id).lit)) withPower((p) => p.rcd()); // dark: anywhere on it resets
      else if (id === 'colophon' && part === 'lamp') {
        // The chain pulled (lit only: a dark lamp's chain does nothing) switches the theme.
        if (nodes.get(id).poke(part)) {
          receipt?.poked();
          void loadMoment('lamp').then((m) => m.pull(), console.error);
        }
      } else {
        if (nodes.get(id).poke(part)) receipt?.poked();
        if (id === 'exit' && part === 'mat' && nodes.get(id).lit) void loadMoment('secrets').then((m) => m.found('key-under-mat'), console.error);
        if (id === 'candygoogy-bot' && part === 'stand') {
          plane ??= loadMoment('plane').then((m) => m.createPlaneTrip({ stage: stage!, nodes, clock: clock!, director, stations }));
          plane.then((p) => p.stand(), (err: unknown) => ((plane = null), console.error(err)));
        }
      }
      return true;
    };
    // A click on the current station's label, or Enter on it, pokes the model; again, its next
    // part (each poke_<part>_hit in the model, in turn; Task 17's keyboard path to the parts).
    // The switch has its own button, and exit's door is Task 16's way out.
    const turns = new Map<string, number>();
    const partsOf = (id: string): (string | null)[] => {
      const parts: (string | null)[] = [null];
      nodes.get(id).root.traverse((o) => {
        const part = /^poke_(.+)_hit$/.exec(o.name)?.[1];
        if (part && part !== 'power' && part !== 'door' && !parts.includes(part)) parts.push(part);
      });
      return parts;
    };
    labels.element.addEventListener('click', (e) => {
      const label = (e.target as Element).closest<HTMLElement>('button.label[data-go]');
      if (!label) return;
      const id = label.dataset.go!;
      const parts = partsOf(id);
      const turn = turns.get(id) ?? 0;
      if (poke(id, parts[turn % parts.length]!)) turns.set(id, turn + 1);
    });
    const pointer = createPointer(stage, nodes, {
      // A press held to boost a flight isn't a click.
      onSelect: (id, part) => !visitor.tookPress && !poke(id, part) && stations.go(id),
      // A drag on the empty floor moves the overview (zoom.ts, its chunk) and turns a station's
      // view (map rotation); the right button, or Shift or Ctrl, turns either.
      onTurn: (dx) => director.turnDrag(dx),
      canTurn: () => director.state === 'overview' || director.state === 'station',
      onPan: (from, to) => void (from ? withZoom((z) => z.pan(from, to)) : zoom?.then((z) => z.pan(null))),
      canPan: zoomable,
      // Pulls are the overview's alone (the owner, 2026-10-22 morning: a neighbour pulled at a
      // station landed on its model); none mid-flight either (a quick second press on the model
      // being flown to pulled it as the camera arrived, 2026-10-21).
      canPull: () => director.state === 'overview',
      // Two fingers zoom, turn and move the overview.
      onPinch: (a, b) => void (a ? withZoom((z) => z.pinch(a, b)) : zoom?.then((z) => z.pinch(null))),
      canPinch: zoomable,
      over: labels.element,
    });
    // The chunk also stops a pull at its neighbours' rings, and a mouse pulls at once, so it's
    // fetched as the arrival ends in the overview (below), before any press. A first press in the
    // overview still asks for it: a deep link's arrival ends at a station, a failed fetch retries.
    const asks = (): void => void withZoom(() => undefined);
    const canvas = stage.renderer.domElement;
    canvas.addEventListener('pointerdown', asks);
    // Over the canvas and the labels (which lie over it); not over the panel or the sheet.
    const wheeled = [stage.renderer.domElement, labels.element];
    for (const el of wheeled) el.addEventListener('wheel', onWheel, { passive: false });
    // The camera: the arrival, flights, framing and drift. It moves the sheet too (stage and
    // panel together): at its peek while the camera travels, open as it settles at a station.
    const setSheet = (s: SheetState, framed: SheetState = s): void => {
      stage!.setSheet(framed);
      panel.setSheet(s);
    };
    const director = createDirector(stage, links, nodes, stations, clock, { world, positions, labels, setSheet });
    panel.follow(director); // the panel's swap ends as the camera lands
    labels.follow(director); // the current label's side off the gondola is held once it lands
    // The phone's start (director.ts, homeView): the arrival played out ends on the composed
    // overview, and the chunk eases it in to the closer start (a skip is there already).
    // Ended in the overview, the chunk is fetched either way (lazy still: loadMoment waits for
    // the first idle moment after the arrival), so it's in before the first pull's press.
    void director.arrived.then(() => {
      if (director.zoom === 1 && director.home.zoom < 1) withZoom((z) => z.start());
      else withZoom(() => undefined);
    });
    // The moments (power, the receipt, sound, secrets) are lazy chunks, loaded only after this.
    openMoments(director.arrived);
    // Task 17: the sound engine, fetched the first time the header's toggle is on (sound-cue.ts).
    const unbindSound = bindSound(() => loadMoment('sound'));
    // The lazy chunks below may come in after a lost context has made the page plain: then they
    // stay out of it.
    let disposed = false;
    void loadMoment('cable').then(async (m) => {
      const c = disposed ? null : await m.createCable(stage!, nodes, clock!, { load: loadModel, roles: applyRoleMaterials, recolour: recolourRoleMaterial, dock: (id) => dockPose(links.curve(id)) });
      if (c && disposed) c.dispose();
      else cable = c;
    }, console.error);
    // The trip and its receipt (Task 16): recorded from the arrival's end, the page's start its start.
    void loadMoment('receipt').then((m) => {
      if (disposed) return;
      receipt = m.createReceipt({
        feed,
        stations,
        director,
        nodes,
        panel,
        stage: stage!,
        theme: () => stage!.theme,
        invalidate: () => clock!.invalidate(),
        startedAt: performance.timeOrigin,
      });
    }, console.error);
    // You: the capsule that rides ahead of the camera, and holds to boost (after the director,
    // so a station change reaches it second).
    const visitor = createVisitor(stage, links, director, clock, stations);
    // The signals on the links: out of the hub's model into each node's, hopping the gondola's grip.
    // A stray's way is made in the duck's chunk, fetched as the first one is due (stray-way.ts).
    let strayWays: ((from?: string) => StrayWay) | null = null;
    const traffic = createTraffic(
      stage,
      links,
      feed,
      clock,
      nodes,
      visitor,
      // Under ?test none strays by chance (tests send one): a stray's button joins the Tab order.
      hidden.length
        ? {
            id: hidden[0]!,
            found: () => stations.revealed(hidden[0]!),
            chance: !testing,
            arrived: director.arrived,
            way: (from) =>
              strayWays?.(from) ??
              void loadMoment('duck').then(
                (m) => (strayWays ??= m.strayWays({ id: hidden[0]!, camera: stage!.camera, nodes, stations, director })),
                console.error,
              ),
          }
        : undefined,
      // The zoom of the view the camera is at. director.zoom is the overview's, which on a
      // phone travel sets to its closer start (0.8) on the way to a station too: there, and on
      // the way, it's 1 (a station is never zoomed). Back to the overview from a station it
      // comes in with the flight's time, so it lands on the overview's without a jump.
      () => {
        const f = director.flight;
        if (f) return f.to !== null ? 1 : f.from === null ? director.zoom : 1 + (director.zoom - 1) * f.t;
        return director.state === 'station' || director.state === 'receipt' ? 1 : director.zoom;
      },
    );
    // The first stray signal fetches the duck's moment, which lays its button over the stray.
    let duck: Promise<Duck> | null = null;
    const offStray = traffic.onStray((root) => {
      if (!root) return;
      // The duck's model, while the stray rides there (a ride of several seconds): in by the
      // time a follow lands; if not, its `appear` plays as it comes in.
      for (const id of hidden) nodes.load(id);
      if (duck || !duckSection) return;
      duck = loadMoment('duck').then((m) =>
        m.createDuck({
          id: hidden[0]!,
          stage: stage!,
          clock: clock!,
          traffic,
          stations,
          nodes,
          links,
          director,
          list: labels.element.querySelector<HTMLElement>('ul.labels') ?? labels.element,
          section: duckSection,
        }),
      );
      duck.catch((err: unknown) => ((duck = null), console.error(err)));
    });
    // Last, so the hash the page loads with reaches every subscriber.
    const unbindHash = bindHash(stations, window, { canReceipt: () => receipt?.canShow() ?? false });

    // A lost context (a GPU reset, a phone's backgrounded tab) ends the 3D: the page goes plain,
    // scrolled to the section of the station the visitor was at, its hash kept. three's own
    // listener (WebGLRenderer) has already called preventDefault, so the browser may restore the
    // context; if it does, the page reloads (src/reload.ts) and the map comes back at that
    // station. At most once a minute, so a GPU that keeps losing it can't loop.
    const lost = (): void => {
      const at = stations.current;
      canvas.addEventListener('webglcontextrestored', () => void reloadOnce('map:restored', String(Math.floor(Date.now() / 60_000))), { once: true });
      disposed = true;
      unbindHash();
      unbindSound();
      offStray();
      void duck?.then((d) => d.dispose());
      duckSection?.remove();
      powerButton.remove();
      void power?.then((p) => p.dispose());
      void plane?.then((p) => p.dispose());
      receipt?.dispose();
      visitor.dispose();
      director.dispose();
      controls.dispose();
      labels.dispose();
      panel.dispose();
      pointer.dispose();
      for (const el of wheeled) el.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', asks);
      void zoom?.then((z) => z.dispose());
      nodes.dispose();
      traffic.dispose();
      stage!.dispose();
      clock!.dispose();
      plain();
      if (at) document.getElementById(stationNode(at))?.scrollIntoView({ block: 'start' });
    };
    stage.renderer.domElement.addEventListener('webglcontextlost', lost, { once: true });

    if (import.meta.env.DEV || testing) {
      window.__map = {
        feed,
        clock,
        stage,
        links,
        traffic,
        nodes,
        stations,
        panel,
        labels,
        director,
        visitor,
        get cable() {
          return cable;
        },
        secrets: () => loadMoment('secrets').then((m) => m.list()),
        get receipt() {
          return receipt;
        },
        get duck() {
          return duck;
        },
        advance(seconds, step) {
          if (!time) throw new Error('__map.advance needs ?test (the manual clock)');
          time.advance(seconds, step);
        },
      };
    }
    // The page laid out here, in this task, so the first frame's labels measure a laid-out page
    // rather than laying it out in the frame (a read only: nothing changes).
    labels.element.getBoundingClientRect();
    frames.open(); // the first frame, now that the whole map is built
  } catch (err) {
    stage?.dispose();
    clock?.dispose();
    plain();
    console.error(err); // for whoever opens the console; the page itself just stays plain
  }
}
