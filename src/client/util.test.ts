import { describe, expect, it } from 'vitest';
import type { PlayerInfo, Rank, Snapshot } from '../shared/types';
import { MAX_SIZE, PADDLE_R, PUCK_R, W } from '../shared/constants';
import {
  BOT,
  CH,
  MIN_PADDLE_PX,
  MIN_PUCK_PX,
  SIDE,
  TALL,
  TOP,
  WIDE,
  byTeam,
  drawnR,
  flow,
  frameOf,
  podium,
  rnd,
  sample,
  shown,
  toField,
} from './util';

const snap = (x: number, paddles: { id: number; x: number; y: number }[] = []): Snapshot => ({
  tick: 0,
  score: [0, 0],
  puck: { x, y: x, vx: x, vy: 0 },
  paddles,
});

describe('toField', () => {
  // Half scale: the canvas is 800 × CH / 2 CSS px, the rink starts TOP / 2 px down.
  const rect = { left: 10, top: 20, width: 800, height: CH / 2 };

  it('maps client pixels to rink units through the canvas rect, below the top band', () => {
    expect(CH).toBe(TOP + 1125 + BOT);
    // 4:3 like the old 1600 × 1200 canvas: the demo layout keeps fitting the viewport.
    expect(2000 / CH).toBeCloseTo(4 / 3);
    expect(toField(10, 20 + TOP / 2, rect)).toEqual([0, 0]);
    expect(toField(810, 20 + TOP / 2 + 562.5, rect)).toEqual([2000, 1125]);
    expect(toField(410, 20 + TOP / 2 + 281.25, rect)).toEqual([1000, 562.5]);
  });

  it('maps through the WIDE frame: the rink full height, a band on each side', () => {
    // An iPhone on its side: 844 × 390 CSS px.
    const r = { left: 0, top: 0, width: 844, height: (844 * 1125) / WIDE.w };
    expect(toField((SIDE * 844) / WIDE.w, 0, r, 1, WIDE)).toEqual([0, 0]);
    const [x, y] = toField(844 - (SIDE * 844) / WIDE.w, r.height, r, 2, WIDE);
    expect(x).toBeCloseTo(4000);
    expect(y).toBeCloseTo(2250);
    // Over the left band: negative x.
    expect(toField(0, 0, r, 1, WIDE)).toEqual([-SIDE, 0]);
  });

  it('picks WIDE for a canvas as wide as a phone on its side, TALL otherwise', () => {
    expect(WIDE.w / WIDE.h).toBeCloseTo(2.16, 2);
    expect(frameOf(844 / 390)).toBe(WIDE);
    expect(frameOf(800 / 360)).toBe(WIDE);
    expect(frameOf(4 / 3)).toBe(TALL);
    expect(frameOf(1.5)).toBe(TALL);
  });

  it('gives y outside the rink over the HUD bands', () => {
    expect(toField(10, 20, rect)).toEqual([0, -TOP]);
    expect(toField(10, 20 + CH / 2, rect)).toEqual([0, 1125 + BOT]);
  });

  it('gives world units on a bigger rink: the same canvas spot, times the size', () => {
    expect(toField(10, 20 + TOP / 2, rect, 1)).toEqual([0, 0]);
    expect(toField(10, 20 + TOP / 2, rect, 2)).toEqual([0, 0]);
    expect(toField(810, 20 + TOP / 2 + 562.5, rect, 2)).toEqual([4000, 2250]);
    expect(toField(410, 20 + TOP / 2 + 281.25, rect, 2)).toEqual([2000, 1125]);
    const [x, y] = toField(810, 20 + TOP / 2 + 562.5, rect, Math.SQRT2);
    expect(x).toBeCloseTo(2000 * Math.SQRT2);
    expect(y).toBeCloseTo(1125 * Math.SQRT2);
    expect(toField(10, 20, rect, 2)).toEqual([0, -TOP * 2]);
  });
});

describe('drawnR', () => {
  // CSS px per world unit of a canvas `css` px wide on a rink of the given size.
  const px = (css: number, size: number) => css / (W * size);

  it('raises the puck and paddles to their minimum at size 2 on a small canvas', () => {
    const phone = px(343, MAX_SIZE);
    expect(drawnR(PUCK_R, MIN_PUCK_PX, phone) * phone).toBeCloseTo(MIN_PUCK_PX);
    expect(drawnR(PADDLE_R, MIN_PADDLE_PX, phone) * phone).toBeCloseTo(MIN_PADDLE_PX);
    expect(drawnR(PUCK_R, MIN_PUCK_PX, phone)).toBeGreaterThan(PUCK_R * 2);
  });

  it('keeps the true radii on a big canvas, or on a small one at size 1 when they fit', () => {
    const big = px(1440, MAX_SIZE);
    expect(drawnR(PUCK_R, MIN_PUCK_PX, big)).toBe(PUCK_R);
    expect(drawnR(PADDLE_R, MIN_PADDLE_PX, big)).toBe(PADDLE_R);
    expect(drawnR(PADDLE_R, MIN_PADDLE_PX, px(800, 1))).toBe(PADDLE_R);
  });
});

