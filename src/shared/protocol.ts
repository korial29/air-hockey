// Wire format.
// Text frames carry rare JSON messages (join, roster, goal, full).
// Binary frames carry the hot path: inputs (client → host) and snapshots (host → client).
import { SCALE } from './constants';
import type { Phase, PlayerInfo, Rank, Snapshot, Team } from './types';

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
      /** Rounds won by each team. */
      wins: [number, number];
      /** 'break': the team that won the round. 'end': the team that won the match. */
      winner?: Team;
      /** 'break' and 'end': everyone who played this match, best points first. */
      ranking?: Rank[];
    };

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;

const toWire = (v: number): number => Math.max(0, Math.min(65535, Math.round(v * SCALE)));
const fromWire = (v: number): number => v / SCALE;

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

// [type u8][tick u16][score0 u8][score1 u8][puckX u16][puckY u16][count u8]
// then count × [id u8][x u16][y u16]
const SNAP_HEAD = 11;
const SNAP_PADDLE = 5;

export const encodeSnapshot = (s: Snapshot): ArrayBuffer => {
  const v = new DataView(new ArrayBuffer(SNAP_HEAD + SNAP_PADDLE * s.paddles.length));
  v.setUint8(0, MSG_SNAPSHOT);
  v.setUint16(1, s.tick & 0xffff);
  v.setUint8(3, Math.min(255, s.score[0]));
  v.setUint8(4, Math.min(255, s.score[1]));
  v.setUint16(5, toWire(s.puck.x));
  v.setUint16(7, toWire(s.puck.y));
  v.setUint8(9, s.paddles.length);
  // byte 10 is reserved (flags), kept at 0
  s.paddles.forEach((p, i) => {
    const o = SNAP_HEAD + i * SNAP_PADDLE;
    v.setUint8(o, p.id);
    v.setUint16(o + 1, toWire(p.x));
    v.setUint16(o + 3, toWire(p.y));
  });
  return v.buffer;
};

export const decodeSnapshot = (buf: ArrayBuffer): Snapshot | null => {
  if (buf.byteLength < SNAP_HEAD) {
    return null;
  }
  const v = new DataView(buf);
  const count = v.getUint8(9);
  if (v.getUint8(0) !== MSG_SNAPSHOT || buf.byteLength !== SNAP_HEAD + count * SNAP_PADDLE) {
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
  return {
    tick: v.getUint16(1),
    score: [v.getUint8(3), v.getUint8(4)],
    puck: { x: fromWire(v.getUint16(5)), y: fromWire(v.getUint16(7)) },
    paddles,
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
