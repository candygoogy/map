// The plane goes to work (Task 17, secret 3, approved 2026-10-20). At candygoogy-bot, a click on
// the launch stand (its `poke_stand_hit`, not the plane) plays `poke_stand`: the launcher cocks and
// kicks, the plane hops. The second within AGAIN seconds is a launch: from the kick the plane flies
// across the map to the homelab's server (the machine the bot runs on), lands on its lid, the
// server's activity light bursts (`blink`), and it flies home to its pin. A lazy chunk
// (moments/load.ts).
//
// The camera follows it (the owner, 2026-10-22: since layout R1 the server is far off, and the
// plane left the bot's view). Launched from the bot's station, the plane's trip out is a
// director ride to the server's station (Director.follow, then stations.go): a flight like any
// other (the hash, the panel and the gondola go with it), whose camera eases off the bot's
// framing onto a chase behind and above the plane, looking past it at the lid, and eases onto
// the server's framing as it lands: RIDE seconds, the landing in view, the visitor left there.
// ‹ ›, Escape or a click mid-ride travel on from the ride as from any flight; the plane goes on.
//
// The flight is code, not a clip: the plane leaves its model. Its mixer keeps posing it on the
// stand (idle's bob), so the one on the stand is hidden for the trip and a copy flies (shared
// geometry and materials, so the theme and the power reach it), from the plane's own pose at the
// kick to the server's lid and back onto the stand's pose as it is when it lands, then swaps back.
// The path is two cubic Béziers (out, and back with a turn), the nose along the path, banked
// into the turns, with an eased speed: fast off the launcher, slowing onto the lid, gliding home.
//
// Reduced motion: the same outcome with the motion cut. At the kick the plane is on the lid at
// once, the server blinks (its clip at its end), and STAY_REDUCED later it's back on its stand;
// from the bot's station the view cuts to the server's.
// It runs on timers then, so a still map requests no frames, and makes no sound: nothing flies.
//
// It imports no three.js values at all, only types: a value import from 'three' in a lazy chunk
// splits three.core out of the runtime's chunk, and the names that cross chunks cost about 1.7 kB
// on the first load (measured). So it makes its Vector3, Box3 and
// Group from instances the first load already made (a node's home, bounds and root).

import type { Box3, Group, Object3D, Vector3 } from 'three';
import type { DirPose, Director } from '../camera/director';
import type { Stations } from '../nav/stations';
import { prefs } from '../motion/prefs';
import type { Clock } from '../stage/clock';
import type { Stage } from '../stage/stage';
import { cue } from '../sound-cue';
import type { Nodes } from '../world/nodes';
import { found } from './secrets';

export const BOT = 'candygoogy-bot';
export const SERVER = 'server';
/** The kick in `poke_stand` (STAND_KICK in the model's Blender source, not in this repo: frame 6
 *  at 24 fps). */
export const KICK = 6 / 24;
/** The second click on the stand within this many seconds launches the plane. */
export const AGAIN = 10;
/** Seconds: out to the lid, on it, and home. */
export const OUT = 3.2;
export const STAY = 1.4;
export const BACK = 3.6;
export const STAY_REDUCED = 1.6;
/** Seconds of the camera's ride to the server: the plane lands at OUT, the framing settles after. */
export const RIDE = OUT + 0.9;
/** The chase: how far behind the plane, above it and to the camera's side, in world units. */
const CHASE_BACK = 3.6;
const CHASE_UP = 2;
const CHASE_SIDE = 1.4;
/** It looks this far past the plane towards the lid, at most, so the server comes into view. */
const LOOK_AHEAD = 0.8; // less on a tall screen, whose view is narrow
/** The plane's centre over the lid's top as it sits there, level. */
const PERCH = 0.05;

export interface PlaneTripOptions {
  stage: Pick<Stage, 'scene' | 'camera'>;
  nodes: Pick<Nodes, 'get'>;
  clock: Pick<Clock, 'add' | 'invalidate'>;
  /** For the ride along (absent: the camera stays). */
  director?: Pick<Director, 'state' | 'follow'>;
  stations?: Pick<Stations, 'current' | 'go'>;
}

export interface PlaneTrip {
  /** A click on the stand, as its `poke_stand` starts (map.ts plays it): the second within
   * AGAIN seconds launches. */
  stand(): void;
  /** From the launch until it's back on its pin. */
  readonly flying: boolean;
  dispose(): void;
}

/** A point on the cubic Bézier a b c d at u, into `out`. */
function bezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, u: number, out: Vector3): Vector3 {
  const v = 1 - u;
  return out
    .copy(a)
    .multiplyScalar(v * v * v)
    .addScaledVector(b, 3 * v * v * u)
    .addScaledVector(c, 3 * v * u * u)
    .addScaledVector(d, u * u * u);
}

