import { describe, expect, it } from 'vitest';
import { PERIOD, ZA, ZN, fixed, layout, obstacles, scene } from './arena';
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
import type { Arena, Obstacle, Team } from './types';

/** A paddle and a puck side by side: the width every gap must leave. */
const FIT = 2 * PADDLE_R + 2 * PUCK_R;
/** The puck alone, with room to spare: the width every gap keeps at sea, even mid-swing. */
const SLIP = 2 * PUCK_R + 20;
/** Every tick of a period, plus fractional ones. */
const TICKS = [...Array(PERIOD).keys(), 0.5, 1234.25, 2047.9];

const ice = (t = 0): Obstacle[] => obstacles('ice', t);
const sea = (t = 0): Obstacle[] => obstacles('sea', t);
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
  }, 20_000);

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
    [4, Math.SQRT2, 4],
    [5, Math.sqrt(2.5), 4],
    [6, Math.sqrt(3), 5],
    [7, Math.sqrt(3.5), 5],
    [8, 2, 6],
    [9, 2, 6],
    [10, 2, 7],
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

  it.each(['ice', 'sea'] as Arena[])(
    'keeps clear of the serve spots, the spawn points and the goal mouths at every count and size (%s)',
    arena => {
      // At sea a mermaid swinging out of its lane passes a few units from the outer spawn column:
      // never over a spawned paddle, and clear by the full margin at tick 0, when a round starts.
      const spare = arena == 'sea' ? 0 : 10;
      for (const rink of RINKS) {
        const { size } = rink;
        const [X, Y] = [W * size, H * size];
        for (const t of SOME) {
          for (const o of obstacles(arena, t, size, rink.count)) {
            for (const x of [X / 4, (3 * X) / 4]) {
              expect(dist(o, x, Y / 2)).toBeGreaterThan(o.r + PUCK_R + 100);
            }
            for (const team of [0, 1] as Team[]) {
              for (let n = 0; n < MAX_PLAYERS; n++) {
                const [x, y] = spawnPoint(team, n, size);
                expect(dist(o, x, y)).toBeGreaterThan(o.r + PADDLE_R + spare);
              }
            }
            expect(Math.min(o.x, X - o.x) - o.r).toBeGreaterThan(300);
          }
        }
        for (const o of obstacles(arena, 0, size, rink.count)) {
          expect(dist(o, X / 2, Y / 2)).toBeGreaterThan(o.r + PUCK_R + 100);
          for (const team of [0, 1] as Team[]) {
            for (let n = 0; n < MAX_PLAYERS; n++) {
              const [x, y] = spawnPoint(team, n, size);
              expect(dist(o, x, y)).toBeGreaterThan(o.r + PADDLE_R + 10);
            }
          }
          // A straight shot from the centre spot reaches any point of either mouth.
          expect(Math.abs(o.y - Y / 2)).toBeGreaterThan(o.r + PUCK_R + (GOAL * size) / 2);
        }
      }
    },
    20_000,
  );

  it('fits a paddle and a puck side by side in every gap at every count and size', () => {
    for (const rink of ALL) {
      const X = W * rink.size;
      const Y = H * rink.size;
      for (const t of SOME) {
        const obs = obstacles('ice', t, rink.size, rink.count);
        obs.forEach((o, i) => {
          if (fixed(o)) {
            expect(Math.min(o.y - o.r, Y - o.y - o.r, o.x - o.r, X - o.x - o.r)).toBeGreaterThan(
              FIT,
            );
          } else if (Math.abs(X / 2 - o.x) > 100 * rink.size) {
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

  it.each(['ice', 'sea'] as Arena[])(
    'cannot be tunnelled at the scaled top speeds, with ceil(size) sub-steps per tick (%s)',
    arena => {
      for (const rink of ALL) {
        const { size } = rink;
        const all = SOME.flatMap(t => obstacles(arena, t, size, rink.count));
        const r = Math.min(...all.map(o => o.r));
        // Both components: a mermaid zig-zags.
        const v = Math.max(...all.map(o => Math.hypot(o.vx, o.vy)));
        const per = TICK_HZ * Math.ceil(size);
        expect((PUCK_MAX_SPEED * size + v) / per).toBeLessThan(r + PUCK_R);
        expect((PADDLE_MAX_SPEED * size + v) / per).toBeLessThan(r + PADDLE_R);
        // Puck and paddle per sub-step: no further than at size 1.
        expect((PUCK_MAX_SPEED * size) / per).toBeLessThanOrEqual(PUCK_MAX_SPEED / TICK_HZ);
        expect((PADDLE_MAX_SPEED * size) / per).toBeLessThanOrEqual(PADDLE_MAX_SPEED / TICK_HZ);
      }
    },
  );
});

describe('the sea arena', () => {
  const ALL = [2, 3, 4, 5, 6, 7].flatMap(count =>
    [1, Math.SQRT2, Math.sqrt(3), MAX_SIZE].map(size => ({ size, count })),
  );
  /** Every tick of a crossing, board to board. */
  const CROSSING = [...Array(PERIOD / 2).keys()];
  /** Lane centres of the side and centre mermaids, from the penguins'. */
  const LANES = ice(0)
    .slice(4)
    .map(o => o.x);

  it('is the ice layout slot for slot: rocks for icebergs, mermaids for penguins', () => {
    for (const { size, count } of ALL) {
      for (const t of [0, 100.5, 777, 1500]) {
        const a = obstacles('ice', t, size, count);
        const b = obstacles('sea', t, size, count);
        expect(b.map(o => o.kind)).toEqual(a.map(o => (o.kind == 'iceberg' ? 'rock' : 'mermaid')));
        b.forEach((o, i) => {
          const c = a[i];
          if (fixed(o)) {
            expect(o).toEqual({ ...c, kind: 'rock' });
          } else {
            // Same lane (give or take the zig-zag), same share of the crossing, same direction.
            expect(Math.abs(o.x - c.x)).toBeLessThanOrEqual(ZA * size + 1e-9);
            expect((o.y - o.r) / (H * size - 2 * o.r)).toBeCloseTo(
              (c.y - c.r) / (H * size - 2 * c.r),
              9,
            );
            expect(Math.sign(o.vy)).toBe(Math.sign(c.vy));
            expect(o.r).toBeGreaterThanOrEqual(30 * size);
          }
        });
      }
    }
  });

  it('zig-zags each mermaid across its lane, within its corridor, a few times per crossing', () => {
    const swims = sea(0).slice(4);
    swims.forEach((_, i) => {
      const xs = CROSSING.map(t => sea(t)[4 + i].x - LANES[i]);
      const vx = CROSSING.map(t => sea(t)[4 + i].vx);
      // Out to ZA units either side, evenly: a swing of 120 units or more, plain to see.
      expect(ZA).toBeGreaterThanOrEqual(60);
      expect(Math.max(...xs)).toBeCloseTo(ZA, 6);
      expect(Math.min(...xs)).toBeCloseTo(-ZA, 6);
      // On the lane where it touches a board.
      expect(xs[0]).toBeCloseTo(0, 9);
      expect(sea(PERIOD / 2)[4 + i].x).toBeCloseTo(LANES[i], 9);
      // Turns: ZN back-and-forths per crossing, a few.
      const turns = vx.filter((v, t) => t && Math.sign(v) != Math.sign(vx[t - 1])).length;
      expect(turns).toBe(2 * ZN);
      expect(ZN).toBeGreaterThanOrEqual(3);
    });
  });

  it('reports its velocity, both components, matching its motion at every size', () => {
    for (const { size } of ALL) {
      let sideways = 0;
      for (const t of [...CROSSING, 1234.25, 2047.5]) {
        const now = obstacles('sea', t, size);
        const next = obstacles('sea', t + 0.25, size);
        now.slice(4).forEach((o, i) => {
          const n = next[4 + i];
          // Away from the turns, the next quarter tick moves it by its velocity.
          if (o.vx == n.vx && o.vy == n.vy) {
            expect((n.x - o.x) * 4 * TICK_HZ).toBeCloseTo(o.vx, 6);
            expect((n.y - o.y) * 4 * TICK_HZ).toBeCloseTo(o.vy, 6);
          }
          sideways = Math.max(sideways, Math.abs(o.vx));
        });
      }
      // 4 · ZA per back-and-forth, ZN of them per crossing (about 197 units/s), scaled.
      expect(sideways / size).toBeCloseTo((8 * ZA * ZN * TICK_HZ) / PERIOD, 6);
    }
  });

  it('swims board to board of the scaled rink', () => {
    for (const rink of ALL.filter(r => r.count > 2)) {
      let top = Infinity;
      let bottom = 0;
      for (const t of CROSSING.filter(t => t % 4 == 0).concat(PERIOD / 2)) {
        for (const o of obstacles('sea', t, rink.size, rink.count).filter(o => !fixed(o))) {
          top = Math.min(top, o.y - o.r);
          bottom = Math.max(bottom, o.y + o.r);
        }
      }
      expect(top).toBeCloseTo(0, 6);
      expect(bottom).toBeCloseTo(H * rink.size, 6);
    }
  });

  it('mirrors the side mermaids at every instant, and the centre one over time', () => {
    for (const rink of ALL) {
      const X = W * rink.size;
      let left = 0;
      let right = 0;
      let sum = 0;
      for (const t of [...Array(PERIOD).keys(), 0.5, 2000.75]) {
        const obs = obstacles('sea', t, rink.size, rink.count);
        expect(obs).toHaveLength(rink.count);
        for (const o of obs) {
          if (Math.abs(o.x - X / 2) <= (ZA + 1) * rink.size) {
            // The centre mermaid, counted over the ticks of a period.
            if (t % 1) {
              continue;
            }
            left += +(o.x < X / 2 - 1e-9);
            right += +(o.x > X / 2 + 1e-9);
            sum += o.x - X / 2;
            continue;
          }
          const m = obs.find(q => Math.abs(q.x - (X - o.x)) < 1e-9)!;
          expect([m.kind, m.y, m.r, m.vy, -m.vx + 0]).toEqual([o.kind, o.y, o.r, o.vy, o.vx + 0]);
        }
      }
      // As long on either side of the centre line, as far.
      expect(left).toBe(right);
      expect(Math.abs(sum)).toBeLessThan(1e-6);
    }
  });

  it('repeats every PERIOD ticks, which divides the u16 snapshot tick wrap', () => {
    for (const rink of ALL) {
      for (const t of [0, 1, 17.5, 1500.25]) {
        const a = obstacles('sea', t, rink.size, rink.count);
        for (const u of [t + PERIOD, t + 65536, t + 3 * 65536]) {
          obstacles('sea', u, rink.size, rink.count).forEach((o, i) => {
            expect(o.kind).toBe(a[i].kind);
            expect(o.x).toBeCloseTo(a[i].x, 6);
            expect(o.y).toBeCloseTo(a[i].y, 6);
            expect([o.vx, o.vy]).toEqual([a[i].vx, a[i].vy]);
          });
        }
      }
    }
  });

  it('fits the puck alone in every gap at every tick, count and size: no obstacle traps it', () => {
    for (const rink of ALL) {
      const X = W * rink.size;
      const Y = H * rink.size;
      for (const t of [...Array(PERIOD).keys(), 0.5, 1234.25, 2047.9]) {
        const obs = obstacles('sea', t, rink.size, rink.count);
        obs.forEach((o, i) => {
          if (fixed(o)) {
            // Rocks to the boards and the side walls: a paddle and a puck, as on the ice.
            expect(Math.min(o.y - o.r, Y - o.y - o.r, o.x - o.r, X - o.x - o.r)).toBeGreaterThan(
              FIT,
            );
          } else if (Math.abs(X / 2 - o.x) > (ZA + 1) * rink.size) {
            // A side lane to a paddle standing on the centre line, where it cannot yield.
            expect(Math.abs(X / 2 - o.x) - o.r - 2 * PADDLE_R).toBeGreaterThan(SLIP);
          }
          for (const q of obs.slice(i + 1)) {
            expect(dist(o, q.x, q.y) - o.r - q.r).toBeGreaterThan(SLIP);
          }
        });
      }
    }
  });

  it('narrows a gap below a paddle and a puck only while a mermaid swings toward it', () => {
    const [a, , b, , { r }] = sea(0);
    const lane = LANES[0];
    /** Every quarter tick of a period. */
    const QUARTERS = [...Array(4 * PERIOD).keys()].map(t => t / 4);
    let rockToLane = Infinity;
    let laneToLane = Infinity;
    let toLine = Infinity;
    let rockTight = 0;
    let lineTight = 0;
    for (const t of QUARTERS) {
      const [, , , , left, mid, right] = sea(t);
      const rock = Math.min(...[a, b].map(o => dist(o, left.x, left.y) - o.r - left.r));
      const line = W / 2 - 2 * PADDLE_R - (left.x + left.r);
      rockToLane = Math.min(rockToLane, rock);
      toLine = Math.min(toLine, line);
      laneToLane = Math.min(
        laneToLane,
        ...[left, right].map(o => dist(o, mid.x, mid.y) - o.r - mid.r),
      );
      // A squeeze only on the side the mermaid swings to.
      if (rock < FIT) {
        rockTight++;
        expect(left.x).toBeLessThan(lane);
      }
      if (line < FIT) {
        lineTight++;
        expect(left.x).toBeGreaterThan(lane);
      }
    }
    // Rocks to the nearest lane: down to about 96, the full outward swing side on, in the rocks'
    // rows only: under 1/8 of the period.
    expect(rockToLane).toBeLessThan(FIT);
    expect(rockToLane).toBeGreaterThanOrEqual(
      lane - ZA - r - Math.max(a.x + a.r, b.x + b.r) - 1e-9,
    );
    expect(rockTight / QUARTERS.length).toBeLessThan(1 / 8);
    // The pair's lanes to a centre-line paddle: 90 at the full inward swing, below a paddle and a
    // puck once the swing passes d, on every inward half-zig: (1 - d / ZA) / 2 of the period.
    const d = W / 2 - 2 * PADDLE_R - FIT - r - lane;
    expect(toLine).toBeCloseTo(W / 2 - 2 * PADDLE_R - (lane + ZA + r), 6);
    expect(lineTight / QUARTERS.length).toBeCloseTo((1 - d / ZA) / 2, 2);
    // Lane to lane: a paddle and a puck at every instant.
    expect(laneToLane).toBeGreaterThan(FIT);
    // The puck alone, always.
    expect(Math.min(rockToLane, toLine)).toBeGreaterThan(SLIP);
  });

  it.each([
    [2, 'rr'],
    [3, 'rrm'],
    [4, 'rrmm'],
    [5, 'rrmmm'],
    [6, 'rrrrmm'],
    [7, 'rrrrmmm'],
  ])('keeps %i obstacles, in the slots of the ice', (count, kinds) => {
    expect(
      obstacles('sea', 333.5, 1, count)
        .map(o => o.kind[0])
        .join(''),
    ).toBe(kinds);
  });
});

describe('fixed', () => {
  it('is true for icebergs and rocks, false for penguins and mermaids', () => {
    expect([...ice(), ...sea()].map(o => [o.kind, fixed(o)])).toEqual([
      ...Array(4).fill(['iceberg', true]),
      ...Array(3).fill(['penguin', false]),
      ...Array(4).fill(['rock', true]),
      ...Array(3).fill(['mermaid', false]),
    ]);
  });
});

describe('scene', () => {
  it('takes turns through a list, round 1 the first, the first one while waiting', () => {
    const list: Arena[] = ['ice', 'sea'];
    expect([0, 1, 2, 3, 4, 5].map(n => scene(list, n))).toEqual([
      'ice',
      'ice',
      'sea',
      'ice',
      'sea',
      'ice',
    ]);
    expect([0, 1, 2, 3, 4].map(n => scene(['sea', 'classic', 'ice'], n))).toEqual([
      'sea',
      'sea',
      'classic',
      'ice',
      'sea',
    ]);
  });

  it('plays a single scene, or a list of one, every round', () => {
    for (const n of [0, 1, 2, 3, 7]) {
      expect(scene('sea', n)).toBe('sea');
      expect(scene(['classic'], n)).toBe('classic');
    }
  });
});
