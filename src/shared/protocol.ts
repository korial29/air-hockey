// Wire format.
// Text frames carry rare JSON messages (join, roster, goal, full).
// Binary frames carry the hot path: inputs (client → host) and snapshots (host → client).
import { SCALE } from './constants';
import type { Arena, Phase, PlayerInfo, Rank, Snapshot, Team } from './types';

export type ClientText = { t: 'join'; name: string };

export type ServerText =
  | { t: 'roster'; you: number; players: PlayerInfo[] }
  | { t: 'goal'; team: Team; score: [number, number] }
  | { t: 'full' }
  | {
      /** Sent on every phase change, and to a player who joins mid-match. */
      t: 'match';
      phase: Phase;
      /** Current round, from 1; 0 in 'wait'. */
      round: number;
      /** Effective rules: the arena, goals that win a round, rounds in a match (best of). */
      arena: Arena;
      /** Rink geometry of the current round: World.size, World.count and World.seed. */
      size: number;
      count: number;
      seed: number;
      goals: number;
      rounds: number;
      /** Rounds won by each team. */
      wins: [number, number];
      /**
       * 'ready': ms left until play, as of sending. Sent again on a refit and to a joiner, so
       * everyone counts down to the same moment, give or take their latency.
       */
      left?: number;
      /** 'break': the team that won the round. 'end': the team that won the match. */
      winner?: Team;
      /** 'break' and 'end': everyone who played this match, best points first. */
      ranking?: Rank[];
    };

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;

const toWire = (v: number): number => Math.max(0, Math.min(65535, Math.round(v * SCALE)));
const fromWire = (v: number): number => v / SCALE;
/** A velocity travels in whole units per second, in an Int16. */
const speed = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/** [type u8][x u16][y u16] = 5 bytes. */
export const encodeInput = (x: number, y: number): ArrayBuffer => {
  const v = new DataView(new ArrayBuffer(5));
  v.setUint8(0, MSG_INPUT);
  v.setUint16(1, toWire(x));
  v.setUint16(3, toWire(y));
  return v.buffer;
};

export const decodeInput = (buf: ArrayBuffer): { x: number; y: number } | null => {
  if (buf.byteLength !== 5) {
    return null;
  }
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG_INPUT) {
    return null;
  }
  return { x: fromWire(v.getUint16(1)), y: fromWire(v.getUint16(3)) };
};

// [type u8][tick u16][score0 u8][score1 u8][puckX u16][puckY u16][count u8][flags u8]
// [puckVx i16][puckVy i16][left u16, ms] then count × [id u8][x u16][y u16]
// then [obs u8] then obs × [hits u8][since u16][angle u8]: since 0xffff while in play, else capped
// at 0xfffe; angle in 256ths of a turn, decoded in [0, 2π).
const SNAP_HEAD = 17;
const SNAP_PADDLE = 5;
const SNAP_OB = 4;
const TURN = 2 * Math.PI;

export const encodeSnapshot = (s: Snapshot): ArrayBuffer => {
  const obs = s.obs ?? [];
  const o = SNAP_HEAD + SNAP_PADDLE * s.paddles.length;
  const v = new DataView(new ArrayBuffer(o + 1 + SNAP_OB * obs.length));
  v.setUint8(0, MSG_SNAPSHOT);
  v.setUint16(1, s.tick & 0xffff);
  v.setUint8(3, Math.min(255, s.score[0]));
  v.setUint8(4, Math.min(255, s.score[1]));
  v.setUint16(5, toWire(s.puck.x));
  v.setUint16(7, toWire(s.puck.y));
  v.setUint8(9, s.paddles.length);
  // byte 10: flags, bit 0 = live, bits 1-3 = held + 1 (0: no whirlwind holds the puck)
  v.setUint8(10, +!!s.live | (((s.held ?? -1) + 1) << 1));
  v.setInt16(11, speed(s.puck.vx));
  v.setInt16(13, speed(s.puck.vy));
  // A hold lasts under 1.5 s: the ms fit.
  v.setUint16(15, Math.round((s.left ?? 0) * 1000));
  s.paddles.forEach((p, i) => {
    const o = SNAP_HEAD + i * SNAP_PADDLE;
    v.setUint8(o, p.id);
    v.setUint16(o + 1, toWire(p.x));
    v.setUint16(o + 3, toWire(p.y));
  });
  v.setUint8(o, obs.length);
  obs.forEach(({ hits, since, angle }, i) => {
    const b = o + 1 + i * SNAP_OB;
    v.setUint8(b, Math.min(255, hits));
    v.setUint16(b + 1, since < 0 ? 0xffff : Math.min(0xfffe, since));
    v.setUint8(b + 3, Math.round((angle / TURN) * 256) & 255);
  });
  return v.buffer;
};

export const decodeSnapshot = (buf: ArrayBuffer): Snapshot | null => {
  const v = new DataView(buf);
  const count = buf.byteLength < SNAP_HEAD ? 0 : v.getUint8(9);
  const o = SNAP_HEAD + count * SNAP_PADDLE;
  if (
    buf.byteLength <= o ||
    v.getUint8(0) !== MSG_SNAPSHOT ||
    buf.byteLength !== o + 1 + v.getUint8(o) * SNAP_OB
  ) {
    return null;
  }
  const paddles = [];
  for (let i = 0; i < count; i++) {
    const o = SNAP_HEAD + i * SNAP_PADDLE;
    paddles.push({
      id: v.getUint8(o),
      x: fromWire(v.getUint16(o + 1)),
      y: fromWire(v.getUint16(o + 3)),
    });
  }
  const obs = [];
  for (let b = o + 1; b < buf.byteLength; b += SNAP_OB) {
    const since = v.getUint16(b + 1);
    obs.push({
      hits: v.getUint8(b),
      since: since == 0xffff ? -1 : since,
      angle: (v.getUint8(b + 3) / 256) * TURN,
    });
  }
  return {
    live: (v.getUint8(10) & 1) == 1,
    held: (v.getUint8(10) >> 1) - 1,
    left: v.getUint16(15) / 1000,
    tick: v.getUint16(1),
    score: [v.getUint8(3), v.getUint8(4)],
    puck: {
      x: fromWire(v.getUint16(5)),
      y: fromWire(v.getUint16(7)),
      vx: v.getInt16(11),
      vy: v.getInt16(13),
    },
    paddles,
    obs,
  };
};

/** Returns null on anything that is not a known text message. */
export const parseText = <T extends ClientText | ServerText>(raw: string): T | null => {
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg.t === 'string' ? msg : null;
  } catch {
    return null;
  }
};
