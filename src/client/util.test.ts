import { describe, expect, it } from 'vitest';
import type { PlayerInfo, Rank, Snapshot } from '../shared/types';
import { BOT, CH, TOP, byTeam, flow, podium, sample, shown, toField } from './util';

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
    expect(CH).toBe(TOP + 900 + BOT);
    expect(toField(10, 20 + TOP / 2, rect)).toEqual([0, 0]);
    expect(toField(810, 20 + TOP / 2 + 450, rect)).toEqual([1600, 900]);
    expect(toField(410, 20 + TOP / 2 + 225, rect)).toEqual([800, 450]);
  });

  it('gives y outside the rink over the HUD bands', () => {
    expect(toField(10, 20, rect)).toEqual([0, -TOP]);
    expect(toField(10, 20 + CH / 2, rect)).toEqual([0, 900 + BOT]);
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

  it('skips players without a goal, leaving steps empty', () => {
    expect(podium([rank(1, 0), rank(2, 3), rank(3, 0)]).map(p => p.id)).toEqual([2]);
    expect(podium([rank(1, 0)])).toEqual([]);
    expect(podium([])).toEqual([]);
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
