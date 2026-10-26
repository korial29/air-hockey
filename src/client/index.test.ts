// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeInput, encodeSnapshot } from '../shared/protocol';
import { obstacles } from '../shared/arena';
import { clampPaddle } from '../shared/physics';
import type { Obstacle, Rank, SocketLike } from '../shared/types';
import { airHockey } from './index';
import type * as Predict from './predict';
import { PADDLE_R, PUCK_R } from '../shared/constants';
import { MIN_PADDLE_PX, MIN_PUCK_PX, TOP } from './util';

vi.mock('../shared/physics', async importOriginal => ({
  ...(await importOriginal<object>()),
  clampPaddle: vi.fn((_team: number, x: number, y: number) => [x, y]),
}));

// The ice and sea layouts and the hit times belong to the physics: a fixed fake of each.
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
      : arena == 'sea'
        ? [
            { kind: 'rock', x: 700, y: 300, r: 70, vx: 0, vy: 0 },
            { kind: 'mermaid', x: 1000, y: 500, r: 50, vx: 120, vy: 180 },
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
 * the translations, and in `arcs` each arc's fill style and radius in canvas pixels.
 */
const fakeContext = () => {
  const texts: string[] = [];
  const ys = new Map<string, number>();
  const at: [string, number, number][] = [];
  const styles: string[] = [];
  const strokes: string[] = [];
  const alphas: number[] = [];
  const moves: [number, number][] = [];
  const arcs: [string, number][] = [];
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
              : k == 'arc'
                ? (_x: number, _y: number, r: number) => arcs.push([String(t.fillStyle), r * m[0]])
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
  return Object.assign(texts, { ys, at, styles, strokes, alphas, moves, arcs });
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
    // 1200 px wide: paddles stay above their minimum drawn size even at size 2.
    canvas.width = 1200;
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
    // 1200 px canvas: 0.6 px per unit, the paddle at (TOP + 450) · 0.6 px, the name above it
    // (font 35 units: 21 px).
    expect(above).toBeCloseTo((TOP + 450 - 44 - 17.5) * 0.6);
    expect(name).toBeCloseTo(21);
    expect(draw().styles).not.toContain('#e6f2f9');

    // Size 2, 5 obstacles: requested as such, the rink is painted again, once.
    send(2, 5);
    snap(2);
    draw();
    expect(obstacles).toHaveBeenCalledWith('ice', expect.any(Number), 2, 5);
    expect(texts.styles).toContain('#e6f2f9');
    // The name keeps its size on screen, the paddle (radius 44) shrinks to half.
    expect(label()[1]).toBeCloseTo(name);
    expect(label()[0]).toBeCloseTo((TOP + 450 - 22 - 17.5) * 0.6);
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

  it('draws the puck and paddles at least MIN_PUCK_PX and MIN_PADDLE_PX wide, physics aside', () => {
    const texts = fakeContext();
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    const canvas = document.body.firstElementChild!.shadowRoot!.querySelector('canvas')!;
    socket.onopen!();
    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    const match = (size: number) =>
      socket.onmessage!({
        data: JSON.stringify({ t: 'match', phase: 'play', arena: 'ice', size, count: 5 }),
      });
    const snap = (size: number) =>
      socket.onmessage!({
        data: encodeSnapshot({
          tick: 42,
          score: [0, 0],
          puck: { x: 1000 * size, y: 560 * size, vx: 0, vy: 0 },
          paddles: [{ id: 3, x: 400 * size, y: 450 * size }],
        }),
      });
    // Drawn radii in CSS px: [puck, paddle], and the canvas y of the name over the paddle.
    const radii = (width: number, dpr = 1) => {
      vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(dpr);
      canvas.width = width * dpr;
      texts.arcs.length = texts.at.length = 0;
      frame(0);
      const r = (color: string) => texts.arcs.find(([s]) => s == color)![1] / dpr;
      return [r('#141a24'), r('#f00'), texts.at.find(([s]) => s == 'Ana')![1] / dpr];
    };

    match(2);
    snap(2);
    // 8 players on a phone: 343 CSS px for 4000 world units, the puck would be 2.4 px wide.
    const [puck, paddle, y] = radii(343);
    expect(puck).toBeCloseTo(MIN_PUCK_PX);
    expect(paddle).toBeCloseTo(MIN_PADDLE_PX);
    // The name clears the drawn paddle: its font is 12 px, half of it above the paddle.
    expect(y).toBeCloseTo(((TOP + 450) * 343) / 2000 - MIN_PADDLE_PX - 6);
    // Same CSS size on a 3x screen.
    radii(343, 3).forEach((v, i) => expect(v).toBeCloseTo([puck, paddle, y][i], 1));
    // A wide canvas draws the true radii: 1440 px for 4000 units.
    const [p2, d2] = radii(1440);
    expect(p2).toBeCloseTo((PUCK_R * 1440) / 4000);
    expect(d2).toBeCloseTo((PADDLE_R * 1440) / 4000);
    // Size 1 on the phone: the paddle is 7.5 px, raised; the puck 4.8 px, raised too.
    match(1);
    snap(1);
    expect(radii(343).slice(0, 2)).toEqual(
      [MIN_PUCK_PX, MIN_PADDLE_PX].map(v => expect.closeTo(v)),
    );
    game.destroy();
  });

  it('has a full screen button on the wrapper, unless disabled or unsupported', () => {
    const fs = (on: boolean) =>
      Object.defineProperty(document, 'fullscreenEnabled', { value: on, configurable: true });
    const mount = (opts: object = {}) => {
      const socket = fakeSocket();
      const game = airHockey(document.body, { name: 'Ana', socket, ...opts });
      const wrap = document.body.lastElementChild as HTMLElement;
      return { game, wrap, button: wrap.shadowRoot!.querySelector('button')! };
    };
    const request = vi.fn(() => Promise.resolve());
    const exit = vi.fn(() => Promise.reject(new Error('not in full screen')));
    HTMLElement.prototype.requestFullscreen = request;
    document.exitFullscreen = exit;
    let current: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      get: () => current,
      configurable: true,
    });

    fs(true);
    const { game, wrap, button } = mount();
    expect(button.hidden).toBe(false);
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Full screen');
    button.click();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.contexts[0]).toBe(wrap);
    // Entered: the label and the icon say how to leave; the button leaves.
    const icon = button.querySelector('path')!.getAttribute('d');
    current = wrap;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(button.getAttribute('aria-label')).toBe('Exit full screen');
    expect(button.querySelector('path')!.getAttribute('d')).not.toBe(icon);
    button.click();
    expect(exit).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    // Left with Escape: back to the first state.
    current = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(button.getAttribute('aria-label')).toBe('Full screen');
    expect(button.querySelector('path')!.getAttribute('d')).toBe(icon);
    game.destroy();

    expect(mount({ fullscreen: false }).button.hidden).toBe(true);
    fs(false);
    expect(mount().button.hidden).toBe(true);
    // @ts-expect-error jsdom has none: restore that
    delete document.fullscreenEnabled;
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  });

  it('maps the pointer through the canvas rect after the canvas changes size', () => {
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    socket.onopen!();
    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    socket.onmessage!({ data: JSON.stringify({ t: 'match', phase: 'play', size: 2 }) });
    const canvas = document.body.firstElementChild!.shadowRoot!.querySelector('canvas')!;
    const input = (rect: DOMRect, fx: number, fy: number) => {
      canvas.getBoundingClientRect = () => rect;
      canvas.dispatchEvent(
        new MouseEvent('pointermove', {
          clientX: rect.left + rect.width * fx,
          clientY: rect.top + rect.height * fy,
        }),
      );
      frame(0);
      return decodeInput(socket.sent.at(-1) as ArrayBuffer);
    };
    // The same spot of the drawn canvas, in the page and letterboxed in full screen.
    const page = input({ left: 16, top: 60, width: 800, height: 600 } as DOMRect, 0.25, 0.5);
    expect(page).toEqual({ x: 1000, y: ((750 - TOP) * 2000) / 1000 });
    const full = input({ left: 240, top: 0, width: 1440, height: 1080 } as DOMRect, 0.25, 0.5);
    expect(full).toEqual(page);
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
  it('draws the sea scene: water and waves, rocks, mermaids, the doubloon; the rink repainted per scene', () => {
    const texts = fakeContext();
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    const draw = () => {
      texts.length = texts.styles.length = texts.strokes.length = 0;
      vi.mocked(obstacles).mockClear();
      frame(0);
      return texts;
    };
    const scene = (arena: string) =>
      socket.onmessage!({
        data: JSON.stringify({
          t: 'match',
          phase: 'play',
          arena,
          round: 1,
          rounds: 3,
          goals: 10,
          wins: [0, 0],
        }),
      });
    socket.onopen!();
    const players = [{ id: 3, name: 'Ana', color: '#f00', team: 0 }];
    socket.onmessage!({ data: JSON.stringify({ t: 'roster', you: 3, players }) });
    const snap = () =>
      socket.onmessage!({
        data: encodeSnapshot({
          tick: 42,
          score: [0, 0],
          puck: { x: 300, y: 600, vx: 0, vy: 0 },
          paddles: [{ id: 3, x: 400, y: 450 }],
        }),
      });
    const facets = (h: string) => texts.styles.filter(v => String(v).startsWith(h)).length;
    snap();

    // Round 1 on the ice, painted once.
    expect(draw().styles).toContain('#e6f2f9');
    expect(draw().styles).not.toContain('#e6f2f9');

    // Round 2 at sea: the rink is painted again (deep water, rope, rail), waves on top.
    scene('sea');
    snap();
    expect(() => draw()).not.toThrow();
    expect(obstacles).toHaveBeenCalledWith('sea', expect.any(Number), 1, 7);
    expect(texts.styles).toContain('#0b4d6e');
    expect(texts.strokes).toEqual(expect.arrayContaining(['#a8703c', '#d9bf86', '#ffffff45']));
    expect(texts.styles).not.toContain('#e6f2f9');
    // A rock (grey-brown facets, moss, barnacles, a foam ring), no iceberg facet.
    expect(facets('hsl(30')).toBeGreaterThan(0);
    expect(facets('hsl(196')).toBe(0);
    expect(texts.styles).toEqual(expect.arrayContaining(['#6f8f3acc', '#e8e0cc']));
    expect(texts.strokes).toContain('#fffc');
    // A mermaid (skin, tail, hair), no penguin.
    expect(texts.styles).toEqual(expect.arrayContaining(['#f3c9a4', '#3f8fe0', '#f4c542']));
    expect(texts.styles).not.toContain('#f39a1c');
    // The puck is a gold doubloon, the beacon kept; the name over a dark shadow.
    expect(texts.styles).toContain('#e9b52c');
    expect(texts.strokes).toEqual(expect.arrayContaining(['#a87314', '#fc3']));
    expect(texts.styles).not.toContain('#141a24');
    expect(texts.styles).toContain('#000a');
    expect(texts.filter(t => t == 'Ana')).toHaveLength(3);
    // Painted once: the water is copied, the waves drawn every frame.
    expect(draw().styles).not.toContain('#0b4d6e');
    expect(texts.strokes).toContain('#ffffff45');

    // Hit: the rock flashes and throws stone chips; the mermaid spins, sees stars, bubbles burst.
    fake.hits.splice(0, 2, performance.now(), performance.now());
    expect(draw().filter(t => t == '★')).toHaveLength(3);
    expect(texts.styles).toContain('#8f8475');
    expect(texts.strokes).toEqual(expect.arrayContaining(['#fff', '#e8fdff']));
    fake.hits.splice(0, 2, -5000, -5000);
    expect(draw()).not.toContain('★');
    expect(texts.strokes).not.toContain('#e8fdff');

    // Back on the ice: painted again, no sea drawing left.
    scene('ice');
    snap();
    draw();
    expect(texts.styles).toContain('#e6f2f9');
    expect(texts.strokes).not.toContain('#ffffff45');
    expect(texts.styles).not.toContain('#e9b52c');
    expect(texts.styles).toContain('#141a24');
    game.destroy();
  });

  it('draws rock and mermaid damage, removal, ghosts and returns from the obstacle states', () => {
    const texts = fakeContext();
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => ((frame = cb), 1));
    const socket = fakeSocket();
    const game = airHockey(document.body, { name: 'Ana', socket });
    const draw = () => {
      texts.length = texts.styles.length = texts.strokes.length = 0;
      texts.alphas.length = texts.moves.length = 0;
      frame(0);
      return texts;
    };
    socket.onopen!();
    socket.onmessage!({
      data: JSON.stringify({
        t: 'match',
        phase: 'play',
        arena: 'sea',
        round: 2,
        rounds: 3,
        goals: 10,
        wins: [1, 0],
      }),
    });
    socket.onmessage!({
      data: encodeSnapshot({
        tick: 4000,
        score: [0, 0],
        puck: { x: 300, y: 600, vx: 0, vy: 0 },
        paddles: [],
      }),
    });
    const sec = (v: number) => v * 240;
    const set = (rock: [number, number], mer: [number, number], angle = 0) =>
      (fake.obs = [
        { hits: rock[0], since: rock[1], angle: 0 },
        { hits: mer[0], since: mer[1], angle },
      ]);
    const facets = () => texts.styles.filter(v => String(v).startsWith('hsl(30')).length;
    const cracks = () => texts.strokes.filter(v => v == '#1e1712').length;

    // In play: one hit, a crack; two, branching cracks and a chipped corner.
    set([0, -1], [0, -1]);
    const intact = draw().styles.filter(v => String(v).startsWith('hsl(30'));
    expect(cracks()).toBe(0);
    expect(texts.strokes).toContain('#fff3');
    set([1, -1], [0, -1]);
    draw();
    expect(cracks()).toBe(1);
    set([2, -1], [0, -1]);
    draw();
    expect(cracks()).toBe(3);
    expect(texts.styles.filter(v => String(v).startsWith('hsl(30'))).not.toEqual(intact);

    // Crumbled 0.3 s ago: stones sinking in ripples, no whole rock (no ridges); at 5 s, nothing.
    set([3, sec(0.3)], [0, -1]);
    draw();
    expect(facets()).toBeGreaterThan(0);
    expect(texts.strokes).toEqual(expect.arrayContaining(['#fff', '#3b3129']));
    expect(texts.strokes).not.toContain('#fff3');
    expect(texts.styles).not.toContain('#6f8f3acc');
    set([3, sec(5)], [0, -1]);
    draw();
    expect(facets()).toBe(0);

    // Mermaid shot out 0.5 s ago along +x: she flies off in a splash of droplets, stars around her.
    set([0, -1], [1, sec(0.5)], 0);
    draw();
    expect(texts.filter(t => t == '★')).toHaveLength(3);
    expect(texts.moves).toContainEqual([1000 + 50 * 24 * 0.5, 500]);
    expect(texts.styles).toContain('#bdf3ff');
    set([0, -1], [1, sec(2)]);
    expect(draw().styles).not.toContain('#f3c9a4');

    // Ghosts at 8 s and 9.5 s: see-through, a ring, bubbles rising, no crack.
    for (const t of [8, 9.5]) {
      set([3, sec(t)], [1, sec(t)]);
      draw();
      expect(facets()).toBeGreaterThan(0);
      expect(texts.styles).toContain('#f3c9a4');
      expect(texts.strokes.filter(v => v == '#e0fbff').length).toBeGreaterThan(2);
      expect(texts.strokes).not.toContain('#7fe3ff');
      const a = texts.alphas.filter(v => v < 1);
      expect(a.some(v => v >= 0.25 && v <= 0.45)).toBe(true);
      expect(cracks()).toBe(0);
    }

    // Back in play: a pop (white ring) for 300 ms, then the plain rock and mermaid.
    const now = performance.now();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
    set([0, -1], [0, -1]);
    expect(draw().strokes).toContain('#fff');
    clock.mockReturnValue(now + 400);
    expect(draw().strokes).not.toContain('#fff');
    expect(texts.strokes).not.toContain('#e0fbff');
    fake.obs = undefined;
    game.destroy();
  });
});
