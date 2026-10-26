// Client prediction: a local World stepped with the host's physics, no DOM, unit-tested.
// The own paddle moves toward the pointer exactly like on the host. The puck is rebased on each
// snapshot (taken as the host state at its arrival) and simulated forward, so a fast puck is
// drawn where it is and an own hit redirects it at once. Other paddles stand at their latest
// snapshot position for collisions; they are drawn interpolated, INTERP_DELAY in the past.
// Obstacles follow the world tick, rebased on the snapshot tick: the arena is a pure function of
// it, so the local puck bounces off the same penguins as the host's. The scene, rink size,
// obstacle count and seed come from the match message, through reset: the own paddle gets the
// host's clamp and speeds, the local puck the round's obstacles, icebergs where the host put them.
// Which obstacles are in play is the host's call: w.obs is rebuilt from every snapshot, so the
// local puck goes through what the host removed. Local steps never damage an obstacle; they only
// bring one back when its RESPAWN is up, as the host does on the same tick.
// For the renderer: view(...).obs[i] is obstacle i of obstacles(arena, view(...).tick, size,
// count, seed) (hits; since: ticks since removal, fractional, -1 in play; angle). Removed for
// since in [0, RESPAWN), a ghost from RESPAWN - GHOST. P.hits keeps the local contact times.
// During the countdown (phase 'ready') the local world moves the paddles only, like the host: the
// own paddle follows the pointer, the puck, the obstacles and the tick stay on the snapshot's.
import { GOAL, H, PUCK_R, TICK_HZ, W } from '../shared/constants';
import { createWorld, skate, step } from '../shared/physics';
import type { Arena, Paddle, Phase, Snapshot, World } from '../shared/types';

/** Physics step, in ms. */
const DT = 1000 / TICK_HZ;
/** Share of the drawn puck correction left after one step: half gone in ~35 ms, whatever TICK_HZ. */
const EASE = 0.85 ** (120 / TICK_HZ);
/** After an own hit, snapshots that do not show it yet are ignored for this long, in ms. */
const GRACE = 200;
/** Steps replayed at most per advance, so a stalled tab does not spiral. */
const MAX_CATCH_UP = 20;
/**
 * w.tick runs this far ahead of the host's u16 tick: obstacles repeat over it, and an obstacle
 * removed `since` ticks ago (since < 65536) gets a tick gone = w.tick - since that is never -1,
 * the in-play mark, nor negative.
 */
const WRAP = 65536;

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
  /** Phase 'ready': local steps move the paddles only (skate). */
  ready?: boolean;
  /** Score of the last snapshot. When it changes the puck was served: rebased without easing. */
  score: string;
  /**
   * hits[i]: time (ms, the clock of `now`) of the last local puck contact with obstacle i of
   * obstacles(w.arena, tick, w.size, w.count, w.seed), undefined before any. For hit animations.
   */
  hits: number[];
}

/** w.arena, w.size, w.count and w.seed come from the match message, through reset. */
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
    if (p.ready) {
      skate(w, DT / 1000);
      continue;
    }
    const { x, y } = k;
    const goal = step(w, DT / 1000, false);
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

const paddle = ({ id, x, y }: Snapshot['paddles'][number], size: number): Paddle => ({
  id,
  team: x > (W * size) / 2 ? 1 : 0,
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
  w.paddles = s.paddles.map(q =>
    q.id == you && p.me?.id == you && !p.off ? p.me : paddle(q, w.size),
  );
  p.me = w.paddles.find(q => q.id == you);
  // Unless the host has not seen our hit yet (its puck still runs against ours): then the local
  // puck and tick stay.
  if (jump || now >= p.hold || n.vx * k.vx + n.vy * k.vy >= 0) {
    // Where the puck is drawn at now (see view) minus where the host has it: the gap to fade.
    const r = (now - p.t) / 1000;
    p.o = jump ? [0, 0] : [p.o[0] + k.x + k.vx * r - n.x, p.o[1] + k.y + k.vy * r - n.y];
    p.t = now;
    p.hold = 0;
    p.wait = false;
    w.tick = s.tick + WRAP;
    w.live = !!s.live;
    Object.assign(k, n);
  }
  // The host's obstacles, in any case: what it removed lets the local puck through at once.
  w.obs = (s.obs ?? []).map(({ hits, since, angle }) => ({
    hits,
    gone: since < 0 ? -1 : w.tick - since,
    angle,
  }));
};

/**
 * Phase change: the host respawns paddles and maybe serves, so the own paddle and the puck
 * restart from the next snapshot. `arena`, `size`, `count` and `seed`: the host's rink, from the
 * same match message (the scene and the icebergs' places change between rounds). Another scene,
 * obstacle count or seed makes other obstacles: their hit times and states go, all in play until
 * the next snapshot tells.
 */
export const reset = (
  p: Prediction,
  phase: Phase,
  arena: Arena,
  size = 1,
  count = 7,
  seed = 0,
): void => {
  const { w } = p;
  if (count != w.count || arena != w.arena || seed != w.seed) {
    p.hits.length = 0;
    w.obs = [];
  }
  Object.assign(w, { arena, size, count, seed });
  p.me = undefined;
  p.score = '';
  p.off = phase == 'break' || phase == 'end';
  p.ready = phase == 'ready';
};

/**
 * The state to draw at now: the snapshot interpolated in the past (s) for the other paddles and
 * the score, the local puck and own paddle in the present. `target`: the clamped pointer.
 * Its tick is the fractional world tick at now: draw obstacles(p.w.arena, tick, p.w.size,
 * p.w.count, p.w.seed) with it. Its obs are the host's latest obstacle states, `since` counted up
 * to that tick (fractional): removals, ghosts and returns animate smoothly between snapshots.
 * While the host is frozen (break, end) s comes back as is, its tick and obs still. In the
 * countdown (ready) only the own paddle moves: the tick is the snapshot's, not counted up.
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
  const f = p.ready ? 0 : (now - p.t) / DT;
  // That push and the correction ignore the walls: keep the drawn puck off the boards (it may
  // only go past a goal line in front of the mouth), or it would dip in and out on a bounce.
  const { size } = w;
  const y = cl(k.y + p.o[1] + k.vy * r, PUCK_R, H * size - PUCK_R);
  let x = k.x + p.o[0] + k.vx * r;
  if (Math.abs(y - (H * size) / 2) > (GOAL * size) / 2) {
    x = cl(x, PUCK_R, W * size - PUCK_R);
  }
  return {
    ...s,
    tick: w.tick - WRAP + f,
    puck: { ...k, x, y },
    paddles: s.paddles.map(q => (q.id == me?.id ? me : q)),
    obs: w.obs.map(({ hits, gone, angle }) => ({
      hits,
      since: gone < 0 ? -1 : w.tick - gone + f,
      angle,
    })),
  };
};
