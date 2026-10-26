import { describe, expect, it } from 'vitest';
import { PERIOD, layout, obstacles } from './arena';
import {
  GOAL,
  H,
  MAX_PLAYERS,
  MAX_SIZE,
  PADDLE_MAX_SPEED,
  PADDLE_R,
  PUCK_MAX_SPEED,
  PUCK_R,
  TICK_HZ,
  W,
} from './constants';
import { spawnPoint } from './physics';
import type { Obstacle, Team } from './types';

/** A paddle and a puck side by side: the width every gap must leave. */
const FIT = 2 * PADDLE_R + 2 * PUCK_R;
/** Every tick of a period, plus fractional ones. */
const TICKS = [...Array(PERIOD).keys(), 0.5, 1234.25, 2047.9];

const ice = (t = 0): Obstacle[] => obstacles('ice', t);
const dist = (o: Obstacle, x: number, y: number): number => Math.hypot(o.x - x, o.y - y);

describe('obstacles', () => {
  it('none in the classic arena', () => {
    expect(obstacles('classic', 0)).toEqual([]);
    expect(obstacles('classic', 1e6)).toEqual([]);
  });

  it('4 still icebergs, then 3 penguins with a slide speed of about 245 units/s', () => {
    const obs = ice(100);
    expect(obs.map(o => o.kind)).toEqual([
      'iceberg',
      'iceberg',
      'iceberg',
      'iceberg',
      'penguin',
      'penguin',
      'penguin',
    ]);
    obs.slice(0, 4).forEach(o => {
      expect(o).toMatchObject({ vx: 0, vy: 0 });
      expect(o.r).toBeGreaterThanOrEqual(55);
      expect(o.r).toBeLessThanOrEqual(75);
      expect(ice(1777)).toContainEqual(o);
    });
    obs.slice(4).forEach(o => {
      expect(o.vx).toBe(0);
      expect(Math.abs(o.vy)).toBeGreaterThan(240);
      expect(Math.abs(o.vy)).toBeLessThan(400);
    });
  });

  it('is mirror-symmetric across the centre line at any time', () => {
    for (const t of [0, 0.5, 300, 1024, 2000.75]) {
      const obs = ice(t);
      for (const [a, b] of [
        [0, 1],
        [2, 3],
        [4, 6],
        [5, 5],
      ]) {
        expect(obs[b].x).toBeCloseTo(W - obs[a].x, 9);
        expect([obs[b].y, obs[b].r, obs[b].vy]).toEqual([obs[a].y, obs[a].r, obs[a].vy]);
      }
    }
  });

  it('repeats every PERIOD ticks, which divides the u16 snapshot tick wrap', () => {
    expect(65536 % PERIOD).toBe(0);
    for (const t of [0, 1, 17.5, 1500.25]) {
      const a = ice(t);
      for (const s of [t + PERIOD, t + 65536, t + 3 * 65536]) {
        ice(s).forEach((o, i) => {
          expect(o.y).toBeCloseTo(a[i].y, 6);
          expect(o.vy).toBe(a[i].vy);
        });
      }
    }
  });

  it('slides penguins board to board, their velocity matching their motion', () => {
    let top = H;
    let bottom = 0;
    for (const t of TICKS) {
      const now = ice(t).slice(4);
      const next = ice(t + 0.25).slice(4);
      now.forEach((o, i) => {
        expect(o.y - o.r).toBeGreaterThanOrEqual(-1e-9);
        expect(o.y + o.r).toBeLessThanOrEqual(H + 1e-9);
        top = Math.min(top, o.y - o.r);
        bottom = Math.max(bottom, o.y + o.r);
        // Away from the turns, the next quarter tick moves it by vy.
        if (o.vy == next[i].vy) {
          expect((next[i].y - o.y) * 4 * TICK_HZ).toBeCloseTo(o.vy, 6);
        }
      });
    }
    expect(top).toBeCloseTo(0, 0);
    expect(bottom).toBeCloseTo(H, 0);
  });

  it('keeps clear of the serve spots, always, and of the centre spot at tick 0', () => {
    expect(ice(0).every(o => dist(o, W / 2, H / 2) > o.r + PUCK_R + 100)).toBe(true);
    for (const t of TICKS) {
      for (const o of ice(t)) {
        expect(dist(o, W / 4, H / 2)).toBeGreaterThan(o.r + PUCK_R + 100);
        expect(dist(o, (3 * W) / 4, H / 2)).toBeGreaterThan(o.r + PUCK_R + 100);
      }
    }
  });

  it('keeps clear of every spawn point, always', () => {
    for (const t of TICKS) {
      for (const o of ice(t)) {
        for (const team of [0, 1] as Team[]) {
          for (let n = 0; n < 16; n++) {
            const [x, y] = spawnPoint(team, n);
            expect(dist(o, x, y)).toBeGreaterThan(o.r + PADDLE_R + 10);
          }
        }
      }
    }
  });

  it('leaves the goal mouths open', () => {
    for (const t of TICKS) {
      for (const o of ice(t)) {
        // Nothing within 300 units of a goal line.
        expect(Math.min(o.x, W - o.x) - o.r).toBeGreaterThan(300);
      }
    }
    // At tick 0 a straight shot from the centre spot reaches any point of either mouth.
    for (const o of ice(0)) {
      expect(Math.abs(o.y - H / 2)).toBeGreaterThan(o.r + PUCK_R + GOAL / 2);
    }
  });

  it('fits a paddle and a puck side by side in every gap, so nothing gets trapped', () => {
    const [a, , b, , left, mid] = ice(0);
    // Icebergs to the boards and the side walls.
    for (const o of [a, b]) {
      expect(Math.min(o.y - o.r, H - o.y - o.r, o.x - o.r)).toBeGreaterThan(FIT);
    }
    // Icebergs to the nearest penguin lane, the lanes to each other, and the pair's lane to a
    // paddle standing on the centre line (where it cannot yield).
    expect(left.x - left.r - Math.max(a.x + a.r, b.x + b.r)).toBeGreaterThan(FIT);
    expect(mid.x - mid.r - (left.x + left.r)).toBeGreaterThan(FIT);
    expect(W / 2 - 2 * PADDLE_R - (left.x + left.r)).toBeGreaterThan(FIT);
  });

  it('cannot be tunnelled: a step closes less than the smallest contact distance', () => {
    const r = Math.min(...ice(0).map(o => o.r));
    const v = Math.max(...ice(0).map(o => Math.abs(o.vy)));
    expect((PUCK_MAX_SPEED + v) / TICK_HZ).toBeLessThan(r + PUCK_R);
    expect((PADDLE_MAX_SPEED + v) / TICK_HZ).toBeLessThan(r + PADDLE_R);
  });
});

