import { GOAL, H, INTERP_DELAY, PADDLE_R, PUCK_R, W } from '../shared/constants';
import { clampPaddle } from '../shared/physics';
import { decodeSnapshot, encodeInput, parseText } from '../shared/protocol';
import type { ServerText } from '../shared/protocol';
import type { PlayerInfo, SocketLike } from '../shared/types';
import { byTeam, sample, toField } from './util';
import type { Stamped } from './util';

export type { PlayerInfo, SocketLike } from '../shared/types';

export interface AirHockeyOptions {
  /** Player name shown on screen. */
  name: string;
  /** WebSocket URL, room in the path: wss://host/<room>. Ignored when socket is given. */
  url?: string;
  /** Any WebSocket-like socket, e.g. localSocket('room') from 'air-hockey/local'. */
  socket?: SocketLike;
}

export type AirHockeyEvent = 'roster' | 'score' | 'goal' | 'open' | 'close';

export interface AirHockey {
  on(event: AirHockeyEvent, cb: (payload: unknown) => void): () => void;
  destroy(): void;
}

type Listener = [AirHockeyEvent, (payload: unknown) => void];

/** Mounts the game in container (Shadow DOM + canvas) and joins. */
export const airHockey = (container: HTMLElement, opts: AirHockeyOptions): AirHockey => {
  const wrap = document.createElement('div');
  const root = wrap.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>canvas{display:block;width:100%;aspect-ratio:${W}/${H};touch-action:none;border-radius:16px}</style><canvas></canvas>`;
  container.append(wrap);
  const canvas = root.querySelector('canvas')!;
  const c = canvas.getContext('2d');

  const listeners = new Set<Listener>();
  const emit = (event: AirHockeyEvent, payload?: unknown) =>
    listeners.forEach(([e, cb]) => (e == event ? cb(payload) : 0));

  const buf: Stamped[] = [];
  let players = new Map<number, PlayerInfo>();
  let you = -1;
  /** Own paddle, predicted from the pointer. */
  let me: [number, number] | undefined;
  let dirty = false;
  let open = false;
  let score = '';
  let goalAt = -1e4;
  let msg = '';
  let raf = 0;
  let dead = false;

  const ws = opts.socket ?? (new WebSocket(opts.url!) as unknown as SocketLike);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    open = true;
    ws.send(JSON.stringify({ t: 'join', name: opts.name }));
    emit('open');
  };
  ws.onclose = () => {
    open = false;
    msg ||= 'Connection closed';
    emit('close');
  };
  ws.onmessage = ({ data }) => {
    if (typeof data != 'string') {
      const s = decodeSnapshot(data);
      if (s) {
        buf.push({ t: performance.now(), s });
        if (buf.length > 8) {
          buf.shift();
        }
        if (score != (score = s.score + '')) {
          emit('score', s.score);
        }
      }
      return;
    }
    const m = parseText<ServerText>(data);
    if (m?.t == 'roster') {
      you = m.you;
      players = new Map(m.players.map(p => [p.id, p]));
      emit('roster', { you, players: m.players });
    } else if (m?.t == 'goal') {
      goalAt = performance.now();
      emit('goal', { team: m.team, score: m.score });
    } else if (m?.t == 'full') {
      msg = 'Room is full';
    }
  };

  const ac = new AbortController();
  const onPointer = (e: PointerEvent) => {
    const team = players.get(you)?.team;
    if (team != null) {
      me = clampPaddle(team, ...toField(e.clientX, e.clientY, canvas.getBoundingClientRect()));
      dirty = true;
    }
  };
  canvas.addEventListener('pointermove', onPointer, ac);
  canvas.addEventListener('pointerdown', onPointer, ac);

  const ro = new ResizeObserver(() => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = (canvas.width * H) / W;
  });
  ro.observe(canvas);

  const draw = (c: CanvasRenderingContext2D, now: number) => {
    const k = canvas.width / W;
    // Font size in field units, never under 12 CSS px.
    const f = Math.max(28, (12 * devicePixelRatio) / k);
    const circle = (x: number, y: number, r: number, color: string) => {
      c.fillStyle = color;
      c.beginPath();
      c.arc(x, y, r, 0, 7);
      c.fill();
    };
    const text = (s: string, x: number, y: number, size = f, align: CanvasTextAlign = 'center') => {
      c.font = `bold ${size}px sans-serif`;
      c.textAlign = align;
      c.fillStyle = '#fff';
      c.fillText(s, x, y);
    };
    const veil = (color: string, label: string) => {
      c.fillStyle = color;
      c.fillRect(0, 0, W, H);
      text(label, W / 2, H / 2, f * 2);
    };

    c.setTransform(k, 0, 0, k, 0, 0);
    c.textBaseline = 'middle';
    c.fillStyle = '#0d2233';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = '#fff4';
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(W / 2, 0);
    c.lineTo(W / 2, H);
    c.moveTo(W / 2 + 120, H / 2);
    c.arc(W / 2, H / 2, 120, 0, 7);
    c.stroke();
    c.fillStyle = '#fc3';
    c.fillRect(0, (H - GOAL) / 2, 12, GOAL);
    c.fillRect(W - 12, (H - GOAL) / 2, 12, GOAL);

    const s = sample(buf, now - INTERP_DELAY);
    if (s) {
      circle(s.puck.x, s.puck.y, PUCK_R, '#fff');
      for (const p of s.paddles) {
        const info = players.get(p.id);
        const [x, y] = p.id == you && me ? me : [p.x, p.y];
        circle(x, y, PADDLE_R, info?.color ?? '#888');
        circle(x, y, PADDLE_R / 2, '#0003');
        text(info?.name ?? '', x, y - PADDLE_R - f / 2);
      }
      text(s.score.join(' : '), W / 2, f * 1.5, f * 2);
    }
    byTeam([...players.values()]).forEach((team, t) =>
      team.forEach((p, i) => {
        const x = t ? W - f : f;
        const y = f * (1.2 + i * 1.2);
        circle(x, y, f / 3, p.color);
        text(p.name, x + (t ? -f / 1.5 : f / 1.5), y, f * 0.8, t ? 'right' : 'left');
      }),
    );

    const a = 1 - (now - goalAt) / 600;
    if (a > 0) {
      veil(`rgba(255,204,51,${a / 2})`, 'GOAL!');
    }
    const label = msg || (open ? '' : 'Connecting…');
    if (label) {
      veil('#000a', label);
    }
  };

  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (dirty && open && me) {
      ws.send(encodeInput(...me));
      dirty = false;
    }
    if (c && canvas.width) {
      draw(c, performance.now());
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    on(event, cb) {
      const l: Listener = [event, cb];
      listeners.add(l);
      return () => listeners.delete(l);
    },
    destroy() {
      if (dead) {
        return;
      }
      dead = true;
      cancelAnimationFrame(raf);
      ac.abort();
      ro.disconnect();
      listeners.clear();
      ws.onopen = ws.onclose = ws.onmessage = null;
      ws.close();
      wrap.remove();
    },
  };
};
