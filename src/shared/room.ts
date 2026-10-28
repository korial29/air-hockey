import { layout, scene } from './arena';
import { MAX_NAME, MAX_PLAYERS, RULES, SNAP_EVERY, TICK_HZ } from './constants';
import { clampPaddle, createWorld, skate, spawnPoint, standing, step } from './physics';
import { decodeInput, encodeSnapshot, parseText } from './protocol';
import type { ClientText, ServerText } from './protocol';
import type {
  Arena,
  Conn,
  Every,
  Paddle,
  Phase,
  PlayerInfo,
  Rank,
  Rules,
  Team,
  World,
} from './types';

type Match = Extract<ServerText, { t: 'match' }>;

interface Player {
  conn: Conn;
  info: PlayerInfo;
  paddle: Paddle;
  /** Stats of the current match; absent until the player is part of one. */
  rank?: Rank;
}

/** Ticks run at most this many times per timer callback, so a stalled host does not spiral. */
const MAX_CATCH_UP = 20;

/** First n characters (code points) of s, trimmed. */
const cut = (s: string, n: number): string => Array.from(s).slice(0, n).join('').trim();

const cleanName = (raw: unknown): string =>
  cut(
    (typeof raw === 'string' ? raw : '')
      .replace(/\s+/g, ' ')
      .replace(/\p{Cc}/gu, '')
      .trim(),
    MAX_NAME,
  );

/** name, or name 2, name 3… (base cut to stay within MAX_NAME) when it is taken. */
const unique = (name: string, taken: string[]): string => {
  let out = name;
  for (let n = 2; taken.includes(out); n++) {
    out = `${cut(name, MAX_NAME - 1 - `${n}`.length)} ${n}`;
  }
  return out;
};

const fresh = (info: PlayerInfo): Rank => ({ ...info, points: 0, goals: 0, hits: 0 });
/** A new seed for the icebergs (vortices, whirlwinds), never 0 (the fixed layout). */
const seed = (): number => 1 + ((Math.random() * 0xfffffffe) >>> 0);
const idle = ({ goals, rounds }: Rules, { arena, size, count, seed }: World): Match => ({
  t: 'match',
  phase: 'wait',
  round: 0,
  wins: [0, 0],
  arena,
  size,
  count,
  seed,
  goals,
  rounds,
});

const setEvery: Every = (cb, ms) => {
  const id = setInterval(cb, ms);
  return () => clearInterval(id);
};

/**
 * One game, transport-agnostic. The Node server and the local host tab both
 * drive a Room: they feed it connections and frames, the room answers through Conn.send.
 */
export class Room {
  /** Every connected peer; null until it joins. */
  private peers = new Map<Conn, Player | null>();
  private world: World;
  /** Room ticks, frozen phases included: the snapshot cadence. */
  private ticks = 0;
  private halt: (() => void) | undefined;
  private rules: Rules;
  /** The match state, as broadcast. */
  private m: Match;
  /** Ticks left in 'ready', 'break' or 'end'. */
  private timer = 0;
  /** Last toucher of the puck; none after a serve or a goal. */
  private last: Player | undefined;
  /**
   * Everyone who played the current match, left ones included, in the order their points last
   * changed: the stable sort of the ranking then puts whoever reached a total first ahead.
   */
  private stats: Rank[] = [];

