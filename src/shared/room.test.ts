import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_NAME, MAX_PLAYERS, SNAP_EVERY, TICK_HZ } from './constants';
import { decodeSnapshot, encodeInput } from './protocol';
import type { ServerText } from './protocol';
import { Room } from './room';
import type { Conn, PlayerInfo, Team, World } from './types';

// The room is tested against a fake physics: paddles jump to their target,
// the toucher and the goal outcome of the next step are driven by the test.
const physics = vi.hoisted(() => ({ goal: -1 as -1 | 0 | 1, hit: -1, steps: 0 }));

vi.mock('./physics', () => ({
  createWorld: (): World => ({
    puck: { x: 800, y: 450, vx: 0, vy: 0 },
    paddles: [],
    score: [0, 0],
    hit: -1,
  }),
  clampPaddle: vi.fn((team: Team, x: number, y: number) => [
    team ? Math.max(800, x) : Math.min(800, x),
    y,
  ]),
  spawnPoint: (team: Team, n: number) => [team ? 1200 : 400, 100 + 100 * n],
  step: (w: World): Team | -1 => {
    physics.steps++;
    w.hit = physics.hit;
    physics.hit = -1;
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
    physics.hit = -1;
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
      { t: 'match', phase: 'wait', round: 0, wins: [0, 0], goals: 10, rounds: 3 },
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
    expect(texts(a)).toHaveLength(2);
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

  it('suffixes a name a present player already has, within MAX_NAME', () => {
    const names = ['Ann', 'Ann', 'Ann', 'Ann 2', 'x'.repeat(40), 'x'.repeat(16), '   ', 'Player 6'];
    const conns = names.map(n => join(room, n));
    expect(conns.map(c => me(c).name)).toEqual([
      'Ann',
      'Ann 2',
      'Ann 3',
      'Ann 2 2',
      'x'.repeat(MAX_NAME),
      `${'x'.repeat(MAX_NAME - 2)} 2`,
      'Player 6',
      'Player 6 2',
    ]);
    // A free name is free again: the leaver's is reused, nobody else is renamed.
    room.disconnect(conns[1]);
    expect(me(join(room, 'Ann')).name).toBe('Ann 2');
    expect(me(conns[2]).name).toBe('Ann 3');
  });

  it('cuts the base so the suffix fits, never leaving a double space', () => {
    const names = Array.from({ length: 10 }, () => me(join(room, 'abcdefghijklm no')).name);
    expect(names.slice(0, 3)).toEqual(['abcdefghijklm no', 'abcdefghijklm 2', 'abcdefghijklm 3']);
    expect(names.at(-1)).toBe('abcdefghijklm 10');
    expect(names.every(n => n.length <= MAX_NAME)).toBe(true);
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
      expect(binaries(a)).toHaveLength(4 / SNAP_EVERY);
      expect(decodeSnapshot(binaries(a).at(-1)!)!.tick).toBe(4);
    });

    it('caps the catch-up after a stall', () => {
      const a = join(room);
      room.start();
      elapse(5001);
      // 10 ticks replayed at most.
      expect(binaries(a)).toHaveLength(Math.floor(10 / SNAP_EVERY));
      elapse(dt * 2);
      expect(decodeSnapshot(binaries(a).at(-1)!)!.tick).toBe(12);
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

describe('Room tournament', () => {
  // A round is 2 goals, a break 6 ticks, the final ranking 12 ticks.
  const RULES = { goals: 2, breakSec: 6 / TICK_HZ, endSec: 12 / TICK_HZ };
  let room: Room;

  beforeEach(() => {
    room = new Room(RULES);
    Object.assign(physics, { goal: -1, hit: -1, steps: 0 });
  });

  const matches = (c: FakeConn) => texts(c).filter(m => m.t === 'match');
  const lastMatch = (c: FakeConn) => {
    const m = matches(c).pop();
    if (m?.t !== 'match') {
      throw new Error('no match message');
    }
    return m;
  };
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) {
      room.tick();
    }
  };
  /** One step where paddle `id` touches the puck, and team `goal` maybe scores. */
  const touch = (id: number, goal: -1 | Team = -1) => {
    Object.assign(physics, { hit: id, goal });
    room.tick();
  };
  const goal = (team: Team) => touch(-1, team);
  /** Team t scores until a match message (break or end) reaches c. */
  const winRound = (c: FakeConn, t: Team) => {
    const n = matches(c).length;
    while (matches(c).length === n) {
      goal(t);
    }
    return lastMatch(c);
  };
  const line = (c: FakeConn, name: string) => lastMatch(c).ranking!.find(r => r.name === name)!;
  const snap = (c: FakeConn) => {
    ticks(SNAP_EVERY);
    return decodeSnapshot(binaries(c).at(-1)!)!;
  };

  it('waits for one player per team, then starts round 1 with the newcomer told right after his roster', () => {
    const a = join(room, 'A');
    expect(lastMatch(a)).toMatchObject({ t: 'match', phase: 'wait', round: 0, wins: [0, 0] });
    // Free play: touches and goals count for nobody.
    touch(0, 1);
    expect(snap(a).score).toEqual([0, 1]);

    const b = join(room, 'B');
    const play = { t: 'match', phase: 'play', round: 1, wins: [0, 0] };
    expect(texts(b).map(m => m.t)).toEqual(['roster', 'match']);
    expect(lastMatch(b)).toMatchObject(play);
    expect(lastMatch(a)).toMatchObject(play);
    // Round start: 0-0, paddles back on their spawn points.
    expect(snap(a)).toMatchObject({
      score: [0, 0],
      paddles: [
        { x: 400, y: 100 },
        { x: 1200, y: 100 },
      ],
    });

    expect(winRound(a, 0).ranking!.map(r => [r.name, r.points])).toEqual([
      ['A', 10],
      ['B', 0],
    ]);
  });

  it('counts a hit only when the toucher changes or after a re-serve', () => {
    const a = join(room, 'A');
    const b = join(room, 'B');
    touch(0);
    touch(0);
    touch(1);
    touch(0);
    touch(0, 0); // same toucher: the goal, no hit
    touch(0); // re-served: a hit again
    goal(0);
    expect(line(a, 'A')).toMatchObject({ hits: 3, goals: 2 });
    expect(line(b, 'B')).toMatchObject({ hits: 1, goals: 0, points: 1 });
  });

  it('credits the goal to its last toucher, never on an own goal or an untouched puck', () => {
    const a = join(room, 'A');
    join(room, 'B');
    // Hit and goal in the same step: the hit counts first, then the goal.
    touch(0, 0);
    touch(0, 1); // own goal by A
    goal(1); // nobody touched it since the serve
    const m = lastMatch(a);
    expect(m).toMatchObject({ phase: 'break', round: 1, wins: [0, 1], winner: 1 });
    expect(line(a, 'A')).toMatchObject({ goals: 1, hits: 2, points: 1 + 20 + 1 });
    expect(line(a, 'B')).toMatchObject({ goals: 0, hits: 0, points: 10 });
  });

  it('wins a round at rules.goals, freezes for the break, then serves round 2', () => {
    const a = join(room, 'A');
    join(room, 'B');
    goal(0);
    expect(matches(a)).toHaveLength(2);
    goal(0);
    expect(lastMatch(a)).toMatchObject({ phase: 'break', round: 1, wins: [1, 0], winner: 0 });
    expect(texts(a).at(-2)).toEqual({ t: 'goal', team: 0, score: [2, 0] });

    const steps = physics.steps;
    const sent = binaries(a).length;
    room.receive(a, encodeInput(300, 300));
    ticks(5);
    expect(physics.steps).toBe(steps);
    expect(lastMatch(a).phase).toBe('break');
    // Snapshots keep going out, with the final score of the round.
    expect(binaries(a).length).toBeGreaterThan(sent);
    expect(decodeSnapshot(binaries(a).at(-1)!)!.score).toEqual([2, 0]);
    room.tick();
    expect(lastMatch(a)).toMatchObject({ t: 'match', phase: 'play', round: 2, wins: [1, 0] });
    expect(physics.steps).toBe(steps);
    expect(snap(a)).toMatchObject({
      score: [0, 0],
      paddles: [
        { x: 400, y: 100 },
        { x: 1200, y: 100 },
      ],
    });
  });

  it('plays the third round only at 1-1', () => {
    const a = join(room, 'A');
    join(room, 'B');
    winRound(a, 0);
    ticks(6);
    winRound(a, 1);
    ticks(6);
    expect(lastMatch(a)).toMatchObject({ phase: 'play', round: 3, wins: [1, 1] });
    expect(winRound(a, 0)).toMatchObject({ phase: 'end', round: 3, wins: [2, 1], winner: 0 });
  });

  it('ends a best of 3 at 2 wins, with the round and match bonuses', () => {
    const a = join(room, 'A');
    join(room, 'B');
    winRound(a, 1);
    ticks(6);
    expect(winRound(a, 1)).toMatchObject({ phase: 'end', round: 2, wins: [0, 2], winner: 1 });
    expect(line(a, 'B').points).toBe(10 + 10 + 30);
    expect(line(a, 'A').points).toBe(0);
  });

  it.each([
    // joins, headStart, goals, expected round score: team 0 is the bigger one
    [5, 1, 10, [0, 1]],
    [3, 1, 10, [0, 1]],
    [3, 3, 10, [0, 3]],
    [3, 5, 2, [0, 1]], // capped one goal short of the round
  ])(
    'gives the smaller team a head start (%i players, headStart %i)',
    (n, headStart, goals, score) => {
      room = new Room({ ...RULES, goals, headStart });
      const conns = Array.from({ length: n }, (_, i) => join(room, `P${i}`));
      // Round 1 started at 1v1.
      expect(snap(conns[0]).score).toEqual([0, 0]);
      winRound(conns[0], 0);
      ticks(6);
      expect(snap(conns[0]).score).toEqual(score);
      // Head-start goals credit nobody.
      winRound(conns[0], 0);
      expect(lastMatch(conns[0]).ranking!.every(r => r.goals === 0)).toBe(true);
    },
  );

  it('gives two goals of head start to 1 player against 3', () => {
    room = new Room({ ...RULES, goals: 10 });
    const conns = Array.from({ length: 5 }, (_, i) => join(room, `P${i}`));
    room.disconnect(conns[3]);
    winRound(conns[0], 0);
    ticks(6);
    expect(snap(conns[0]).score).toEqual([0, 2]);
  });

  it.each([
    // joins, winner, match points
    [3, 1, 30 * 2], // 2v1, the single player wins
    [5, 1, 30 * 2], // 3v2: 1.5 rounds to 2
    [3, 0, 30], // the bigger team wins: no multiplier
  ] as const)(
    'multiplies the match bonus of an upset (%i players, team %i wins)',
    (n, t, bonus) => {
      room = new Room({ ...RULES, rounds: 1, headStart: 0 });
      const conns = Array.from({ length: n }, (_, i) => join(room, `P${i}`));
      expect(winRound(conns[0], t)).toMatchObject({ phase: 'end', winner: t });
      const winners = lastMatch(conns[0]).ranking!.filter(r => r.team === t);
      expect(winners.map(r => r.points)).toEqual(winners.map(() => 10 + bonus));
    },
  );

  it('keeps the points of a leaver without bonus, and gives them back on rejoin by name', () => {
    const a = join(room, 'A');
    join(room, 'B');
    const c = join(room, ' C ');
    touch(me(c).id);
    room.disconnect(c);
    winRound(a, 0);
    expect(line(a, 'C')).toEqual({ ...me(c), points: 1, goals: 0, hits: 1, left: true });
    expect(line(a, 'A').points).toBe(10);

    // Back during the break, on the balanced team.
    const c2 = join(room, 'C');
    expect(lastMatch(c2)).toMatchObject({ phase: 'break', winner: 0 });
    expect(lastMatch(c2).ranking!.find(r => r.name === 'C')).toEqual({
      ...me(c2),
      points: 1,
      goals: 0,
      hits: 1,
    });
    ticks(6);
    winRound(a, 0);
    expect(lastMatch(a).phase).toBe('end');
    expect(line(a, 'C')).toEqual({ ...me(c2), points: 1 + 10 + 30, goals: 0, hits: 1 });
    expect(lastMatch(a).ranking).toHaveLength(3);
  });

  it('gives the stats back on rejoin under the deduplicated name', () => {
    const a = join(room, 'A');
    join(room, 'B');
    const a2 = join(room, 'A');
    expect(me(a2).name).toBe('A 2');
    touch(me(a2).id);
    room.disconnect(a2);
    // The same raw name comes back while 'A' is still here: it lands on 'A 2' and its stats.
    const back = join(room, 'A');
    expect(me(back).name).toBe('A 2');
    winRound(a, 0);
    expect(line(a, 'A 2')).toMatchObject({ hits: 1 });
    expect(lastMatch(a).ranking).toHaveLength(3);
  });

  it('a newcomer mid-match plays at once and starts from 0, others keep their stats', () => {
    const a = join(room, 'A');
    join(room, 'B');
    touch(0);
    const c = join(room, 'C');
    expect(texts(c).map(m => m.t)).toEqual(['roster', 'match']);
    expect(lastMatch(c)).toMatchObject({ t: 'match', phase: 'play', round: 1, wins: [0, 0] });
    expect(me(c).team).toBe(0);
    winRound(a, 1);
    expect(line(a, 'A')).toMatchObject({ points: 1, hits: 1 });
    expect(line(a, 'C')).toMatchObject({ points: 0, hits: 0 });
  });

  it.each([false, true])('drops the match when a team empties (during the break: %s)', brk => {
    const a = join(room, 'A');
    const b = join(room, 'B');
    touch(0);
    goal(0);
    if (brk) {
      goal(0);
    }
    room.disconnect(b);
    expect(lastMatch(a)).toMatchObject({ t: 'match', phase: 'wait', round: 0, wins: [0, 0] });
    // Free play again: physics runs, the score is left as is.
    const steps = physics.steps;
    expect(snap(a).score).toEqual(brk ? [2, 0] : [1, 0]);
    expect(physics.steps).toBe(steps + SNAP_EVERY);

    join(room, 'B');
    expect(lastMatch(a)).toMatchObject({ t: 'match', phase: 'play', round: 1, wins: [0, 0] });
    winRound(a, 1);
    expect(line(a, 'A')).toMatchObject({ points: 0, hits: 0 });
  });

  it('starts a new match from scratch after endSec', () => {
    room = new Room({ ...RULES, rounds: 1 });
    const a = join(room, 'A');
    join(room, 'B');
    touch(0);
    winRound(a, 0);
    expect(lastMatch(a).phase).toBe('end');
    const n = matches(a).length;
    const steps = physics.steps;
    ticks(11);
    expect(matches(a)).toHaveLength(n);
    expect(physics.steps).toBe(steps);
    room.tick();
    expect(lastMatch(a)).toMatchObject({ t: 'match', phase: 'play', round: 1, wins: [0, 0] });
    winRound(a, 1);
    expect(line(a, 'A')).toMatchObject({ points: 0, hits: 0, goals: 0 });
  });

  it('keeps the final ranking on screen when a team empties, then waits', () => {
    room = new Room({ ...RULES, rounds: 1 });
    const a = join(room, 'A');
    const b = join(room, 'B');
    winRound(a, 0);
    room.disconnect(b);
    expect(lastMatch(a)).toMatchObject({ phase: 'end', winner: 0 });
    ticks(12);
    expect(lastMatch(a)).toMatchObject({ t: 'match', phase: 'wait', round: 0, wins: [0, 0] });
  });

  it('ranks by points, then goals, then hits, then who got there first', () => {
    room = new Room({ ...RULES, hit: 1, goal: 2, roundWin: 0 });
    const conns = ['A', 'B', 'C', 'D'].map(name => join(room, name));
    const [a, b, c, d] = conns.map(c => me(c).id);
    touch(b);
    touch(a, 0); // A: 1 hit + 1 goal = 3
    touch(d, 1); // D: 3 as well, later
    [c, b, c, b, c].forEach(id => touch(id)); // B reaches 3 hits before C
    goal(1); // own goal by C: the round ends, nobody credited
    expect(lastMatch(conns[0]).ranking!.map(r => [r.name, r.points, r.goals, r.hits])).toEqual([
      ['A', 3, 1, 1],
      ['D', 3, 1, 1],
      ['B', 3, 0, 3],
      ['C', 3, 0, 3],
    ]);
  });

  it('ranks more hits first on equal points and goals', () => {
    room = new Room({ ...RULES, hit: 0, roundWin: 0 });
    const conns = ['A', 'B', 'C'].map(name => join(room, name));
    touch(0, 0); // A: 1 goal, 1 hit
    touch(1);
    touch(2);
    touch(1, 1); // B: 1 goal, 2 hits, later
    goal(0); // untouched since the serve: ends the round, nobody credited
    expect(lastMatch(conns[0]).ranking!.map(r => r.name)).toEqual(['B', 'A', 'C']);
  });
});
