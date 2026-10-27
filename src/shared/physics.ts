// Fixed-step physics, shared by the host (authoritative) and the client (paddle prediction).
// Paddles are kinematic (infinite mass): they push the puck, the puck never pushes them,
// except when it is pinned against a wall (see the last pass of `step`). In a crowded crease only
// the defender nearest the goal does; the puck goes through the others (see solid). Obstacles are
// kinematic too: they push both, and kick the puck away like pinball bumpers, but for those that
// grab it: a whirlwind spins it round and flings it out, a vortex sucks it under and lets it up
// elsewhere, a shark eats it and spits it out in a random direction (see twirl). A genie makes it
// vanish, served again on the centre spot, and its spell paralyses whoever touched it last for
// STUN ticks: that paddle stays put (see drive). The host's puck breaks them (see bump): a removed
// obstacle touches nothing until it comes back, RESPAWN ticks later.
// The rink is W · s × H · s for the world's size s: goals, serve spots and top speeds scale with
// it, the radii do not.
import { draw, fixed, obstacles, swirl } from './arena';
import {
  CREASE,
  GOAL,
  H,
  ICEBERG_HP,
  PADDLE_MAX_SPEED,
  PADDLE_R,
  PUCK_MAX_SPEED,
  PUCK_R,
  RESPAWN,
  STUN,
  W,
} from './constants';
import type { Arena, Obstacle, Paddle, Puck, Team, World } from './types';

/** Restitution of walls, posts and paddle hits. */
const E = 0.9;
/** Share of the puck speed kept after one second of sliding. */
const DRAG = 0.7;
/** Minimum speed of a puck whose centre is past a goal line, so it always drops in (× size). */
const SLOT_SPEED = 300;
/** Minimum speed of a puck leaving an obstacle: the pinball kick (× size). */
const KICK = 1000;
/** Turns per second of a puck caught in a whirlwind. */
export const TURNS = 2.5;
/**
 * Seconds a whirlwind holds the puck: HOLD, plus up to SWAY drawn at random. SWAY is 2 turns, so
 * the puck leaves in any direction.
 */
export const HOLD = 0.6;
export const SWAY = 0.8;
/** Speed a whirlwind flings the puck out at, a shark spits it at (× size). */
export const FLING = 1400;
/** Seconds a shark keeps the puck in its belly. */
export const CHEW = 0.6;
/** A puck coming up from a vortex stays this far from the goal lines (× size). */
const SHORE = 300;
/** Speed a caught puck sinks into a whirlwind's eye or a vortex and comes back out at, units/s. */
const SINK = 600;
/** Clearance a served puck keeps from paddles and obstacles, and the step between serve spots tried. */
const SERVE_GAP = 40;
const SERVE_STEP = 160;
/** Paddle-puck contact distance. */
const RR = PUCK_R + PADDLE_R;

const cl = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** Bounces a velocity component off a wall whose inward direction is `n` (+1 or -1). */
const bounce = (v: number, n: number): number => (v * n < 0 ? -v * E : v);

/**
 * The paddles the puck meets, on a rink of that size. In the crease of its own goal (CREASE ·
 * size round the middle of the mouth) only the paddle nearest the goal stops the puck, the lower
 * id on a tie: the others there are ghosts it goes through, so a wall of defenders cannot shut
 * the goal. Outside the crease every paddle is solid. From positions alone: host and prediction
 * agree.
 */
export const solid = <T extends Pick<Paddle, 'id' | 'team' | 'x' | 'y'>>(
  ps: T[],
  size = 1,
): T[] => {
  const d = (p: T) => Math.hypot(p.x - p.team * W * size, p.y - (H * size) / 2);
  const inside = (p: T) => d(p) <= CREASE * size;
  return ps.filter(
    p =>
      !inside(p) ||
      !ps.some(
        q =>
          q != p && q.team == p.team && inside(q) && (d(q) < d(p) || (d(q) == d(p) && q.id < p.id)),
      ),
  );
};

/** Clamps a paddle centre to its team's half and inside the walls of a rink of that size. */
export const clampPaddle = (team: Team, x: number, y: number, size = 1): [number, number] => {
  const h = (W * size) / 2;
  const l = team ? h + PADDLE_R : PADDLE_R;
  return [cl(x, l, l + h - 2 * PADDLE_R), cl(y, PADDLE_R, H * size - PADDLE_R)];
};

const place = (p: Paddle, x: number, y: number, s: number): void => {
  [p.x, p.y] = clampPaddle(p.team, x, y, s);
};

