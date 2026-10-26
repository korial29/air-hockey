import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_NAME, MAX_PLAYERS, SNAP_EVERY, TICK_HZ } from './constants';
import { decodeSnapshot, encodeInput } from './protocol';
import type { ServerText } from './protocol';
import { Room } from './room';
import type { Conn, PlayerInfo, Team, World } from './types';

// The room is tested against a fake physics: paddles jump to their target,
// the goal outcome of the next step is driven by the test.
const physics = vi.hoisted(() => ({ goal: -1 as -1 | 0 | 1 }));

vi.mock('./physics', () => ({
  createWorld: (): World => ({
    puck: { x: 800, y: 450, vx: 0, vy: 0 },
    paddles: [],
    score: [0, 0],
  }),
  clampPaddle: vi.fn((team: Team, x: number, y: number) => [
    team ? Math.max(800, x) : Math.min(800, x),
    y,
  ]),
  spawnPoint: (team: Team, n: number) => [team ? 1200 : 400, 100 + 100 * n],
  step: (w: World): Team | -1 => {
    w.paddles.forEach(p => {
      p.x = p.tx;
      p.y = p.ty;
    });
    const goal = physics.goal;
    physics.goal = -1;
    if (goal !== -1) {
      w.score[goal]++;
    }
    return goal;
  },
}));

interface FakeConn extends Conn {
  sent: (string | ArrayBuffer)[];
}

const fakeConn = (): FakeConn => {
  const sent: (string | ArrayBuffer)[] = [];
  return { sent, send: data => sent.push(data) };
};

const texts = (c: FakeConn): ServerText[] =>
  c.sent.filter(d => typeof d === 'string').map(d => JSON.parse(d));

const binaries = (c: FakeConn): ArrayBuffer[] => c.sent.filter(d => typeof d !== 'string');

const lastRoster = (c: FakeConn) => {
  const r = texts(c)
    .filter(m => m.t === 'roster')
    .pop();
  if (!r || r.t !== 'roster') {
    throw new Error('no roster');
  }
  return r;
};

const join = (room: Room, name: unknown = 'p'): FakeConn => {
  const c = fakeConn();
  room.connect(c);
  room.receive(c, JSON.stringify({ t: 'join', name }));
  return c;
};

const me = (c: FakeConn): PlayerInfo => {
  const r = lastRoster(c);
  return r.players.find(p => p.id === r.you)!;
};

