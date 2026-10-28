import { obstacles } from '../shared/arena';
import {
  GHOST,
  INTERP_DELAY,
  PADDLE_R,
  PUCK_R,
  RESPAWN,
  STUN,
  TICK_HZ,
  W,
} from '../shared/constants';
import { clampPaddle, solid } from '../shared/physics';
import { decodeSnapshot, encodeInput, parseText } from '../shared/protocol';
import type { ServerText } from '../shared/protocol';
import type { PlayerInfo, SocketLike, Team } from '../shared/types';
import { predict, rebase, reset, view } from './predict';
import {
  beacon,
  bolt,
  circle,
  countdown,
  doubloon,
  hud,
  obstacle,
  pen,
  rink,
  ruby,
  sand,
  snow,
  splash,
  stadium,
  streak,
  stunned,
  text,
  veil,
  waves,
} from './render';
import {
  CH,
  MIN_PADDLE_PX,
  MIN_PUCK_PX,
  TALL,
  TOP,
  WIDE,
  drawnR,
  frameOf,
  sample,
  toField,
} from './util';
import type { Stamped } from './util';

export type { Phase, PlayerInfo, Rank, SocketLike, Team } from '../shared/types';

/** Ticks a genie's bolt takes to fade out at the end of its spell. */
const ZAP = 72;

