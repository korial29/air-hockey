import { MAX_NAME, MAX_PLAYERS, SNAP_EVERY, TICK_HZ } from './constants';
import { clampPaddle, createWorld, spawnPoint, step } from './physics';
import { decodeInput, encodeSnapshot, parseText } from './protocol';
import type { ClientText, ServerText } from './protocol';
import type { Conn, Paddle, PlayerInfo, World } from './types';

interface Player {
  conn: Conn;
  info: PlayerInfo;
  paddle: Paddle;
}

/** Ticks run at most this many times per timer callback, so a stalled host does not spiral. */
const MAX_CATCH_UP = 10;

const cleanName = (raw: unknown): string =>
  Array.from(
    (typeof raw === 'string' ? raw : '')
      .replace(/\s+/g, ' ')
      .replace(/\p{Cc}/gu, '')
      .trim(),
  )
    .slice(0, MAX_NAME)
    .join('')
    .trim();

/**
 * One game, transport-agnostic. The Node server and the local host tab both
 * drive a Room: they feed it connections and frames, the room answers through Conn.send.
 */
export class Room {
  /** Every connected peer; null until it joins. */
  private peers = new Map<Conn, Player | null>();
  private world: World = createWorld();
  private ticks = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  /** Number of joined players. */
  public get size(): number {
    return this.players().length;
  }

  /** A peer opened. Nothing is sent until it joins. */
  public connect(conn: Conn): void {
    this.peers.set(conn, null);
  }

  /** A text (JSON) or binary frame from a peer. */
  public receive(conn: Conn, data: string | ArrayBuffer): void {
    const p = this.peers.get(conn);
    if (typeof data === 'string') {
      const msg = parseText<ClientText>(data);
      if (p === null && msg?.t === 'join') {
        this.join(conn, msg.name);
      }
      return;
    }
    const input = p && decodeInput(data);
    if (input) {
      [p.paddle.tx, p.paddle.ty] = clampPaddle(p.info.team, input.x, input.y);
    }
  }

  /** A peer left: its paddle goes, the roster goes out again. */
  public disconnect(conn: Conn): void {
    const p = this.peers.get(conn);
    this.peers.delete(conn);
    if (!p) {
      return;
    }
    const w = this.world;
    w.paddles = w.paddles.filter(q => q !== p.paddle);
    if (this.size) {
      this.roster();
    } else {
      // Last one out: the next game starts from 0-0.
      this.world = createWorld();
      this.ticks = 0;
    }
  }

  /** One physics step of 1 / TICK_HZ; a snapshot goes out every SNAP_EVERY ticks. */
  public tick(): void {
    if (!this.size) {
      return;
    }
    const w = this.world;
    const goal = step(w, 1 / TICK_HZ);
    if (goal !== -1) {
      this.broadcast(
        JSON.stringify({ t: 'goal', team: goal, score: [...w.score] } satisfies ServerText),
      );
    }
    if (++this.ticks % SNAP_EVERY === 0) {
      // One buffer for everyone: transports must not mutate it.
      this.broadcast(
        encodeSnapshot({ tick: this.ticks, score: w.score, puck: w.puck, paddles: w.paddles }),
      );
    }
  }

  /**
   * Drives tick() with a timer. An accumulator on performance.now() keeps the
   * simulation at TICK_HZ whatever the timer jitter; after a stall at most
   * MAX_CATCH_UP ticks are replayed and the rest of the backlog is dropped.
   */
  public start(): void {
    if (this.timer) {
      return;
    }
    const dt = 1000 / TICK_HZ;
    let last = performance.now();
    let acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      for (let n = 0; acc >= dt && n < MAX_CATCH_UP; n++) {
        this.tick();
        acc -= dt;
      }
      acc %= dt;
    }, dt);
  }

  public stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private players(): Player[] {
    return [...this.peers.values()].filter(p => p !== null);
  }

  private broadcast(data: string | ArrayBuffer): void {
    this.players().forEach(p => p.conn.send(data));
  }

  private join(conn: Conn, name: unknown): void {
    const players = this.players();
    if (players.length >= MAX_PLAYERS) {
      conn.send(JSON.stringify({ t: 'full' } satisfies ServerText));
      return;
    }
    // Smallest free id. It doubles as the colour slot: both are freed on leave.
    let id = 0;
    while (players.some(p => p.info.id === id)) {
      id++;
    }
    const n0 = players.filter(p => p.info.team === 0).length;
    const team = players.length - n0 < n0 ? 1 : 0;
    const [x, y] = spawnPoint(team, team ? players.length - n0 : n0);
    const paddle: Paddle = { id, team, x, y, vx: 0, vy: 0, tx: x, ty: y };
    const info: PlayerInfo = {
      id,
      name: cleanName(name) || `Player ${id}`,
      color: `hsl(${Math.round((id * 137.508) % 360)} 80% 55%)`,
      team,
    };
    this.world.paddles.push(paddle);
    this.peers.set(conn, { conn, info, paddle });
    this.roster();
  }

  /** Each joined peer gets the full roster with its own id. */
  private roster(): void {
    const players = this.players();
    const list = players.map(p => p.info).sort((a, b) => a.id - b.id);
    players.forEach(p =>
      p.conn.send(
        JSON.stringify({ t: 'roster', you: p.info.id, players: list } satisfies ServerText),
      ),
    );
  }
}