/** Puck counterpart of place: kept between the top and bottom walls. */
const put = (k: Puck, x: number, y: number, s: number): void => {
  k.x = x;
  k.y = cl(y, PUCK_R, H * s - PUCK_R);
};

/**
 * Pushes c out of circle o (an obstacle, the puck, a paddle) to the contact distance D, through
 * fix (place or put). When a wall stops it, it slides along that wall instead: a penguin at a
 * board squeezes it out sideways. `past` (a paddle out of an obstacle): cornered there, where
 * a board meets the centre line, it slips past to the obstacle's far side. Returns whether c was
 * inside.
 */
const out = <T extends Puck | Paddle>(
  c: T,
  o: Puck | Obstacle,
  D: number,
  fix: (c: T, x: number, y: number, s: number) => void,
  s: number,
  past = false,
): boolean => {
  let nx = c.x - o.x;
  let ny = c.y - o.y;
  let d = Math.hypot(nx, ny);
  if (d >= D) {
    return false;
  }
  if (!d) {
    nx = d = 1;
  }
  const y = o.y + (ny / d) * D;
  fix(c, o.x + (nx / d) * D, y, s);
  nx = c.x - o.x;
  ny = c.y - o.y;
  if (nx * nx + ny * ny < D * D) {
    // The top or bottom wall held it: slide along x. Else the centre line or a side wall: along y.
    const along = c.y != y;
    const slide = (k: number): void =>
      along
        ? fix(c, o.x + k * (nx < 0 ? -1 : 1) * Math.sqrt(D * D - ny * ny), c.y, s)
        : fix(c, c.x, o.y + k * (ny < 0 ? -1 : 1) * Math.sqrt(D * D - nx * nx), s);
    slide(1);
    // Still inside (beyond rounding): a wall holds it on the near side too, a corner. Past: far side.
    if (past && Math.hypot(c.x - o.x, c.y - o.y) < D - 1e-6) {
      slide(-1);
    }
  }
  return true;
};

/** Whether a puck at x, y stands clear of every paddle and obstacle, by SERVE_GAP. */
const clear = (w: World, obs: Obstacle[], x: number, y: number): boolean =>
  w.paddles.every(p => Math.hypot(p.x - x, p.y - y) > RR + SERVE_GAP) &&
  obs.every(o => Math.hypot(o.x - x, o.y - y) > o.r + PUCK_R + SERVE_GAP);

/**
 * Serves the puck at rest at x, on the centre row or the nearest clear spot along it, not in play:
 * a paddle left on the spot would otherwise shove the puck the moment it appears, into a goal
 * again and again.
 */
const serve = (w: World, obs: Obstacle[], x: number): void => {
  const k = w.puck;
  const Y = H * w.size;
  w.live = false;
  [k.x, k.y, k.vx, k.vy] = [x, Y / 2, 0, 0];
  for (const f of [0, -1, 1, -2, 2]) {
    if (clear(w, obs, x, Y / 2 + f * SERVE_STEP * w.size)) {
      k.y = Y / 2 + f * SERVE_STEP * w.size;
      break;
    }
  }
};

/** Whether obstacle i is out of play (removed, ghost included): it touches nothing. */
const off = (w: World, i: number): boolean => (w.obs[i]?.gone ?? -1) >= 0;

/** Times each obstacle was removed this round: where the icebergs stand (see obstacles). */
const times = (w: World) => w.obs.map(o => o.times);

/** The obstacles of the world at its tick, where they stand. */
export const standing = (w: World): Obstacle[] =>
  obstacles(w.arena, w.tick, w.size, w.count, w.seed, times(w));

/**
 * Puck against the obstacles in play: out of them, bounce on the relative velocity (penguins,
 * sharks and genies move), then the kick: it leaves at KICK · size at least, the push added along
 * the normal. A whirlwind, a vortex or a shark grabs the puck instead (w.held, see twirl).
 * Records w.bumps. A shark keeps it CHEW seconds; the others HOLD + SWAY · a draw of the seed and
 * the u16 tick of the catch: host and prediction draw the same.
 * On the host (`was`: the bumps of the previous step) a new contact is a hit: one that did not
 * touch that obstacle in the previous step, nor earlier in this one, so a puck held against it
 * counts once. A fixed obstacle (iceberg, vortex, whirlwind) goes at its ICEBERG_HP-th hit, a
 * penguin or a genie at the first one, removed at once at the tick this step lands on; a shark
 * never goes. The puck bounces and gets the kick all the same; a whirlwind or a vortex that goes
 * lets go of it at once.
 */
