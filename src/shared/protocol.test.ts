import { describe, expect, it } from 'vitest';
import { H, MAX_SIZE, PADDLE_MAX_SPEED, PUCK_MAX_SPEED, PUCK_R, SCALE, W } from './constants';
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

describe('the widest rink', () => {
  it('fits the u16 fixed point: SCALE 16, up to 4095 units', () => {
    expect(SCALE).toBe(16);
    expect(Math.floor(MAX)).toBe(4095);
    // A puck all the way into the right goal of the widest rink still fits.
    expect(MAX).toBeGreaterThan(W * MAX_SIZE + PUCK_R);
    // And so do the scaled top speeds, in whole units per second.
    expect(Math.max(PUCK_MAX_SPEED, PADDLE_MAX_SPEED) * MAX_SIZE).toBeLessThan(32767);
  });

  it('round-trips inputs and snapshots within 1 / SCALE up to 4095 units', () => {
    const X = W * MAX_SIZE;
    const Y = H * MAX_SIZE;
    for (const [x, y] of [
      [X, Y],
      [X + PUCK_R, Y / 2],
      [4095, 4095],
      [MAX, 1234.5678],
      [X / 2 + 0.03, 0.01],
    ]) {
      const i = decodeInput(encodeInput(x, y))!;
      expect(Math.abs(i.x - x)).toBeLessThanOrEqual(EPS / 2);
      expect(Math.abs(i.y - y)).toBeLessThanOrEqual(EPS / 2);
      const s = decodeSnapshot(
        encodeSnapshot({
          tick: 7,
          score: [0, 0],
          puck: { x, y, vx: PUCK_MAX_SPEED * MAX_SIZE, vy: -PUCK_MAX_SPEED * MAX_SIZE },
          paddles: [{ id: 3, x: y, y: x }],
        }),
      )!;
      expect(Math.abs(s.puck.x - x)).toBeLessThanOrEqual(EPS / 2);
      expect(Math.abs(s.puck.y - y)).toBeLessThanOrEqual(EPS / 2);
      expect([s.puck.vx, s.puck.vy]).toEqual([4800, -4800]);
      expect(Math.abs(s.paddles[0].x - y)).toBeLessThanOrEqual(EPS / 2);
      expect(Math.abs(s.paddles[0].y - x)).toBeLessThanOrEqual(EPS / 2);
    }
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
    expect(out.live).toBe(false);
    expect(decodeSnapshot(encodeSnapshot({ ...snapshot, live: true }))!.live).toBe(true);
    out.paddles.forEach((p, i) => {
      const s = snapshot.paddles[i];
      expect(p.id).toBe(s.id);
      expect(Math.abs(p.x - s.x)).toBeLessThanOrEqual(EPS);
      expect(Math.abs(p.y - s.y)).toBeLessThanOrEqual(EPS);
    });
  });

  it('carry what holds the puck, with the live flag and its time left to the ms', () => {
    const out = decodeSnapshot(encodeSnapshot(snapshot))!;
    expect([out.held, out.left]).toEqual([-1, 0]);
    for (const held of [-1, 0, 3, 6]) {
      for (const live of [false, true]) {
        const s = decodeSnapshot(encodeSnapshot({ ...snapshot, live, held, left: 1.2345 }))!;
        expect([s.held, s.live, s.left]).toEqual([held, live, 1.235]);
      }
    }
  });

  it('carry an empty paddle list and no obstacles in 19 bytes', () => {
    const buf = encodeSnapshot({ ...snapshot, paddles: [] });
    expect(buf.byteLength).toBe(18);
    expect(decodeSnapshot(buf)).toMatchObject({ paddles: [], obs: [] });
  });

  it('carry the obstacle states after the paddles, 5 bytes each', () => {
    const obs = [
      { hits: 0, since: -1, angle: 0 },
      { hits: 2, since: -1, angle: 1 },
      { hits: 3, since: 0, angle: -2 },
      { hits: 1, since: 2399, angle: Math.PI },
      { hits: 0, since: -1, angle: 0 },
      { hits: 0, since: -1, angle: 0 },
      { hits: 1, since: 17, angle: 6.2 },
    ];
    const buf = encodeSnapshot({ ...snapshot, obs });
    expect(buf.byteLength).toBe(17 + 3 * 5 + 1 + 7 * 5);
    const out = decodeSnapshot(buf)!;
    expect(out.paddles.map(p => p.id)).toEqual([1, 7, 255]);
    expect(out.obs!.map(({ hits, since }) => [hits, since])).toEqual(
      obs.map(({ hits, since }) => [hits, since]),
    );
    // Removals counted to 255, none when absent.
    expect(out.obs!.map(o => o.times)).toEqual(Array(7).fill(0));
    for (const times of [0, 1, 17, 255]) {
      const s = { ...snapshot, obs: [{ hits: 0, since: -1, angle: 0, times }] };
      expect(decodeSnapshot(encodeSnapshot(s))!.obs![0].times).toBe(times);
    }
  });

  it('keep the obstacle angle within half a 256th of a turn, in [0, 2π)', () => {
    const TURN = 2 * Math.PI;
    for (let a = -Math.PI; a <= Math.PI; a += 0.013) {
      const [o] = decodeSnapshot(
        encodeSnapshot({ ...snapshot, obs: [{ hits: 1, since: 0, angle: a }] }),
      )!.obs!;
      expect(o.angle).toBeGreaterThanOrEqual(0);
      expect(o.angle).toBeLessThan(TURN);
      // Same direction, modulo a turn.
      const d = Math.abs(((o.angle - a) % TURN) + TURN) % TURN;
      expect(Math.min(d, TURN - d)).toBeLessThanOrEqual(TURN / 512 + 1e-12);
    }
  });

  it('cap the obstacle hits and ticks since removal, 0xffff meaning in play', () => {
    const out = decodeSnapshot(
      encodeSnapshot({
        ...snapshot,
        obs: [
          { hits: 300, since: 1e6, angle: 0 },
          { hits: 0, since: 0xffff, angle: 0 },
          { hits: 0, since: -1, angle: 0 },
        ],
      }),
    )!;
    expect(out.obs!.map(o => [o.hits, o.since])).toEqual([
      [255, 0xfffe],
      [0, 0xfffe],
      [0, -1],
    ]);
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
    expect(decodeSnapshot(new ArrayBuffer(17))).toBeNull();
    expect(decodeSnapshot(good.slice(0, good.length - 1).buffer)).toBeNull();
    expect(decodeSnapshot(new Uint8Array([...good, 0]).buffer)).toBeNull();
    const wrongType = good.slice();
    wrongType[0] = MSG_INPUT;
    expect(decodeSnapshot(wrongType.buffer)).toBeNull();
    const wrongCount = good.slice();
    wrongCount[9] = 4;
    expect(decodeSnapshot(wrongCount.buffer)).toBeNull();
    // The obstacle count byte must match the bytes that follow.
    const withObs = new Uint8Array(
      encodeSnapshot({ ...snapshot, obs: [{ hits: 1, since: 3, angle: 0 }] }),
    );
    expect(decodeSnapshot(withObs.buffer)).not.toBeNull();
    expect(decodeSnapshot(withObs.slice(0, -1).buffer)).toBeNull();
    const wrongObs = withObs.slice();
    wrongObs[17 + 3 * 5] = 2;
    expect(decodeSnapshot(wrongObs.buffer)).toBeNull();
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
