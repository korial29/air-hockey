// Client prediction: a local World stepped with the host's physics, no DOM, unit-tested.
// The own paddle moves toward the pointer exactly like on the host. The puck is rebased on each
// snapshot (taken as the host state at its arrival) and simulated forward, so a fast puck is
// drawn where it is and an own hit redirects it at once. Other paddles stand at their latest
// snapshot position for collisions; they are drawn interpolated, INTERP_DELAY in the past.
// Obstacles follow the world tick, rebased on the snapshot tick: the arena is a pure function of
// it, so the local puck bounces off the same penguins as the host's.
import { GOAL, H, PUCK_R, TICK_HZ, W } from '../shared/constants';
import { createWorld, step } from '../shared/physics';
import type { Arena, Paddle, Phase, Snapshot, World } from '../shared/types';

/** Physics step, in ms. */
const DT = 1000 / TICK_HZ;
/** Share of the drawn puck correction left after one step: half gone in ~35 ms, whatever TICK_HZ. */
const EASE = 0.85 ** (120 / TICK_HZ);
/** After an own hit, snapshots that do not show it yet are ignored for this long, in ms. */
const GRACE = 200;
/** Steps replayed at most per advance, so a stalled tab does not spiral. */
const MAX_CATCH_UP = 20;

const cl = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

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
  /**
   * hits[i]: time (ms, the clock of `now`) of the last local puck contact with obstacle i of
   * obstacles(w.arena, tick), undefined before any. For hit animations.
   */
  hits: number[];
}

/** w.arena comes from the match message, through reset. */
export const predict = (): Prediction => ({
  w: createWorld(),
  o: [0, 0],
  t: -1,
  hold: 0,
  score: '',
  hits: [],
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
    w.bumps.forEach(i => (p.hits[i] = p.t + DT));
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
  w.tick = s.tick;
  Object.assign(k, n);
};

/**
 * Phase change: the host respawns paddles and maybe serves, so the own paddle and the puck
 * restart from the next snapshot. `arena`: the host's, from the same match message.
 */
export const reset = (p: Prediction, phase: Phase, arena: Arena): void => {
  p.w.arena = arena;
  p.me = undefined;
  p.score = '';
  p.off = phase == 'break' || phase == 'end';
};

/**
 * The state to draw at now: the snapshot interpolated in the past (s) for the other paddles and
 * the score, the local puck and own paddle in the present. `target`: the clamped pointer.
 * Its tick is the fractional world tick at now: draw obstacles(p.w.arena, tick) with it. While
 * the host is frozen (break, end) s comes back as is, its tick still.
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
  // That push and the correction ignore the walls: keep the drawn puck off the boards (it may
  // only go past a goal line in front of the mouth), or it would dip in and out on a bounce.
  const y = cl(k.y + p.o[1] + k.vy * r, PUCK_R, H - PUCK_R);
  let x = k.x + p.o[0] + k.vx * r;
  if (Math.abs(y - H / 2) > GOAL / 2) {
    x = cl(x, PUCK_R, W - PUCK_R);
  }
  return {
    ...s,
    tick: w.tick + (now - p.t) / DT,
    puck: { ...k, x, y },
    paddles: s.paddles.map(q => (q.id == me?.id ? me : q)),
  };
};