/** A puck let up by a vortex: its splash lasts RISE ms, the puck pops up in the first 60 %. */
const RISE = 700;

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
  // bounding rect stays the drawn area, which the pointer mapping relies on. A phone on its side
  // (a landscape screen at most 500 px high) gets the WIDE aspect instead: the frame follows it.
  root.innerHTML =
    `<style>div{position:relative}canvas{display:block;width:100%;aspect-ratio:${W}/${CH};touch-action:none;border-radius:16px}` +
    `button{position:absolute;right:1%;height:clamp(24px,9%,40px);top:calc(${(50 * TOP) / CH}% - clamp(12px,4.5%,20px));aspect-ratio:1;padding:0;border:0;border-radius:8px;background:#fff2;color:#fff;cursor:pointer}` +
    `button:hover{background:#fff4}button:focus-visible{outline:2px solid #fff}svg{width:70%;height:70%}` +
    `:host(:fullscreen){display:flex;align-items:center;justify-content:center;background:#08131d}` +
    `:host(:fullscreen) div{width:min(100vw,100vh * ${W / CH})}:host(:fullscreen) canvas{border-radius:0}` +
    `@media (orientation:landscape) and (max-height:500px){canvas{aspect-ratio:${WIDE.w}/${WIDE.h}}button{top:auto;bottom:2%}` +
    `:host(:fullscreen) div{width:min(100vw,100vh * ${WIDE.w / WIDE.h})}}` +
    // A phone held upright: the landscape rink would be a strip, the paddles too small to steer.
    `p{display:none;position:absolute;inset:0;margin:0;place-content:center;border-radius:16px;background:#08131de6;color:#fff;font:600 18px system-ui,sans-serif}` +
    `@media (orientation:portrait) and (pointer:coarse) and (max-width:600px){p{display:grid}}</style>` +
    `<div><canvas></canvas><button type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path/></svg></button><p>Turn your phone sideways</p></div>`;
  container.append(wrap);
  const canvas = root.querySelector('canvas')!;
  const c = canvas.getContext('2d');
  const button = root.querySelector('button')!;
  const path = root.querySelector('path')!;

  const listeners = new Set<Listener>();
  const emit = (event: AirHockeyEvent, payload?: unknown) =>
    listeners.forEach(([e, cb]) => (e == event ? cb(payload) : 0));

  const buf: Stamped[] = [];
  /** Where the rink sits on the canvas: TALL, or WIDE on a phone on its side (see the style). */
  let L = TALL;
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
  /** The vortex holding the puck last frame (-1: none), and when and where it let it up (ms). */
  let sunk = -1;
  let rose = -1e4;
  let spot = [0, 0];

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
      reset(P, m.phase, m.arena, m.size, m.count, m.seed);
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
        ...toField(e.clientX, e.clientY, canvas.getBoundingClientRect(), z, L),
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
  // In full screen a phone turns landscape where it can (Android); leaving unlocks it.
  const turn = () =>
    (screen.orientation as { lock?: (o: string) => Promise<void> } | undefined)?.lock?.(
      'landscape',
    );
  button.addEventListener(
    'click',
    () =>
      (full() ? document.exitFullscreen() : wrap.requestFullscreen().then(turn)).catch(() => {}),
    ac,
  );
  document.addEventListener('fullscreenchange', syncFull, ac);

  const ro = new ResizeObserver(() => {
    L = canvas.clientHeight ? frameOf(canvas.clientWidth / canvas.clientHeight) : TALL;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = (canvas.width * L.h) / L.w;
  });
  ro.observe(canvas);

  const draw = (c: CanvasRenderingContext2D, now: number) => {
    const k = canvas.width / L.w;
    const [x0, y0] = [k * L.x, k * L.y];
    // Font size in field units, never under 12 CSS px.
    const f = Math.max(35, (12 * devicePixelRatio) / k);
    // Rink size factor of the round, obstacles in play and their seed: the defaults before any
    // match message.
    const { size = 1, count = 7, seed = 0 } = match ?? {};
    pen(c, f, size);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.textBaseline = 'middle';
    c.fillStyle = '#08131d';
    c.fillRect(0, 0, L.w, L.h);
    // The rink, between the HUD bands: field coordinates from here on.
    c.setTransform(k, 0, 0, k, x0, y0);
    const arena = match?.arena ?? 'ice';
    const ice = arena == 'ice';
    const sea = arena == 'sea';
    const desert = arena == 'desert';
    rink(arena, k);
    if (sea) {
      waves(now);
    }
    if (desert) {
      sand(now);
    }
    // The world, W · size × H · size, on the same rink area: puck and paddles look smaller on a
    // bigger rink. Names keep their size on screen: g world units.
    c.setTransform(k / size, 0, 0, k / size, x0, y0);
    const g = f * size;
    // Puck and paddles never drawn under MIN_PUCK_PX and MIN_PADDLE_PX: CSS px per world unit.
    const px = k / devicePixelRatio / size;
    const pd = drawnR(PUCK_R, MIN_PUCK_PX, px);
    let pr = pd;
    const dr = drawnR(PADDLE_R, MIN_PADDLE_PX, px);

    const s = view(P, sample(buf, now - INTERP_DELAY), now, me);
    // Time of the puck's last contact with each obstacle; absent before prediction tracks it.
    const hits = P.hits;
    const tick = s?.tick ?? 0;
    // Times each one was removed: an iceberg comes back elsewhere, its ghost shows where.
    const ts = s?.obs?.map(o => o.times) ?? [];
    // A genie's spell, ticks since it struck (-1: none): it stands still, behind the tick by its lag.
    const spell = (i: number) => s?.obs?.[i]?.cast ?? -1;
    const all = obstacles(
      arena,
      tick,
      size,
      count,
      seed,
      ts,
      s?.obs?.map((o, i) => (o.lag ?? 0) + Math.max(0, spell(i))) ?? [],
    );
    all.forEach((o, i) => {
      // Absent: intact and in play. Removed: drawn from where it was then (one removal less),
      // ghost where it is now.
      const st = s?.obs?.[i];
      const since = st?.since ?? -1;
      if (since < 0 && was[i] >= 0) {
        back[i] = now;
      }
      was[i] = since;
      const then =
        since >= 0 && since < RESPAWN - GHOST
          ? obstacles(
              arena,
              tick - since,
              size,
              count,
              seed,
              ts.map((t = 0, j) => t - +(j == i)),
            )[i]
          : o;
      obstacle(o, i, now - (hits?.[i] ?? -1e9), now, st, now - (back[i] ?? -1e9), then);
    });
    if (s) {
      const { x, y, vx, vy } = s.puck;
      // At sea, what holds it takes it under: a vortex down its funnel, a shark into its belly.
      // Smaller as it nears the centre, out of sight there.
      const h = sea ? all[s.held ?? -1] : undefined;
      pr *= h ? Math.min(1, Math.hypot(x - h.x, y - h.y) / h.r) : 1;
      // Let up by a vortex: a splash where it surfaces, the puck popping up a little past its size.
      if (sunk >= 0 && !h) {
        rose = now;
        spot = [x, y];
      }
      sunk = h?.kind == 'vortex' ? s.held! : -1;
      const q = (now - rose) / RISE;
      if (q < 1) {
        const t = Math.min(1, q * 1.6) - 1;
        pr *= Math.max(0, 1 + 2.7 * t ** 3 + 1.7 * t ** 2);
      }
      // Top speeds scale with the rink: so does the speed that leaves a trail.
      streak(
        trail,
        x,
        y,
        Math.hypot(vx, vy) > 1000 * size,
        ice ? '#2a9df4' : desert ? '#e8384f' : '#fff',
        pr,
      );
      if (q < 1) {
        splash(spot[0], spot[1], pd, q);
      }
      // Out of sight: no puck, no beacon.
      if (pr) {
        beacon(x, y, pr, now);
        circle(x, y, pr, ice ? '#141a24' : '#fff');
        if (ice) {
          circle(x, y, pr * 0.75, '#2b3646');
        }
        if (sea) {
          doubloon(x, y, pr);
        }
        // The puck itself blinks toward a light yellow, in step with the beacon's glow.
        circle(x, y, pr, `rgba(255,214,90,${0.15 + 0.6 * (0.5 + 0.5 * Math.sin(now / 400))})`);
        // In the desert the ruby goes over it: the blink rings it like a gold setting.
        if (desert) {
          ruby(x, y, pr * 0.78);
        }
      }
      // The extra defenders in a crease are ghosts the puck goes through: see-through.
      const firm = solid(
        s.paddles.map(p => ({
          ...p,
          team: (players.get(p.id)?.team ?? +(p.x > (W * size) / 2)) as Team,
        })),
        size,
      ).map(p => p.id);
      for (const p of s.paddles) {
        const info = players.get(p.id);
        const { x, y } = p;
        c.globalAlpha = firm.includes(p.id) ? 1 : 0.35;
        circle(x, y, dr, info?.color ?? '#888');
        circle(x, y, dr / 2, '#0003');
        c.globalAlpha = 1;
        // Above the paddle, or below it against the top wall. At sea, over a dark shadow; dark on
        // the sand.
        const ny = y < dr + g ? y + dr + g / 2 : y - dr - g / 2;
        const name = info?.name ?? '';
        if (sea) {
          text(name, x + g / 14, ny + g / 14, g, 'center', '#000a');
        }
        text(name, x, ny, g, 'center', ice ? '#163049' : desert ? '#3b2410' : '#fff');
      }
      // Genie spells: the victim paralysed, its seconds left on it, a bolt from the genie all along
      // (fading out over the last ZAP ticks).
      all.forEach((o, i) => {
        const t = spell(i);
        const v = s.paddles.find(p => p.id == s.obs?.[i]?.victim);
        if (t >= 0 && v) {
          stunned(v.x, v.y, dr, 1 - t / STUN, Math.ceil((STUN - t) / TICK_HZ), now);
          bolt(o.x, o.y, v.x, v.y, Math.max(0, 1 - (STUN - t) / ZAP), now);
        }
      });
    }
    // Back to base rink coordinates: snow and veils cover the rink area whatever its size.
    c.setTransform(k, 0, 0, k, x0, y0);
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
    hud([...players.values()], you, s ? s.score.join(' : ') : '', label, match ?? {}, L == WIDE);
    if (phase == 'end' && !label) {
      // W × CH, scaled to the canvas height and centred: on WIDE, the bands still show the score,
      // the rink between them goes dark.
      c.fillStyle = '#08131d';
      c.fillRect(L.x, 0, L.w - 2 * L.x, L.h);
      const z = (k * L.h) / CH;
      c.setTransform(z, 0, 0, z, (k * L.w - z * W) / 2, 0);
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
