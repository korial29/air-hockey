import { describe, expect, it } from 'vitest';
import {
  GOAL,
  H,
  PADDLE_MAX_SPEED,
  PADDLE_R,
  PUCK_MAX_SPEED,
  PUCK_R,
  TICK_HZ,
  W,
} from './constants';
import { clampPaddle, createWorld, spawnPoint, step } from './physics';
import type { Paddle, Team, World } from './types';

const DT = 1 / TICK_HZ;
const RR = PUCK_R + PADDLE_R;

const paddle = (team: Team, x: number, y: number, id = 1): Paddle => ({
  id,
  team,
  x,
  y,
  vx: 0,
  vy: 0,
  tx: x,
  ty: y,
});

const world = (x: number, y: number, vx = 0, vy = 0, paddles: Paddle[] = []): World => {
  const w = createWorld();
  Object.assign(w.puck, { x, y, vx, vy });
  w.paddles = paddles;
  return w;
};

/** Steps until a goal or `n` steps; returns the scoring team or -1. */
const run = (w: World, n: number, each?: () => void): number => {
  for (let i = 0; i < n; i++) {
    const t = step(w, DT);
    each?.();
    if (t !== -1) {
      return t;
    }
  }
  return -1;
};

const speed = (w: World): number => Math.hypot(w.puck.vx, w.puck.vy);

describe('createWorld', () => {
  it('puts the puck at rest in the centre, with no paddles and 0-0', () => {
    expect(createWorld()).toEqual({
      puck: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
      paddles: [],
      score: [0, 0],
    });
  });
});

describe('clampPaddle', () => {
  it('keeps each team in its half and inside the walls', () => {
    expect(clampPaddle(0, W, -10)).toEqual([W / 2 - PADDLE_R, PADDLE_R]);
    expect(clampPaddle(0, -10, H + 10)).toEqual([PADDLE_R, H - PADDLE_R]);
    expect(clampPaddle(1, 0, H / 2)).toEqual([W / 2 + PADDLE_R, H / 2]);
    expect(clampPaddle(1, W + 10, H / 2)).toEqual([W - PADDLE_R, H / 2]);
  });

  it('leaves a valid position untouched', () => {
    expect(clampPaddle(0, 300, 200)).toEqual([300, 200]);
    expect(clampPaddle(1, 1300, 700)).toEqual([1300, 700]);
  });
});

