// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeInput, encodeSnapshot } from '../shared/protocol';
import type { SocketLike } from '../shared/types';
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
});
