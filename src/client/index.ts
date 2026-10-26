import { obstacles } from '../shared/arena';
import { GHOST, INTERP_DELAY, PADDLE_R, PUCK_R, RESPAWN, W } from '../shared/constants';
import { clampPaddle } from '../shared/physics';
import { decodeSnapshot, encodeInput, parseText } from '../shared/protocol';
import type { ServerText } from '../shared/protocol';
import type { PlayerInfo, SocketLike } from '../shared/types';
import { predict, rebase, reset, view } from './predict';
import {
  beacon,
  circle,
  countdown,
  hud,
  obstacle,
  pen,
  rink,
  snow,
  stadium,
  streak,
  text,
  veil,
} from './render';
import { CH, MIN_PADDLE_PX, MIN_PUCK_PX, TOP, drawnR, sample, toField } from './util';
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
  /** Full screen button in the top band, where the browser allows it. Default true. */
  fullscreen?: boolean;
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
  // The canvas keeps its W × CH aspect in full screen too, centred on the dark background: its
  // bounding rect stays the drawn area, which the pointer mapping relies on.
  root.innerHTML =
    `<style>div{position:relative}canvas{display:block;width:100%;aspect-ratio:${W}/${CH};touch-action:none;border-radius:16px}` +
    `button{position:absolute;right:1%;height:clamp(24px,9%,40px);top:calc(${(50 * TOP) / CH}% - clamp(12px,4.5%,20px));aspect-ratio:1;padding:0;border:0;border-radius:8px;background:#fff2;color:#fff;cursor:pointer}` +
    `button:hover{background:#fff4}button:focus-visible{outline:2px solid #fff}svg{width:70%;height:70%}` +
    `:host(:fullscreen){display:flex;align-items:center;justify-content:center;background:#08131d}` +
    `:host(:fullscreen) div{width:min(100vw,100vh * ${W / CH})}:host(:fullscreen) canvas{border-radius:0}</style>` +
    `<div><canvas></canvas><button type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path/></svg></button></div>`;
  container.append(wrap);
  const canvas = root.querySelector('canvas')!;
  const c = canvas.getContext('2d');
  const button = root.querySelector('button')!;
  const path = root.querySelector('path')!;

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
  /** Countdown: when play starts (ms), from the 'ready' message; when it did, from 'play'. */
  let goAt = 0;
  let playAt = -1e4;
  let msg = '';
  let raf = 0;
  let dead = false;
  let match: MatchState | undefined;
  /** Last puck positions drawn, for its trail. */
  const trail: number[] = [];
  /** Per obstacle: Snapshot.obs since drawn last frame, and when it came back in play (ms). */
  const was: number[] = [];
  const back: number[] = [];

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
      const now = performance.now();
      // 'ready' says how long is left as of sending: a joiner mid-countdown counts from there too.
      if (m.phase == 'ready') {
        goAt = now + (m.left ?? 0);
      }
      // The countdown ends where the paddles got to: the pointer stays the target.
      const go = m.phase == 'play' && match?.phase == 'ready';
      if (go) {
        playAt = now;
      } else {
        // The host puts paddles back on their spawn points at round start: drop the prediction
        // until the pointer moves again, or our paddle would be drawn where it no longer is.
        me = undefined;
      }
      reset(P, m.phase, m.arena, m.size, m.count);
      emit('match', (match = rest));
    } else if (m?.t == 'full') {
      msg = 'Room is full';
    }
  };

  const ac = new AbortController();
  const onPointer = (e: PointerEvent) => {
    const team = players.get(you)?.team;
    if (team != null) {
      const z = P.w.size;
      me = clampPaddle(
        team,
        ...toField(e.clientX, e.clientY, canvas.getBoundingClientRect(), z),
        z,
      );
      dirty = true;
    }
  };
  canvas.addEventListener('pointermove', onPointer, ac);
  canvas.addEventListener('pointerdown', onPointer, ac);

  // Full screen on the wrapper: Escape or the button again leaves it.
  const full = () => document.fullscreenElement == wrap;
  const syncFull = () => {
    button.setAttribute('aria-label', full() ? 'Exit full screen' : 'Full screen');
    path.setAttribute(
      'd',
      full() ? 'M9 4v5H4m16 0h-5V4m0 16v-5h5M4 15h5v5' : 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5',
    );
  };
  syncFull();
  button.hidden = opts.fullscreen == false || !document.fullscreenEnabled;
  button.addEventListener(
    'click',
    () => (full() ? document.exitFullscreen() : wrap.requestFullscreen()).catch(() => {}),
    ac,
  );
  document.addEventListener('fullscreenchange', syncFull, ac);

  const ro = new ResizeObserver(() => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = (canvas.width * CH) / W;
  });
  ro.observe(canvas);

  const draw = (c: CanvasRenderingContext2D, now: number) => {
    const k = canvas.width / W;
    // Font size in field units, never under 12 CSS px.
    const f = Math.max(35, (12 * devicePixelRatio) / k);
    // Rink size factor of the round and obstacles in play: the defaults before any match message.
    const { size = 1, count = 7 } = match ?? {};
    pen(c, f, size);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.textBaseline = 'middle';
    c.fillStyle = '#08131d';
    c.fillRect(0, 0, W, CH);
    // The rink, between the HUD bands: field coordinates from here on.
    c.setTransform(k, 0, 0, k, 0, k * TOP);
    const arena = match?.arena ?? 'ice';
    const ice = arena == 'ice';
    rink(ice, k);
    // The world, W · size × H · size, on the same rink area: puck and paddles look smaller on a
    // bigger rink. Names keep their size on screen: g world units.
    c.setTransform(k / size, 0, 0, k / size, 0, k * TOP);
    const g = f * size;
    // Puck and paddles never drawn under MIN_PUCK_PX and MIN_PADDLE_PX: CSS px per world unit.
    const px = k / devicePixelRatio / size;
    const pr = drawnR(PUCK_R, MIN_PUCK_PX, px);
    const dr = drawnR(PADDLE_R, MIN_PADDLE_PX, px);

    const s = view(P, sample(buf, now - INTERP_DELAY), now, me);
    // Time of the puck's last contact with each obstacle; absent before prediction tracks it.
    const hits = P.hits;
    const tick = s?.tick ?? 0;
    obstacles(arena, tick, size, count).forEach((o, i) => {
      // Absent: intact and in play. Removed: drawn from where it was then, ghost where it is now.
      const st = s?.obs?.[i];
      const since = st?.since ?? -1;
      if (since < 0 && was[i] >= 0) {
        back[i] = now;
      }
      was[i] = since;
      obstacle(
        o,
        i,
        now - (hits?.[i] ?? -1e9),
        now,
        st,
        now - (back[i] ?? -1e9),
        since >= 0 && since < RESPAWN - GHOST ? obstacles(arena, tick - since, size, count)[i] : o,
      );
    });
    if (s) {
      const { x, y, vx, vy } = s.puck;
      // Top speeds scale with the rink: so does the speed that leaves a trail.
      streak(trail, x, y, Math.hypot(vx, vy) > 1000 * size, ice ? '#2a9df4' : '#fff', pr);
      beacon(x, y, pr, now);
      circle(x, y, pr, ice ? '#141a24' : '#fff');
      if (ice) {
        circle(x, y, pr * 0.75, '#2b3646');
      }
      for (const p of s.paddles) {
        const info = players.get(p.id);
        const { x, y } = p;
        circle(x, y, dr, info?.color ?? '#888');
        circle(x, y, dr / 2, '#0003');
        // Above the paddle, or below it against the top wall.
        text(
          info?.name ?? '',
          x,
          y < dr + g ? y + dr + g / 2 : y - dr - g / 2,
          g,
          'center',
          ice ? '#163049' : '#fff',
        );
      }
    }
    // Back to base rink coordinates: snow and veils cover the rink area whatever its size.
    c.setTransform(k, 0, 0, k, 0, k * TOP);
    if (ice) {
      snow(now);
    }
    const { phase, winner, ranking = [] } = match ?? {};
    // Countdown over the rink: 3, 2, 1, one second each, then PLAY! for 600 ms.
    if (phase == 'ready') {
      const t = (goAt - now) / 1000;
      const n = Math.max(1, Math.ceil(t));
      countdown(n + '', Math.min(1, n - t));
    } else if (phase == 'play' && now - playAt < 600) {
      countdown('PLAY!', (now - playAt) / 600, '#fc3');
    }
    const label = msg || (open ? '' : 'Connecting…');
    const a = 1 - (now - goalAt) / 600;
    if (a > 0 && phase != 'break' && phase != 'end') {
      veil(`rgba(255,204,51,${a / 2})`, 'GOAL!');
    }
    if (label || phase == 'break') {
      veil('#000a');
    }
    c.setTransform(k, 0, 0, k, 0, 0);
    hud([...players.values()], you, s ? s.score.join(' : ') : '', label, match ?? {});
    if (phase == 'end' && !label) {
      stadium(ranking, winner, now);
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
