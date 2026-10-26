// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeInput, encodeSnapshot } from '../shared/protocol';
import { obstacles } from '../shared/arena';
import { clampPaddle } from '../shared/physics';
import type { Obstacle, Rank, SocketLike } from '../shared/types';
import { airHockey } from './index';
import type * as Predict from './predict';
import { TOP } from './util';

vi.mock('../shared/physics', async importOriginal => ({
  ...(await importOriginal<object>()),
  clampPaddle: vi.fn((_team: number, x: number, y: number) => [x, y]),
}));

// The ice layout and the hit times belong to the physics: a fixed fake of each.
const fake = vi.hoisted(() => ({
  hits: [] as number[],
  obs: undefined as { hits: number; since: number; angle: number }[] | undefined,
}));
vi.mock('../shared/arena', () => ({
  obstacles: vi.fn((arena: string): Obstacle[] =>
    arena == 'ice'
      ? [
          { kind: 'iceberg', x: 700, y: 300, r: 70, vx: 0, vy: 0 },
          { kind: 'penguin', x: 1000, y: 500, r: 50, vx: 0, vy: 180 },
        ]
      : [],
  ),
}));
vi.mock('./predict', async importOriginal => {
  const m = await importOriginal<typeof Predict>();
  return {
    ...m,
    predict: () => Object.assign(m.predict(), { hits: fake.hits }),
    // The obstacle states the rules side will fill, on the drawn snapshot.
    view: (...a: Parameters<typeof m.view>) => {
      const s = m.view(...a);
      return s && fake.obs ? { ...s, obs: fake.obs } : s;
    },
  };
});

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

/**
 * A 2D context that accepts every call and records the text drawn, the canvas y of each
 * text in field units (through setTransform), the fill styles set, and in `at` each text
 * with its canvas y and font size in canvas pixels. Also the stroke styles, the alphas and
 * the translations.
 */