describe('layout', () => {
  it.each([
    [0, 1, 3],
    [1, 1, 3],
    [2, 1, 3],
    [3, Math.sqrt(1.5), 3],
    [4, Math.SQRT2, 3],
    [5, Math.sqrt(2.5), 3],
    [6, Math.sqrt(3), 4],
    [7, Math.sqrt(3.5), 4],
    [8, 2, 5],
    [10, 2, 6],
    [12, 2, 7],
    [16, 2, 7],
  ])('%i players: size %f, %i obstacles', (players, size, count) => {
    expect(layout(players)).toEqual({ size, count });
  });

  it('keeps the area per player from 2 to 8 players', () => {
    for (let n = 2; n <= 8; n++) {
      expect((layout(n).size ** 2 * W * H) / n).toBeCloseTo((W * H) / 2, 6);
    }
    expect(layout(MAX_PLAYERS).size).toBe(MAX_SIZE);
  });
});

describe('obstacles on a scaled rink', () => {
  /** Every size and count the room can pick. */
  const RINKS = [...Array(MAX_PLAYERS + 1).keys()].map(n => layout(n));
  const ALL = [2, 3, 4, 5, 6, 7].flatMap(count =>
    [1, Math.SQRT2, Math.sqrt(3), MAX_SIZE].map(size => ({ size, count })),
  );
  /** A period sampled every 8 ticks, plus fractional ticks. */
  const SOME = [...Array(PERIOD / 8).keys()].map(t => t * 8).concat([0.5, 1234.25, 2047.9]);
  const at = (t: number, { size, count }: { size: number; count: number }) =>
    obstacles('ice', t, size, count);

  it.each([
    [2, 'ii', [0, 1]],
    [3, 'iip', [0, 1, 5]],
    [4, 'iipp', [0, 1, 4, 6]],
    [5, 'iippp', [0, 1, 4, 5, 6]],
    [6, 'iiiipp', [0, 1, 2, 3, 4, 6]],
    [7, 'iiiippp', [0, 1, 2, 3, 4, 5, 6]],
  ])('keeps %i obstacles of the full layout, in its order', (count, kinds, picked) => {
    for (const t of [0, 333.5]) {
      const obs = obstacles('ice', t, 1, count);
      expect(obs.map(o => o.kind[0]).join('')).toBe(kinds);
      expect(obs).toEqual(picked.map(i => ice(t)[i]));
    }
  });

  it('is the base layout scaled by the size, with the same crossing time', () => {
    for (const { size, count } of ALL) {
      for (const t of [0, 100.5, 1500]) {
        const base = obstacles('ice', t, 1, count);
        obstacles('ice', t, size, count).forEach((o, i) => {
          const b = base[i];
          expect([o.kind, o.vx]).toEqual([b.kind, b.vx]);
          for (const k of ['x', 'y', 'r', 'vy'] as const) {
            expect(o[k]).toBeCloseTo(b[k] * size, 9);
          }
        });
      }
    }
  });

  it('is mirror-symmetric at every count and size, a penguin on the centre line when odd', () => {
    for (const rink of ALL) {
      const X = W * rink.size;
      for (const t of [0, 0.5, 777, 2000.75]) {
        const obs = at(t, rink);
        expect(obs).toHaveLength(rink.count);
        expect(obs.filter(o => Math.abs(o.x - X / 2) < 1e-9)).toHaveLength(rink.count % 2);
        for (const o of obs) {
          const m = obs.find(q => Math.abs(q.x - (X - o.x)) < 1e-9)!;
          expect([m.kind, m.y, m.r, m.vy]).toEqual([o.kind, o.y, o.r, o.vy]);
        }
      }
    }
  });

  it('keeps each index on the same obstacle, and repeats every PERIOD ticks', () => {
    for (const rink of ALL) {
      const first = at(0, rink);
      for (const t of [1, 17.5, 1500.25]) {
        const a = at(t, rink);
        a.forEach((o, i) =>
          expect([o.kind, o.x, o.r]).toEqual([first[i].kind, first[i].x, first[i].r]),
        );
        at(t + 65536, rink).forEach((o, i) => {
          expect(o.y).toBeCloseTo(a[i].y, 6);
          expect(o.vy).toBe(a[i].vy);
        });
      }
    }
  });

  it('slides penguins board to board of the scaled rink', () => {
    for (const rink of ALL.filter(r => r.count > 2)) {
      let top = Infinity;
      let bottom = 0;
      for (const t of SOME) {
        for (const o of at(t, rink).filter(o => o.kind == 'penguin')) {
          top = Math.min(top, o.y - o.r);
          bottom = Math.max(bottom, o.y + o.r);
        }
      }
      expect(top).toBeCloseTo(0, 0);
      expect(bottom).toBeCloseTo(H * rink.size, 0);
    }
  });

  it('keeps clear of the serve spots, the spawn points and the goal mouths at every count and size', () => {
    for (const rink of RINKS) {
      const { size } = rink;
      const [X, Y] = [W * size, H * size];
      for (const t of SOME) {
        for (const o of at(t, rink)) {
          for (const x of [X / 4, (3 * X) / 4]) {
            expect(dist(o, x, Y / 2)).toBeGreaterThan(o.r + PUCK_R + 100);
          }
          for (const team of [0, 1] as Team[]) {
            for (let n = 0; n < MAX_PLAYERS; n++) {
              const [x, y] = spawnPoint(team, n, size);
              expect(dist(o, x, y)).toBeGreaterThan(o.r + PADDLE_R + 10);
            }
          }
          expect(Math.min(o.x, X - o.x) - o.r).toBeGreaterThan(300);
        }
      }
      for (const o of at(0, rink)) {
        expect(dist(o, X / 2, Y / 2)).toBeGreaterThan(o.r + PUCK_R + 100);
        // A straight shot from the centre spot reaches any point of either mouth.
        expect(Math.abs(o.y - Y / 2)).toBeGreaterThan(o.r + PUCK_R + (GOAL * size) / 2);
      }
    }
  }, 20_000);

  it('fits a paddle and a puck side by side in every gap at every count and size', () => {
    for (const rink of ALL) {
      const X = W * rink.size;
      const Y = H * rink.size;
      for (const t of SOME) {
        const obs = at(t, rink);
        obs.forEach((o, i) => {
          if (o.kind == 'iceberg') {
            expect(Math.min(o.y - o.r, Y - o.y - o.r, o.x - o.r, X - o.x - o.r)).toBeGreaterThan(
              FIT,
            );
          } else if (o.x != X / 2) {
            // A side lane to a paddle standing on the centre line, where it cannot yield.
            expect(Math.abs(X / 2 - o.x) - o.r - 2 * PADDLE_R).toBeGreaterThan(FIT);
          }
          for (const q of obs.slice(i + 1)) {
            expect(dist(o, q.x, q.y) - o.r - q.r).toBeGreaterThan(FIT);
          }
        });
      }
    }
  });

  it('cannot be tunnelled at the scaled top speeds, with ceil(size) sub-steps per tick', () => {
    for (const rink of ALL) {
      const { size } = rink;
      const obs = at(0, rink);
      const r = Math.min(...obs.map(o => o.r));
      const v = Math.max(...obs.map(o => Math.abs(o.vy)));
      const per = TICK_HZ * Math.ceil(size);
      expect((PUCK_MAX_SPEED * size + v) / per).toBeLessThan(r + PUCK_R);
      expect((PADDLE_MAX_SPEED * size + v) / per).toBeLessThan(r + PADDLE_R);
      // Puck and paddle per sub-step: no further than at size 1.
      expect((PUCK_MAX_SPEED * size) / per).toBeLessThanOrEqual(PUCK_MAX_SPEED / TICK_HZ);
      expect((PADDLE_MAX_SPEED * size) / per).toBeLessThanOrEqual(PADDLE_MAX_SPEED / TICK_HZ);
    }
  });
});