const bump = (w: World, obs: Obstacle[], was?: number[]): void =>
  obs.forEach((o, i) => {
    const k = w.puck;
    const kick = KICK * w.size;
    if (!w.live || w.held >= 0 || off(w, i) || !out(k, o, o.r + PUCK_R, put, w.size)) {
      return;
    }
    const d = Math.hypot(k.x - o.x, k.y - o.y);
    const nx = (k.x - o.x) / d;
    const ny = (k.y - o.y) / d;
    const vn = (k.vx - o.vx) * nx + (k.vy - o.vy) * ny;
    if (['whirlwind', 'vortex', 'shark'].includes(o.kind)) {
      w.held = i;
      w.left = o.kind == 'shark' ? CHEW : HOLD + SWAY * draw(w.seed, w.tick & 0xffff);
    }
    if (o.kind == 'genie') {
      // The puck vanishes, served again on the centre spot; on the host, the genie's spell strikes
      // whoever touched it last: paralysed STUN ticks.
      serve(w, obs, (W * w.size) / 2);
      const p = was && w.paddles.find(p => p.id == w.last);
      if (p) {
        p.stun = STUN;
      }
    } else {
      if (vn < 0) {
        k.vx -= (1 + E) * vn * nx;
        k.vy -= (1 + E) * vn * ny;
      }
      const s = Math.hypot(k.vx, k.vy);
      if (s < kick) {
        // Smallest push along the normal that brings the speed to the kick.
        const un = k.vx * nx + k.vy * ny;
        const a = Math.sqrt(un * un - s * s + kick * kick) - un;
        k.vx += a * nx;
        k.vy += a * ny;
      }
    }
    if (!w.bumps.includes(i)) {
      w.bumps.push(i);
      if (was && !was.includes(i)) {
        const st = (w.obs[i] ??= { hits: 0, gone: -1, angle: 0 });
        // From the puck to the obstacle's centre at impact: where a shot-out penguin flies.
        st.angle = Math.atan2(-ny, -nx);
        if (o.kind != 'shark' && ++st.hits >= (fixed(o) ? ICEBERG_HP : 1)) {
          st.gone = w.tick + 1;
          st.times = ((st.times ?? 0) + 1) & 255;
        }
      }
    }
  });

/**
 * A grabbed puck for dt, by obstacle w.held of obs, until w.left runs out or the obstacle goes:
 * - a whirlwind turns it TURNS a second in its sense (swirl), sinking at SINK to the eye's edge
 *   (o.r - PUCK_R: no paddle reaches it there), back out to the rim in time. Then it flies off
 *   along its circle at FLING · size from just past the rim, from where it turned to: a random
 *   direction.
 * - a vortex turns it the same way down to its centre, under the water. Then it comes up at rest
 *   on the first of five spots drawn from the seed and the u16 tick that stands clear (or the
 *   last one): anywhere on the rink but within SHORE of a goal line, in mirror for a vortex right
 *   of the centre line.
 * - a shark keeps it in its belly, at its centre, then spits it at FLING · size from just past
 *   its rim in a direction drawn from the seed and the u16 tick: aimed at a player, it would set
 *   two of them shooting it back and forth through the shark.
 * Its velocity follows its motion, for drawing between steps.
 */
