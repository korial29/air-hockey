import { describe, expect, it } from 'vitest';
import {
  GHOST,
  GOAL,
  H,
  ICEBERG_HP,
  PADDLE_MAX_SPEED,
  PADDLE_R,
  PUCK_MAX_SPEED,
  PUCK_R,
  RESPAWN,
  TICK_HZ,
  W,
} from './constants';
import { PERIOD, ZA, ZN, fixed, obstacles, swirl } from './arena';
import { SPIN, clampPaddle, createWorld, skate, spawnPoint, step } from './physics';
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

/** A classic world (no obstacles) unless an arena is given, its puck already in play. */
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
  w.live = true;
  return w;
};

/**
 * Longest stretches, in steps, a live puck stays within PUCK_R of one spot: `still` anywhere,
 * `pinned` touching an obstacle all along (held against a rock or a shark by a paddle).
 */
const stillness = () => {
  const m = { still: 0, pinned: 0 };
  let [x, y, n, p] = [NaN, NaN, 0, 0];
  return Object.assign(m, {
    see(w: World): void {
      const k = w.puck;
      if (w.live && Math.hypot(k.x - x, k.y - y) < PUCK_R) {
        m.still = Math.max(m.still, ++n);
        p = w.bumps.length ? p + 1 : 0;
        m.pinned = Math.max(m.pinned, p);
      } else {
        [x, y, n, p] = [k.x, k.y, 0, 0];
      }
    },
  });
};

/** Steps (on the host unless told) until a goal or `n` steps; returns the scoring team or -1. */
const run = (w: World, n: number, each?: () => void, host = true): number => {
  for (let i = 0; i < n; i++) {
    const t = step(w, DT, host);
    each?.();
    if (t !== -1) {
      return t;
    }
  }
  return -1;
};

const speed = (w: World): number => Math.hypot(w.puck.vx, w.puck.vy);

/** The obstacles the world stands among. */
const obs = (w: World) => obstacles(w.arena, w.tick, w.size, w.count);

/** Those in play: removed ones and their ghosts touch nothing. */
const solid = (w: World) => obs(w).filter((_, i) => w.obs[i].gone < 0);

/**
 * How deep the puck sinks into a paddle or an obstacle in play, or a paddle into an obstacle in
 * play; ≤ 0 if not.
 */
