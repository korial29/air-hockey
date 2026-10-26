// Pure client helpers: no DOM, unit-tested.
import { H, W } from '../shared/constants';
import type { PlayerInfo, Rank, Snapshot } from '../shared/types';

/** A snapshot stamped with its receive time (ms, performance.now()). */
export interface Stamped {
  t: number;
  s: Snapshot;
}

/** Client (CSS px) coordinates → field units, given the canvas bounding rect. */
export const toField = (
  cx: number,
  cy: number,
  r: { left: number; top: number; width: number; height: number },
): [number, number] => [((cx - r.left) * W) / r.width, ((cy - r.top) * H) / r.height];

/** Positions of b, moved back toward a by (1 - f). Paddles new in b stay where b has them. */
export const lerp = (a: Snapshot, b: Snapshot, f: number): Snapshot => {
  const m = (u: number, v: number) => u + (v - u) * f;
  return {
    ...b,
    puck: { x: m(a.puck.x, b.puck.x), y: m(a.puck.y, b.puck.y) },
    paddles: b.paddles.map(p => {
      const q = a.paddles.find(o => o.id == p.id) ?? p;
      return { id: p.id, x: m(q.x, p.x), y: m(q.y, p.y) };
    }),
  };
};

/**
 * The world at time t, interpolated between the two snapshots bracketing it.
 * Holds the last one when starved, the first one when t is older than the buffer.
 */
export const sample = (buf: Stamped[], t: number): Snapshot | undefined => {
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1];
    const b = buf[i];
    if (a.t <= t) {
      return t < b.t ? lerp(a.s, b.s, (t - a.t) / (b.t - a.t)) : b.s;
    }
  }
  return buf[0]?.s;
};

/** Players split by team: [team 0, team 1], roster order kept. */
export const byTeam = (players: PlayerInfo[]): PlayerInfo[][] =>
  [0, 1].map(t => players.filter(p => p.team == t));

/** Top 3 scorers, most goals first. Ties keep the ranking order; nobody without a goal. */
export const podium = (ranking: Rank[]): Rank[] =>
  ranking
    .filter(r => r.goals > 0)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, 3);

/**
 * Ranking table shape for n lines when `fit` rows fit on screen: one column while it fits,
 * then two (filled column by column). Lines past cols × rows are cut.
 */
export const grid = (n: number, fit: number): [cols: number, rows: number] => {
  const cols = n > fit ? 2 : 1;
  return [cols, Math.max(0, Math.min(Math.ceil(n / cols), fit))];
};