const twirl = (w: World, obs: Obstacle[], dt: number): void => {
  const k = w.puck;
  const o = obs[w.held];
  const s = w.size;
  const d = swirl(o, s);
  const a = Math.atan2(k.y - o.y, k.x - o.x) + d * TURNS * 2 * Math.PI * dt;
  let r = Math.hypot(k.x - o.x, k.y - o.y);
  w.left -= dt;
  // Lets go once the time is up, rounding errors of the sum of steps aside.
  const gone = w.left < 1e-9 || off(w, w.held);
  // A whirlwind lets it out once the time left only just covers the way from the eye's edge to the
  // rim. Flung from the rim, whatever the last step left.
  r =
    o.kind == 'shark'
      ? 0
      : gone
        ? o.r + PUCK_R + 1
        : r +
          cl(
            (o.kind == 'vortex' ? 0 : w.left * SINK < 2 * PUCK_R ? o.r + PUCK_R : o.r - PUCK_R) - r,
            -SINK * dt,
            SINK * dt,
          );
  const x = o.x + Math.cos(a) * r;
  const y = o.y + Math.sin(a) * r;
  // In a shark's belly it swims along: no jump from its rim to its centre.
  [k.vx, k.vy] = o.kind == 'shark' ? [o.vx, o.vy] : [(x - k.x) / dt, (y - k.y) / dt];
  [k.x, k.y] = [x, y];
  if (!gone) {
    return;
  }
  w.held = -1;
  k.vx = -Math.sin(a) * d * FLING * s;
  k.vy = Math.cos(a) * d * FLING * s;
  const t = (w.tick & 0xffff) * 10;
  if (o.kind == 'vortex') {
    for (let j = 0; j < 10; j += 2) {
      k.x = (SHORE + (W - 2 * SHORE) * draw(w.seed, t + j)) * s;
      k.x = d > 0 ? k.x : W * s - k.x;
      k.y = PUCK_R + (H * s - 2 * PUCK_R) * draw(w.seed, t + j + 1);
      if (clear(w, obs, k.x, k.y)) {
        break;
      }
    }
    k.vx = k.vy = 0;
  }
  if (o.kind == 'shark') {
    const b = 2 * Math.PI * draw(w.seed, t);
    const [ux, uy] = [Math.cos(b), Math.sin(b)];
    put(k, o.x + ux * (o.r + PUCK_R + 1), o.y + uy * (o.r + PUCK_R + 1), s);
    k.vx = ux * FLING * s;
    k.vy = uy * FLING * s;
  }
};

/** A paddle out of the obstacles in play: it slides around them. */
const avoid = (p: Paddle, w: World, obs: Obstacle[]): void =>
  obs.forEach((o, i) => off(w, i) || out(p, o, o.r + PADDLE_R, place, w.size, true));

/** Empty world at tick 0: puck at the centre, no paddles, 0-0, every obstacle in play, intact. */
export const createWorld = (arena: Arena = 'ice', size = 1, count = 7, seed = 0): World => ({
  arena,
  size,
  count,
  seed,
  tick: 0,
  bumps: [],
  live: false,
  held: -1,
  left: 0,
  obs: obstacles(arena, 0, size, count, seed).map(() => ({ hits: 0, gone: -1, angle: 0 })),
  puck: { x: (W * size) / 2, y: (H * size) / 2, vx: 0, vy: 0 },
  paddles: [],
  score: [0, 0],
  hit: -1,
});

/**
 * Spawn point for the n-th paddle of a team, spread over its half of a rink of that size: the
 * n-th spot of the grid below that no obstacle of obs covers (10 units clear).
 * Four columns of three, from the goal outward; the column next to the serve spot
 * (W / 4 from the goal) is 100 units away from it, more than PUCK_R + PADDLE_R. The icebergs
 * stand on cells of the same area (see CELLS in arena.ts), so a spot under one is skipped; the
 * last column is clear of the nearest penguin lane (x 720). A shark swinging out of that lane
 * grazes the last column at sea (a tenth of a unit clear); it is clear by the full margin at
 * tick 0, when a round starts. Past 12 spots the grid repeats, shifted down by 60 units.
 * All of it is drawn on the base rink and scaled with the obstacles, so every clearance grows.
 */
export const spawnPoint = (
  team: Team,
  n: number,
  size = 1,
  obs: Obstacle[] = [],
): [number, number] => {
  let p: [number, number];
  let k = 0;
  do {
    const x = [100, 210, 320, 600][((k / 3) | 0) % 4] * size;
    const y = (H / 2 + [0, -0.3, 0.3][k % 3] * H + 60 * ((k++ / 12) | 0)) * size;
    p = clampPaddle(team, team ? W * size - x : x, y, size);
  } while (obs.some(o => Math.hypot(p[0] - o.x, p[1] - o.y) <= o.r + PADDLE_R + 10) || n-- > 0);
  return p;
};

