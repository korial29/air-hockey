// Client prediction: a local World stepped with the host's physics, no DOM, unit-tested.
// The own paddle moves toward the pointer exactly like on the host. The puck is rebased on each
// snapshot (taken as the host state at its arrival) and simulated forward, so a fast puck is
// drawn where it is and an own hit redirects it at once. Other paddles stand at their latest
// snapshot position for collisions; they are drawn interpolated, INTERP_DELAY in the past.
import { TICK_HZ, W } from '../shared/constants';
import { createWorld, step } from '../shared/physics';
import type { Paddle, Phase, Snapshot, World } from '../shared/types';

/** Physics step, in ms. */
const DT = 1000 / TICK_HZ;
/** Share of the drawn puck correction left after one step: half gone in ~4 steps (35 ms). */
const EASE = 0.85;
/** After an own hit, snapshots that do not show it yet are ignored for this long, in ms. */
const GRACE = 200;
/** Steps replayed at most per advance, so a stalled tab does not spiral. */
const MAX_CATCH_UP = 10;

export interface Prediction {
  w: World;
  /** Own paddle, in w.paddles; its target is the pointer. Absent until a snapshot shows it. */
  me?: Paddle;
  /**
   * The puck is drawn at w.puck + o. A snapshot rebases w.puck and moves the gap into o, which
   * fades step by step: corrections slide, never teleport.
   */
  o: [number, number];
  /** Time w stands at, ms; -1 before the first snapshot. */
  t: number;
  /** Until this time (ms), snapshots whose puck still runs against the local one are skipped. */
  hold: number;
  /** A local goal: the puck stays put until the next snapshot. */
  wait?: boolean;
  /** Phase 'break' or 'end': the host is frozen, snapshots are drawn as they are. */
  off?: boolean;
  /** Score of the last snapshot. When it changes the puck was served: rebased without easing. */
  score: string;
}

export const predict = (): Prediction => ({
  w: createWorld(),
  o: [0, 0],
  t: -1,
  hold: 0,
  score: '',
});

/** Steps w up to now. */
const advance = (p: Prediction, now: number): void => {
  const { w } = p;
  const k = w.puck;
  p.t = Math.max(p.t, now - MAX_CATCH_UP * DT);
  for (; p.t + DT <= now; p.t += DT) {
    const { x, y } = k;
    const goal = step(w, DT / 1000);
    if (goal != -1) {
      // The host owns the score and the serve: undo both.
      w.score[goal]--;
      p.wait = true;
    }
    if (p.wait) {
      Object.assign(k, { x, y, vx: 0, vy: 0 });
    }
    if (p.me && w.hit == p.me.id) {
      p.hold = p.t + GRACE;
    }
    p.o[0] *= EASE;
    p.o[1] *= EASE;
  }
};

const paddle = ({ id, x, y }: Snapshot['paddles'][number]): Paddle => ({
  id,
  team: x > W / 2 ? 1 : 0,
  x,
  y,
  vx: 0,
  vy: 0,
  tx: x,
  ty: y,
});

/** A snapshot arrives at now. `you` is the own paddle id. */
export const rebase = (p: Prediction, s: Snapshot, you: number, now: number): void => {
  const { w } = p;
  const k = w.puck;
  const n = s.puck;
  const served = p.score != (p.score = s.score + '');
  const jump = p.off || p.t < 0 || served;
  if (!jump) {
    advance(p, now);
  }
  w.paddles = s.paddles.map(q => (q.id == you && p.me?.id == you && !p.off ? p.me : paddle(q)));
  p.me = w.paddles.find(q => q.id == you);
  if (!jump && now < p.hold && n.vx * k.vx + n.vy * k.vy < 0) {
    // The host has not seen our hit yet.
    return;
  }
  // Where the puck is drawn at now (see view) minus where the host has it: the gap to fade.
  const r = (now - p.t) / 1000;
  p.o = jump ? [0, 0] : [p.o[0] + k.x + k.vx * r - n.x, p.o[1] + k.y + k.vy * r - n.y];
  p.t = now;
  p.hold = 0;
  p.wait = false;
  Object.assign(k, n);
};

/**
 * Phase change: the host respawns paddles and maybe serves, so the own paddle and the puck
 * restart from the next snapshot.
 */
export const reset = (p: Prediction, phase: Phase): void => {
  p.me = undefined;
  p.score = '';
  p.off = phase == 'break' || phase == 'end';
};

/**
 * The state to draw at now: the snapshot interpolated in the past (s) for the other paddles and
 * the score, the local puck and own paddle in the present. `target`: the clamped pointer.
 */
export const view = (
  p: Prediction,
  s: Snapshot | undefined,
  now: number,
  target?: [number, number],
): Snapshot | undefined => {
  const { me, w } = p;
  if (!s || p.off || p.t < 0) {
    return s;
  }
  if (me && target) {
    [me.tx, me.ty] = target;
  }
  advance(p, now);
  const k = w.puck;
  // w stands up to one step behind now: the puck is drawn where it gets at now.
  const r = (now - p.t) / 1000;
  return {
    ...s,
    puck: { ...k, x: k.x + p.o[0] + k.vx * r, y: k.y + p.o[1] + k.vy * r },
    paddles: s.paddles.map(q => (q.id == me?.id ? me : q)),
  };
};
