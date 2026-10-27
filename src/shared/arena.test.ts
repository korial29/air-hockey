import { describe, expect, it } from 'vitest';
import { GA, PERIOD, WANDER, ZA, ZN, fixed, layout, obstacles, scene, swirl } from './arena';
import {
  GOAL,
  H,
  MAX_PLAYERS,
  MAX_SIZE,
  PADDLE_MAX_SPEED,
  PADDLE_R,
  PUCK_MAX_SPEED,
  PUCK_R,
  RULES,
  TICK_HZ,
  W,
} from './constants';
import { spawnPoint } from './physics';
import type { Arena, Obstacle, Team } from './types';

/** A paddle and a puck side by side: the width every gap must leave. */
const FIT = 2 * PADDLE_R + 2 * PUCK_R;
/**
 * The puck alone, with room to spare: the width every gap keeps at sea, even mid-swing, and in the
 * desert, wherever the genies float.
 */
const SLIP = 2 * PUCK_R + 20;
/** Every tick of a period, plus fractional ones. */
const TICKS = [...Array(PERIOD).keys(), 0.5, 1234.25, 2047.9];

const ice = (t = 0): Obstacle[] => obstacles('ice', t);
const sea = (t = 0): Obstacle[] => obstacles('sea', t);
const desert = (t = 0): Obstacle[] => obstacles('desert', t);
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

  it.each(['ice', 'sea', 'desert'] as Arena[])(
    'keeps clear of the serve spots, the spawn points and the goal mouths at every count and size (%s)',
    arena => {
      // At sea a shark swinging out of its lane grazes the outer spawn column: never over a
      // spawned paddle, and clear by the full margin at tick 0, when a round starts. In the desert
      // the genies' band stops 6 units short of it.
      const spare = { ice: 10, sea: 0, desert: 5 }[arena as string] ?? 0;
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
          // A genie may float anywhere in its band, past the centre spot too.
          if (o.kind == 'genie') {
            continue;
          }
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

  it.each(['ice'] as Arena[])(
    'fits a paddle and a puck side by side in every gap at every count and size (%s)',
    arena => {
      for (const rink of ALL) {
        const X = W * rink.size;
        const Y = H * rink.size;
        for (const t of SOME) {
          const obs = obstacles(arena, t, rink.size, rink.count);
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
    },
  );

  it.each(['ice', 'sea', 'desert'] as Arena[])(
    'cannot be tunnelled at the scaled top speeds, with ceil(size) sub-steps per tick (%s)',
    arena => {
      for (const rink of ALL) {
        const { size } = rink;
        const all = SOME.flatMap(t => obstacles(arena, t, size, rink.count));
        const r = Math.min(...all.map(o => o.r));
        // Both components: a shark zig-zags.
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
  /** Lane centres of the side and centre sharks, from the penguins'. */
  const LANES = ice(0)
    .slice(4)
    .map(o => o.x);

  it('is the ice layout slot for slot: vortices for icebergs, sharks for penguins', () => {
    for (const { size, count } of ALL) {
      for (const t of [0, 100.5, 777, 1500]) {
        const a = obstacles('ice', t, size, count);
        const b = obstacles('sea', t, size, count);
        expect(b.map(o => o.kind)).toEqual(a.map(o => (o.kind == 'iceberg' ? 'vortex' : 'shark')));
        b.forEach((o, i) => {
          const c = a[i];
          if (fixed(o)) {
            expect(o).toEqual({ ...c, kind: 'vortex' });
          } else {
            // Same lane (give or take the zig-zag), same share of the crossing, same direction.
            expect(Math.abs(o.x - c.x)).toBeLessThanOrEqual(ZA * size + 1e-9);
            expect((o.y - o.r) / (H * size - 2 * o.r)).toBeCloseTo(
              (c.y - c.r) / (H * size - 2 * c.r),
              9,
            );
            expect(Math.sign(o.vy)).toBe(Math.sign(c.vy));
            // Big: wider than the penguin of the same slot.
            expect(o.r).toBeGreaterThan(c.r);
          }
        });
      }
    }
  });

  it('zig-zags each shark across its lane, within its corridor, a few times per crossing', () => {
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

  it('mirrors the side sharks at every instant, and the centre one over time', () => {
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
            // The centre shark, counted over the ticks of a period.
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
            // Vortices to the boards and the side walls: a paddle and a puck, as on the ice.
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
  }, 20_000);

  it('narrows a gap below a paddle and a puck only while a shark swings toward it', () => {
    const [a, , b, , { r }] = sea(0);
    const lane = LANES[0];
    /** Every quarter tick of a period. */
    const QUARTERS = [...Array(4 * PERIOD).keys()].map(t => t / 4);
    let vortexToLane = Infinity;
    let laneToLane = Infinity;
    let toLine = Infinity;
    let vortexTight = 0;
    let lineTight = 0;
    let laneTight = 0;
    for (const t of QUARTERS) {
      const [, , , , left, mid, right] = sea(t);
      const vortex = Math.min(...[a, b].map(o => dist(o, left.x, left.y) - o.r - left.r));
      const line = W / 2 - 2 * PADDLE_R - (left.x + left.r);
      const lanes = [left, right].map(o => dist(o, mid.x, mid.y) - o.r - mid.r);
      vortexToLane = Math.min(vortexToLane, vortex);
      toLine = Math.min(toLine, line);
      laneToLane = Math.min(laneToLane, ...lanes);
      // A squeeze only on the side the shark swings to.
      if (vortex < FIT) {
        vortexTight++;
        expect(left.x).toBeLessThan(lane);
      }
      if (line < FIT) {
        lineTight++;
        expect(left.x).toBeGreaterThan(lane);
      }
      lanes.forEach((g, k) => {
        if (g < FIT) {
          // Two sharks swinging toward each other.
          laneTight++;
          const o = [left, right][k];
          expect(Math.sign(o.x - LANES[2 * k])).toBe(Math.sign(mid.x - o.x));
          expect(Math.sign(mid.x - LANES[1])).toBe(Math.sign(o.x - mid.x));
        }
      });
    }
    // Vortices to the nearest lane: down to about 87, the full outward swing side on, in the vortices'
    // rows only: under 1/4 of the period.
    expect(vortexToLane).toBeLessThan(FIT);
    expect(vortexToLane).toBeGreaterThanOrEqual(
      lane - ZA - r - Math.max(a.x + a.r, b.x + b.r) - 1e-9,
    );
    expect(vortexTight / QUARTERS.length).toBeLessThan(1 / 4);
    // The pair's lanes to a centre-line paddle: 78 at the full inward swing, below a paddle and a
    // puck once the swing passes d, on every inward half-zig: (1 - d / ZA) / 2 of the period.
    const d = W / 2 - 2 * PADDLE_R - FIT - r - lane;
    expect(toLine).toBeCloseTo(W / 2 - 2 * PADDLE_R - (lane + ZA + r), 6);
    expect(lineTight / QUARTERS.length).toBeCloseTo((1 - d / ZA) / 2, 2);
    // Lane to lane: down to about 129, under 1/16 of the period.
    expect(laneToLane).toBeLessThan(FIT);
    expect(laneToLane).toBeGreaterThan(125);
    expect(laneTight / QUARTERS.length).toBeLessThan(1 / 16);
    // The puck alone, always.
    expect(Math.min(vortexToLane, toLine, laneToLane)).toBeGreaterThan(SLIP);
  });

  it.each([
    [2, 'vv'],
    [3, 'vvs'],
    [4, 'vvss'],
    [5, 'vvsss'],
    [6, 'vvvvss'],
    [7, 'vvvvsss'],
  ])('keeps %i obstacles, in the slots of the ice', (count, kinds) => {
    expect(
      obstacles('sea', 333.5, 1, count)
        .map(o => o.kind[0])
        .join(''),
    ).toBe(kinds);
  });
});

describe('the desert arena', () => {
  const ALL = [2, 3, 4, 5, 6, 7].flatMap(count =>
    [1, Math.SQRT2, Math.sqrt(3), MAX_SIZE].map(size => ({ size, count })),
  );
  const SEEDS = [0, 1, 77, 123456789, 2 ** 32 - 1];
  const KIND = { iceberg: 'whirlwind', penguin: 'genie' } as Record<string, Obstacle['kind']>;

  it('puts whirlwinds where the ice puts icebergs, genies in its penguin lanes', () => {
    for (const { size, count } of ALL) {
      for (const seed of SEEDS) {
        for (const t of [0, 0.5, 100.5, 777, 1500, 2047.9, 65536 + 3]) {
          const a = obstacles('ice', t, size, count, seed);
          const b = obstacles('desert', t, size, count, seed);
          expect(b.map(o => o.kind)).toEqual(a.map(o => KIND[o.kind]));
          // Whirlwinds: same place and size, every guarantee of the icebergs holds as it is.
          expect(b.filter(fixed)).toEqual(a.filter(fixed).map(o => ({ ...o, kind: 'whirlwind' })));
          // Genies: in their band, round the penguin's lane.
          b.forEach((o, i) => {
            if (!fixed(o)) {
              expect(o.r).toBe(a[i].r);
              expect(Math.abs(o.x - a[i].x)).toBeLessThanOrEqual(GA * size + 1e-9);
              expect(o.y).toBeGreaterThanOrEqual(o.r - 1e-9);
              expect(o.y).toBeLessThanOrEqual(H * size - o.r + 1e-9);
            }
          });
        }
      }
    }
  });

  it('fits the puck alone in every gap wherever the genies float: no obstacle traps it', () => {
    for (const { size, count } of ALL) {
      const X = W * size;
      for (const seed of SEEDS) {
        for (let t = 0; t < 65536; t += 193) {
          const obs = obstacles('desert', t, size, count, seed);
          obs.forEach((o, i) => {
            if (!fixed(o) && Math.abs(X / 2 - o.x) > (GA + 1) * size) {
              // A side genie to a paddle standing on the centre line, where it cannot yield.
              expect(Math.abs(X / 2 - o.x) - o.r - 2 * PADDLE_R).toBeGreaterThan(SLIP);
            }
            for (const q of obs.slice(i + 1)) {
              expect(dist(o, q.x, q.y) - o.r - q.r).toBeGreaterThan(SLIP);
            }
          });
        }
      }
    }
  }, 20_000);

  it.each([
    [2, 'ww'],
    [3, 'wwg'],
    [4, 'wwgg'],
    [5, 'wwggg'],
    [6, 'wwwwgg'],
    [7, 'wwwwggg'],
  ])('keeps %i obstacles, in the slots of the ice', (count, kinds) => {
    expect(
      obstacles('desert', 333.5, 1, count)
        .map(o => o.kind[0])
        .join(''),
    ).toBe(kinds);
  });

  it('floats genies at random in their band, gliding from waypoint to waypoint, the pair in mirror', () => {
    const lanes = ice(0)
      .slice(4)
      .map(o => o.x);
    for (const seed of [0, 1, 77, 2 ** 32 - 1]) {
      const at = (t: number) => obstacles('desert', t, 1, 7, seed).slice(4);
      const [lo, hi] = [lanes.map(() => H), lanes.map(() => 0)];
      const [west, east] = [lanes.map(() => W), lanes.map(() => 0)];
      let fast = 0;
      for (let t = 0; t < 65536; t += 7.5) {
        const now = at(t);
        const next = at(t + 0.25);
        now.forEach((o, i) => {
          expect(o.kind).toBe('genie');
          // Its velocity matches its motion.
          expect((next[i].x - o.x) * 4 * TICK_HZ).toBeCloseTo(o.vx, 0);
          expect((next[i].y - o.y) * 4 * TICK_HZ).toBeCloseTo(o.vy, 0);
          fast = Math.max(fast, Math.hypot(o.vx, o.vy));
          [lo[i], hi[i]] = [Math.min(lo[i], o.y - o.r), Math.max(hi[i], o.y + o.r)];
          [west[i], east[i]] = [Math.min(west[i], o.x), Math.max(east[i], o.x)];
        });
        // The side genies in mirror.
        expect(now[2].x).toBeCloseTo(W - now[0].x, 9);
        expect(now[2].y).toBe(now[0].y);
        expect([now[2].vx, now[2].vy]).toEqual([-now[0].vx, now[0].vy]);
        // At a waypoint, still for an instant.
        if (t % WANDER == 0) {
          now.forEach(o => expect(Math.hypot(o.vx, o.vy)).toBeLessThan(1e-9));
        }
      }
      // Over the u16 tick, most of the band: board to board, and both sides of the lane.
      lanes.forEach((x, i) => {
        expect(lo[i]).toBeLessThan(H * 0.1);
        expect(hi[i]).toBeGreaterThan(H * 0.9);
        expect(west[i]).toBeLessThan(x - GA * 0.8);
        expect(east[i]).toBeGreaterThan(x + GA * 0.8);
      });
      // About as fast as a penguin at its fastest, at most.
      expect(fast).toBeLessThan(400);
    }
    // Another seed, another float; the same seed, the same one.
    expect(obstacles('desert', 500, 1, 7, 1)[4]).not.toEqual(obstacles('desert', 500, 1, 7, 2)[4]);
    expect(obstacles('desert', 500, 1, 7, 1)).toEqual(obstacles('desert', 500, 1, 7, 1));
  });

  it('repeats over the u16 snapshot tick wrap', () => {
    for (const { size, count } of ALL) {
      for (const t of [0, 1, 17.5, 1500.25, 65535.5]) {
        const a = obstacles('desert', t, size, count, 9);
        obstacles('desert', t + 65536, size, count, 9).forEach((o, i) => {
          expect(o.x).toBeCloseTo(a[i].x, 6);
          expect(o.y).toBeCloseTo(a[i].y, 6);
          expect(o.vx).toBeCloseTo(a[i].vx, 6);
          expect(o.vy).toBeCloseTo(a[i].vy, 6);
        });
      }
    }
  });

  it('spins each whirlwind clockwise left of the centre line, its mirror counter-clockwise', () => {
    for (const { size, count } of ALL) {
      const X = W * size;
      const obs = obstacles('desert', 0, size, count, 77).filter(fixed);
      expect(obs.length).toBeGreaterThanOrEqual(2);
      for (const o of obs) {
        expect(swirl(o, size)).toBe(o.x < X / 2 ? 1 : -1);
        const m = obs.find(q => Math.abs(q.x - (X - o.x)) < 1e-9)!;
        expect(swirl(m, size)).toBe(-swirl(o, size));
      }
    }
    expect(swirl(desert()[0])).toBe(1);
    expect(swirl(desert()[1])).toBe(-1);
  });
});

describe('icebergs (vortices) across the width', () => {
  const ALL = [2, 3, 4, 5, 6, 7].flatMap(count =>
    [1, Math.SQRT2, Math.sqrt(3), MAX_SIZE].map(size => ({ size, count })),
  );
  /** 500 seeds as the room draws them (1 to 2^32 - 1), spread out, plus the extremes. */
  const SEEDS = [...Array(498).keys()]
    .map(i => 1 + ((i * 2654435761) >>> 0))
    .concat(1, 2 ** 32 - 1);
  /** The bands of y, size 1: top pair, bottom pair. */
  const BANDS = [
    [217, 355],
    [758, 918],
  ];
  /**
   * y of a fixed obstacle of that layout (size 1), the layout set upright: half the seeds turn
   * it upside down, the top pair (always obstacle 0) then in the bottom half.
   */
  const upright = (obs: Obstacle[], y: number, size: number) =>
    obs[0].y > (H * size) / 2 ? H - y / size : y / size;
  /** Distance from (x, y) to the segment from (ax, ay) to (bx, by). */
  const seg = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
    const [dx, dy] = [bx - ax, by - ay];
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - u * dx, y - ay - u * dy);
  };

  it('keeps the fixed layout for seed 0, and the penguins and sharks whatever the seed', () => {
    for (const arena of ['ice', 'sea', 'desert'] as Arena[]) {
      for (const { size, count } of ALL) {
        expect(obstacles(arena, 0, size, count, 0)).toEqual(obstacles(arena, 0, size, count));
      }
      expect(
        obstacles(arena, 0, 1, 7, 0)
          .slice(0, 4)
          .map(o => o.y),
      ).toEqual([270, 270, 870, 870]);
      for (const seed of SEEDS.slice(0, 50)) {
        for (const t of [0, 333.5, 1500]) {
          const a = obstacles(arena, t, 1, 7);
          const b = obstacles(arena, t, 1, 7, seed);
          // The genies float along waypoints of the seed (see the desert arena).
          if (arena != 'desert') {
            expect(b.slice(4)).toEqual(a.slice(4));
          }
          // Same x, kind and size: only y moves.
          b.slice(0, 4).forEach((o, i) => expect({ ...o, y: 0 }).toEqual({ ...a[i], y: 0 }));
        }
      }
    }
  });

  it('draws y from the seed alone: the same on every call, still within a round', () => {
    for (const seed of SEEDS) {
      const a = obstacles('ice', 0, Math.SQRT2, 7, seed);
      expect(obstacles('ice', 0, Math.SQRT2, 7, seed)).toEqual(a);
      expect(obstacles('ice', 1777.5, Math.SQRT2, 7, seed).slice(0, 4)).toEqual(a.slice(0, 4));
      // The sea puts its vortices where the ice puts its icebergs, the desert its whirlwinds.
      for (const arena of ['sea', 'desert'] as Arena[]) {
        expect(
          obstacles(arena, 0, Math.SQRT2, 7, seed)
            .slice(0, 4)
            .map(o => o.y),
        ).toEqual(a.slice(0, 4).map(o => o.y));
      }
    }
  });

  it('places each pair at the same y, mirrored, anywhere in its band, scaled, upside down half the time', () => {
    for (const { size, count } of ALL) {
      const ys: number[][] = [[], []];
      let flips = 0;
      for (const seed of SEEDS) {
        const obs = obstacles('ice', 0, size, count, seed).filter(fixed);
        flips += +(obs[0].y > (H * size) / 2);
        for (let i = 0; i < obs.length; i += 2) {
          const [a, b] = [obs[i], obs[i + 1]];
          expect(b.x).toBeCloseTo(W * size - a.x, 9);
          expect([b.y, b.r]).toEqual([a.y, a.r]);
          ys[i / 2].push(upright(obs, a.y, size));
        }
      }
      // The same seeds flip at every count and size: about half of them.
      expect(flips / SEEDS.length).toBeGreaterThan(0.4);
      expect(flips / SEEDS.length).toBeLessThan(0.6);
      ys.forEach((y, i) => {
        if (y.length) {
          const [lo, hi] = BANDS[i];
          expect(Math.min(...y)).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(Math.max(...y)).toBeLessThanOrEqual(hi + 1e-9);
          // Spread over the band: both ends reached, many distinct places.
          expect(Math.min(...y)).toBeLessThan(lo + 5);
          expect(Math.max(...y)).toBeGreaterThan(hi - 5);
          expect(new Set(y.map(v => Math.round(v))).size).toBeGreaterThan(100);
        }
      });
    }
    // The pairs draw apart: the bottom one is not the top one shifted.
    const corr = SEEDS.map(seed => obstacles('ice', 0, 1, 7, seed)).filter(
      o => (upright(o, o[0].y, 1) - 217) / 138 < 0.5 != (upright(o, o[2].y, 1) - 758) / 160 < 0.5,
    ).length;
    expect(corr / SEEDS.length).toBeGreaterThan(0.4);
    expect(corr / SEEDS.length).toBeLessThan(0.6);
  });

  it('moves an iceberg to a new place of its band each time it comes back, its mirror staying', () => {
    for (const { size, count } of ALL) {
      for (const seed of SEEDS.slice(0, 100)) {
        const a = obstacles('ice', 0, size, count, seed);
        // Absent or 0: the round's place, the pair in mirror.
        expect(obstacles('ice', 0, size, count, seed, [0, undefined, 0])).toEqual(a);
        a.filter(fixed).forEach((_, i) => {
          const ys = new Set<number>();
          for (let n = 1; n < 6; n++) {
            const times = [];
            times[i] = n;
            const b = obstacles('ice', 0, size, count, seed, times);
            // Only that one moves, along y, within its band.
            b.forEach((o, j) =>
              expect({ ...o, y: +(j == i) || o.y }).toEqual({ ...a[j], y: +(j == i) || a[j].y }),
            );
            const [lo, hi] = BANDS[i >> 1];
            expect(upright(a, b[i].y, size)).toBeGreaterThanOrEqual(lo - 1e-9);
            expect(upright(a, b[i].y, size)).toBeLessThanOrEqual(hi + 1e-9);
            ys.add(b[i].y);
          }
          // A new place each time.
          expect(ys.size).toBe(5);
        });
      }
    }
    // Seed 0: the fixed layout, whatever the count.
    expect(obstacles('ice', 0, 1, 7, 0, [3, 1])).toEqual(obstacles('ice', 0));
  });

  it.each(['ice', 'sea', 'desert'] as Arena[])(
    'keeps every guarantee for any seed at every count and size (%s)',
    arena => {
      /** Smallest margin seen per guarantee: all of them must stay positive. */
      const worst = {
        boards: Infinity,
        shot: Infinity,
        spots: Infinity,
        spawn: Infinity,
        gaps: 1e9,
      };
      const see = (k: keyof typeof worst, v: number) => (worst[k] = Math.min(worst[k], v));
      for (const { size, count } of ALL) {
        const [X, Y] = [W * size, H * size];
        const mouth = [...Array(21).keys()].map(k => Y / 2 + (k / 20 - 0.5) * GOAL * size);
        const spawns = ([0, 1] as Team[]).flatMap(team =>
          [...Array(MAX_PLAYERS).keys()].map(n => spawnPoint(team, n, size)),
        );
        for (const seed of SEEDS) {
          for (const o of obstacles(arena, 0, size, count, seed).filter(fixed)) {
            // A paddle and a puck between it and the boards.
            see('boards', Math.min(o.y - o.r, Y - o.y - o.r, o.x - o.r, X - o.x - o.r) - FIT);
            // A straight shot from the centre spot reaches any point of either mouth.
            for (const y of mouth) {
              for (const x of [0, X]) {
                see('shot', seg(o.x, o.y, X / 2, Y / 2, x, y) - o.r - PUCK_R);
              }
            }
            // Serve spots, centre spot and spawn points clear.
            for (const x of [X / 4, X / 2, (3 * X) / 4]) {
              see('spots', dist(o, x, Y / 2) - o.r - PUCK_R - 100);
            }
            for (const [x, y] of spawns) {
              see('spawn', dist(o, x, y) - o.r - PADDLE_R - 10);
            }
          }
        }
        // Top and bottom pairs, and every fixed obstacle to every mover over a period: a paddle and
        // a puck on the ice, the puck alone at sea and in the desert (see the sea's squeeze, the
        // genies' float).
        for (const seed of SEEDS.slice(0, 100)) {
          for (let t = 0; t < PERIOD; t += 16) {
            const obs = obstacles(arena, t, size, count, seed);
            for (const o of obs.filter(fixed)) {
              for (const q of obs) {
                if (q != o) {
                  see(
                    'gaps',
                    dist(o, q.x, q.y) - o.r - q.r - (fixed(q) || arena == 'ice' ? FIT : SLIP),
                  );
                }
              }
            }
          }
        }
      }
      for (const v of Object.values(worst)) {
        expect(v).toBeGreaterThan(0);
      }
      // The bands are about as wide as they can be: the tightest guarantees come within a unit.
      expect(Math.min(worst.boards, worst.shot)).toBeLessThan(1.5);
    },
    20_000,
  );

  it('squeezes a vortex and a shark under a paddle and a puck for 1/9 to 1/4 of the period', () => {
    const FULL = [...Array(PERIOD).keys()];
    for (const seed of [0, ...SEEDS.slice(0, 20)]) {
      const [a, , b] = obstacles('sea', 0, 1, 7, seed);
      let tight = 0;
      let low = Infinity;
      for (const t of FULL) {
        const left = obstacles('sea', t, 1, 7, seed)[4];
        const gap = Math.min(...[a, b].map(o => dist(o, left.x, left.y) - o.r - left.r));
        low = Math.min(low, gap);
        tight += +(gap < FIT);
      }
      // 84 at the worst draw (128 − vortex radius from x alone); the puck needs 2 · PUCK_R + 20.
      expect(low).toBeGreaterThan(83.9);
      expect(tight / FULL.length).toBeGreaterThan(1 / 9);
      expect(tight / FULL.length).toBeLessThan(1 / 4);
    }
  });
});

describe('fixed', () => {
  it('is true for icebergs, vortices and whirlwinds, false for penguins, sharks and genies', () => {
    expect([...ice(), ...sea(), ...desert()].map(o => [o.kind, fixed(o)])).toEqual([
      ...Array(4).fill(['iceberg', true]),
      ...Array(3).fill(['penguin', false]),
      ...Array(4).fill(['vortex', true]),
      ...Array(3).fill(['shark', false]),
      ...Array(4).fill(['whirlwind', true]),
      ...Array(3).fill(['genie', false]),
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

  it('plays the three scenes of the default rules once each in a 3-round match, then again', () => {
    expect(RULES.arena).toEqual(['ice', 'sea', 'desert']);
    expect(RULES.rounds).toBe(3);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(n => scene(RULES.arena, n))).toEqual([
      'ice',
      'ice',
      'sea',
      'desert',
      'ice',
      'sea',
      'desert',
      'ice',
    ]);
  });

  it('plays a single scene, or a list of one, every round', () => {
    for (const n of [0, 1, 2, 3, 7]) {
      expect(scene('sea', n)).toBe('sea');
      expect(scene(['classic'], n)).toBe('classic');
    }
  });
});
