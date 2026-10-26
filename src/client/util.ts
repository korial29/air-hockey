// Pure client helpers: no DOM, unit-tested.
import { H, W } from '../shared/constants';
import type { PlayerInfo, Rank, Snapshot } from '../shared/types';

/** A snapshot stamped with its receive time (ms, performance.now()). */
export interface Stamped {
  t: number;
  s: Snapshot;
}

/** HUD bands above and below the rink, in field units. The canvas is W × CH, 4:3. */
export const TOP = 200;
export const BOT = 175;
export const CH = TOP + H + BOT;

/**
 * Client (CSS px) coordinates → world units, given the canvas bounding rect and the rink size
 * factor: the rink always fills the same part of the canvas, W · size × H · size world units.
 * y is measured from the rink's top edge: the HUD bands give negative y or y past H · size.
 */
export const toField = (
  cx: number,
  cy: number,
  r: { left: number; top: number; width: number; height: number },
  size = 1,
): [number, number] => [
  ((cx - r.left) * W * size) / r.width,
  (((cy - r.top) * CH) / r.height - TOP) * size,
];

/**
 * Positions of b, moved back toward a by (1 - f); the puck velocity is b's.
 * Paddles new in b stay where b has them.
 */
export const lerp = (a: Snapshot, b: Snapshot, f: number): Snapshot => {
  const m = (u: number, v: number) => u + (v - u) * f;
  return {
    ...b,
    puck: { ...b.puck, x: m(a.puck.x, b.puck.x), y: m(a.puck.y, b.puck.y) },
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

/** Deterministic pseudo-random number in [0, 1) for an index: stable decor, no table. */
export const rnd = (i: number): number => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5;
  return v - Math.floor(v);
};

/** Players split by team: [team 0, team 1], roster order kept. */
export const byTeam = (players: PlayerInfo[]): PlayerInfo[][] =>
  [0, 1].map(t => players.filter(p => p.team == t));

/**
 * The 3 players on the podium: most goals first, ties (0 goals included) keep the ranking order,
 * i.e. points. Players who left are not on it.
 */
export const podium = (ranking: Rank[]): Rank[] =>
  ranking
    .filter(r => !r.left)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, 3);

/**
 * Flows items of widths ws into rows of width room, left to right: the [x, row] of each item
 * that fits in `rows` rows. An item wider than room still gets a row of its own.
 */
export const flow = (ws: number[], room: number, rows: number): [x: number, row: number][] => {
  const at: [number, number][] = [];
  let x = 0;
  let row = 0;
  for (const w of ws) {
    if (x && x + w > room) {
      x = 0;
      row++;
    }
    if (row >= rows) {
      break;
    }
    at.push([x, row]);
    x += w;
  }
  return at;
};

/** n lines in room lines: all of them when they fit, else room - 1 and a "+N more" line. */
export const shown = (n: number, room: number): [lines: number, more: number] => {
  const k = n > room ? Math.max(0, room - 1) : n;
  return [k, n - k];
};
