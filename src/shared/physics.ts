// Fixed-step physics, shared by the host (authoritative) and the client (paddle prediction).
// Paddles are kinematic (infinite mass): they push the puck, the puck never pushes them,
// except when it is pinned against a wall (see the last pass of `step`). Obstacles are kinematic
// too: they push both, and kick the puck away like pinball bumpers.
import { obstacles } from './arena';
import { GOAL, H, PADDLE_MAX_SPEED, PADDLE_R, PUCK_MAX_SPEED, PUCK_R, W } from './constants';
import type { Arena, Obstacle, Paddle, Puck, Team, World } from './types';

/** Restitution of walls, posts and paddle hits. */
const E = 0.9;
/** Share of the puck speed kept after one second of sliding. */
const DRAG = 0.7;
/** Minimum speed of a puck whose centre is past a goal line, so it always drops in. */
const SLOT_SPEED = 300;
/** Minimum speed of a puck leaving an obstacle: the pinball kick. */
const KICK = 1000;
/** Paddle-puck contact distance. */
const RR = PUCK_R + PADDLE_R;
/** Range of a paddle centre x within its half. */
const X_SPAN = W / 2 - 2 * PADDLE_R;
/** Half-height of the goal mouth. */
const G = GOAL / 2;

const cl = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** Bounces a velocity component off a wall whose inward direction is `n` (+1 or -1). */
const bounce = (v: number, n: number): number => (v * n < 0 ? -v * E : v);
/** Lowest x of a paddle centre for a team; the highest is lo + X_SPAN. */
const lo = (t: Team): number => (t ? W / 2 + PADDLE_R : PADDLE_R);

const place = (p: Paddle, x: number, y: number): void => {
  const l = lo(p.team);
  p.x = cl(x, l, l + X_SPAN);
  p.y = cl(y, PADDLE_R, H - PADDLE_R);
};

/** Puck counterpart of place: kept between the top and bottom walls. */
const put = (k: Puck, x: number, y: number): void => {
  k.x = x;
  k.y = cl(y, PUCK_R, H - PUCK_R);
};

/**
 * Pushes c out of circle o (an obstacle, the puck, a paddle) to the contact distance D, through
 * fix (place or put). When a wall stops it, it slides along that wall instead: a penguin at a
 * board squeezes it out sideways. Returns whether c was inside.
 */
const out = <T extends Puck | Paddle>(
  c: T,
  o: Puck | Obstacle,
  D: number,
  fix: (c: T, x: number, y: number) => void,
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
  fix(c, o.x + (nx / d) * D, y);
  nx = c.x - o.x;
  ny = c.y - o.y;
  if (nx * nx + ny * ny < D * D) {
    // The top or bottom wall held it: slide along x. Else the centre line or a side wall: along y.
    if (c.y != y) {
      fix(c, o.x + (nx < 0 ? -1 : 1) * Math.sqrt(D * D - ny * ny), c.y);
    } else {
      fix(c, c.x, o.y + (ny < 0 ? -1 : 1) * Math.sqrt(D * D - nx * nx));
    }
  }
  return true;
};

/**
 * Puck against the obstacles: out of them, bounce on the relative velocity (penguins move), then
 * the kick: it leaves at KICK at least, the push added along the normal. Records w.bumps.
 */
