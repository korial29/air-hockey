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
import { PERIOD, obstacles } from './arena';
import { clampPaddle, createWorld, spawnPoint, step } from './physics';
import type { Arena, Paddle, Team, World } from './types';

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

/** A classic world (no obstacles) unless an arena is given. */
const world = (
  x: number,
  y: number,
  vx = 0,
  vy = 0,
  paddles: Paddle[] = [],
  arena: Arena = 'classic',
): World => {
  const w = createWorld(arena);
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

/** The obstacles the world stands among. */
const obs = (w: World) => obstacles(w.arena, w.tick);

/** How deep the puck sinks into a paddle or an obstacle, or a paddle into an obstacle; ≤ 0 if not. */
const overlap = (w: World): number => {
  const k = w.puck;
  let worst = -Infinity;
  for (const o of obs(w)) {
    worst = Math.max(worst, o.r + PUCK_R - Math.hypot(k.x - o.x, k.y - o.y));
    for (const p of w.paddles) {
      worst = Math.max(worst, o.r + PADDLE_R - Math.hypot(p.x - o.x, p.y - o.y));
    }
  }
  for (const p of w.paddles) {
    worst = Math.max(worst, RR - Math.hypot(k.x - p.x, k.y - p.y));
  }
  return worst;
};

describe('createWorld', () => {
  it('puts the puck at rest in the centre, with no paddles and 0-0, on ice at tick 0', () => {
    expect(createWorld()).toEqual({
      arena: 'ice',
      tick: 0,
      bumps: [],
      puck: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
      paddles: [],
      score: [0, 0],
      hit: -1,
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
    // Faster than the puck may go: it leaves at the cap.
    expect(w.puck.vx).toBeGreaterThan(Math.min(PADDLE_MAX_SPEED, PUCK_MAX_SPEED) * 0.75);
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

describe('hit', () => {
  it('is -1 when no paddle touches the puck', () => {
    const w = world(W / 2, H / 2, 600, 0, [paddle(0, 100, 100)]);
    w.hit = 5;
    run(w, 10, () => expect(w.hit).toBe(-1));
  });

  it('names the paddle that hit the puck, on the contact step only', () => {
    const w = world(400, H / 2, -1000, 0, [paddle(0, 300, H / 2, 7)]);
    const hits: number[] = [];
    run(w, 10, () => hits.push(w.hit));
    expect(hits.filter(h => h === 7)).toHaveLength(1);
    expect(hits.filter(h => h !== 7 && h !== -1)).toEqual([]);
  });

  it.each([
    [2, 3],
    [3, 2],
  ])('keeps the last paddle when several touch the puck in one step (%i then %i)', (i, j) => {
    // One paddle above the puck, one on its right, both overlapping it a little.
    const w = world(400, H / 2, 0, 0, [paddle(0, 400, H / 2 - 70, i), paddle(0, 470, H / 2, j)]);
    step(w, DT);
    expect(w.hit).toBe(j);
  });

  it('counts a puck pinned against a wall', () => {
    // The paddle stays still against a puck resting on the top wall: only the pinned pass sees it.
    const p = paddle(0, 400, PUCK_R + RR - 5, 4);
    const w = world(400, PUCK_R, 0, 0, [p]);
    step(w, DT);
    expect(w.hit).toBe(4);
  });

  it('is reset by a step that does nothing', () => {
    const w = world(W / 2, H / 2);
    w.hit = 2;
    step(w, 0);
    expect(w.hit).toBe(-1);
  });
});

describe('ice arena', () => {
  /** Minimum speed of a puck leaving an obstacle (physics.ts). */
  const KICK = 1000;
  const ice = (x: number, y: number, vx = 0, vy = 0, paddles: Paddle[] = []): World =>
    world(x, y, vx, vy, paddles, 'ice');

  it('counts the steps in w.tick, a step that does nothing aside', () => {
    const w = ice(W / 2, H / 2);
    run(w, 10);
    step(w, 0);
    expect(w.tick).toBe(10);
  });

  it('bounces the puck off an iceberg with the pinball kick, naming it in bumps once', () => {
    const [berg] = obs(createWorld());
    const w = ice(berg.x - berg.r - PUCK_R - 30, berg.y, 300, 0);
    const bumps: number[][] = [];
    let after = 0;
    run(w, 60, () => {
      bumps.push(w.bumps);
      if (w.bumps.length && !after) {
        after = speed(w);
        expect(w.puck.vx).toBeLessThan(0);
      }
    });
    expect(bumps.filter(b => b.length)).toEqual([[0]]);
    expect(after).toBeCloseTo(KICK, 6);
    expect(w.puck.x).toBeLessThan(berg.x - berg.r - PUCK_R - 100);
  });

  it('keeps a fast puck faster than the kick, minus the restitution', () => {
    const [berg] = obs(createWorld());
    const w = ice(berg.x, berg.y + berg.r + PUCK_R + 5, 0, -2000);
    step(w, DT);
    expect(w.bumps).toEqual([0]);
    expect(w.puck.vy).toBeGreaterThan(2000 * 0.9 * 0.99);
  });

  it('lets a sliding penguin carry a resting puck along its slide', () => {
    // The centre penguin leaves the top board at tick 0, sliding down.
    for (const dx of [0, 30]) {
      const w = ice(W / 2 + dx, 400);
      for (let i = 0; i < 600 && !w.bumps.length; i++) {
        step(w, DT);
      }
      expect(w.bumps).toEqual([5]);
      const p = obs(w)[5];
      expect(p.vy).toBeGreaterThan(0);
      expect(w.puck.vy).toBeGreaterThan(p.vy);
      expect(speed(w)).toBeCloseTo(KICK, 6);
      expect(Math.sign(Math.round(w.puck.vx))).toBe(Math.sign(dx));
    }
  });

  it('makes paddles slide around obstacles, never into them', () => {
    const [berg] = obs(createWorld());
    // Aimed just past the far side of the iceberg: the paddle goes around it.
    const p = paddle(0, berg.x - 200, berg.y);
    p.tx = berg.x + 160;
    p.ty = berg.y + 20;
    const w = ice(W / 2, H - 100, 0, 0, [p]);
    run(w, 240, () => expect(overlap(w)).toBeLessThan(1e-6));
    expect([p.x, p.y]).toEqual([p.tx, p.ty]);

    // Aimed at its centre: it stops on its edge.
    [p.tx, p.ty] = [berg.x, berg.y];
    run(w, 240, () => expect(overlap(w)).toBeLessThan(1e-6));
    expect(Math.hypot(p.x - berg.x, p.y - berg.y)).toBeCloseTo(berg.r + PADDLE_R, 6);
  });

  it('lets a penguin push a paddle in its lane up to the board, where the paddle slips past', () => {
    // Left lane: the penguin leaves the bottom board at tick 0, sliding up.
    const lane = obs(createWorld())[4];
    const p = paddle(0, lane.x, H / 2);
    const w = ice(W / 2, H - 100, 0, 0, [p]);
    let top = H;
    let aside = 0;
    run(w, PERIOD / 2, () => {
      expect(overlap(w)).toBeLessThan(1e-6);
      top = Math.min(top, p.y);
      aside = Math.max(aside, Math.abs(p.x - lane.x));
    });
    // Carried to the top board, squeezed out sideways, back on its target below the penguin.
    expect(top).toBe(PADDLE_R);
    expect(aside).toBeGreaterThan(lane.r + PADDLE_R - 5);
    expect([p.x, p.y]).toEqual([lane.x, H / 2]);
  });

  it('never leaves a puck inside a paddle or an iceberg when a paddle drives it into one', () => {
    const [berg] = obs(createWorld());
    const p = paddle(0, berg.x - 250, berg.y + 10);
    [p.tx, p.ty] = [berg.x, berg.y];
    const w = ice(berg.x - 150, berg.y, 0, 0, [p]);
    run(w, 480, () => {
      expect(overlap(w)).toBeLessThan(0.1);
      expect(Number.isFinite(w.puck.x + w.puck.y + w.puck.vx + w.puck.vy)).toBe(true);
    });
  });

  it('squeezes a puck out sideways when a penguin reaches the board it rests on', () => {
    const w = ice(W / 2, PUCK_R);
    // The centre penguin, sliding up, 300 ticks before it touches the top board.
    w.tick = PERIOD - 300;
    const lane = obs(w)[5];
    let bumped = false;
    run(w, 400, () => {
      expect(overlap(w)).toBeLessThan(0.1);
      expect(w.puck.y).toBeGreaterThanOrEqual(PUCK_R);
      bumped ||= w.bumps.includes(5);
    });
    expect(bumped).toBe(true);
    expect(Math.abs(w.puck.x - lane.x)).toBeGreaterThan(lane.r);
  });

  it('keeps every invariant through a long scrambled game among the obstacles', () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const paddles = [0, 1, 2, 3, 4, 5].map(i => {
      const team = (i & 1) as Team;
      return paddle(team, ...spawnPoint(team, i >> 1), i);
    });
    const w = ice(W / 2, H / 2, 900, 700, paddles);
    let worst = 0;
    let fast = 0;
    let outside = 0;
    let bumps = 0;
    let goals = 0;
    for (let i = 0; i < 20000; i++) {
      if (i % 20 === 0) {
        for (const p of paddles) {
          p.tx = rnd() < 0.5 ? w.puck.x : rnd() * 2400 - 200;
          p.ty = rnd() < 0.5 ? w.puck.y : rnd() * 1500 - 200;
        }
      }
      goals += +(step(w, DT) !== -1);
      bumps += w.bumps.length;
      const k = w.puck;
      expect(Number.isFinite(k.x + k.y + k.vx + k.vy)).toBe(true);
      worst = Math.max(worst, overlap(w));
      fast = Math.max(fast, speed(w));
      // Inside the rink, or in a goal mouth on its way in.
      const mouth = Math.abs(k.y - H / 2) <= GOAL / 2;
      outside += +(k.y < PUCK_R || k.y > H - PUCK_R || (!mouth && (k.x < 0 || k.x > W)));
      for (const p of paddles) {
        expect(clampPaddle(p.team, p.x, p.y)).toEqual([p.x, p.y]);
      }
    }
    expect(worst).toBeLessThan(0.1);
    expect(fast).toBeLessThanOrEqual(PUCK_MAX_SPEED + 1e-6);
    expect(outside).toBe(0);
    expect(bumps).toBeGreaterThan(100);
    expect(goals).toBeGreaterThan(5);
  });

  it('is not there in the classic arena', () => {
    const [berg] = obs(createWorld());
    const w = world(berg.x - 200, berg.y, 1200, 0);
    run(w, 120, () => expect(w.bumps).toEqual([]));
    expect(w.puck.x).toBeGreaterThan(berg.x + 100);
    expect(w.puck.vy).toBe(0);
  });
});