describe('spawnPoint', () => {
  it.each([0, 1] as const)('gives team %i distinct valid spots away from the puck', team => {
    const serveX = team ? (3 * W) / 4 : W / 4;
    const seen = new Set<string>();
    for (let n = 0; n < 16; n++) {
      const [x, y] = spawnPoint(team, n);
      expect(clampPaddle(team, x, y)).toEqual([x, y]);
      expect(Math.hypot(x - serveX, y - H / 2)).toBeGreaterThan(RR);
      expect(Math.hypot(x - W / 2, y - H / 2)).toBeGreaterThan(RR);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(16);
  });

  it('mirrors the two teams', () => {
    const [x0, y0] = spawnPoint(0, 4);
    expect(spawnPoint(1, 4)).toEqual([W - x0, y0]);
  });
});

describe('paddles', () => {
  it('move toward the target at most at PADDLE_MAX_SPEED, velocity from the displacement', () => {
    const p = paddle(0, 100, H / 2);
    p.tx = 700;
    step(world(W / 2, 100, 0, 0, [p]), DT);
    expect(p.x).toBeCloseTo(100 + PADDLE_MAX_SPEED * DT);
    expect(p.vx).toBeCloseTo(PADDLE_MAX_SPEED);
    expect(p.vy).toBe(0);
  });

  it('stop on the target', () => {
    const p = paddle(1, 1200, 300);
    p.tx = 1205;
    p.ty = 302;
    step(world(W / 2, H / 2, 0, 0, [p]), DT);
    expect([p.x, p.y]).toEqual([1205, 302]);
    expect(p.vx).toBeCloseTo(5 / DT);
  });

  it.each([0, 1] as const)('never cross the centre line (team %i)', team => {
    const p = paddle(team, team ? 1400 : 200, H / 2);
    p.tx = team ? 0 : W;
    p.ty = 0;
    const w = world(W / 2, H - 100, 0, 0, [p]);
    const edge = (): number => (team ? p.x - PADDLE_R : p.x + PADDLE_R);
    run(w, 120, () => {
      expect(team ? edge() >= W / 2 : edge() <= W / 2).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(PADDLE_R);
    });
    expect([edge(), p.y]).toEqual([W / 2, PADDLE_R]);
  });
});

describe('puck', () => {
  it('bounces off the top wall with restitution', () => {
    const w = world(W / 2, 40, 0, -1200);
    run(w, 10, () => expect(w.puck.y).toBeGreaterThanOrEqual(PUCK_R));
    expect(w.puck.vy).toBeGreaterThan(1000);
    expect(w.puck.vy).toBeLessThan(1200 * 0.9);
  });

  it('bounces off a side wall outside the goal mouth, no goal', () => {
    const w = world(60, 150, -2000, 0);
    expect(run(w, 30)).toBe(-1);
    expect(w.puck.vx).toBeGreaterThan(0);
    expect(w.puck.x).toBeGreaterThanOrEqual(PUCK_R);
    expect(w.score).toEqual([0, 0]);
  });

  it('cannot be pushed through a side wall into the goal by a paddle', () => {
    const p = paddle(0, 120, 200);
    p.tx = 0;
    const w = world(40, 200, 0, 0, [p]);
    expect(run(w, 60)).toBe(-1);
    expect(w.puck.x).toBeGreaterThanOrEqual(PUCK_R);
    expect(w.score).toEqual([0, 0]);
  });

  it('bounces off a goal post', () => {
    const w = world(100, H / 2 - GOAL / 2, -1500, 0);
    expect(run(w, 30)).toBe(-1);
    expect(w.puck.vx).toBeGreaterThan(0);
    expect(w.score).toEqual([0, 0]);
  });

  it('loses speed the same way whatever the step size', () => {
    const a = world(W / 2, H / 2, 600, 0);
    const b = world(W / 2, H / 2, 600, 0);
    for (let i = 0; i < 120; i++) {
      step(a, 1 / 120);
    }
    for (let i = 0; i < 60; i++) {
      step(b, 1 / 60);
    }
    expect(a.puck.vx).toBeLessThan(600);
    expect(a.puck.vx).toBeCloseTo(b.puck.vx, 6);
    expect(Math.abs(a.puck.x - b.puck.x)).toBeLessThan(2);
  });

  it('is capped at PUCK_MAX_SPEED', () => {
    const w = world(W / 2, H / 2, 9000, 4000);
    step(w, DT);
    expect(speed(w)).toBeCloseTo(PUCK_MAX_SPEED);
  });
});

describe('goals', () => {
  it('team 1 scores in the left goal, the puck is re-served on team 0 side', () => {
    const w = world(200, H / 2, -2000, 0);
    expect(run(w, 60)).toBe(1);
    expect(w.score).toEqual([0, 1]);
    expect(w.puck).toEqual({ x: W / 4, y: H / 2, vx: 0, vy: 0 });
  });

  it('team 0 scores in the right goal, the puck is re-served on team 1 side', () => {
    const w = world(W - 200, H / 2 + 100, 2000, 0);
    w.score = [2, 3];
    expect(run(w, 60)).toBe(0);
    expect(w.score).toEqual([3, 3]);
    expect(w.puck).toEqual({ x: (3 * W) / 4, y: H / 2, vx: 0, vy: 0 });
  });

  it('counts only once the puck has fully crossed the line', () => {
    const w = world(PUCK_R + 1, H / 2, -1200, 0);
    let last = w.puck.x;
    const t = run(w, 60, () => {
      if (w.puck.x !== W / 4) {
        last = w.puck.x;
      }
    });
    expect(t).toBe(1);
    expect(last).toBeGreaterThanOrEqual(-PUCK_R);
  });

  it('a puck that stopped past the line still drops in', () => {
    expect(run(world(-2, H / 2, 0, 0), 60)).toBe(1);
  });
});

describe('paddle hits', () => {
  it('a moving paddle sends a resting puck away hard', () => {
    const p = paddle(0, 300, H / 2);
    p.tx = 700;
    const w = world(420, H / 2, 0, 0, [p]);
    run(w, 10);
    expect(w.puck.vx).toBeGreaterThan(PADDLE_MAX_SPEED * 0.75);
    expect(Math.abs(w.puck.vy)).toBeLessThan(1);
  });

  it('a still paddle only bounces the puck back, slower', () => {
    const w = world(400, H / 2, -1000, 0, [paddle(0, 300, H / 2)]);
    run(w, 10);
    expect(w.puck.vx).toBeGreaterThan(0);
    expect(w.puck.vx).toBeLessThan(1000);
  });

  it('a glancing hit deflects the puck sideways', () => {
    const p = paddle(0, 300, H / 2);
    p.tx = 700;
    const w = world(420, H / 2 - 40, 0, 0, [p]);
    run(w, 10);
    expect(w.puck.vx).toBeGreaterThan(0);
    expect(w.puck.vy).toBeLessThan(0);
  });

  it('never leaves a paddle and the puck overlapping, even when the puck is pinned', () => {
    // Pinned against the top wall.
    const p = paddle(0, 400, 200);
    p.ty = 0;
    const w = world(400, 120, 0, 0, [p]);
    run(w, 30, () => {
      expect(Math.hypot(w.puck.x - p.x, w.puck.y - p.y)).toBeGreaterThanOrEqual(RR - 1e-9);
      expect(w.puck.y).toBeGreaterThanOrEqual(PUCK_R);
    });
  });

  it('keeps every invariant through a long scrambled game', () => {
    let seed = 42;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const paddles = [0, 1, 2, 3, 4, 5].map(i => {
      const team = (i & 1) as Team;
      return paddle(team, ...spawnPoint(team, i >> 1), i);
    });
    const w = world(W / 2, H / 2, 900, 700, paddles);
    for (let i = 0; i < 6000; i++) {
      if (i % 20 === 0) {
        for (const p of paddles) {
          // Half of the time chase the puck, else aim anywhere (including out of the field).
          p.tx = rnd() < 0.5 ? w.puck.x : rnd() * 2000 - 200;
          p.ty = rnd() < 0.5 ? w.puck.y : rnd() * 1300 - 200;
        }
      }
      step(w, DT);
      const k = w.puck;
      expect(speed(w)).toBeLessThanOrEqual(PUCK_MAX_SPEED + 1e-6);
      expect(k.y).toBeGreaterThanOrEqual(PUCK_R);
      expect(k.y).toBeLessThanOrEqual(H - PUCK_R);
      for (const p of paddles) {
        expect(clampPaddle(p.team, p.x, p.y)).toEqual([p.x, p.y]);
        // Squeezes between several paddles may leave a sliver, far below the 1 / SCALE wire step.
        expect(Math.hypot(k.x - p.x, k.y - p.y)).toBeGreaterThan(RR - 0.01);
      }
    }
    expect(w.score[0] + w.score[1]).toBeGreaterThan(0);
  });
});
