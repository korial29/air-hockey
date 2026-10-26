import { describe, expect, it } from 'vitest';
import { H, SCALE, W } from './constants';
import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  MSG_INPUT,
  MSG_SNAPSHOT,
  parseText,
} from './protocol';
import type { Snapshot } from './types';

const EPS = 1 / SCALE;
const MAX = 65535 / SCALE;

const snapshot: Snapshot = {
  tick: 1234,
  score: [3, 7],
  puck: { x: 812.345, y: 450.01, vx: -2399.6, vy: 1234.4 },
  paddles: [
    { id: 1, x: 44, y: 856 },
    { id: 7, x: W - 44.123, y: 123.456 },
    { id: 255, x: W / 2, y: H / 2 },
  ],
};

describe('input frames', () => {
  it('round-trip within 1 / SCALE', () => {
    for (const [x, y] of [
      [0, 0],
      [W, H],
      [123.456, 789.012],
      [W / 2 + 0.01, 0.49],
    ]) {
      const buf = encodeInput(x, y);
      expect(buf.byteLength).toBe(5);
      const out = decodeInput(buf);
      expect(Math.abs(out!.x - x)).toBeLessThanOrEqual(EPS);
      expect(Math.abs(out!.y - y)).toBeLessThanOrEqual(EPS);
    }
  });

  it('clamp out-of-range coordinates to the u16 range', () => {
    expect(decodeInput(encodeInput(-50, 1e9))).toEqual({ x: 0, y: MAX });
  });

  it('reject malformed buffers', () => {
    expect(decodeInput(new ArrayBuffer(0))).toBeNull();
    expect(decodeInput(new ArrayBuffer(4))).toBeNull();
    expect(decodeInput(new ArrayBuffer(6))).toBeNull();
    const wrongType = new Uint8Array(encodeInput(10, 10));
    wrongType[0] = MSG_SNAPSHOT;
    expect(decodeInput(wrongType.buffer)).toBeNull();
    expect(decodeInput(encodeSnapshot({ ...snapshot, paddles: [] }))).toBeNull();
  });
});

describe('snapshot frames', () => {
  it('round-trip within 1 / SCALE', () => {
    const out = decodeSnapshot(encodeSnapshot(snapshot))!;
    expect(out.tick).toBe(1234);
    expect(out.score).toEqual([3, 7]);
    expect(Math.abs(out.puck.x - snapshot.puck.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(out.puck.y - snapshot.puck.y)).toBeLessThanOrEqual(EPS);
    expect([out.puck.vx, out.puck.vy]).toEqual([-2400, 1234]);
    expect(out.paddles).toHaveLength(3);
    out.paddles.forEach((p, i) => {
      const s = snapshot.paddles[i];
      expect(p.id).toBe(s.id);
      expect(Math.abs(p.x - s.x)).toBeLessThanOrEqual(EPS);
      expect(Math.abs(p.y - s.y)).toBeLessThanOrEqual(EPS);
    });
  });

  it('carry an empty paddle list', () => {
    const buf = encodeSnapshot({ ...snapshot, paddles: [] });
    expect(buf.byteLength).toBe(15);
    expect(decodeSnapshot(buf)!.paddles).toEqual([]);
  });

  it('wrap the tick, cap the score and clamp coordinates and velocities', () => {
    const out = decodeSnapshot(
      encodeSnapshot({
        tick: 65536 + 5,
        score: [300, 0],
        puck: { x: -10, y: 1e9, vx: -1e6, vy: 40000 },
        paddles: [{ id: 2, x: -1, y: 1e6 }],
      }),
    )!;
    expect(out.tick).toBe(5);
    expect(out.score).toEqual([255, 0]);
    expect(out.puck).toEqual({ x: 0, y: MAX, vx: -32768, vy: 32767 });
    expect(out.paddles).toEqual([{ id: 2, x: 0, y: MAX }]);
  });

  it('reject malformed buffers', () => {
    const good = new Uint8Array(encodeSnapshot(snapshot));
    expect(decodeSnapshot(new ArrayBuffer(0))).toBeNull();
    expect(decodeSnapshot(new ArrayBuffer(14))).toBeNull();
    expect(decodeSnapshot(good.slice(0, good.length - 1).buffer)).toBeNull();
    expect(decodeSnapshot(new Uint8Array([...good, 0]).buffer)).toBeNull();
    const wrongType = good.slice();
    wrongType[0] = MSG_INPUT;
    expect(decodeSnapshot(wrongType.buffer)).toBeNull();
    const wrongCount = good.slice();
    wrongCount[9] = 4;
    expect(decodeSnapshot(wrongCount.buffer)).toBeNull();
    expect(decodeSnapshot(encodeInput(1, 2))).toBeNull();
  });
});

describe('parseText', () => {
  it('returns known-shaped messages', () => {
    expect(parseText('{"t":"join","name":"Ann"}')).toEqual({ t: 'join', name: 'Ann' });
    expect(parseText('{"t":"full"}')).toEqual({ t: 'full' });
  });

  it.each(['', 'not json', '{', 'null', '42', '"join"', '[]', '{}', '{"t":1}', '{"type":"join"}'])(
    'returns null on junk: %j',
    raw => {
      expect(parseText(raw)).toBeNull();
    },
  );
});
