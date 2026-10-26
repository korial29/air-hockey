// Fixed-step physics, shared by the host (authoritative) and the client (paddle prediction).
// Paddles are kinematic (infinite mass): they push the puck, the puck never pushes them,
// except when it is pinned against a wall (see the last pass of `step`). Obstacles are kinematic
// too: they push both, and kick the puck away like pinball bumpers. The host's puck breaks them
// (see bump): a removed obstacle touches nothing until it comes back, RESPAWN ticks later.
// The rink is W · s × H · s for the world's size s: goals, serve spots and top speeds scale with
// it, the radii do not.
import { fixed, obstacles } from './arena';
import {
  GOAL,
  H,
  ICEBERG_HP,
  PADDLE_MAX_SPEED,
  PADDLE_R,
  PUCK_MAX_SPEED,
  PUCK_R,
  RESPAWN,
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
/** Paddle-puck contact distance. */
const RR = PUCK_R + PADDLE_R;

const cl = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** Bounces a velocity component off a wall whose inward direction is `n` (+1 or -1). */
const bounce = (v: number, n: number): number => (v * n < 0 ? -v * E : v);

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

/** Whether obstacle i is out of play (removed, ghost included): it touches nothing. */
const off = (w: World, i: number): boolean => (w.obs[i]?.gone ?? -1) >= 0;

/**
 * Puck against the obstacles in play: out of them, bounce on the relative velocity (penguins
 * and sharks move), then the kick: it leaves at KICK · size at least, the push added along the
 * normal. Records w.bumps.
 * On the host (`was`: the bumps of the previous step) a new contact is a hit: one that did not
 * touch that obstacle in the previous step, nor earlier in this one, so a puck held against it
 * counts once. A fixed obstacle (iceberg, rock) goes at its ICEBERG_HP-th hit, a mover (penguin,
 * shark) at the first one, removed at once at the tick this step lands on. The puck bounces and
 * gets the kick all the same.
 */
const bump = (w: World, obs: Obstacle[], was?: number[]): void =>
  obs.forEach((o, i) => {
    const k = w.puck;
    const kick = KICK * w.size;
    if (!w.live || off(w, i) || !out(k, o, o.r + PUCK_R, put, w.size)) {
      return;
    }
    const d = Math.hypot(k.x - o.x, k.y - o.y);
    const nx = (k.x - o.x) / d;
    const ny = (k.y - o.y) / d;
    const vn = (k.vx - o.vx) * nx + (k.vy - o.vy) * ny;
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
    if (!w.bumps.includes(i)) {
      w.bumps.push(i);
      if (was && !was.includes(i)) {
        const st = (w.obs[i] ??= { hits: 0, gone: -1, angle: 0 });
        // From the puck to the obstacle's centre at impact: where a shot-out penguin flies.
        st.angle = Math.atan2(-ny, -nx);
        if (++st.hits >= (fixed(o) ? ICEBERG_HP : 1)) {
          st.gone = w.tick + 1;
        }
      }
    }
  });

/** A paddle out of the obstacles in play: it slides around them. */
const avoid = (p: Paddle, w: World, obs: Obstacle[]): void =>
  obs.forEach((o, i) => off(w, i) || out(p, o, o.r + PADDLE_R, place, w.size, true));

/** Empty world at tick 0: puck at the centre, no paddles, 0-0, every obstacle in play, intact. */
export const createWorld = (arena: Arena = 'ice', size = 1, count = 7): World => ({
  arena,
  size,
  count,
  tick: 0,
  bumps: [],
  live: false,
  obs: obstacles(arena, 0, size, count).map(() => ({ hits: 0, gone: -1, angle: 0 })),
  puck: { x: (W * size) / 2, y: (H * size) / 2, vx: 0, vy: 0 },
  paddles: [],
  score: [0, 0],
  hit: -1,
});

/**
 * Spawn point for the n-th paddle of a team, spread over its half of a rink of that size.
 * Four columns of three, from the goal outward; the column next to the serve spot
 * (W / 4 from the goal) is 100 units away from it, more than PUCK_R + PADDLE_R. The last two
 * columns stand either side of the icebergs (x 450-460), the last one clear of the nearest
 * penguin lane (x 720): no obstacle ever covers a spawn point. A shark swinging out of that lane
 * grazes the last column at sea (a tenth of a unit clear); it is clear by the full margin at tick
 * 0, when a round starts.
 * Past 12 paddles the grid repeats, shifted down by 60 units.
 * All of it is drawn on the base rink and scaled with the obstacles, so every clearance grows.
 */
export const spawnPoint = (team: Team, n: number, size = 1): [number, number] => {
  const x = [100, 210, 320, 600][((n / 3) | 0) % 4] * size;
  const y = (H / 2 + [0, -0.3, 0.3][n % 3] * H + 60 * ((n / 12) | 0)) * size;
  return clampPaddle(team, team ? W * size - x : x, y, size);
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
 * Penguins and sharks (zig-zag included) move under 1.4 units per step: puck to obstacle closes
 * at most 11.4 < 40 + 28 (the smallest obstacle, a penguin), paddle to obstacle 31.4 < 40 + 44.
 * On a bigger rink top speeds grow with the size, so the step runs in ceil(size) sub-steps, the
 * obstacles taken at fractional ticks: the distances per sub-step stay those above.
 */
export const step = (w: World, dt: number, host = true): Team | -1 => {
  const was = host ? w.bumps : undefined;
  w.hit = -1;
  w.bumps = [];
  let goal: Team | -1 = -1;
  const n = Math.ceil(w.size);
  const at = (i: number) => obstacles(w.arena, w.tick + i / n, w.size, w.count);
  if (dt > 0) {
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
  const [tx, ty] = clampPaddle(p.team, p.tx, p.ty, s);
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
  const obs = obstacles(w.arena, w.tick, w.size, w.count);
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

  const f = DRAG ** dt;
  k.vx *= f;
  k.vy *= f;
  k.x += k.vx * dt;
  k.y += k.vy * dt;

  // Paddle hits: push the puck out along the normal, bounce on the relative velocity.
  for (const p of w.paddles) {
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
        w.live = false;
        k.x = i > 0 ? X / 4 : (3 * X) / 4;
        k.y = Y / 2;
        k.vx = k.vy = 0;
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
    w.hit = hit;
  }
  bump(w, obs, was);

  // Whatever overlap is left (puck pinned against a wall, an obstacle or squeezed between paddles,
  // paddle on the serve spot) pushes the paddle back, sliding along the centre line, a wall or an
  // obstacle that stops it. A paddle that still cannot yield moves the puck instead, and the
  // obstacles push the puck out again. Four passes leave < 0.1 units of overlap with 6 paddles,
  // under a unit in a rare 16-paddle scrum against an obstacle.
  for (let n = 0; n < 4; n++) {
    for (const p of w.paddles) {
      if (out(p, k, RR, place, s)) {
        w.hit = p.id;
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
