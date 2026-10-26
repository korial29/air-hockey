// Fixed-step physics, shared by the host (authoritative) and the client (paddle prediction).
// Paddles are kinematic (infinite mass): they push the puck, the puck never pushes them,
// except when it is pinned against a wall (see the last pass of `step`).
import { GOAL, H, PADDLE_MAX_SPEED, PADDLE_R, PUCK_MAX_SPEED, PUCK_R, W } from './constants';
import type { Paddle, Team, World } from './types';

/** Restitution of walls, posts and paddle hits. */
const E = 0.9;
/** Share of the puck speed kept after one second of sliding. */
const DRAG = 0.7;
/** Minimum speed of a puck whose centre is past a goal line, so it always drops in. */
const SLOT_SPEED = 300;
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

/** Empty world: puck at the centre, no paddles, 0-0. */
export const createWorld = (): World => ({
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
 * Four columns of three, from the goal outward; the columns next to the serve spot
 * (W / 4 from the goal) are 100 units away from it, more than PUCK_R + PADDLE_R.
 * Past 12 paddles the grid repeats, shifted down by 60 units.
 */
export const spawnPoint = (team: Team, n: number): [number, number] => {
  const x = ([3, 6, 10, 13][((n / 3) | 0) % 4] * W) / 32;
  const y = H / 2 + [0, -0.3, 0.3][n % 3] * H + 60 * ((n / 12) | 0);
  return clampPaddle(team, team ? W - x : x, y);
};

/**
 * Advances the world by dt seconds (always 1 / TICK_HZ in practice).
 * Moves paddles toward their target, moves the puck, resolves collisions.
 * On a goal it bumps the score, re-serves the puck and returns the scoring team; -1 otherwise.
 *
 * No tunnelling at 120 Hz: the puck moves at most 2400 / 120 = 20 units per step (< PUCK_R = 28
 * against walls and posts), a paddle 3000 / 120 = 25, so the closing distance per step is at
 * most 45 < PUCK_R + PADDLE_R = 72: an overlap is always caught before the centres cross.
 */
export const step = (w: World, dt: number): Team | -1 => {
  if (!(dt > 0)) {
    return -1;
  }
  const k = w.puck;
  const m = PADDLE_MAX_SPEED * dt;
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
    if (u < 0) {
      // Past the goal line, inside the mouth: the slot walls hold it, and it keeps going in.
      if (Math.abs(dy) > G - PUCK_R) {
        k.y = H / 2 + Math.sign(dy) * (G - PUCK_R);
        k.vy = bounce(k.vy, -Math.sign(dy));
      }
      k.vx = i * Math.min(k.vx * i, -SLOT_SPEED);
      if (u < -PUCK_R) {
        goal = i > 0 ? 1 : 0;
        w.score[goal]++;
        k.x = i > 0 ? W / 4 : (3 * W) / 4;
        k.y = H / 2;
        k.vx = k.vy = 0;
      }
    } else if (Math.abs(dy) > G) {
      k.x = gx + PUCK_R * i;
      k.vx = bounce(k.vx, i);
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

  const s = Math.hypot(k.vx, k.vy);
  if (s > PUCK_MAX_SPEED) {
    k.vx *= PUCK_MAX_SPEED / s;
    k.vy *= PUCK_MAX_SPEED / s;
  }

  // Whatever overlap is left (puck pinned against a wall or squeezed between paddles, paddle on
  // the serve spot) pushes the paddle back, sliding along the centre line or a side wall when it
  // stands on one. A paddle that still cannot yield moves the puck instead. Three passes leave
  // < 0.002 units of overlap with 4 paddles, < 0.1 in a 16-paddle scrum.
  for (let n = 0; n < 3; n++) {
    for (const p of w.paddles) {
      let nx = p.x - k.x;
      let ny = p.y - k.y;
      let d = Math.hypot(nx, ny);
      if (d < RR && d) {
        place(p, k.x + (nx / d) * RR, k.y + (ny / d) * RR);
        // Stopped by the centre line or a side wall: slide along it to the contact distance.
        d = p.x - k.x;
        if (d * d < RR * RR) {
          place(p, p.x, k.y + (ny < 0 ? -1 : 1) * Math.sqrt(RR * RR - d * d));
        }
        nx = k.x - p.x;
        ny = k.y - p.y;
        d = Math.hypot(nx, ny);
        if (d < RR && d) {
          k.x = p.x + (nx / d) * RR;
          k.y = cl(p.y + (ny / d) * RR, PUCK_R, H - PUCK_R);
        }
      }
    }
  }
  return goal;
};
