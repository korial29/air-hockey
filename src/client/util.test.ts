import { describe, expect, it } from 'vitest';
import type { PlayerInfo, Snapshot } from '../shared/types';
import { byTeam, sample, toField } from './util';

const snap = (x: number, paddles: { id: number; x: number; y: number }[] = []): Snapshot => ({
  tick: 0,
  score: [0, 0],
  puck: { x, y: x },
  paddles,
});

describe('toField', () => {
  it('maps client pixels to field units through the canvas rect', () => {
    const rect = { left: 10, top: 20, width: 800, height: 450 };
    expect(toField(10, 20, rect)).toEqual([0, 0]);
    expect(toField(810, 470, rect)).toEqual([1600, 900]);
    expect(toField(410, 245, rect)).toEqual([800, 450]);
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
    expect(s.puck).toEqual({ x: 25, y: 25 });
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