  /** Missing rules fall back to RULES. */
  public constructor(rules: Partial<Rules> = {}) {
    this.rules = { ...RULES, ...rules };
    // The rink of layout(0); fit() and next() move the world onto the one the players call for.
    this.world = this.empty();
    this.m = idle(this.rules, this.world);
  }

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
      [p.paddle.tx, p.paddle.ty] = clampPaddle(p.info.team, input.x, input.y, this.world.size);
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
    if (p.rank) {
      p.rank.left = true;
    }
    if (this.size) {
      this.roster();
    } else {
      // Last one out: the next game starts from 0-0.
      this.world = this.empty();
      this.ticks = 0;
    }
    if (!this.sync() && this.fit()) {
      this.go(this.m.phase);
    }
  }

  /** One physics step of 1 / TICK_HZ; a snapshot goes out every SNAP_EVERY ticks. */
  public tick(): void {
    if (!this.size) {
      return;
    }
    const { rules, m, world: w } = this;
    const { phase } = m;
    if (phase === 'ready') {
      // Countdown: the paddles get into position, the puck, the obstacles and w.tick wait.
      skate(w, 1 / TICK_HZ);
      if (--this.timer < 1) {
        this.go('play');
      }
    } else if (phase === 'break' || phase === 'end') {
      // Frozen: no physics, snapshots still go out.
      if (--this.timer < 1) {
        if (phase === 'break') {
          this.next();
        } else {
          this.sync(true);
        }
      }
    } else {
      const goal = step(w, 1 / TICK_HZ);
      // Counted in 'wait' too, on stale or missing ranks that nobody sees.
      const p = this.players().find(p => p.info.id === w.hit);
      if (p && p !== this.last) {
        this.add((this.last = p), rules.hit, 'hits');
      }
      if (goal !== -1) {
        // The last toucher scores, or pays for an own goal. Goals nobody touched count for nobody.
        if (this.last) {
          this.add(
            this.last,
            this.last.info.team === goal ? rules.goal : -rules.ownGoal,
            this.last.info.team === goal ? 'goals' : undefined,
          );
        }
        this.last = undefined;
        this.broadcast(
          JSON.stringify({ t: 'goal', team: goal, score: [...w.score] } satisfies ServerText),
        );
        if (phase === 'play' && w.score[goal] >= rules.goals) {
          // Round won. Every round is played, one scene each: after the last one the match goes
          // to the team with the most rounds won (on a tie, rounds being even, to the last
          // round's). Upset bonus: a smaller team that wins the match gets bigger / smaller times
          // the points.
          m.wins[goal]++;
          const end = m.round >= rules.rounds;
          const [a, b] = m.wins;
          const win = end && a != b ? (+(b > a) as Team) : goal;
          const n = this.teams();
          const k = Math.round(n[1 - win] / n[win]) || 1;
          this.players().forEach(p =>
            this.add(
              p,
              (p.info.team === goal ? rules.roundWin : 0) +
                (end && p.info.team === win ? rules.matchWin * k : 0),
            ),
          );
          this.timer = Math.round((end ? rules.endSec : rules.breakSec) * TICK_HZ);
          this.go(end ? 'end' : 'break', win);
        } else if (this.fit()) {
          // Served again with more or fewer players than the rink was made for.
          this.go(phase);
        }
      }
    }
    if (++this.ticks % SNAP_EVERY === 0) {
      // One buffer for everyone: transports must not mutate it. The world tick (u16 on the wire)
      // places the obstacles; it stands still in 'ready', 'break' and 'end', like the penguins.
      // Their state travels as ticks since removal, which survive the wrap.
      this.broadcast(
        encodeSnapshot({
          tick: w.tick,
          score: w.score,
          puck: w.puck,
          paddles: w.paddles,
          live: w.live,
          held: w.held,
          left: w.left,
          obs: w.obs.map(({ gone, cast = -1, ...o }) => ({
            ...o,
            since: gone < 0 ? -1 : w.tick - gone,
            cast: cast < 0 ? -1 : w.tick - cast,
          })),
        }),
      );
    }
  }

  /**
   * Drives tick() with a timer. An accumulator on performance.now() keeps the
   * simulation at TICK_HZ whatever the timer jitter; after a stall at most
   * MAX_CATCH_UP ticks are replayed and the rest of the backlog is dropped.
   * `every` replaces setInterval, e.g. with a Worker-backed timer that
   * background tabs do not throttle.
   */
  public start(every: Every = setEvery): void {
    if (this.halt) {
      return;
    }
    const dt = 1000 / TICK_HZ;
    let last = performance.now();
    let acc = 0;
    this.halt = every(() => {
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
    this.halt?.();
    this.halt = undefined;
  }

  /** A world on the rink of layout(0), in the first scene, for a room nobody joined yet. */
  private empty(): World {
    const { size, count } = layout(0);
    return createWorld(scene(this.rules.arena, 0), size, count, seed());
  }

  /** The scene of the current round: the first one while waiting. */
  private scene(): Arena {
    return scene(this.rules.arena, this.m.round);
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
    const n = this.teams();
    const team = n[1] < n[0] ? 1 : 0;
    // On the current rink; fit() may then respawn everyone on a new one (waiting, or puck served).
    const [x, y] = spawnPoint(team, n[team], this.world.size, standing(this.world));
    const paddle: Paddle = { id, team, x, y, vx: 0, vy: 0, tx: x, ty: y };
    const info: PlayerInfo = {
      id,
      // Two present players never share a name.
      name: unique(
        cleanName(name) || `Player ${id}`,
        players.map(p => p.info.name),
      ),
      color: `hsl(${Math.round((id * 137.508) % 360)} 80% 55%)`,
      team,
    };
    const player: Player = { conn, info, paddle };
    const { phase } = this.m;
    if (phase !== 'wait' && phase !== 'end') {
      // Back in the same match under the same name: the stats come back.
      let r = this.stats.find(r => r.left && r.name === info.name);
      if (r) {
        delete r.left;
      } else {
        this.stats.push((r = fresh(info)));
      }
      player.rank = Object.assign(r, info);
    }
    this.world.paddles.push(paddle);
    this.peers.set(conn, player);
    this.roster();
    if (!this.sync()) {
      if (this.fit()) {
        this.go(this.m.phase);
      } else {
        conn.send(this.told());
      }
    }
  }

  private add(p: Player | undefined, points: number, stat?: 'goals' | 'hits'): void {
    const r = p?.rank;
    // Gone players keep their points, and earn no more.
    if (r && !r.left) {
      if (stat) {
        r[stat]++;
      }
      if (points) {
        const s = this.stats;
        r.points += points;
        s.push(...s.splice(s.indexOf(r), 1));
      }
    }
  }

  /** Players per team. */
  private teams(): number[] {
    const n = [0, 0];
    this.world.paddles.forEach(p => n[p.team]++);
    return n;
  }

  /**
   * Starts a match once both teams have a player, drops back to 'wait' when one empties.
   * The final ranking stays up for endSec unless the room empties; `due` ends it.
   * Returns whether the phase changed.
   */
  private sync(due?: boolean): boolean {
    const [a, b] = this.teams();
    const { phase } = this.m;
    const on = a && b;
    if (!due && (on ? phase !== 'wait' : phase === 'wait' || (phase === 'end' && this.size))) {
      return false;
    }
    this.m = idle(this.rules, this.world);
    if (on) {
      this.stats = this.players().map(p => (p.rank = fresh(p.info)));
      this.next();
    } else {
      this.fit();
      this.go('wait');
    }
    return true;
  }

  /**
   * Moves the world onto the rink the joined players call for, in the scene of the round (the
   * first one while waiting), when that is fair: while waiting, during the countdown, or mid-round
   * while the puck waits at its serve spot (after a goal) and nobody has touched it yet. Paddles
   * respawn on it (see shape), the puck keeps its serve spot, scaled; the score stays, so does
   * the countdown. The icebergs (vortices) take a new place while waiting, keep the round's one
   * otherwise. The caller tells the clients.
   * Returns whether it did.
   */
  private fit(): boolean {
    const { size, count } = layout(this.size);
    const w = this.world;
    const { phase } = this.m;
    if (
      !(phase === 'wait' || phase === 'ready' || (phase === 'play' && !w.live)) ||
      (size === w.size && count === w.count && w.arena === this.scene())
    ) {
      return false;
    }
    const { x, y } = w.puck;
    const r = size / w.size;
    this.shape(w.score, phase === 'wait' ? seed() : w.seed);
    if (phase === 'play') {
      Object.assign(this.world.puck, { x: x * r, y: y * r });
    }
    return true;
  }

  /**
   * The world on the rink for the joined players (layout), in the scene of the round, at tick 0,
   * where no penguin stands on the centre spot: paddles back to their spawn points, puck served,
   * every obstacle back and intact (a fresh w.obs, sized to the new count), the icebergs (vortices)
   * placed by `seed`, score as given.
   * Returns the paddles per team.
   */
  private shape(score: [number, number], seed: number): number[] {
    const w = this.world;
    const { size, count } = layout(this.size);
    const n = [0, 0];
    const arena = this.scene();
    Object.assign(w, createWorld(arena, size, count, seed), { paddles: w.paddles, score });
    // Off the spots the icebergs of the round cover.
    const obs = standing(w);
    w.paddles.forEach(p => {
      [p.tx, p.ty] = [p.x, p.y] = spawnPoint(p.team, n[p.team]++, size, obs);
    });
    Object.assign(this.m, { arena, size, count, seed });
    this.last = undefined;
    return n;
  }

  /**
   * Next round, in its scene, on the rink for the players joined right now (set until the next
   * round), the icebergs (vortices) in a new place: paddles back to their spawn points, puck served,
   * head start for the smaller team, then the readySec countdown (none at 0) before play.
   */
  private next(): void {
    this.m.round++;
    const [a, b] = this.shape([0, 0], seed());
    const { goals, headStart, readySec } = this.rules;
    this.world.score[a < b ? 0 : 1] = Math.min(goals - 1, headStart * Math.abs(a - b));
    this.timer = Math.round(readySec * TICK_HZ);
    this.go(this.timer > 0 ? 'ready' : 'play');
  }

  /**
   * Phase change, broadcast. 'break' and 'end' carry the winner and the ranking at that time,
   * 'ready' the time left (see told).
   */
  private go(phase: Phase, winner?: Team): void {
    Object.assign(this.m, {
      phase,
      left: undefined,
      winner,
      ranking:
        winner === undefined
          ? winner
          : [...this.stats].sort(
              (a, b) => b.points - a.points || b.goals - a.goals || b.hits - a.hits,
            ),
    });
    this.broadcast(this.told());
  }

  /**
   * The match message as of now. In 'ready' it carries the ms left until play: a client counts
   * down from when it gets the message, a joiner mid-countdown included, all of them late by
   * their own latency only, like the 'play' message that ends it.
   */
  private told(): string {
    if (this.m.phase === 'ready') {
      this.m.left = Math.round((this.timer * 1000) / TICK_HZ);
    }
    return JSON.stringify(this.m);
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