describe('sample', () => {
  const buf = [
    { t: 0, s: snap(0, [{ id: 1, x: 0, y: 0 }]) },
    {
      t: 100,
      s: snap(100, [
        { id: 1, x: 100, y: 50 },
        { id: 2, x: 7, y: 8 },
      ]),
    },
    { t: 200, s: snap(300) },
  ];

  it('returns nothing on an empty buffer', () => {
    expect(sample([], 50)).toBeUndefined();
  });

  it('interpolates the puck and paddles between the bracketing snapshots', () => {
    const s = sample(buf, 25)!;
    expect(s.puck).toEqual({ x: 25, y: 25, vx: 100, vy: 0 });
    expect(s.paddles).toEqual([
      { id: 1, x: 25, y: 12.5 },
      { id: 2, x: 7, y: 8 },
    ]);
    expect(sample(buf, 150)!.puck.x).toBe(200);
  });

  it('holds the last snapshot when starved and the first one when too early', () => {
    expect(sample(buf, 500)).toBe(buf[2].s);
    expect(sample(buf, 200)).toBe(buf[2].s);
    expect(sample(buf, -10)).toBe(buf[0].s);
  });
});

describe('byTeam', () => {
  it('groups players by team, keeping order', () => {
    const p = (id: number, team: 0 | 1): PlayerInfo => ({
      id,
      team,
      name: `p${id}`,
      color: '#000',
    });
    const players = [p(1, 1), p(2, 0), p(3, 1)];
    expect(byTeam(players)).toEqual([[players[1]], [players[0], players[2]]]);
  });
});

const rank = (id: number, goals: number): Rank => ({
  id,
  name: `p${id}`,
  color: '#000',
  team: 0,
  points: 100 - id,
  goals,
  hits: 0,
});

describe('podium', () => {
  it('keeps the three best scorers, most goals first', () => {
    const r = [rank(1, 2), rank(2, 5), rank(3, 1), rank(4, 3)];
    expect(podium(r).map(p => p.id)).toEqual([2, 4, 1]);
  });

  it('orders ties by the ranking array', () => {
    const r = [rank(1, 1), rank(2, 4), rank(3, 4), rank(4, 4)];
    expect(podium(r).map(p => p.id)).toEqual([2, 3, 4]);
  });

  it('keeps players without a goal, in ranking order, and leaves missing steps empty', () => {
    expect(podium([rank(1, 0), rank(2, 3), rank(3, 0)]).map(p => p.id)).toEqual([2, 1, 3]);
    expect(podium([rank(1, 0)]).map(p => p.id)).toEqual([1]);
    expect(podium([])).toEqual([]);
  });

  it('leaves out players who left', () => {
    expect(podium([{ ...rank(1, 9), left: true }, rank(2, 0)]).map(p => p.id)).toEqual([2]);
  });

  it('does not reorder the ranking it reads', () => {
    const r = [rank(1, 1), rank(2, 5)];
    podium(r);
    expect(r.map(p => p.id)).toEqual([1, 2]);
  });
});

describe('flow', () => {
  it('fills rows left to right and wraps', () => {
    expect(flow([3, 4, 2, 5], 8, 3)).toEqual([
      [0, 0],
      [3, 0],
      [0, 1],
      [2, 1],
    ]);
  });

  it('stops at the last row, and gives an oversized item a row of its own', () => {
    expect(flow([3, 4, 2, 5], 8, 1)).toEqual([
      [0, 0],
      [3, 0],
    ]);
    expect(flow([12, 1], 8, 2)).toEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(flow([], 8, 2)).toEqual([]);
    expect(flow([1], 8, 0)).toEqual([]);
  });
});

describe('shown', () => {
  it('shows every line that fits', () => {
    expect(shown(5, 9)).toEqual([5, 0]);
    expect(shown(9, 9)).toEqual([9, 0]);
  });

  it('keeps the last line for "+N more" past the fit', () => {
    expect(shown(16, 7)).toEqual([6, 10]);
    expect(shown(3, 0)).toEqual([0, 3]);
    expect(shown(0, 0)).toEqual([0, 0]);
  });
});

describe('rnd', () => {
  it('is deterministic and in [0, 1)', () => {
    const v = Array.from({ length: 500 }, (_, i) => rnd(i));
    expect(v).toEqual(Array.from({ length: 500 }, (_, i) => rnd(i)));
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThan(1);
    // Spread out, not stuck in a corner of the range.
    expect(v.filter(x => x < 0.5).length).toBeGreaterThan(200);
    expect(v.filter(x => x < 0.5).length).toBeLessThan(300);
  });
});
