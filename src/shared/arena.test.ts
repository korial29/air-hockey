import { describe, expect, it } from 'vitest';
import { PERIOD, obstacles } from './arena';
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