const bump = (w: World, obs: Obstacle[]): void =>
  obs.forEach((o, i) => {
    const k = w.puck;
    if (!w.live || !out(k, o, o.r + PUCK_R, put)) {
      return;
    }
    if (!w.bumps.includes(i)) {
      w.bumps.push(i);
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
    if (s < KICK) {
      // Smallest push along the normal that brings the speed to KICK.
      const un = k.vx * nx + k.vy * ny;
      const a = Math.sqrt(un * un - s * s + KICK * KICK) - un;
      k.vx += a * nx;
      k.vy += a * ny;
    }
  });

/** A paddle out of the obstacles: it slides around them. */
const avoid = (p: Paddle, obs: Obstacle[]): void =>
  obs.forEach(o => out(p, o, o.r + PADDLE_R, place));

/** Empty world at tick 0: puck at the centre, no paddles, 0-0. */
export const createWorld = (arena: Arena = 'ice'): World => ({
  arena,
  tick: 0,
  bumps: [],
  live: false,
  puck: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
  paddles: [],
  score: [0, 0],
  hit: -1,
});

/** Clamps a paddle centre to its team's half and inside the walls. */
export const clampPaddle = (team: Team, x: number, y: number): [number, number] => {
  const l = lo(team);
  return [cl(x, l, l + X_SPAN), cl(y, PADDLE_R, H - PADDLE_R)];
};

/**
 * Spawn point for the n-th paddle of a team, spread over its half.
 * Four columns of three, from the goal outward; the column next to the serve spot
 * (W / 4 from the goal) is 100 units away from it, more than PUCK_R + PADDLE_R. The last two
 * columns stand either side of the icebergs (x 450-460), the last one clear of the nearest
 * penguin lane (x 720): no obstacle ever covers a spawn point.
 * Past 12 paddles the grid repeats, shifted down by 60 units.
 */
export const spawnPoint = (team: Team, n: number): [number, number] => {
  const x = [100, 210, 320, 600][((n / 3) | 0) % 4];
  const y = H / 2 + [0, -0.3, 0.3][n % 3] * H + 60 * ((n / 12) | 0);
  return clampPaddle(team, team ? W - x : x, y);
};

/**
 * Advances the world by dt seconds (always 1 / TICK_HZ in practice) and w.tick by one.
 * Moves paddles toward their target, moves the puck, resolves collisions with the obstacles
 * of the arena at the new tick.
 * On a goal it bumps the score, re-serves the puck and returns the scoring team; -1 otherwise.
 * Sets w.hit to the paddle that touched the puck during the step (the last one if several), or -1,
 * and w.bumps to the obstacles it touched.
 *
 * No tunnelling at 240 Hz: the puck moves at most 2400 / 240 = 10 units per step (< PUCK_R = 28
 * against walls and posts), a paddle 7200 / 240 = 30, so the closing distance per step is at
 * most 40 < PUCK_R + PADDLE_R = 72: an overlap is always caught before the centres cross.
 * Penguins move about 1 unit per step: puck to obstacle closes at most 11 < 40 + 28 (the
 * smallest obstacle), paddle to obstacle at most 31 < 40 + 44.
 */
export const step = (w: World, dt: number): Team | -1 => {
  w.hit = -1;
  w.bumps = [];
  if (!(dt > 0)) {
    return -1;
  }
  const k = w.puck;
  const m = PADDLE_MAX_SPEED * dt;
  const obs = obstacles(w.arena, ++w.tick);
  let goal: Team | -1 = -1;

  for (const p of w.paddles) {
    const ox = p.x;
    const oy = p.y;
    // Aim at the clamped target so a target across the line still gets the full speed budget.
    const l = lo(p.team);
    let dx = cl(p.tx, l, l + X_SPAN) - ox;
    let dy = cl(p.ty, PADDLE_R, H - PADDLE_R) - oy;
    const d = Math.hypot(dx, dy);
    if (d > m) {
      dx *= m / d;
      dy *= m / d;
    }
    place(p, ox + dx, oy + dy);
    avoid(p, obs);
    p.vx = (p.x - ox) / dt;
    p.vy = (p.y - oy) / dt;
  }

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
      w.hit = p.id;
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

  if (k.y < PUCK_R || k.y > H - PUCK_R) {
    k.y = cl(k.y, PUCK_R, H - PUCK_R);
    k.vy = bounce(k.vy, k.y < H / 2 ? 1 : -1);
  }

  // Side walls. `i` is +1 on the left half (inward = +x), -1 on the right one.
  const i = k.x < W / 2 ? 1 : -1;
  const gx = i > 0 ? 0 : W;
  const u = (k.x - gx) * i;
  if (u < PUCK_R) {
    const dy = k.y - H / 2;
    if (Math.abs(dy) > G) {
      // Beside the mouth: a plain wall, even for a puck a paddle squeezed past the line.
      k.x = gx + PUCK_R * i;
      k.vx = bounce(k.vx, i);
    } else if (u < 0) {
      // Past the goal line, inside the mouth: the slot walls hold it, and it keeps going in.
      if (Math.abs(dy) > G - PUCK_R) {
        k.y = H / 2 + Math.sign(dy) * (G - PUCK_R);
        k.vy = bounce(k.vy, -Math.sign(dy));
      }
      k.vx = i * Math.min(k.vx * i, -SLOT_SPEED);
      if (u < -PUCK_R) {
        goal = i > 0 ? 1 : 0;
        w.score[goal]++;
        w.live = false;
        k.x = i > 0 ? W / 4 : (3 * W) / 4;
        k.y = H / 2;
        k.vx = k.vy = 0;
      }
    } else {
      // In front of the mouth: only the posts (its corners) bounce, as points.
      const py = H / 2 + (dy < 0 ? -G : G);
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
  w.live ||= w.hit != -1;
  bump(w, obs);

  // Whatever overlap is left (puck pinned against a wall, an obstacle or squeezed between paddles,
  // paddle on the serve spot) pushes the paddle back, sliding along the centre line, a wall or an
  // obstacle that stops it. A paddle that still cannot yield moves the puck instead, and the
  // obstacles push the puck out again. Four passes leave < 0.1 units of overlap with 6 paddles,
  // under a unit in a rare 16-paddle scrum against an obstacle.
  for (let n = 0; n < 4; n++) {
    for (const p of w.paddles) {
      if (out(p, k, RR, place)) {
        w.hit = p.id;
        w.live = true;
        avoid(p, obs);
        out(k, p, RR, put);
      }
    }
    bump(w, obs);
  }

  const s = Math.hypot(k.vx, k.vy);
  if (s > PUCK_MAX_SPEED) {
    k.vx *= PUCK_MAX_SPEED / s;
    k.vy *= PUCK_MAX_SPEED / s;
  }
  return goal;
};