/**
 * Advances the world by dt seconds (always 1 / TICK_HZ in practice) and w.tick by one.
 * Moves paddles toward their target, moves the puck, resolves collisions with the obstacles
 * of the arena at the new tick.
 * On a goal it bumps the score, re-serves the puck and returns the scoring team; -1 otherwise.
 * Sets w.hit to the paddle that touched the puck during the step (the last one if several), or -1,
 * and w.bumps to the obstacles it touched.
 * `host`: the authoritative world, where the puck damages the obstacles (see bump). A prediction
 * (false) bounces off the same obstacles and leaves w.obs alone but for their return.
 *
 * Obstacles due back at the new tick (gone + RESPAWN) come back first, intact. A live puck in the
 * way is pushed out gently, a unit clear: no kick, no damage, no bump. Paddles slide out of them
 * like out of any obstacle, in the sub-step.
 *
 * No tunnelling at 240 Hz: the puck moves at most 2400 / 240 = 10 units per step (< PUCK_R = 28
 * against walls and posts), a paddle 7200 / 240 = 30, so the closing distance per step is at
 * most 40 < PUCK_R + PADDLE_R = 72: an overlap is always caught before the centres cross.
 * Penguins, sharks (zig-zag included) and genies (at their fastest, mid-glide) move under 1.6
 * units per step: puck to obstacle closes at most 11.6 < 40 + 28 (the smallest obstacle, a penguin
 * or a genie), paddle to obstacle 31.6 < 40 + 44. A caught puck moves with its whirlwind's turn.
 * On a bigger rink top speeds grow with the size, so the step runs in ceil(size) sub-steps, the
 * obstacles taken at fractional ticks: the distances per sub-step stay those above.
 */
export const step = (w: World, dt: number, host = true): Team | -1 => {
  const was = host ? w.bumps : undefined;
  w.hit = -1;
  w.bumps = [];
  let goal: Team | -1 = -1;
  const n = Math.ceil(w.size);
  const at = (i: number) => obstacles(w.arena, w.tick + i / n, w.size, w.count, w.seed, times(w));
  if (dt > 0) {
    w.paddles.forEach(p => p.stun && p.stun--);
    at(1).forEach((o, i) => {
      const st = w.obs[i];
      if (st?.gone >= 0 && w.tick + 1 - st.gone >= RESPAWN) {
        Object.assign(st, { hits: 0, gone: -1 });
        if (w.live) {
          out(w.puck, o, o.r + PUCK_R + 1, put, w.size);
        }
      }
    });
  }
  for (let i = 1; dt > 0 && i <= n; i++) {
    const g = sub(w, dt / n, at(i), was);
    if (g != -1) {
      goal = g;
    }
  }
  w.tick += +(dt > 0);
  return goal;
};

/** Paddle p toward its target for dt, at most PADDLE_MAX_SPEED · size, around the obstacles obs. */
const drive = (p: Paddle, w: World, obs: Obstacle[], dt: number): void => {
  const s = w.size;
  const m = PADDLE_MAX_SPEED * s * dt;
  const ox = p.x;
  const oy = p.y;
  // Aim at the clamped target so a target across the line still gets the full speed budget.
  // Paralysed: it stays where it is (obstacles still push it).
  const [tx, ty] = p.stun ? [p.x, p.y] : clampPaddle(p.team, p.tx, p.ty, s);
  let dx = tx - ox;
  let dy = ty - oy;
  const d = Math.hypot(dx, dy);
  if (d > m) {
    dx *= m / d;
    dy *= m / d;
  }
  place(p, ox + dx, oy + dy, s);
  avoid(p, w, obs);
  p.vx = (p.x - ox) / dt;
  p.vy = (p.y - oy) / dt;
};

/**
 * The countdown before a round (phase 'ready'): step for the paddles only. They move toward their
 * targets as in step, around the obstacles where they stand and around the puck, which they never
 * push. The puck, the obstacles, w.tick, w.hit, w.live and the score stay as they are.
 */
export const skate = (w: World, dt: number): void => {
  const n = Math.ceil(w.size);
  const obs = obstacles(w.arena, w.tick, w.size, w.count, w.seed, times(w));
  for (let i = 0; i < n; i++) {
    for (const p of w.paddles) {
      drive(p, w, obs, dt / n);
      if (out(p, w.puck, RR, place, w.size)) {
        avoid(p, w, obs);
      }
    }
  }
};

