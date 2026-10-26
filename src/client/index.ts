import { GOAL, H, INTERP_DELAY, PADDLE_R, PUCK_R, W } from '../shared/constants';
import { clampPaddle } from '../shared/physics';
import { decodeSnapshot, encodeInput, parseText } from '../shared/protocol';
import type { ServerText } from '../shared/protocol';
import type { PlayerInfo, SocketLike, Team } from '../shared/types';
import { predict, rebase, reset, view } from './predict';
import { byTeam, grid, podium, sample, toField } from './util';
import type { Stamped } from './util';

export type { Phase, PlayerInfo, Rank, SocketLike, Team } from '../shared/types';

/** Payload of the 'match' event: the host's match message, without its type tag. */
export type MatchState = Omit<Extract<ServerText, { t: 'match' }>, 't'>;

export interface AirHockeyOptions {
  /** Player name shown on screen. */
  name: string;
  /** WebSocket URL, room in the path: wss://host/<room>. Ignored when socket is given. */
  url?: string;
  /** Any WebSocket-like socket, e.g. localSocket('room') from 'air-hockey/local'. */
  socket?: SocketLike;
}

export type AirHockeyEvent = 'roster' | 'score' | 'goal' | 'match' | 'open' | 'close';

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
  /** Pointer, clamped to the own half: the own paddle's target. */
  let me: [number, number] | undefined;
  /** Local simulation of the puck and the own paddle. */
  const P = predict();
  let dirty = false;
  let open = false;
  let score = '';
  let goalAt = -1e4;
  let msg = '';
  let raf = 0;
  let dead = false;
  let match: MatchState | undefined;

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
        const now = performance.now();
        buf.push({ t: now, s });
        rebase(P, s, you, now);
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
    } else if (m?.t == 'match') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { t, ...rest } = m;
      // The host puts paddles back on their spawn points at round start: drop the prediction
      // until the pointer moves again, or our paddle would be drawn where it no longer is.
      me = undefined;
      reset(P, m.phase);
      emit('match', (match = rest));
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
    const text = (
      s: string,
      x: number,
      y: number,
      size = f,
      align: CanvasTextAlign = 'center',
      color = '#fff',
      max?: number,
    ) => {
      c.font = `bold ${size}px sans-serif`;
      c.textAlign = align;
      c.fillStyle = color;
      c.fillText(s, x, y, max);
    };
    const veil = (color: string, label = '') => {
      c.fillStyle = color;
      c.fillRect(0, 0, W, H);
      text(label, W / 2, H / 2, f * 2);
    };
    const won = (t?: Team) => (t == null ? '' : `${t ? 'Right' : 'Left'} wins`);

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

    const s = view(P, sample(buf, now - INTERP_DELAY), now, me);
    if (s) {
      circle(s.puck.x, s.puck.y, PUCK_R, '#fff');
      for (const p of s.paddles) {
        const info = players.get(p.id);
        const { x, y } = p;
        circle(x, y, PADDLE_R, info?.color ?? '#888');
        circle(x, y, PADDLE_R / 2, '#0003');
        // Above the paddle, or below it against the top wall.
        text(info?.name ?? '', x, y < PADDLE_R + f ? y + PADDLE_R + f / 2 : y - PADDLE_R - f / 2);
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

    const { phase, round = 0, rounds, goals, wins = [0, 0], winner, ranking = [] } = match ?? {};
    const a = 1 - (now - goalAt) / 600;
    if (phase == 'wait' || phase == 'play') {
      text(
        phase == 'wait'
          ? 'Waiting for a player on each side'
          : `Round ${round}/${rounds} · ${wins.join('–')} · first to ${goals}`,
        W / 2,
        f * 3.2,
      );
    }
    if (a > 0 && phase != 'break' && phase != 'end') {
      veil(`rgba(255,204,51,${a / 2})`, 'GOAL!');
    }
    if (phase == 'break') {
      veil('#000a', `${won(winner)} round ${round}`);
      text(`Left ${wins.join(' – ')} Right`, W / 2, H / 2 + f * 2, f * 1.4);
    }
    if (phase == 'end') {
      // Text unit: f at least, larger when the ranking leaves room for it.
      const e = Math.max(f, Math.min(f * 2, H / (6 + ranking.length * 1.3)));
      veil('#000e');
      text(`🏆 ${won(winner) || 'Match over'}`, W / 2, e * 0.9, e * 1.4);
      // The winning team's players, in their colours, squeezed to fit the width.
      c.font = `bold ${e}px sans-serif`;
      const team = ranking.filter(r => r.team == winner && !r.left);
      const ws = team.map(r => c.measureText(r.name).width + e);
      const z = Math.min(1, (W - e * 2) / ws.reduce((u, v) => u + v, 0));
      let x = W / 2 - (ws.reduce((u, v) => u + v, -e) * z) / 2;
      team.forEach((r, i) => {
        text(r.name, x, e * 2.1, e, 'left', r.color, (ws[i] - e) * z);
        x += ws[i] * z;
      });
      // Top scorers: gold in the middle and higher, silver left, bronze right.
      podium(ranking).forEach((r, i) =>
        text(
          `${[...'🥇🥈🥉'][i]} ${r.name} · ${r.goals} goal${r.goals > 1 ? 's' : ''}`,
          W / 2 + [0, -1, 1][i] * W * 0.32,
          e * (i ? 3.7 : 3.3),
          e,
          'center',
          r.color,
          W * 0.3,
        ),
      );
      // Full ranking by points, one or two columns; players who left are greyed.
      const y0 = e * 5;
      const room = H - y0 - e * 0.3;
      const [cols, rows] = grid(ranking.length, Math.floor(room / e / 0.9) - 1);
      const lh = Math.min(e * 1.4, room / (rows + 1));
      const cw = Math.min((W - e) / cols, e * 18);
      const nw = e * 2.4;
      for (let i = 0; i < cols * rows && i < ranking.length; i++) {
        const r = ranking[i];
        const x0 = W / 2 + cw * (Math.floor(i / rows) - cols / 2);
        const y = y0 + lh * ((i % rows) + 1);
        const right = (j: number) => x0 + cw - e / 2 - (2 - j) * nw;
        if (i % rows == 0) {
          ['Pts', 'Goals', 'Hits'].forEach((h, j) =>
            text(h, right(j), y0, e, 'right', '#fff8', nw - e / 3),
          );
        }
        c.globalAlpha = r.left ? 0.4 : 1;
        text(`${i + 1}. ${r.name}`, x0 + e / 2, y, e, 'left', r.color, cw - 3 * nw - e);
        [r.points, r.goals, r.hits].forEach((v, j) => text(v + '', right(j), y, e, 'right'));
        c.globalAlpha = 1;
      }
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
