// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeInput, encodeSnapshot } from '../shared/protocol';
import type { Rank, SocketLike } from '../shared/types';
import { airHockey } from './index';

vi.mock('../shared/physics', () => ({
  clampPaddle: (_team: number, x: number, y: number) => [x, y],
}));

const fakeSocket = () => {
  const sent: (string | ArrayBuffer)[] = [];
  const socket: SocketLike & { sent: typeof sent; closed: boolean } = {
    binaryType: '',
    onopen: null,
    onclose: null,
    onmessage: null,
    sent,
    closed: false,
    send: data => sent.push(data),
    close: () => {
      socket.closed = true;
    },
  };
  return socket;
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // jsdom has no canvas backend: keep the console quiet and return no context.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

/** A 2D context that accepts every call and records the text drawn. */
const fakeContext = () => {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) =>
      k in t
        ? t[k]
        : k == 'fillText'
          ? (s: string) => texts.push(s)
          : k == 'measureText'
            ? (s: string) => ({ width: s.length * 10 })
            : () => {},
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  return texts;
};

const rank = (id: number, team: 0 | 1, goals: number, left?: boolean): Rank => ({
  id,
  name: `p${id}`,
  color: '#f00',
  team,
  points: 50 - id,
  goals,
  hits: id,
  left,
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('airHockey', () => {
  it('mounts in a shadow root, joins, emits events and cleans up', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const socket = fakeSocket();
    const game = airHockey(container, { name: 'Ana', socket });

    const wrap = container.firstElementChild!;
    expect(wrap.shadowRoot!.querySelector('canvas')).not.toBeNull();
    expect(socket.binaryType).toBe('arraybuffer');

    const opened = vi.fn();
    game.on('open', opened);
    socket.onopen!();
    expect(opened).toHaveBeenCalledOnce();
    expect(JSON.parse(socket.sent[0] as string)).toEqual({ t: 'join', name: 'Ana' });

    const roster = vi.fn();
    const off = game.on('roster', roster);
    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    expect(roster).toHaveBeenCalledWith({ you: 3, players });
    off();
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    expect(roster).toHaveBeenCalledOnce();

    const goal = vi.fn();
    game.on('goal', goal);
    socket.onmessage!({ data: JSON.stringify({ t: 'goal', team: 1, score: [0, 1] }) });
    expect(goal).toHaveBeenCalledWith({ team: 1, score: [0, 1] });

    const score = vi.fn();
    game.on('score', score);
    const snapshot = (s: [number, number]) =>
      encodeSnapshot({ tick: 1, score: s, puck: { x: 800, y: 450 }, paddles: [] });
    socket.onmessage!({ data: snapshot([0, 1]) });
    socket.onmessage!({ data: snapshot([0, 1]) });
    socket.onmessage!({ data: snapshot([2, 1]) });
    expect(score.mock.calls).toEqual([[[0, 1]], [[2, 1]]]);

    game.destroy();
    game.destroy();
    expect(container.childElementCount).toBe(0);
    expect(socket.closed).toBe(true);
    expect(socket.onmessage).toBeNull();
  });

  it('sends the pointer as an input at most once per frame, only when it moved', () => {
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    socket.onopen!();
    const canvas = document.body.firstElementChild!.shadowRoot!.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 450 }) as DOMRect;
    const move = (x: number) =>
      canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: 100 }));

    move(100);
    frame(0);
    expect(socket.sent).toHaveLength(1); // no team yet: pointer ignored

    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    move(100);
    move(200);
    frame(0);
    frame(0);
    expect(socket.sent).toHaveLength(2);
    expect(decodeInput(socket.sent[1] as ArrayBuffer)).toEqual({ x: 400, y: 200 });
    game.destroy();
  });

  it('emits the match message without its tag and draws every phase', () => {
    const texts = fakeContext();
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    const match = vi.fn();
    game.on('match', match);
    const send = (m: object) => socket.onmessage!({ data: JSON.stringify({ t: 'match', ...m }) });
    const draw = () => {
      texts.length = 0;
      frame(0);
      return texts;
    };
    socket.onopen!();

    // Before the roster, and with no ranking at all.
    send({ phase: 'wait', round: 0, wins: [0, 0] });
    expect(match).toHaveBeenCalledWith({ phase: 'wait', round: 0, wins: [0, 0] });
    expect(draw()).toContain('Waiting for a player on each side');
    send({ phase: 'end', round: 3, wins: [1, 2], winner: 1, ranking: [] });
    expect(draw()).toContain('🏆 Right wins');

    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    socket.onmessage!({
      data: encodeSnapshot({ tick: 1, score: [4, 2], puck: { x: 1, y: 1 }, paddles: [] }),
    });
    send({ phase: 'play', round: 2, rounds: 3, goals: 10, wins: [1, 0] });
    expect(draw()).toEqual(expect.arrayContaining(['4 : 2', 'Round 2/3 · 1–0 · first to 10']));

    const ranking = [rank(1, 0, 2), rank(2, 0, 5), rank(3, 1, 0, true)];
    send({ phase: 'break', round: 2, wins: [2, 0], winner: 0, ranking });
    expect(match).toHaveBeenLastCalledWith({
      phase: 'break',
      round: 2,
      wins: [2, 0],
      winner: 0,
      ranking,
    });
    expect(draw()).toEqual(expect.arrayContaining(['Left wins round 2', 'Left 2 – 0 Right']));

    send({ phase: 'end', round: 2, wins: [2, 0], winner: 0, ranking });
    expect(draw()).toEqual(
      expect.arrayContaining([
        '🏆 Left wins',
        'p1',
        'p2',
        '🥇 p2 · 5 goals',
        '🥈 p1 · 2 goals',
        '3. p3',
      ]),
    );
    expect(texts.some(t => t.startsWith('🥉'))).toBe(false);

    // 16 players still draw: two columns, every line shown.
    send({
      phase: 'end',
      round: 3,
      wins: [2, 1],
      winner: 0,
      ranking: Array.from({ length: 16 }, (_, i) => rank(i + 1, (i % 2) as 0 | 1, i)),
    });
    expect(draw()).toEqual(expect.arrayContaining(['1. p1', '16. p16']));

    expect(match).toHaveBeenCalledTimes(6);
    game.destroy();
    expect(socket.onmessage).toBeNull();
    expect(document.body.childElementCount).toBe(0);
  });
});