/** One sub-step of step, among the obstacles obs. */
const sub = (w: World, dt: number, obs: Obstacle[], was?: number[]): Team | -1 => {
  const s = w.size;
  const k = w.puck;
  // Rink width and height, half-height of the goal mouth.
  const X = W * s;
  const Y = H * s;
  const G = (GOAL * s) / 2;
  // Paddle that touched the puck in this sub-step: it alone puts a served puck in play.
  let hit = -1;
  let goal: Team | -1 = -1;

  w.paddles.forEach(p => drive(p, w, obs, dt));
  // Where they stand now: a crowded crease leaves one of them solid.
  const ps = solid(w.paddles, s);
  // Grabbed, it only goes where its holder takes it, out of reach: paddles go round it. Let go,
  // it plays on from where it was left, this very sub-step.
  if (w.held >= 0) {
    twirl(w, obs, dt);
  }
  if (w.held >= 0) {
    ps.forEach(p => out(p, k, RR, place, s) && avoid(p, w, obs));
    return -1;
  }

  const f = DRAG ** dt;
  k.vx *= f;
  k.vy *= f;
  k.x += k.vx * dt;
  k.y += k.vy * dt;

  // Paddle hits: push the puck out along the normal, bounce on the relative velocity. Ghosts in a
  // crease let it through.
  for (const p of ps) {
    let nx = k.x - p.x;
    let ny = k.y - p.y;
    let d = Math.hypot(nx, ny);
    if (d < RR) {
      hit = p.id;
      if (!d) {
        nx = 1 - 2 * p.team;
        d = 1;
      }
      nx /= d;
      ny /= d;
      k.x = p.x + nx * RR;
      k.y = p.y + ny * RR;
      const vn = (k.vx - p.vx) * nx + (k.vy - p.vy) * ny;
      if (vn < 0) {
        k.vx -= (1 + E) * vn * nx;
        k.vy -= (1 + E) * vn * ny;
      }
    }
  }

  if (k.y < PUCK_R || k.y > Y - PUCK_R) {
    k.y = cl(k.y, PUCK_R, Y - PUCK_R);
    k.vy = bounce(k.vy, k.y < Y / 2 ? 1 : -1);
  }

  // Side walls. `i` is +1 on the left half (inward = +x), -1 on the right one.
  const i = k.x < X / 2 ? 1 : -1;
  const gx = i > 0 ? 0 : X;
  const u = (k.x - gx) * i;
  if (u < PUCK_R) {
    const dy = k.y - Y / 2;
    if (Math.abs(dy) > G) {
      // Beside the mouth: a plain wall, even for a puck a paddle squeezed past the line.
      k.x = gx + PUCK_R * i;
      k.vx = bounce(k.vx, i);
    } else if (u < 0) {
      // Past the goal line, inside the mouth: the slot walls hold it, and it keeps going in.
      if (Math.abs(dy) > G - PUCK_R) {
        k.y = Y / 2 + Math.sign(dy) * (G - PUCK_R);
        k.vy = bounce(k.vy, -Math.sign(dy));
      }
      k.vx = i * Math.min(k.vx * i, -SLOT_SPEED * s);
      if (u < -PUCK_R) {
        goal = i > 0 ? 1 : 0;
        w.score[goal]++;
        serve(w, obs, i > 0 ? X / 4 : (3 * X) / 4);
      }
    } else {
      // In front of the mouth: only the posts (its corners) bounce, as points.
      const py = Y / 2 + (dy < 0 ? -G : G);
      let nx = k.x - gx;
      let ny = k.y - py;
      const d = Math.hypot(nx, ny);
      if (d < PUCK_R && d) {
        nx /= d;
        ny /= d;
        k.x = gx + nx * PUCK_R;
        k.y = py + ny * PUCK_R;
        const vn = k.vx * nx + k.vy * ny;
        if (vn < 0) {
          k.vx -= (1 + E) * vn * nx;
          k.vy -= (1 + E) * vn * ny;
        }
      }
    }
  }

  // A paddle touch puts a served puck in play: from now on the obstacles bounce it.
  w.live ||= hit != -1;
  if (hit != -1) {
    w.hit = w.last = hit;
  }
  bump(w, obs, was);

  // Whatever overlap is left (puck pinned against a wall, an obstacle or squeezed between paddles,
  // paddle on the serve spot) pushes the paddle back, sliding along the centre line, a wall or an
  // obstacle that stops it. A paddle that still cannot yield moves the puck instead, and the
  // obstacles push the puck out again. Four passes leave < 0.1 units of overlap with 6 paddles,
  // under a unit in a rare 16-paddle scrum against an obstacle. A goalie pushed back can hand its
  // crease to a ghost already on the puck: who is solid is decided again at each pass.
  for (let n = 0; n < 4; n++) {
    for (const p of solid(w.paddles, s)) {
      if (out(p, k, RR, place, s)) {
        w.hit = w.last = p.id;
        w.live = true;
        avoid(p, w, obs);
        out(k, p, RR, put, s);
      }
    }
    bump(w, obs, was);
  }

  const v = Math.hypot(k.vx, k.vy);
  const top = PUCK_MAX_SPEED * s;
  if (v > top) {
    k.vx *= top / v;
    k.vy *= top / v;
  }
  return goal;
};