describe('Room', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room();
    physics.goal = -1;
  });

  afterEach(() => {
    room.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends nothing before join, then the roster with the joiner id', () => {
    const a = fakeConn();
    room.connect(a);
    expect(a.sent).toEqual([]);
    room.receive(a, JSON.stringify({ t: 'join', name: 'Ann' }));
    expect(room.size).toBe(1);
    expect(texts(a)).toEqual([
      { t: 'roster', you: 0, players: [{ id: 0, name: 'Ann', color: 'hsl(0 80% 55%)', team: 0 }] },
    ]);

    const b = join(room, 'Bob');
    expect(lastRoster(a)).toEqual({ ...lastRoster(b), you: 0 });
    expect(lastRoster(b).you).toBe(1);
    expect(lastRoster(b).players.map(p => p.name)).toEqual(['Ann', 'Bob']);
  });

  it('ignores frames before join, a second join, junk and unknown conns', () => {
    const a = fakeConn();
    room.connect(a);
    room.receive(a, encodeInput(10, 10));
    room.receive(a, 'not json');
    room.receive(a, JSON.stringify({ t: 'other' }));
    expect(a.sent).toEqual([]);

    room.receive(a, JSON.stringify({ t: 'join', name: 'first' }));
    room.receive(a, JSON.stringify({ t: 'join', name: 'second' }));
    expect(texts(a)).toHaveLength(1);
    expect(me(a).name).toBe('first');

    const stranger = fakeConn();
    room.receive(stranger, JSON.stringify({ t: 'join', name: 'x' }));
    expect(stranger.sent).toEqual([]);
    expect(room.size).toBe(1);
  });

  it.each([
    ['  Ann   \t\n Lee  ', 'Ann Lee'],
    ['\u0007Bell\u0000', 'Bell'],
    ['x'.repeat(40), 'x'.repeat(MAX_NAME)],
    ['   ', 'Player 0'],
    ['\u0001\u0002', 'Player 0'],
    [42, 'Player 0'],
    [null, 'Player 0'],
  ])('sanitises the name %j', (raw, name) => {
    expect(me(join(room, raw)).name).toBe(name);
  });

  it('answers full past MAX_PLAYERS', () => {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      join(room);
    }
    const late = join(room);
    expect(texts(late)).toEqual([{ t: 'full' }]);
    expect(room.size).toBe(MAX_PLAYERS);
  });

  it('gives unique colours and reuses freed ids and colours', () => {
    const conns = Array.from({ length: MAX_PLAYERS }, () => join(room));
    const players = lastRoster(conns[0]).players;
    expect(players.map(p => p.id)).toEqual([...Array(MAX_PLAYERS).keys()]);
    expect(new Set(players.map(p => p.color)).size).toBe(MAX_PLAYERS);

    const freed = me(conns[3]);
    room.disconnect(conns[3]);
    const back = me(join(room));
    expect(back.id).toBe(freed.id);
    expect(back.color).toBe(freed.color);
  });

  it('balances teams and spawns at the next spot of the team', () => {
    const conns = Array.from({ length: 4 }, () => join(room));
    expect(conns.map(c => me(c).team)).toEqual([0, 1, 0, 1]);

    room.disconnect(conns[1]);
    const c = join(room);
    expect(me(c).team).toBe(1);

    for (let i = 0; i < SNAP_EVERY; i++) {
      room.tick();
    }
    const snap = decodeSnapshot(binaries(c).at(-1)!)!;
    // Team 1 had one paddle left, so the newcomer takes spot #1 of team 1.
    expect(snap.paddles.find(p => p.id === me(c).id)).toMatchObject({ x: 1200, y: 200 });
  });

  it('sends the roster again on leave, and nothing to the leaver', () => {
    const a = join(room, 'a');
    const b = join(room, 'b');
    const before = b.sent.length;
    room.disconnect(b);
    expect(b.sent).toHaveLength(before);
    expect(lastRoster(a).players.map(p => p.name)).toEqual(['a']);
    expect(room.size).toBe(1);
    // Unknown and non-joined conns leave silently.
    const ghost = fakeConn();
    room.connect(ghost);
    room.disconnect(ghost);
    room.disconnect(fakeConn());
    expect(texts(a).filter(m => m.t === 'roster')).toHaveLength(3);
  });

  it('clamps inputs to the team half', async () => {
    const { clampPaddle } = await import('./physics');
    const a = join(room);
    room.receive(a, encodeInput(1500, 300));
    expect(clampPaddle).toHaveBeenLastCalledWith(0, 1500, 300);
    for (let i = 0; i < SNAP_EVERY; i++) {
      room.tick();
    }
    expect(decodeSnapshot(binaries(a)[0])!.paddles).toEqual([{ id: 0, x: 800, y: 300 }]);

    room.receive(a, new ArrayBuffer(3));
    expect(clampPaddle).toHaveBeenCalledTimes(1);
  });

  it('sends one snapshot buffer to everyone every SNAP_EVERY ticks', () => {
    const a = join(room);
    const b = join(room);
    const c = fakeConn();
    room.connect(c);
    for (let i = 0; i < SNAP_EVERY - 1; i++) {
      room.tick();
    }
    expect(binaries(a)).toEqual([]);
    room.tick();
    expect(binaries(a)).toHaveLength(1);
    expect(binaries(b)[0]).toBe(binaries(a)[0]);
    expect(c.sent).toEqual([]);
    const snap = decodeSnapshot(binaries(a)[0])!;
    expect(snap.tick).toBe(SNAP_EVERY);
    expect(snap.paddles.map(p => p.id)).toEqual([0, 1]);

    for (let i = 0; i < SNAP_EVERY * 2; i++) {
      room.tick();
    }
    expect(binaries(a)).toHaveLength(3);
  });

  it('broadcasts goals and resets the score once the room empties', () => {
    const a = join(room);
    const b = join(room);
    physics.goal = 1;
    room.tick();
    const goal = { t: 'goal', team: 1, score: [0, 1] };
    expect(texts(a).at(-1)).toEqual(goal);
    expect(texts(b).at(-1)).toEqual(goal);

    room.disconnect(a);
    room.disconnect(b);
    const c = join(room);
    for (let i = 0; i < SNAP_EVERY; i++) {
      room.tick();
    }
    const snap = decodeSnapshot(binaries(c)[0])!;
    expect(snap.score).toEqual([0, 0]);
    expect(snap.tick).toBe(SNAP_EVERY);
  });

  it('does no work while empty', () => {
    const c = fakeConn();
    room.connect(c);
    for (let i = 0; i < SNAP_EVERY * 2; i++) {
      room.tick();
    }
    expect(c.sent).toEqual([]);
  });

  describe('timer', () => {
    let now = 0;
    const dt = 1000 / TICK_HZ;

    beforeEach(() => {
      now = 0;
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      vi.spyOn(performance, 'now').mockImplementation(() => now);
    });

    const elapse = (ms: number) => {
      now += ms;
      vi.advanceTimersByTime(Math.ceil(dt));
    };

    it('ticks at TICK_HZ whatever the timer jitter', () => {
      const a = join(room);
      room.start();
      // 3 callbacks that land late or early: 4 ticks worth of time in total.
      elapse(dt * 1.5);
      elapse(dt * 0.6);
      elapse(dt * 2);
      expect(binaries(a)).toHaveLength(1);
      expect(decodeSnapshot(binaries(a)[0])!.tick).toBe(SNAP_EVERY);
    });

    it('caps the catch-up after a stall', () => {
      const a = join(room);
      room.start();
      elapse(5001);
      // 10 ticks replayed at most: snapshots at ticks 4 and 8.
      expect(binaries(a)).toHaveLength(2);
      elapse(dt * 2);
      expect(decodeSnapshot(binaries(a)[2])!.tick).toBe(12);
    });

    it('starts and stops idempotently', () => {
      room.start();
      room.start();
      expect(vi.getTimerCount()).toBe(1);
      room.stop();
      room.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