const overlap = (w: World): number => {
  const k = w.puck;
  let worst = -Infinity;
  for (const o of solid(w)) {
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
      size: 1,
      count: 7,
      seed: 0,
      tick: 0,
      bumps: [],
      live: false,
      obs: Array(7).fill({ hits: 0, gone: -1, angle: 0 }),
      puck: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
      paddles: [],
      score: [0, 0],
      hit: -1,
    });
    expect(createWorld('classic', 2, 3)).toMatchObject({
      arena: 'classic',
      size: 2,
      count: 3,
      puck: { x: W, y: H, vx: 0, vy: 0 },
    });
  });

  it('places the icebergs by its seed: step and skate go around them there', () => {
    // Seed 25 draws the bottom pair at y 768, 102 above its seed-0 place: out of a puck's reach
    // on that row.
    const [, , berg] = obstacles('ice', 0, 1, 7, 25);
    expect(obstacles('ice', 0)[2].y - berg.y).toBeGreaterThan(berg.r + PUCK_R + 10);
    const shot = (seed: number) => {
      const w = createWorld('ice', 1, 7, seed);
      Object.assign(w.puck, { x: berg.x - berg.r - PUCK_R - 5, y: berg.y, vx: 300 });
      w.live = true;
      const bumps: number[] = [];
      run(w, 20, () => bumps.push(...w.bumps));
      return [w.seed, bumps, w.puck.vx < 0];
    };
    expect(shot(25)).toEqual([25, [2], true]);
    expect(shot(0)).toEqual([0, [], false]);
    // A paddle aiming at its centre stops on its edge.
    const w = createWorld('ice', 1, 7, 25);
    const p = paddle(0, berg.x - 200, berg.y);
    [p.tx, p.ty] = [berg.x, berg.y];
    w.paddles = [p];
    for (let i = 0; i < 120; i++) {
      skate(w, DT);
    }
    expect(Math.hypot(p.x - berg.x, p.y - berg.y)).toBeCloseTo(berg.r + PADDLE_R, 6);
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

describe('skate (countdown)', () => {
  /** Everything skate must leave alone. */
  const rest = (w: World) =>
    JSON.stringify([w.puck, w.tick, w.obs, w.live, w.hit, w.bumps, w.score, w.size, w.count]);

  it('moves the paddles like step, sub-stepped, around the obstacles; the rest of the world waits', () => {
    const w = createWorld('ice', 2, 7);
    const a = paddle(0, 300, 300, 1);
    const b = paddle(1, 3700, 300, 2);
    [a.tx, a.ty, b.tx, b.ty] = [1700, 1900, 2300, 1900];
    w.paddles = [a, b];
    const before = rest(w);
    skate(w, DT);
    // Twice the top speed on a rink of size 2.
    expect(Math.hypot(a.x - 300, a.y - 300)).toBeCloseTo(2 * PADDLE_MAX_SPEED * DT);
    for (let i = 0; i < 480; i++) {
      skate(w, DT);
      expect(overlap(w)).toBeLessThan(1e-6);
    }
    expect([a.x, a.y, b.x, b.y]).toEqual([1700, 1900, 2300, 1900]);
    expect(rest(w)).toBe(before);
  });

  it('stops a paddle against the served puck, never pushing it nor putting it in play', () => {
    const w = createWorld('classic');
    const p = paddle(0, 200, H / 2);
    [p.tx, p.ty] = [W / 2, H / 2];
    w.paddles = [p];
    const before = rest(w);
    for (let i = 0; i < 240; i++) {
      skate(w, DT);
    }
    expect(Math.hypot(p.x - W / 2, p.y - H / 2)).toBeCloseTo(RR, 6);
    expect(rest(w)).toBe(before);
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

describe('serve after a goal', () => {
  it.each([
    [0, 'classic'],
    [1, 'classic'],
    [0, 'ice'],
  ] as const)(
    'serves beside a paddle left on the serve spot: no own goal again and again (team %i, %s)',
    (team, arena) => {
      // The paddle stays where it just hit, on its own serve spot; the puck goes into its goal.
      const spot = team ? (3 * W) / 4 : W / 4;
      const p = paddle(team, spot, H / 2);
      const w = world(team ? W - 40 : 40, H / 2, team ? 2000 : -2000, 0, [p], arena);
      let goals = 0;
      for (let i = 0; i < 4 * TICK_HZ; i++) {
        goals += +(step(w, DT) != -1);
      }
      expect(goals).toBe(1);
      expect(w.puck).toMatchObject({ x: spot, vx: 0, vy: 0 });
      expect(Math.hypot(p.x - w.puck.x, p.y - w.puck.y)).toBeGreaterThan(PUCK_R + PADDLE_R);
    },
  );

  it('serves on the spot itself when nothing stands there', () => {
    const w = world(40, H / 2, -2000, 0, [paddle(0, 100, 100)]);
    expect(run(w, 30)).toBe(1);
    expect(w.puck).toMatchObject({ x: W / 4, y: H / 2 });
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

describe('served puck', () => {
  it('lets the obstacles through until a paddle touches it: no penguin starts a round alone', () => {
    // Served at the centre, on the centre penguin's lane, nobody playing: two full periods.
    const w = createWorld('ice');
    for (let i = 0; i < 2 * PERIOD; i++) {
      expect(step(w, DT)).toBe(-1);
      expect(w.bumps).toEqual([]);
    }
    expect(w.puck).toEqual({ x: W / 2, y: H / 2, vx: 0, vy: 0 });
    expect(w.live).toBe(false);
  });

  it('goes live on a paddle touch and back to served after a goal', () => {
    const w = createWorld('ice');
    const p = paddle(0, W / 2 - PADDLE_R - PUCK_R - 40, H / 2);
    p.tx = W;
    w.paddles = [p];
    run(w, 10);
    expect(w.live).toBe(true);
    // Into the right goal from just in front of it: served again on the conceding side.
    Object.assign(w.puck, { x: W - 40, y: H / 2, vx: 2000, vy: 0 });
    w.paddles = [];
    expect(run(w, 60)).toBe(0);
    expect(w.live).toBe(false);
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
    // Prediction steps: the penguin is not shot out, so its push at the board is what is tested.
    run(
      w,
      400,
      () => {
        expect(overlap(w)).toBeLessThan(0.1);
        expect(w.puck.y).toBeGreaterThanOrEqual(PUCK_R);
        bumped ||= w.bumps.includes(5);
      },
      false,
    );
    expect(bumped).toBe(true);
    expect(Math.abs(w.puck.x - lane.x)).toBeGreaterThan(lane.r);
  });

  it.each(['ice', 'sea', 'desert'] as Arena[])(
    'keeps every invariant through a long scrambled game among the obstacles (%s)',
    arena => {
      let seed = 7;
      const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const paddles = [0, 1, 2, 3, 4, 5].map(i => {
        const team = (i & 1) as Team;
        return paddle(team, ...spawnPoint(team, i >> 1), i);
      });
      const w = world(W / 2, H / 2, 900, 700, paddles, arena);
      const still = stillness();
      let worst = 0;
      let fast = 0;
      let outside = 0;
      let bumps = 0;
      let goals = 0;
      let removed = 0;
      let back = 0;
      for (let i = 0; i < 20000; i++) {
        if (i % 20 === 0) {
          for (const p of paddles) {
            p.tx = rnd() < 0.5 ? w.puck.x : rnd() * 2400 - 200;
            p.ty = rnd() < 0.5 ? w.puck.y : rnd() * 1500 - 200;
          }
        }
        const before = w.obs.map(o => o.gone);
        goals += +(step(w, DT) !== -1);
        bumps += w.bumps.length;
        still.see(w);
        w.obs.forEach((o, j) => {
          removed += +(before[j] < 0 && o.gone >= 0);
          back += +(before[j] >= 0 && o.gone < 0);
          // In play: below its last hit. Removed: since this very step at most, back in RESPAWN.
          if (o.gone < 0) {
            expect(o.hits).toBeLessThan(fixed(obs(w)[j]) ? ICEBERG_HP : 1);
          } else {
            expect(w.tick - o.gone).toBeGreaterThanOrEqual(0);
            expect(w.tick - o.gone).toBeLessThan(RESPAWN);
          }
        });
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
      // Fewer bumps than with unbreakable obstacles: they spend much of the game removed.
      expect(bumps).toBeGreaterThan(40);
      expect(goals).toBeGreaterThan(5);
      expect(removed).toBeGreaterThan(10);
      expect(back).toBeGreaterThan(10);
      // Never stuck: in a narrow passage too, the kick throws a pinned puck clear at once.
      expect(still.still).toBeLessThan(TICK_HZ);
      expect(still.pinned).toBeLessThan(TICK_HZ / 10);
    },
  );

  it('is not there in the classic arena', () => {
    const [berg] = obs(createWorld());
    const w = world(berg.x - 200, berg.y, 1200, 0);
    run(w, 120, () => expect(w.bumps).toEqual([]));
    expect(w.puck.x).toBeGreaterThan(berg.x + 100);
    expect(w.puck.vy).toBe(0);
  });
});

describe('a rink of size 2', () => {
  const S = 2;
  const X = W * S;
  const Y = H * S;
  /** A size-2 world, classic unless an arena is given, its puck in play. */
  const big = (
    x: number,
    y: number,
    vx = 0,
    vy = 0,
    paddles: Paddle[] = [],
    arena: Arena = 'classic',
    count = 7,
  ): World => {
    const w = createWorld(arena, S, count);
    Object.assign(w.puck, { x, y, vx, vy });
    w.paddles = paddles;
    w.live = true;
    return w;
  };

  it('clamps paddles to the scaled halves, and spawns them inside, mirrored and apart', () => {
    expect(clampPaddle(0, X, -10, S)).toEqual([X / 2 - PADDLE_R, PADDLE_R]);
    expect(clampPaddle(0, -10, Y + 10, S)).toEqual([PADDLE_R, Y - PADDLE_R]);
    expect(clampPaddle(1, 0, Y / 2, S)).toEqual([X / 2 + PADDLE_R, Y / 2]);
    expect(clampPaddle(1, X + 10, Y / 2, S)).toEqual([X - PADDLE_R, Y / 2]);
    for (const team of [0, 1] as Team[]) {
      const seen = new Set<string>();
      for (let n = 0; n < 16; n++) {
        const [x, y] = spawnPoint(team, n, S);
        expect(clampPaddle(team, x, y, S)).toEqual([x, y]);
        expect(spawnPoint((1 - team) as Team, n, S)).toEqual([X - x, y]);
        expect(Math.hypot(x - (team ? 3 * X : X) / 4, y - Y / 2)).toBeGreaterThan(RR);
        seen.add(`${x},${y}`);
      }
      expect(seen.size).toBe(16);
    }
  });

  it('moves paddles at twice the top speed, across the whole scaled half', () => {
    const p = paddle(0, 100, Y / 2);
    p.tx = X;
    p.ty = Y;
    const w = big(X / 2, 100, 0, 0, [p]);
    step(w, DT);
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(PADDLE_MAX_SPEED * S);
    run(w, 240);
    expect([p.x, p.y]).toEqual([X / 2 - PADDLE_R, Y - PADDLE_R]);
  });

  it('bounces the puck off the scaled walls, posts and goal mouth edges', () => {
    // Bottom wall at 2H, where the base rink had open ice.
    const a = big(X / 2, Y - 40, 0, 2000);
    run(a, 10, () => expect(a.puck.y).toBeLessThanOrEqual(Y - PUCK_R));
    expect(a.puck.vy).toBeLessThan(0);
    // The right board beside the scaled mouth.
    const b = big(X - 60, 200, 2000, 0);
    expect(run(b, 30)).toBe(-1);
    expect(b.puck.vx).toBeLessThan(0);
    expect(b.puck.x).toBeLessThanOrEqual(X - PUCK_R);
    // A post of the scaled mouth, GOAL below the centre.
    const c = big(100, Y / 2 - GOAL, -1500, 0);
    expect(run(c, 30)).toBe(-1);
    expect(c.puck.vx).toBeGreaterThan(0);
  });

  it('scores in the scaled goal mouths and serves on the scaled spots', () => {
    // Within the size-2 mouth, outside the base one.
    const w = big(X - 200, Y / 2 + GOAL * 0.9, 2000, 0);
    expect(run(w, 60)).toBe(0);
    expect(w.puck).toEqual({ x: (3 * X) / 4, y: Y / 2, vx: 0, vy: 0 });
    const v = big(200, Y / 2 - GOAL * 0.9, -2000, 0);
    expect(run(v, 60)).toBe(1);
    expect(w.live || v.live).toBe(false);
    expect(v.puck).toEqual({ x: X / 4, y: Y / 2, vx: 0, vy: 0 });
  });

  it('pulls a puck past the line into the slot at twice the slot speed', () => {
    const w = big(-2, Y / 2, 0, 0);
    step(w, DT);
    expect(w.puck.vx).toBeCloseTo(-600);
    expect(run(w, 60)).toBe(1);
  });

  it('caps the puck at twice PUCK_MAX_SPEED and keeps the drag per second', () => {
    const w = big(X / 2, Y / 2, 9000, 0);
    step(w, DT);
    // Capped in the first sub-step, slowed by the drag of the second one.
    expect(speed(w)).toBeLessThanOrEqual(PUCK_MAX_SPEED * S);
    expect(speed(w)).toBeGreaterThan(PUCK_MAX_SPEED * S * 0.999);
    const a = big(X / 2, Y / 2, 600, 0);
    const b = world(W / 2, H / 2, 600, 0);
    run(a, 120);
    run(b, 120);
    expect(a.puck.vx).toBeCloseTo(b.puck.vx, 9);
  });

  it('counts one tick per step, whatever the sub-steps', () => {
    const w = big(X / 2, Y / 2);
    run(w, 10);
    step(w, 0);
    expect(w.tick).toBe(10);
  });

  it.each([0, 7, 13, 19, 31, 47, 59, 71])(
    'catches a head-on hit at both top speeds, whatever the phase (%i)',
    off => {
      // Puck at 4800 units/s and paddle at 14400 run into each other: 80 units a tick, more than
      // the contact distance, so only the sub-steps catch the contact.
      const p = paddle(0, X / 2 - 400 - off, Y / 2);
      p.tx = X / 2;
      const w = big(X / 2 - 100, Y / 2, -PUCK_MAX_SPEED * S, 0, [p]);
      let hit = false;
      run(w, 20, () => {
        hit ||= w.hit == p.id;
        expect(w.puck.x - p.x).toBeGreaterThanOrEqual(RR - 1e-6);
      });
      expect(hit).toBe(true);
      expect(w.puck.vx).toBeGreaterThan(0);
    },
  );

  it('kicks the puck off a scaled iceberg at twice KICK', () => {
    const w = big(0, 0, 300, 0, [], 'ice');
    const [berg] = obstacles('ice', 0, S, 7);
    Object.assign(w.puck, { x: berg.x - berg.r - PUCK_R - 30, y: berg.y });
    expect(berg).toMatchObject({ x: 900, y: 540, r: 144 });
    let after = 0;
    run(w, 60, () => {
      if (w.bumps.length && !after) {
        after = speed(w);
        expect(w.bumps).toEqual([0]);
      }
    });
    // The kick, maybe minus the drag of a sub-step after it.
    expect(after).toBeLessThanOrEqual(2000 + 1e-6);
    expect(after).toBeGreaterThan(2000 * 0.999);
  });

  it('lets the obstacles leave a served puck alone until a paddle touches it', () => {
    for (const count of [3, 7]) {
      const w = createWorld('ice', S, count);
      for (let i = 0; i < 2 * PERIOD; i++) {
        expect(step(w, DT)).toBe(-1);
        expect(w.bumps).toEqual([]);
      }
      expect(w.puck).toEqual({ x: X / 2, y: Y / 2, vx: 0, vy: 0 });
      const p = paddle(0, X / 2 - RR - 40, Y / 2);
      p.tx = X;
      w.paddles = [p];
      run(w, 10);
      expect(w.live).toBe(true);
    }
  });

  it.each(
    [3, 5, 7].flatMap(count =>
      ['ice', 'sea', 'desert'].map(arena => [count, arena] as [number, Arena]),
    ),
  )(
    'keeps every invariant through a long scrambled game among %i obstacles (%s)',
    (count, arena) => {
      let seed = count;
      const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const paddles = [...Array(12).keys()].map(i => {
        const team = (i & 1) as Team;
        return paddle(team, ...spawnPoint(team, i >> 1, S), i);
      });
      const w = big(X / 2, Y / 2, 900, 700, paddles, arena, count);
      const still = stillness();
      let worst = 0;
      let bumps = 0;
      let goals = 0;
      for (let i = 0; i < 10000; i++) {
        if (i % 20 === 0) {
          for (const p of paddles) {
            p.tx = rnd() < 0.5 ? w.puck.x : rnd() * (X + 400) - 200;
            p.ty = rnd() < 0.5 ? w.puck.y : rnd() * (Y + 400) - 200;
          }
        }
        goals += +(step(w, DT) !== -1);
        bumps += w.bumps.length;
        still.see(w);
        const k = w.puck;
        expect(Number.isFinite(k.x + k.y + k.vx + k.vy)).toBe(true);
        for (const o of solid(w)) {
          worst = Math.max(worst, o.r + PUCK_R - Math.hypot(k.x - o.x, k.y - o.y));
          for (const p of paddles) {
            worst = Math.max(worst, o.r + PADDLE_R - Math.hypot(p.x - o.x, p.y - o.y));
          }
        }
        for (const p of paddles) {
          worst = Math.max(worst, RR - Math.hypot(k.x - p.x, k.y - p.y));
          expect(clampPaddle(p.team, p.x, p.y, S)).toEqual([p.x, p.y]);
        }
        expect(speed(w)).toBeLessThanOrEqual(PUCK_MAX_SPEED * S + 1e-6);
        const mouth = Math.abs(k.y - Y / 2) <= GOAL;
        expect(k.y < PUCK_R || k.y > Y - PUCK_R || (!mouth && (k.x < 0 || k.x > X))).toBe(false);
      }
      expect(worst).toBeLessThan(0.1);
      // The puck meets the obstacles: a sanity floor, not a target (the free-spot serve after a
      // goal changes the paths, and 3 obstacles on a size-2 rink get 9 to a few dozen bumps).
      expect(bumps).toBeGreaterThan(5);
      expect(goals).toBeGreaterThan(2);
      expect(still.still).toBeLessThan(TICK_HZ);
      expect(still.pinned).toBeLessThan(TICK_HZ / 10);
    },
  );
});

describe('breakable obstacles', () => {
  /** Minimum speed of a puck leaving an obstacle (physics.ts). */
  const KICK = 1000;
  /** The centre penguin stands at the centre of the rink at this tick, sliding down. */
  const MID = PERIOD / 4;
  const ice = (x: number, y: number, vx = 0, vy = 0, paddles: Paddle[] = []): World =>
    world(x, y, vx, vy, paddles, 'ice');
  const [berg] = obs(createWorld());
  /**
   * Sends the puck at the first iceberg from its left, 30 units off: the kick on each contact.
   * Returns the bumps of the steps that had some, and the tick the first of them landed on.
   */
  const shoot = (w: World): [number[][], number] => {
    Object.assign(w.puck, { x: berg.x - berg.r - PUCK_R - 30, y: berg.y, vx: 300, vy: 0 });
    const bumps: number[][] = [];
    let at = -1;
    run(w, 60, () => {
      if (w.bumps.length && at < 0) {
        at = w.tick;
        expect(speed(w)).toBeCloseTo(KICK, 6);
        expect(w.puck.vx).toBeLessThan(0);
      }
      bumps.push(w.bumps);
    });
    return [bumps.filter(b => b.length), at];
  };

  it('starts every obstacle of the arena in play, intact; none on the classic rink', () => {
    expect(createWorld('ice', 2, 3).obs).toEqual(Array(3).fill({ hits: 0, gone: -1, angle: 0 }));
    expect(createWorld('classic').obs).toEqual([]);
  });

  it(`shatters an iceberg on its ${ICEBERG_HP}th puck hit, with the kick every time`, () => {
    const w = ice(0, 0);
    for (let n = 1; n <= ICEBERG_HP; n++) {
      const [bumps, at] = shoot(w);
      expect(bumps).toEqual([[0]]);
      expect(w.obs[0].hits).toBe(n);
      // Hit head-on from the left: sent right.
      expect(w.obs[0].angle).toBeCloseTo(0, 9);
      // Removed at the tick of the step that broke it.
      expect(w.obs[0].gone).toBe(n < ICEBERG_HP ? -1 : at);
    }
    // Gone: the puck slides straight through where it stood.
    Object.assign(w.puck, { x: berg.x - berg.r - PUCK_R - 30, y: berg.y, vx: 1200, vy: 0 });
    run(w, 60, () => expect(w.bumps).toEqual([]));
    expect(w.puck.x).toBeGreaterThan(berg.x + berg.r);
    expect(w.puck.vy).toBe(0);
    expect(w.obs.slice(1).every(o => o.hits == 0 && o.gone == -1)).toBe(true);
  });

  it('counts a puck held against an iceberg once, however long it stays', () => {
    const p = paddle(0, berg.x - berg.r - 2 * PUCK_R - PADDLE_R - 10, berg.y);
    [p.tx, p.ty] = [berg.x, berg.y];
    const w = ice(berg.x - berg.r - PUCK_R - 5, berg.y, 0, 0, [p]);
    let held = 0;
    run(w, 480, () => (held += +w.bumps.includes(0)));
    expect(held).toBeGreaterThan(400);
    expect(w.obs[0]).toMatchObject({ hits: 1, gone: -1 });
  });

  it('takes no damage from a served puck nobody touched', () => {
    const w = ice(0, 0);
    w.live = false;
    Object.assign(w.puck, { x: berg.x - berg.r - PUCK_R - 30, y: berg.y, vx: 1200, vy: 0 });
    run(w, 60, () => expect(w.bumps).toEqual([]));
    expect(w.obs[0]).toEqual({ hits: 0, gone: -1, angle: 0 });
  });

  it('shoots a penguin out on the first hit, toward where the puck sent it', () => {
    for (const [dx, dy] of [
      [-1, 0],
      [-1, -1],
      [0, 1],
    ]) {
      const w = ice(0, 0);
      w.tick = MID;
      const [x, y] = [W / 2 + dx * 150, H / 2 + dy * 150];
      Object.assign(w.puck, { x, y, vx: -dx * 800, vy: -dy * 800 });
      run(w, 60, () => {
        if (w.bumps.length) {
          // Bounced back with the kick, at least.
          expect(w.bumps).toEqual([5]);
          expect(w.puck.vx * -dx + w.puck.vy * -dy).toBeLessThan(0);
          expect(speed(w)).toBeGreaterThanOrEqual(KICK - 1e-6);
        }
      });
      expect(w.obs[5].hits).toBe(1);
      expect(w.obs[5].gone).toBeGreaterThan(MID);
      expect(w.obs[5].gone).toBeLessThan(w.tick);
      // From the puck to the penguin's centre at impact: roughly the way the puck came.
      const a = w.obs[5].angle;
      expect(Math.cos(a) * -dx + Math.sin(a) * -dy).toBeGreaterThan(0.9 * Math.hypot(dx, dy));
    }
  });

  it('lets the puck and the paddles through a removed obstacle and its ghost', () => {
    for (const since of [0, RESPAWN - GHOST - 1, RESPAWN - GHOST, RESPAWN - 61]) {
      const w = ice(0, 0);
      w.tick = 5000;
      // It comes back in RESPAWN - since ticks: the run below ends before that.
      w.obs[0].gone = w.tick - since;
      const p = paddle(0, berg.x + 200, berg.y + 100);
      [p.tx, p.ty] = [berg.x + 20, berg.y];
      w.paddles = [p];
      // Across the iceberg's left side, clear of the paddle that comes from its right.
      Object.assign(w.puck, { x: berg.x - 60, y: berg.y - 150, vx: 0, vy: 1200 });
      run(w, 60, () => expect(w.bumps).toEqual([]));
      expect([p.x, p.y]).toEqual([p.tx, p.ty]);
      expect(w.puck.vx).toBe(0);
      expect(w.puck.y).toBeGreaterThan(berg.y);
      expect(w.obs[0].hits).toBe(0);
    }
  });

  it('brings a removed obstacle back intact RESPAWN ticks after, then it bounces and breaks again', () => {
    const w = ice(0, 0);
    w.obs[0] = { hits: ICEBERG_HP, gone: 50, angle: 1 };
    w.tick = 50 + RESPAWN - 2;
    step(w, DT);
    expect(w.obs[0].gone).toBe(50);
    step(w, DT);
    expect(w.tick).toBe(50 + RESPAWN);
    expect(w.obs[0]).toMatchObject({ hits: 0, gone: -1 });
    expect(shoot(w)[0]).toEqual([[0]]);
    expect(w.obs[0]).toMatchObject({ hits: 1, gone: -1 });
  });

  it('pushes a puck and a paddle out of an obstacle that comes back on them: no kick, no damage', () => {
    for (const [i, x, y] of [
      [0, berg.x - 20, berg.y + 10],
      // The centre penguin, on its way down through the middle of the rink.
      [5, W / 2 + 15, H / 2 - 20],
    ]) {
      const p = paddle(1, W - berg.x + 30, berg.y - 20);
      const w = ice(x, y, 0, 0, [p]);
      w.tick = MID + PERIOD * 2;
      // Both mirrored icebergs come back now, and the centre penguin.
      for (const j of [0, 1, 5]) {
        w.obs[j].gone = w.tick + 1 - RESPAWN;
      }
      step(w, DT);
      expect(w.obs[i]).toEqual({ hits: 0, gone: -1, angle: 0 });
      expect(w.bumps).toEqual([]);
      expect(w.puck).toMatchObject({ vx: 0, vy: 0 });
      expect(overlap(w)).toBeLessThan(0);
      // Paddles slide out like out of any obstacle.
      expect(Math.hypot(p.x - (W - berg.x), p.y - berg.y)).toBeCloseTo(berg.r + PADDLE_R, 6);
    }
    // The iceberg leaves the resting puck alone from then on.
    const w = ice(berg.x - 20, berg.y + 10);
    w.tick = 5000;
    w.obs[0].gone = w.tick + 1 - RESPAWN;
    run(w, 240, () => expect(w.bumps).toEqual([]));
    expect(w.obs[0]).toEqual({ hits: 0, gone: -1, angle: 0 });
    expect(speed(w)).toBe(0);
  });

  it('leaves a served puck where it is when an obstacle comes back on it', () => {
    const w = ice(berg.x, berg.y);
    w.live = false;
    w.tick = 5000;
    w.obs[0].gone = w.tick + 1 - RESPAWN;
    step(w, DT);
    expect(w.obs[0].gone).toBe(-1);
    expect(w.puck).toEqual({ x: berg.x, y: berg.y, vx: 0, vy: 0 });
  });

  it('bounces a prediction off the same obstacles without damage, and brings them back on time', () => {
    const w = ice(0, 0);
    for (let n = 0; n < ICEBERG_HP + 1; n++) {
      Object.assign(w.puck, { x: berg.x - berg.r - PUCK_R - 30, y: berg.y, vx: 300, vy: 0 });
      let bumped = false;
      run(w, 60, () => (bumped ||= w.bumps.includes(0)), false);
      expect(bumped).toBe(true);
      expect(w.puck.vx).toBeLessThan(0);
    }
    expect(w.obs[0]).toEqual({ hits: 0, gone: -1, angle: 0 });
    w.tick = 5000;
    w.obs[5] = { hits: 1, gone: w.tick + 1 - RESPAWN, angle: 2 };
    step(w, DT, false);
    expect(w.obs[5]).toMatchObject({ hits: 0, gone: -1 });
  });
});

describe('sea arena', () => {
  /** Minimum speed of a puck leaving an obstacle (physics.ts). */
  const KICK = 1000;
  /** The centre shark crosses the middle of the rink at this tick, swimming down. */
  const MID = PERIOD / 4;
  const sea = (x: number, y: number, vx = 0, vy = 0, paddles: Paddle[] = []): World =>
    world(x, y, vx, vy, paddles, 'sea');
  const [rock] = obstacles('sea', 0);

  it(`breaks a rock like an iceberg: on its ${ICEBERG_HP}th puck hit, with the kick every time`, () => {
    const w = sea(0, 0);
    for (let n = 1; n <= ICEBERG_HP; n++) {
      Object.assign(w.puck, { x: rock.x - rock.r - PUCK_R - 30, y: rock.y, vx: 300, vy: 0 });
      const bumps: number[][] = [];
      let at = -1;
      run(w, 60, () => {
        if (w.bumps.length && at < 0) {
          at = w.tick;
          expect(speed(w)).toBeCloseTo(KICK, 6);
          expect(w.puck.vx).toBeLessThan(0);
        }
        bumps.push(w.bumps);
      });
      expect(bumps.filter(b => b.length)).toEqual([[0]]);
      expect(w.obs[0]).toMatchObject({ hits: n, gone: n < ICEBERG_HP ? -1 : at });
      expect(w.obs[0].angle).toBeCloseTo(0, 9);
    }
    // Gone: the puck slides straight through where it stood.
    Object.assign(w.puck, { x: rock.x - rock.r - PUCK_R - 30, y: rock.y, vx: 1200, vy: 0 });
    run(w, 60, () => expect(w.bumps).toEqual([]));
    expect(w.puck.x).toBeGreaterThan(rock.x + rock.r);
  });

  it('shoots a shark out on the first hit, like a penguin, toward where the puck sent it', () => {
    for (const [dx, dy] of [
      [-1, 0],
      [-1, -1],
      [0, 1],
    ]) {
      const w = sea(0, 0);
      // About when it gets to the centre of the rink, where the puck aims.
      w.tick = MID - 30;
      const [x, y] = [W / 2 + dx * 150, H / 2 + dy * 150];
      Object.assign(w.puck, { x, y, vx: -dx * 800, vy: -dy * 800 });
      run(w, 60, () => {
        if (w.bumps.length) {
          expect(w.bumps).toEqual([5]);
          expect(w.puck.vx * -dx + w.puck.vy * -dy).toBeLessThan(0);
          expect(speed(w)).toBeGreaterThanOrEqual(KICK - 1e-6);
        }
      });
      expect(w.obs[5].hits).toBe(1);
      expect(w.obs[5].gone).toBeGreaterThan(MID - 30);
      expect(w.obs[5].gone).toBeLessThan(w.tick);
      // From the puck to the shark's centre at impact: roughly the way the puck came.
      const a = w.obs[5].angle;
      expect(Math.cos(a) * -dx + Math.sin(a) * -dy).toBeGreaterThan(0.9 * Math.hypot(dx, dy));
    }
  });

  it('lets a swimming shark carry a resting puck along, its sideways swim included', () => {
    // The centre shark leaves the top board at tick 0, swimming down in zig-zag.
    for (const dx of [-20, 0, 20]) {
      const w = sea(W / 2 + dx, 400);
      for (let i = 0; i < 600 && !w.bumps.length; i++) {
        step(w, DT, false);
      }
      expect(w.bumps).toEqual([5]);
      const m = obs(w)[5];
      expect(m.kind).toBe('shark');
      expect(m.vy).toBeGreaterThan(0);
      expect(m.vx).not.toBe(0);
      expect(w.puck.vy).toBeGreaterThan(m.vy);
      expect(speed(w)).toBeCloseTo(KICK, 6);
    }
  });

  it('bounces the puck on its velocity relative to the shark, sideways swim included', () => {
    /**
     * A puck at 2000 units/s head-on into the left shark at tick t, from its right: its vx after.
     * Fast enough to leave above the kick either way, which would hide the difference.
     */
    const shot = (t: number): [number, number] => {
      const m = obstacles('sea', t + 1)[4];
      const w = sea(m.x + m.r + PUCK_R - 0.5, m.y, -2000, 0);
      w.tick = t;
      step(w, DT, false);
      expect(w.bumps).toEqual([4]);
      return [w.puck.vx, m.vx];
    };
    // Swimming toward the puck, then away from it, half a zig later.
    const [toward, v1] = shot(300);
    const [away, v2] = shot(300 + Math.round(PERIOD / (4 * ZN)));
    const zv = (8 * ZA * ZN * TICK_HZ) / PERIOD;
    expect([v1, v2]).toEqual([zv, -zv]);
    // Faster back by (1 + E) times the difference of the sideways swims.
    expect(toward - away).toBeCloseTo(1.9 * (v1 - v2), -1);
  });

  it('cannot be tunnelled by a puck at top speed across a shark swimming toward it', () => {
    for (let t = 0; t < PERIOD; t += 37) {
      const m = obstacles('sea', t + 1)[4];
      const w = sea(m.x - m.r - PUCK_R - 5, m.y, PUCK_MAX_SPEED, 0);
      w.tick = t;
      run(w, 20, undefined, false);
      expect(w.puck.x).toBeLessThan(obstacles('sea', w.tick)[4].x);
    }
  });

  it('slips a paddle cornered at the centre line past a shark swinging into it at a board', () => {
    // The centre shark reaches either board from team 0's side, swinging back to its lane.
    for (const [y, t] of [
      [PADDLE_R, PERIOD - 200],
      [H - PADDLE_R, PERIOD / 2 - 200],
    ]) {
      const p = paddle(0, W / 2 - PADDLE_R, y);
      const w = sea(300, H / 2, 0, 0, [p]);
      w.tick = t;
      let near = Infinity;
      let past = false;
      run(
        w,
        400,
        () => {
          expect(overlap(w)).toBeLessThan(1e-6);
          const m = obs(w)[5];
          near = Math.min(near, Math.hypot(p.x - m.x, p.y - m.y) - m.r - PADDLE_R);
          past ||= p.x < m.x;
        },
        false,
      );
      // It met the paddle, the paddle went round it, then back into its corner.
      expect(near).toBeCloseTo(0, 6);
      expect(past).toBe(true);
      expect([p.x, p.y]).toEqual([W / 2 - PADDLE_R, y]);
    }
  });

  it('makes paddles slide around rocks and sharks, never into them', () => {
    const p = paddle(0, 100, H / 2);
    const w = sea(W / 2, H - 100, 0, 0, [p]);
    for (let i = 0; i < 4; i++) {
      [p.tx, p.ty] = [
        [rock.x, rock.y],
        [720, H / 2],
        [900, 100],
        [300, 900],
      ][i];
      run(w, 480, () => expect(overlap(w)).toBeLessThan(1e-6), false);
    }
  });
});

describe('desert arena', () => {
  /** Minimum speed of a puck leaving an obstacle (physics.ts). */
  const KICK = 1000;
  /** The centre genie floats through the middle of the rink at this tick, going down. */
  const MID = PERIOD / 4;
  const desert = (x: number, y: number, vx = 0, vy = 0, paddles: Paddle[] = []): World =>
    world(x, y, vx, vy, paddles, 'desert');
  const [wind, mirror] = obstacles('desert', 0);
  /** The puck 30 units left of the first whirlwind, heading at its centre at 300 units/s. */
  const aim = (w: World) =>
    Object.assign(w.puck, { x: wind.x - wind.r - PUCK_R - 30, y: wind.y, vx: 300, vy: 0 });

  it('spins the puck clockwise off a whirlwind left of the centre line: SPIN across the normal', () => {
    // Slow, head-on, on its left side: SPIN up (clockwise on screen), the kick back left.
    const w = desert(0, 0);
    aim(w);
    for (let i = 0; i < 60 && !w.bumps.length; i++) {
      step(w, DT, false);
    }
    expect(w.bumps).toEqual([0]);
    expect(w.puck.vy).toBeCloseTo(-SPIN, 6);
    expect(w.puck.vx).toBeCloseTo(-Math.sqrt(KICK ** 2 - SPIN ** 2), 6);
    expect(speed(w)).toBeCloseTo(KICK, 6);
    expect(swirl(wind)).toBe(1);
    // Fast: the bounce (restitution E) along the normal, SPIN across it, above the kick.
    const f = desert(wind.x - wind.r - PUCK_R - 5, wind.y, 2000);
    step(f, DT, false);
    expect(f.bumps).toEqual([0]);
    expect(f.puck.vy).toBeCloseTo(-SPIN, 6);
    expect(f.puck.vx).toBeLessThan(-2000 * 0.9 * 0.99);
    // The other side of it: down there, still clockwise.
    const r = desert(wind.x + wind.r + PUCK_R + 5, wind.y, -300);
    run(r, 30, () => r.bumps.length && expect(r.puck.vy).toBeCloseTo(SPIN, 6), false);
    expect(r.puck.vx).toBeGreaterThan(0);
    // Above it: sent right, below it: left.
    for (const dy of [-1, 1]) {
      const u = desert(wind.x, wind.y + dy * (wind.r + PUCK_R + 5), 0, -dy * 300);
      run(u, 30, () => u.bumps.length && expect(u.puck.vx).toBeCloseTo(-dy * SPIN, 6), false);
      expect(u.puck.vy * dy).toBeGreaterThan(0);
    }
  });

  it('spins the puck in mirror off mirrored whirlwinds: neither team is favoured', () => {
    let seed = 11;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let hits = 0;
    for (const size of [1, 2]) {
      const X = W * size;
      const all = obstacles('desert', 0, size, 7);
      for (const [a, b] of [
        [0, 1],
        [2, 3],
      ]) {
        const o = all[a];
        for (let n = 0; n < 40; n++) {
          // From anywhere around it, at any speed, toward it more or less.
          const th = rnd() * 2 * Math.PI;
          const d = o.r + PUCK_R + 5 + rnd() * 30;
          const v = 200 + rnd() * 2200;
          const aimAt = th + Math.PI + (rnd() - 0.5);
          const left = createWorld('desert', size, 7);
          const right = createWorld('desert', size, 7);
          left.live = right.live = true;
          const k = {
            x: o.x + d * Math.cos(th),
            y: o.y + d * Math.sin(th),
            vx: v * size * Math.cos(aimAt),
            vy: v * size * Math.sin(aimAt),
          };
          Object.assign(left.puck, k);
          Object.assign(right.puck, { ...k, x: X - k.x, vx: -k.vx });
          let met = false;
          for (let i = 0; i < 30; i++) {
            step(left, DT, false);
            step(right, DT, false);
            met ||= left.bumps.includes(a);
            // Mirrored indices: the pairs swap, the centre genie stays.
            expect(right.bumps).toEqual(left.bumps.map(j => [1, 0, 3, 2, 6, 5, 4][j]));
            expect(right.puck.x).toBeCloseTo(X - left.puck.x, 6);
            expect(right.puck.y).toBeCloseTo(left.puck.y, 6);
            expect(right.puck.vx).toBeCloseTo(-left.puck.vx, 6);
            expect(right.puck.vy).toBeCloseTo(left.puck.vy, 6);
          }
          expect(swirl(all[b], size)).toBe(-swirl(o, size));
          hits += +met;
        }
      }
    }
    // Most throws meet it.
    expect(hits).toBeGreaterThan(100);
    expect(swirl(mirror)).toBe(-1);
  });

  it('never holds the puck: from any angle and speed it leaves a whirlwind within a few steps', () => {
    for (const size of [1, Math.SQRT2, 2]) {
      const all = obstacles('desert', 0, size, 7);
      for (const i of [0, 1, 2, 3]) {
        const o = all[i];
        const D = o.r + PUCK_R;
        for (let deg = 0; deg < 360; deg += 15) {
          for (const v of [150, 300, 1000, 1800, PUCK_MAX_SPEED]) {
            for (const b of [-0.95, -0.6, -0.3, 0, 0.3, 0.6, 0.95]) {
              // Coming in toward the centre from that side, b · D off the line through it.
              const th = (deg * Math.PI) / 180;
              const [ux, uy] = [-Math.cos(th), -Math.sin(th)];
              const w = createWorld('desert', size, 7);
              w.live = true;
              Object.assign(w.puck, {
                x: o.x - ux * (D + 12) - uy * b * D,
                y: o.y - uy * (D + 12) + ux * b * D,
                vx: ux * v * size,
                vy: uy * v * size,
              });
              let first = -1;
              let touching = 0;
              let longest = 0;
              let last = -Infinity;
              for (let n = 0; n < 120; n++) {
                step(w, DT, false);
                const on = w.bumps.includes(i);
                touching = on ? touching + 1 : 0;
                longest = Math.max(longest, touching);
                if (on && first < 0) {
                  first = n;
                  // Leaves outward, at the kick at least (less the drag of a later sub-step), never
                  // over the cap.
                  const k = w.puck;
                  const [nx, ny] = [(k.x - o.x) / D, (k.y - o.y) / D];
                  expect(k.vx * nx + k.vy * ny).toBeGreaterThan(0);
                  expect(speed(w)).toBeGreaterThanOrEqual(KICK * size * 0.999);
                  expect(speed(w)).toBeLessThanOrEqual(PUCK_MAX_SPEED * size + 1e-6);
                }
                // Then straight away from it, step after step: no pull back, no orbit. Ten steps
                // on, clear of it, a grazing puck that left along the tangent included.
                const gap = Math.hypot(w.puck.x - o.x, w.puck.y - o.y) - D;
                if (first >= 0 && n > first && n <= first + 10) {
                  expect(gap).toBeGreaterThan(last);
                }
                if (first >= 0 && n == first + 10) {
                  expect(gap).toBeGreaterThan(5 * size);
                }
                last = gap;
              }
              if (Math.abs(b) < 0.9 || v >= 300) {
                expect(first).toBeGreaterThanOrEqual(0);
              }
              expect(longest).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  }, 30_000);

  it('spins a puck a paddle holds against a whirlwind out from under it', () => {
    const p = paddle(0, wind.x - wind.r - 2 * PUCK_R - PADDLE_R - 10, wind.y);
    [p.tx, p.ty] = [wind.x, wind.y];
    const w = desert(wind.x - wind.r - PUCK_R - 5, wind.y, 0, 0, [p]);
    const still = stillness();
    run(
      w,
      480,
      () => {
        still.see(w);
        expect(overlap(w)).toBeLessThan(0.1);
        expect(speed(w)).toBeLessThanOrEqual(PUCK_MAX_SPEED + 1e-6);
      },
      false,
    );
    expect(still.pinned).toBeLessThan(TICK_HZ / 10);
  });

  it('predicts the spin as the host plays it, step for step, until the host breaks it', () => {
    for (const [dx, dy] of [
      [-1, 0],
      [0, 1],
      [1, -1],
      [-1, 1],
    ]) {
      const host = desert(wind.x + dx * 150, wind.y + dy * 150, -dx * 900, -dy * 900);
      const local = desert(wind.x + dx * 150, wind.y + dy * 150, -dx * 900, -dy * 900);
      let met = false;
      for (let i = 0; i < 120; i++) {
        step(host, DT);
        step(local, DT, false);
        met ||= host.bumps.includes(0);
        expect(local.puck).toEqual(host.puck);
        expect(local.bumps).toEqual(host.bumps);
      }
      expect(met).toBe(true);
      expect(host.obs[0].hits).toBeGreaterThanOrEqual(1);
      expect(local.obs[0].hits).toBe(0);
    }
  });

  it(`breaks a whirlwind like an iceberg: on its ${ICEBERG_HP}th puck hit, spin and kick every time`, () => {
    const w = desert(0, 0);
    for (let n = 1; n <= ICEBERG_HP; n++) {
      aim(w);
      const bumps: number[][] = [];
      let at = -1;
      run(w, 60, () => {
        if (w.bumps.length && at < 0) {
          at = w.tick;
          expect(speed(w)).toBeCloseTo(KICK, 6);
          expect(w.puck.vy).toBeCloseTo(-SPIN, 6);
        }
        bumps.push(w.bumps);
      });
      expect(bumps.filter(b => b.length)).toEqual([[0]]);
      expect(w.obs[0]).toMatchObject({ hits: n, gone: n < ICEBERG_HP ? -1 : at });
      expect(w.obs[0].angle).toBeCloseTo(0, 9);
    }
    // Gone: the puck slides straight through where it stood, unspun.
    Object.assign(w.puck, { x: wind.x - wind.r - PUCK_R - 30, y: wind.y, vx: 1200, vy: 0 });
    run(w, 60, () => expect(w.bumps).toEqual([]));
    expect(w.puck.x).toBeGreaterThan(wind.x + wind.r);
    expect(w.puck.vy).toBe(0);
    // Back RESPAWN ticks after its removal, intact: it bounces and spins again.
    w.tick = w.obs[0].gone + RESPAWN - 1;
    step(w, DT);
    expect(w.obs[0]).toMatchObject({ hits: 0, gone: -1 });
    aim(w);
    run(w, 60);
    expect(w.obs[0]).toMatchObject({ hits: 1, gone: -1 });
    expect(w.puck.vy).toBeLessThan(0);
  });

  it('shoots a genie out on the first hit, like a penguin, unspun, and brings it back', () => {
    for (const [dx, dy] of [
      [-1, 0],
      [-1, -1],
      [0, 1],
    ]) {
      const w = desert(0, 0);
      w.tick = MID;
      const [x, y] = [W / 2 + dx * 150, H / 2 + dy * 150];
      Object.assign(w.puck, { x, y, vx: -dx * 800, vy: -dy * 800 });
      run(w, 60, () => {
        if (w.bumps.length) {
          expect(w.bumps).toEqual([5]);
          expect(w.puck.vx * -dx + w.puck.vy * -dy).toBeLessThan(0);
          expect(speed(w)).toBeGreaterThanOrEqual(KICK - 1e-6);
        }
      });
      expect(obs(w)[5].kind).toBe('genie');
      expect(w.obs[5].hits).toBe(1);
      expect(w.obs[5].gone).toBeGreaterThan(MID);
      expect(w.obs[5].gone).toBeLessThan(w.tick);
      const a = w.obs[5].angle;
      expect(Math.cos(a) * -dx + Math.sin(a) * -dy).toBeGreaterThan(0.9 * Math.hypot(dx, dy));
      // Back in play RESPAWN ticks after, intact.
      const gone = w.obs[5].gone;
      w.tick = gone + RESPAWN - 1;
      step(w, DT);
      expect(w.obs[5]).toMatchObject({ hits: 0, gone: -1 });
    }
  });

  it('bounces the puck off a genie like off a penguin: the same velocity, no spin', () => {
    for (const t of [MID - 40, MID, 900, 1700]) {
      const m = obstacles('desert', t + 1)[5];
      const [x, y] = [m.x + 10, m.y + m.r + PUCK_R + 4];
      const [a, b] = [desert(x, y, 0, -900), world(x, y, 0, -900, [], 'ice')];
      a.tick = b.tick = t;
      for (let i = 0; i < 20; i++) {
        step(a, DT, false);
        step(b, DT, false);
      }
      expect(a.puck).toEqual(b.puck);
    }
  });

  it('makes paddles slide around whirlwinds and genies, never into them', () => {
    const p = paddle(0, 100, H / 2);
    const w = desert(W / 2, H - 100, 0, 0, [p]);
    for (const [tx, ty] of [
      [wind.x, wind.y],
      [720, H / 2],
      [900, 100],
      [300, 900],
    ]) {
      [p.tx, p.ty] = [tx, ty];
      run(w, 480, () => expect(overlap(w)).toBeLessThan(1e-6), false);
    }
  });
});