const fakeContext = () => {
  const texts: string[] = [];
  const ys = new Map<string, number>();
  const at: [string, number, number][] = [];
  const styles: string[] = [];
  const strokes: string[] = [];
  const alphas: number[] = [];
  const moves: [number, number][] = [];
  let m = [1, 0];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) =>
      k in t
        ? t[k]
        : k == 'fillText'
          ? (s: string, _x: number, y: number) => {
              texts.push(s);
              ys.set(s, y + m[1] / m[0]);
              at.push([s, y * m[0] + m[1], parseFloat(String(t.font).split(' ')[1]) * m[0]]);
            }
          : k == 'setTransform'
            ? (a: number, ...r: number[]) => (m = [a, r[4]])
            : k == 'translate'
              ? (x: number, y: number) => moves.push([x, y])
              : k == 'measureText'
                ? (s: string) => ({ width: s.length * 10 })
                : String(k).startsWith('create')
                  ? () => ({ addColorStop: () => {} })
                  : () => {},
    set: (t, k, v) => {
      if (k == 'fillStyle') {
        styles.push(v);
      }
      if (k == 'strokeStyle') {
        strokes.push(v);
      }
      if (k == 'globalAlpha') {
        alphas.push(v);
      }
      t[k] = v;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  return Object.assign(texts, { ys, at, styles, strokes, alphas, moves });
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
      encodeSnapshot({ tick: 1, score: s, puck: { x: 800, y: 450, vx: 0, vy: 0 }, paddles: [] });
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
    // 800 × 600 CSS px for 2000 × 1500 field units: 0.4 px per unit, the rink TOP × 0.4 px down.
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const move = (x: number) =>
      canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: 180 }));

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
    expect(decodeInput(socket.sent[1] as ArrayBuffer)).toEqual({ x: 500, y: 250 });
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
      texts.length = texts.styles.length = 0;
      frame(0);
      return texts;
    };
    const y = (s: string) => texts.ys.get(s)!;
    socket.onopen!();

    // Before the roster, and with no ranking at all.
    send({ phase: 'wait', round: 0, wins: [0, 0] });
    expect(match).toHaveBeenCalledWith({ phase: 'wait', round: 0, wins: [0, 0] });
    expect(draw()).toContain('Waiting for a player on each side');
    send({ phase: 'end', round: 3, wins: [1, 2], winner: 1, ranking: [] });
    expect(draw()).toContain('🏆 Right team wins');

    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    socket.onmessage!({
      data: encodeSnapshot({
        tick: 1,
        score: [4, 2],
        puck: { x: 1, y: 1, vx: 0, vy: 0 },
        paddles: [{ id: 3, x: 400, y: 450 }],
      }),
    });
    send({ phase: 'play', round: 2, rounds: 3, goals: 10, wins: [1, 0] });
    expect(draw()).toEqual(
      expect.arrayContaining(['4 : 2', 'Round 2/3 · 1–0 · first to 10', 'Left', 'Right']),
    );
    // HUD in the bands, outside the rink [TOP, TOP + 1125]; paddle names on the rink.
    expect(y('4 : 2')).toBeLessThan(TOP);
    expect(y('Round 2/3 · 1–0 · first to 10')).toBeLessThan(TOP);
    expect(y('Left')).toBeGreaterThan(TOP + 1125);
    expect(y('Right')).toBeGreaterThan(TOP + 1125);
    expect(texts.filter(t => t == 'Ana')).toHaveLength(2);
    expect(y('GOAL!')).toBeUndefined();

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
    expect(y('Left wins round 2')).toBeLessThan(TOP);
    expect(y('Left 2 – 0 Right')).toBeLessThan(TOP);

    send({ phase: 'end', round: 2, wins: [2, 0], winner: 0, ranking });
    // Title, winners, podium (step numbers, goals, names), medals, points ranking.
    expect(draw()).toEqual(
      expect.arrayContaining([
        '🏆 Left team wins',
        'p1',
        'p2',
        '1',
        '2',
        '3',
        '5 goals',
        '2 goals',
        'Points',
        '1. p1',
        '3. p3',
      ]),
    );
    expect(texts.styles).toEqual(expect.arrayContaining(['#fc3', '#cfd6df']));
    // Bronze only on the empty 3rd block's band: no medal without a player.
    expect(texts.styles.filter(s => s == '#cd7f32')).toHaveLength(1);
    expect(texts.some(t => t.includes('more'))).toBe(false);

    // 16 players: the ranking shows what fits, then "+N more"; the podium is full.
    send({
      phase: 'end',
      round: 3,
      wins: [2, 1],
      winner: 0,
      ranking: Array.from({ length: 16 }, (_, i) => rank(i + 1, (i % 2) as 0 | 1, i)),
    });
    expect(draw()).toEqual(
      expect.arrayContaining(['1. p1', '5. p5', '+11 more', 'p16', '15 goals', 'p14']),
    );
    expect(texts).not.toContain('6. p6');
    expect(texts.styles).toContain('#cd7f32');

    expect(match).toHaveBeenCalledTimes(6);
    game.destroy();
    expect(socket.onmessage).toBeNull();
    expect(document.body.childElementCount).toBe(0);
  });

  it('counts down 3, 2, 1 over the rink centre, then PLAY! for 600 ms; nothing in other phases', () => {
    const texts = fakeContext();
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    const send = (phase: string, left?: number) =>
      socket.onmessage!({
        data: JSON.stringify({
          t: 'match',
          phase,
          left,
          round: 1,
          rounds: 3,
          goals: 10,
          wins: [0, 0],
        }),
      });
    const OVERLAY = ['3', '2', '1', 'PLAY!'];
    /** The overlay texts drawn at time t (the shadow, then the label). */
    const at = (t: number) => {
      clock.mockReturnValue(t);
      texts.length = texts.at.length = texts.alphas.length = 0;
      frame(0);
      return texts.filter(s => OVERLAY.includes(s));
    };
    socket.onopen!();
    socket.onmessage!({
      data: JSON.stringify({
        t: 'roster',
        you: 3,
        players: [{ id: 3, name: 'Ana', color: '#f00', team: 0 }],
      }),
    });
    socket.onmessage!({
      data: encodeSnapshot({
        tick: 1,
        score: [0, 0],
        puck: { x: 1000, y: 560, vx: 0, vy: 0 },
        paddles: [{ id: 3, x: 400, y: 450 }],
      }),
    });

    send('wait');
    expect(at(1000)).toEqual([]);
    send('ready', 3000);
    expect(at(1000)).toEqual(['3', '3']);
    // The round line stays in the top band.
    expect(texts).toContain('Round 1/3 · 0–0 · first to 10');
    // Big, over the rink centre: on a 300 px canvas (0.15 px per unit), some 70 px tall.
    /** Canvas px of the label (drawn after its shadow) at time t. */
    const size = (t: number) => (at(t), texts.at.filter(([s]) => OVERLAY.includes(s)).at(-1)![2]);
    expect(texts.ys.get('3')).toBeCloseTo(TOP + 1125 / 2);
    expect(size(1000)).toBeGreaterThan(60);
    // Pops in big, settles, then swells and fades out within its second.
    expect(size(1000)).toBeGreaterThan(size(1300));
    expect(size(1900)).toBeGreaterThan(size(1300));
    expect(at(1950)).toEqual(['3', '3']);
    expect(Math.min(...texts.alphas)).toBeLessThan(0.2);
    expect(at(2000)).toEqual(['2', '2']);
    expect(at(2999)).toEqual(['2', '2']);
    expect(at(3500)).toEqual(['1', '1']);
    // A late 'play' message: 1 stays (faded out), never 0.
    expect(at(4100)).toEqual(['1', '1']);

    send('play');
    expect(at(4100)).toEqual(['PLAY!', 'PLAY!']);
    expect(at(4650)).toEqual(['PLAY!', 'PLAY!']);
    expect(at(4700)).toEqual([]);
    expect(at(9000)).toEqual([]);

    // A joiner mid-countdown counts from the time left in its message.
    send('ready', 1200);
    expect(at(9000)).toEqual(['2', '2']);
    expect(at(9300)).toEqual(['1', '1']);
    // Back to waiting (a team emptied): no countdown, no PLAY!.
    send('wait');
    expect(at(9300)).toEqual([]);
    // 'play' that does not end a countdown (a refit after a goal): no PLAY!.
    send('play');
    expect(at(9300)).toEqual([]);
    send('break');
    expect(at(9300)).toEqual([]);
    game.destroy();
  });

  it('moves the own paddle in the countdown and keeps the pointer as its target into play', () => {
    const texts = fakeContext();
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    socket.onopen!();
    const canvas = document.body.firstElementChild!.shadowRoot!.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    const send = (phase: string) =>
      socket.onmessage!({
        data: JSON.stringify({ t: 'match', phase, left: 3000, round: 1, wins: [0, 0] }),
      });
    const snap = (y: number) =>
      socket.onmessage!({
        data: encodeSnapshot({
          tick: 1,
          score: [0, 0],
          puck: { x: 1000, y: 560, vx: 0, vy: 0 },
          paddles: [{ id: 3, x: 400, y }],
        }),
      });
    /** Field y of the own paddle's name (drawn above it, before the HUD lists it) at time t. */
    const name = (t: number) => {
      clock.mockReturnValue(t);
      texts.at.length = 0;
      frame(0);
      return texts.at.find(([s]) => s == 'Ana')![1];
    };
    send('ready');
    snap(450);
    const still = name(0);
    // Pointer at y 250: the input goes out, and the paddle gets there locally within 100 ms.
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 180 }));
    const moved = name(100);
    expect(decodeInput(socket.sent.at(-1) as ArrayBuffer)).toEqual({ x: 250, y: 250 });
    expect(moved).toBeCloseTo(still - 200 * 0.15);
    // Play: the host had it half-way; the pointer, still, remains the target.
    send('play');
    snap(350);
    expect(name(200)).toBeCloseTo(moved);
    // A new round (respawn): the target is dropped, the paddle stays where the host has it.
    send('ready');
    snap(450);
    expect(name(300)).toBeCloseTo(still);
    game.destroy();
  });

  it('draws the ice arena with its obstacles and hit animations, and the classic one', () => {
    const texts = fakeContext();
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    const draw = () => {
      texts.length = texts.styles.length = 0;
      vi.mocked(obstacles).mockClear();
      frame(0);
      return texts;
    };
    socket.onopen!();
    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    const snap = (x: number, vx: number) =>
      socket.onmessage!({
        data: encodeSnapshot({
          tick: 42,
          score: [0, 0],
          puck: { x, y: 600, vx, vy: 0 },
          paddles: [{ id: 3, x: 400, y: 450 }],
        }),
      });
    snap(300, 0);

    // Before any match message: the ice arena, at the snapshot tick.
    draw();
    expect(obstacles).toHaveBeenCalledWith('ice', expect.any(Number), 1, 7);
    expect(vi.mocked(obstacles).mock.calls[0][1]).toBeGreaterThanOrEqual(42);
    // Pale ice, nets, a penguin (orange beak and feet) and a faceted iceberg; no hit yet.
    expect(texts.styles).toEqual(expect.arrayContaining(['#e6f2f9', '#f39a1c']));
    expect(texts.styles.some(s => String(s).startsWith('hsl(196'))).toBe(true);
    expect(texts.styles).not.toContain('#e6faff');
    expect(texts).not.toContain('★');

    // The puck just hit both: shards fly off the iceberg, stars circle the penguin.
    fake.hits.push(performance.now(), performance.now());
    expect(draw().filter(t => t == '★')).toHaveLength(3);
    expect(texts.styles).toContain('#e6faff');
    // The rink is painted once, then copied from its image.
    expect(texts.styles).not.toContain('#e6f2f9');
    // Long ago: back to rest.
    fake.hits.splice(0, 2, -5000, -5000);
    expect(draw()).not.toContain('★');

    // A fast puck leaves a trail over a few frames.
    snap(600, 2000);
    draw();
    snap(640, 2000);
    expect(() => draw()).not.toThrow();

    // Classic: the dark table, no obstacle drawn.
    const match = { phase: 'play', round: 1, rounds: 3, goals: 10, wins: [0, 0] };
    socket.onmessage!({ data: JSON.stringify({ t: 'match', arena: 'classic', ...match }) });
    snap(300, 0);
    draw();
    expect(obstacles).toHaveBeenCalledWith('classic', expect.any(Number), 1, 7);
    expect(texts.styles).toContain('#0d2233');
    expect(texts.styles).not.toContain('#f39a1c');
    expect(texts.styles).not.toContain('#e6f2f9');
    game.destroy();
  });

  it('draws a bigger rink: world in world units, names at their size, rink repainted', () => {
    const texts = fakeContext();
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    const canvas = document.body.firstElementChild!.shadowRoot!.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const draw = () => {
      texts.length = texts.styles.length = texts.at.length = 0;
      vi.mocked(obstacles).mockClear();
      frame(0);
      return texts;
    };
    // The paddle name on the rink (the first one drawn, the HUD lists it too): canvas y, px.
    const label = () => {
      const [, y, px] = texts.at.find(([s]) => s == 'Ana')!;
      return [y, px];
    };
    const snap = (size: number) =>
      socket.onmessage!({
        data: encodeSnapshot({
          tick: 42,
          score: [0, 0],
          puck: { x: 1000 * size, y: 560 * size, vx: 0, vy: 0 },
          paddles: [{ id: 3, x: 400 * size, y: 450 * size }],
        }),
      });
    const send = (size?: number, count?: number) =>
      socket.onmessage!({
        data: JSON.stringify({
          t: 'match',
          phase: 'play',
          arena: 'ice',
          size,
          count,
          round: 1,
          rounds: 3,
          goals: 10,
          wins: [0, 0],
        }),
      });
    socket.onopen!();
    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    snap(1);

    // Size 1: what was drawn before the rink could grow, names in field units above the rink.
    draw();
    expect(obstacles).toHaveBeenCalledWith('ice', expect.any(Number), 1, 7);
    expect(texts.styles).toContain('#e6f2f9');
    const [above, name] = label();
    // 300 px canvas: 0.15 px per unit, the paddle at (TOP + 450) · 0.15 px, the name above it.
    expect(above).toBeCloseTo((TOP + 450 - 44 - 40) * 0.15);
    expect(name).toBeCloseTo(12);
    expect(draw().styles).not.toContain('#e6f2f9');

    // Size 2, 5 obstacles: requested as such, the rink is painted again, once.
    send(2, 5);
    snap(2);
    draw();
    expect(obstacles).toHaveBeenCalledWith('ice', expect.any(Number), 2, 5);
    expect(texts.styles).toContain('#e6f2f9');
    // The name keeps its size on screen, the paddle (radius 44) shrinks to half.
    expect(label()[1]).toBeCloseTo(name);
    expect(label()[0]).toBeCloseTo((TOP + 450 - 22 - 40) * 0.15);
    expect(texts.styles).toContain('#f00');
    expect(draw().styles).not.toContain('#e6f2f9');

    // The pointer maps to world units, and the clamp gets the size.
    const move = () =>
      canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 180 }));
    move();
    frame(0);
    expect(decodeInput(socket.sent.at(-1) as ArrayBuffer)).toEqual({ x: 1000, y: 500 });
    expect(clampPaddle).toHaveBeenLastCalledWith(0, 1000, 500, 2);

    // Back to the defaults (no size in the message): size 1, repainted, same name size.
    send();
    snap(1);
    draw();
    expect(obstacles).toHaveBeenCalledWith('ice', expect.any(Number), 1, 7);
    expect(texts.styles).toContain('#e6f2f9');
    expect(label()).toEqual([above, name]);
    move();
    frame(0);
    expect(decodeInput(socket.sent.at(-1) as ArrayBuffer)).toEqual({ x: 500, y: 250 });
    game.destroy();
  });

  it('draws damage, removal, ghosts and returns from the obstacle states', () => {
    const texts = fakeContext();
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    const draw = () => {
      texts.length = texts.styles.length = texts.strokes.length = 0;
      texts.alphas.length = texts.moves.length = 0;
      vi.mocked(obstacles).mockClear();
      frame(0);
      return texts;
    };
    socket.onopen!();
    socket.onmessage!({
      data: encodeSnapshot({
        tick: 4000,
        score: [0, 0],
        puck: { x: 300, y: 600, vx: 0, vy: 0 },
        paddles: [],
      }),
    });
    // Ticks (240 Hz): seconds since removal. Iceberg 0, penguin 1.
    const sec = (v: number) => v * 240;
    const set = (berg: [number, number], pen: [number, number], angle = 0) =>
      (fake.obs = [
        { hits: berg[0], since: berg[1], angle: 0 },
        { hits: pen[0], since: pen[1], angle },
      ]);
    const facets = () => texts.styles.filter(v => String(v).startsWith('hsl(196')).length;
    const cracks = () => texts.strokes.filter(v => v == '#2b6d96').length;

    // Missing states: intact and in play.
    fake.obs = undefined;
    draw();
    expect(facets()).toBeGreaterThan(0);
    expect(cracks()).toBe(0);
    expect(texts.styles).toContain('#f39a1c');

    // In play: one hit, a crack; two, branching cracks and a chipped corner (darker facets).
    set([0, -1], [0, -1]);
    const intact = draw().styles.filter(v => String(v).startsWith('hsl(196'));
    expect(cracks()).toBe(0);
    set([1, -1], [0, -1]);
    draw();
    expect(cracks()).toBe(1);
    set([2, -1], [0, -1]);
    draw();
    expect(cracks()).toBe(3);
    expect(texts.styles.filter(v => String(v).startsWith('hsl(196'))).not.toEqual(intact);

    // Shattered 0.3 s ago: shards and ice dust, no whole iceberg (no outline); at 5 s, nothing.
    set([3, sec(0.3)], [0, -1]);
    draw();
    expect(texts.styles).toContain('#f8fdff');
    expect(facets()).toBeGreaterThan(0);
    expect(texts.strokes).not.toContain('#fffa');
    set([3, sec(5)], [0, -1]);
    draw();
    expect(facets()).toBe(0);
    expect(texts.styles).not.toContain('#f8fdff');

    // Penguin shot out 0.5 s ago along +x: it flies from where it was at removal, stars around it.
    set([0, -1], [1, sec(0.5)], 0);
    draw();
    // The predicted tick runs on real time: a loaded machine adds a few ticks between steps.
    expect(obstacles).toHaveBeenCalledWith('ice', expect.closeTo(4000 - sec(0.5), -1), 1, 7);
    expect(texts.filter(t => t == '★')).toHaveLength(3);
    expect(texts.moves).toContainEqual([1000 + 50 * 24 * 0.5, 500]);
    // Gone for good at 2 s: nothing drawn for it.
    set([0, -1], [1, sec(2)]);
    expect(draw().styles).not.toContain('#f39a1c');

    // Ghosts at 8 s and 9.5 s: see-through (25 to 45 %), at their place, with a ring.
    for (const t of [8, 9.5]) {
      set([3, sec(t)], [1, sec(t)]);
      draw();
      expect(facets()).toBeGreaterThan(0);
      expect(texts.styles).toContain('#f39a1c');
      expect(texts.strokes).toContain('#7fe3ff');
      const a = texts.alphas.filter(v => v < 1);
      expect(a.some(v => v >= 0.25 && v <= 0.45)).toBe(true);
      expect(cracks()).toBe(0);
    }

    // Back in play: a pop (white ring) for 300 ms, then the plain obstacle.
    const now = performance.now();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
    set([0, -1], [0, -1]);
    expect(draw().strokes).toContain('#fff');
    clock.mockReturnValue(now + 400);
    expect(draw().strokes).not.toContain('#fff');
    expect(texts.alphas.filter(v => v > 0 && v < 1)).toEqual([]);
    fake.obs = undefined;
    game.destroy();
  });
});