/** Progress along a leg at u (0..1) with speeds v0 and v1 at its ends (a cubic Hermite). */
function pace(u: number, v0: number, v1: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (u3 - 2 * u2 + u) * v0 + (-2 * u3 + 3 * u2) + (u3 - u2) * v1;
}

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export function createPlaneTrip({ stage, nodes, clock, director, stations }: PlaneTripOptions): PlaneTrip {
  const proto = nodes.get(BOT);
  const vec = (x = 0, y = 0, z = 0): Vector3 => proto.home.clone().set(x, y, z);
  const box = (): Box3 => proto.bounds.clone().makeEmpty();
  const GroupOf = proto.root.constructor as new () => Group;
  const UP = vec(0, 1, 0);
  let lastStand: number | null = null;
  let ghost: Group | null = null;
  let off: (() => void) | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let pending = false; // from the second click to the kick
  let offKick: (() => void) | null = null; // the wait for the kick, while pending
  let chase: ((t: number, from: DirPose, to: DirPose, out: DirPose) => void) | null = null;

  const real = () => nodes.get(BOT).root.getObjectByName('plane') ?? null;

  /** The world-space centre of `o`'s geometry. */
  const centreOf = (o: Object3D) => box().setFromObject(o).getCenter(vec());

  /** A copy of the plane that leaves its model, posed exactly where the plane is. */
  function takeOff(plane: Object3D): Group {
    plane.updateWorldMatrix(true, true);
    const g = new GroupOf();
    g.name = 'plane-trip';
    g.position.copy(centreOf(plane));
    plane.getWorldQuaternion(g.quaternion);
    g.updateMatrixWorld();
    const body = plane.clone();
    body.matrix.copy(g.matrixWorld).invert().multiply(plane.matrixWorld);
    body.matrix.decompose(body.position, body.quaternion, body.scale);
    g.add(body);
    stage.scene.add(g);
    plane.visible = false;
    return g;
  }

  function land(): void {
    if (ghost) stage.scene.remove(ghost);
    ghost = null;
    const plane = real();
    if (plane) plane.visible = true;
    off?.();
    off = null;
    clock.invalidate();
  }

  /** The server's lid: where the plane sits, its centre PERCH over the top's middle. */
  function lid(): Vector3 {
    const server = nodes.get(SERVER).root;
    server.updateWorldMatrix(true, true);
    const b = box();
    server.traverse((o) => {
      const m = (o as { material?: { name?: string } }).material;
      if ((o as { isMesh?: boolean }).isMesh && m?.name !== 'shadow') b.expandByObject(o);
    });
    return b.getCenter(vec()).setY(b.max.y + PERCH);
  }

  function fly(plane: Object3D): void {
    const g = (ghost = takeOff(plane));
    cue('plane', 'out'); // its sounds (Task 17, moments/sound.ts): off the launcher, onto the lid, home
    const p0 = g.position.clone();
    const q0 = g.quaternion.clone();
    const nose = vec(0, 0, -1).applyQuaternion(q0);
    const L = lid();
    const dir = L.clone().sub(p0).setY(0).normalize();
    const homeDir = nose.clone().setY(0).normalize();
    const span = L.clone().sub(p0).setY(0).length();
    const high = Math.max(1.2, span * 0.3);
    // Both legs swing out to the side away from the camera, wherever it is, so the plane doesn't
    // fly into the lens (from the bot's station the server lies past the camera).
    const side = vec(-dir.z, 0, dir.x);
    if (side.dot(stage.camera.position.clone().sub(p0)) > 0) side.negate();
    const swing = Math.min(2.2, span * 0.45);
    // Out: off the launcher along its nose, up and over, down onto the lid heading `dir`.
    const out = [
      p0,
      p0.clone().addScaledVector(nose, 0.9).addScaledVector(UP, 0.5).addScaledVector(side, swing),
      L.clone().addScaledVector(dir, -span * 0.35).addScaledVector(UP, high).addScaledVector(side, swing),
      L,
    ];
    const aim = new GroupOf();
    const level = (fwd: Vector3) => {
      aim.up.copy(UP);
      aim.lookAt(fwd.clone().negate()); // -Z (the nose) along fwd
      return aim.quaternion.clone();
    };
    const qLid = level(dir);
    // The camera's ride (follow): behind the plane on its way to the lid, above it, on the
    // camera's side of its swing, looking past it at the lid; eased off where it left from and
    // onto the server's framing.
    const cam = vec();
    const look = vec();
    const head = vec();
    chase = (t, from, to, o) => {
      const p = ghost ? ghost.position : L;
      head.copy(L).sub(p).setY(0);
      if (head.lengthSq() < 0.04) head.copy(dir);
      head.normalize();
      // Further back on a tall screen, whose narrow view would lose the plane off its sides.
      const k = Math.max(1, 0.9 / stage.camera.aspect);
      cam.copy(p).addScaledVector(head, -CHASE_BACK * k).addScaledVector(UP, CHASE_UP * k).addScaledVector(side, -CHASE_SIDE * k);
      const w0 = 1 - smooth(t / 0.3);
      const w1 = smooth((t - 0.6) / 0.4);
      o.position.copy(cam).lerp(from.position, w0).lerp(to.position, w1);
      // It looks at the plane all the way (eased off the lid onto what the framing looks at).
      look.copy(L).sub(p).clampLength(0, LOOK_AHEAD / (k * k)).add(p).lerp(head.copy(to.position).addScaledVector(to.forward, to.reach ?? to.position.distanceTo(L)), w1);
      o.forward.copy(look).sub(o.position).normalize();
      o.reach = undefined;
    };
    const at = vec();
    const ahead = vec();
    let fwdH = homeDir.clone();
    let roll = 0;

    /** The pose at u along a leg: on the curve, the nose along it, banked into the turn. */
    const pose = (pts: Vector3[], u: number, dt: number) => {
      bezier(pts[0]!, pts[1]!, pts[2]!, pts[3]!, u, at);
      bezier(pts[0]!, pts[1]!, pts[2]!, pts[3]!, Math.min(u + 0.01, 1), ahead);
      const fwd = ahead.sub(at);
      if (fwd.lengthSq() < 1e-10) fwd.copy(dir);
      fwd.normalize();
      const h = fwd.clone().setY(0);
      if (h.lengthSq() > 1e-8) {
        h.normalize();
        const turn = fwdH.clone().cross(h).y; // + turning left
        const want = Math.max(-0.7, Math.min(0.7, (turn / Math.max(dt, 1e-3)) * 0.35));
        roll += (want - roll) * Math.min(1, dt * 6);
        fwdH = h;
      }
      aim.up.copy(UP).applyAxisAngle(fwd, -roll);
      aim.lookAt(fwd.clone().negate());
      g.position.copy(at);
      g.quaternion.copy(aim.quaternion);
    };

    let t = 0;
    let blinked = false;
    let back: Vector3[] | null = null;
    off = clock.add((dt) => {
      t += dt;
      if (t < OUT) {
        const u = pace(t / OUT, 1.5, 0.35);
        pose(out, u, dt);
        g.quaternion.slerp(q0, 1 - smooth((t / OUT) / 0.15)); // out of the launcher's pose
        g.quaternion.slerp(qLid, smooth((t / OUT - 0.8) / 0.2)); // level onto the lid
        return true;
      }
      if (t < OUT + STAY) {
        g.position.copy(L);
        g.quaternion.copy(qLid);
        if (!blinked) {
          blinked = true;
          cue('plane', 'lid');
          void nodes.get(SERVER).play('blink');
        }
        return true;
      }
      const home = centreOf(plane); // the stand's pose as it is now (idle bobs it)
      back ??= [
        L,
        L.clone().addScaledVector(dir, 1.4).addScaledVector(UP, high * 0.9).addScaledVector(side, swing),
        home.clone().addScaledVector(homeDir, -span * 0.4).addScaledVector(UP, high * 0.8).addScaledVector(side, swing * 0.6),
        home.clone(),
      ];
      back[3]!.copy(home);
      const k = (t - OUT - STAY) / BACK;
      if (k >= 1) {
        cue('plane', 'home');
        land();
        return false;
      }
      pose(back, pace(k, 0.6, 0.5), dt);
      g.quaternion.slerp(qLid, 1 - smooth(k / 0.15)); // off the lid
      const settle = smooth((k - 0.82) / 0.18); // onto the pin, as the plane on the stand is
      if (settle > 0) {
        g.position.lerp(home, settle);
        g.quaternion.slerp(plane.getWorldQuaternion(aim.quaternion.clone()), settle);
      }
      return true;
    });
  }

  function cut(plane: Object3D): void {
    const g = (ghost = takeOff(plane));
    g.position.copy(lid());
    const aimDir = g.position.clone().sub(centreOf(plane)).setY(0).normalize();
    const aim = new GroupOf();
    aim.lookAt(aimDir.negate());
    g.quaternion.copy(aim.quaternion);
    void nodes.get(SERVER).play('blink');
    clock.invalidate();
    timers.push(setTimeout(land, STAY_REDUCED * 1000));
  }

  function launch(): void {
    found('plane-to-work');
    pending = true;
    // From the kick of the `poke_stand` just started (it plays on frames, as every poke).
    let k = 0;
    const kick = (offKick = clock.add((dt) => {
      k += dt;
      if (k < KICK) return true;
      kick();
      offKick = null;
      pending = false;
      const plane = real();
      if (!plane) return false;
      // Still at the bot's station (not off on ‹ › since the click): the camera goes along.
      const along = stations?.current === BOT && director?.state === 'station';
      if (prefs.reduced) cut(plane);
      else fly(plane);
      if (along) {
        const pose = chase;
        if (pose && !prefs.reduced) director!.follow({ to: SERVER, duration: RIDE, pose });
        stations!.go(SERVER);
      }
      return false;
    }));
  }

  return {
    stand() {
      if (ghost || pending || !nodes.get(BOT).lit || !nodes.get(SERVER).lit) return;
      const now = performance.now() / 1000;
      if (lastStand !== null && now - lastStand < AGAIN) {
        lastStand = null;
        launch();
      } else lastStand = now;
    },
    get flying() {
      return ghost !== null || pending;
    },
    dispose() {
      offKick?.(); // disposed before the kick: it never takes off
      offKick = null;
      pending = false;
      for (const id of timers) clearTimeout(id);
      timers = [];
      land();
    },
  };
}
