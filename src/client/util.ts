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

/** Where the rink sits on a canvas of w × h field units: at x, y, W × H. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** HUD bands above and below the rink: 4:3. */
export const TALL: Frame = { x: 0, y: TOP, w: W, h: CH };
/**
 * A phone on its side: the rink full height, a HUD band on each side, SIDE wide. 2.16:1, an
 * iPhone's screen held sideways: the rink a third bigger than in TALL.
 */
export const SIDE = 215;
export const WIDE: Frame = { x: SIDE, y: 0, w: W + 2 * SIDE, h: H };
/** The frame for a canvas of that CSS aspect (width / height): the nearer of the two. */
export const frameOf = (aspect: number): Frame =>
  aspect > (TALL.w / TALL.h + WIDE.w / WIDE.h) / 2 ? WIDE : TALL;

/**
 * Smallest drawn radius of the puck and of a paddle, in CSS px. A big rink on a small canvas
 * (8 players on a phone) would draw them at 2 to 4 px; they are drawn bigger, around their true
 * position, while the physics keeps PUCK_R and PADDLE_R.
 */
export const MIN_PUCK_PX = 7;
export const MIN_PADDLE_PX = 11;

/** Radius r in world units, raised to min CSS px on screen; px is CSS px per world unit. */
export const drawnR = (r: number, min: number, px: number): number => Math.max(r, min / px);

/**
 * Client (CSS px) coordinates → world units, given the canvas bounding rect, the rink size factor
 * and the frame: the rink always fills the same part of the canvas, W · size × H · size world
 * units. Measured from the rink's top left corner: the HUD bands give negative coordinates, or
 * coordinates past the rink.
 */
export const toField = (
  cx: number,
  cy: number,
  r: { left: number; top: number; width: number; height: number },
  size = 1,
  { x, y, w, h }: Frame = TALL,
): [number, number] => [
  (((cx - r.left) * w) / r.width - x) * size,
  (((cy - r.top) * h) / r.height - y) * size,
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
      return { ...p, x: m(q.x, p.x), y: m(q.y, p.y) };
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
