export type Team = 0 | 1;

export interface PlayerInfo {
  id: number;
  name: string;
  /** CSS colour, unique within the room. */
  color: string;
  team: Team;
}

export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Paddle {
  id: number;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Target the player is pointing at; the paddle moves toward it at PADDLE_MAX_SPEED. */
  tx: number;
  ty: number;
}

/**
 * The scene of a round. 'ice': icebergs and sliding penguins. 'sea' (sea and pirates): vortices and
 * sharks swimming in zig-zag, wooden goals. 'desert' (an Arabian Nights desert): whirlwinds of sand
 * and floating genies, Moorish arches for goals. 'classic': an empty rink.
 */
export type Arena = 'ice' | 'sea' | 'desert' | 'classic';

/**
 * A round obstacle the puck bounces off like a pinball bumper, unless it grabs it (whirlwind,
 * vortex, shark). Paddles cannot cross it.
 */
export interface Obstacle {
  /**
   * Fixed ones (iceberg, vortex, whirlwind) break after ICEBERG_HP hits; penguins and genies on
   * one; sharks never.
   */
  kind: 'iceberg' | 'penguin' | 'vortex' | 'shark' | 'whirlwind' | 'genie';
  x: number;
  y: number;
  r: number;
  /** Units per second: 0 for the fixed ones, the slide of a penguin, a shark's swim, a genie's float. */
  vx: number;
  vy: number;
}

/** What happened to an obstacle. Only the puck damages obstacles, and only once it is live. */
export interface ObstacleState {
  /** Puck hits taken: an iceberg shatters at ICEBERG_HP, a penguin is shot out at 1. */
  hits: number;
  /**
   * Tick it was removed at (shattered or shot out), -1 while in play. It is a ghost from
   * gone + RESPAWN - GHOST and back in play, intact, at gone + RESPAWN.
   */
  gone: number;
  /** Direction the puck sent it, radians: a shot-out penguin flies this way. */
  angle: number;
  /**
   * Times it was removed this round (absent: 0), up to 255 then 0 again: an iceberg (vortex,
   * whirlwind) comes back somewhere else in its band each time (see obstacles in arena.ts).
   */
  times?: number;
}

export interface World {
  arena: Arena;
  /**
   * Rink size factor on each side, 1 to MAX_SIZE: the rink is W · size × H · size, the goals
   * GOAL · size, top speeds scale too. Puck and paddle radii do not. Set at round start.
   */
  size: number;
  /** How many obstacles of the arena are in play (see obstacles). Set at round start. */
  count: number;
  /** Places the icebergs (vortices, whirlwinds) across the width (see obstacles); 0: the fixed one. */
  seed: number;
  /**
   * Physics steps since the world was created; obstacles(arena, tick, size, count, seed) gives the
   * obstacles.
   */
  tick: number;
  /** Indices in obstacles(arena, tick) the puck touched during the last step. */
  bumps: number[];
  /**
   * False from each serve until a paddle touches the puck: obstacles let it through meanwhile,
   * so a penguin cannot start a round alone, let alone score.
   */
  live: boolean;
  /**
   * Index of the obstacle holding the puck (a whirlwind, a vortex or a shark, see twirl in
   * physics.ts), -1 when none does.
   */
  held: number;
  /** Seconds until it lets go. */
  left: number;
  /**
   * State of each obstacle in play, indexed like obstacles(arena, tick, size, count, seed).
   * Reset at round start (every obstacle back, intact).
   */
  obs: ObstacleState[];
  puck: Puck;
  paddles: Paddle[];
  score: [number, number];
  /** Id of the paddle that touched the puck during the last step, -1 if none. */
  hit: number;
}

/** Match rules, set by the host. Defaults in constants.ts (RULES). */
export interface Rules {
  /**
   * The scene, or scenes taking turns from one round to the next (round 1 the first, round 2 the
   * second, then round again). Default ['ice', 'sea', 'desert'].
   */
  arena: Arena | Arena[];
  /**
   * Rounds in a match, all of them played (one scene each): the team that wins the most wins the
   * match, the last round's winner on a tie.
   */
  rounds: number;
  /** Goals that win a round. */
  goals: number;
  /** Points for a hit, counted only when the previous toucher was someone else or the puck was re-served. */
  hit: number;
  /** Points for the last toucher of a goal, unless it is an own goal. */
  goal: number;
  /** Points for each player of the team that wins a round. */
  roundWin: number;
  /** Points for each player of the team that wins the match. */
  matchWin: number;
  /** Uneven teams: the smaller team starts each round with headStart goals per missing player. */
  headStart: number;
  /** Countdown before each round, in seconds: paddles move, the puck waits. 0: none. */
  readySec: number;
  /** Pause after a round, in seconds. */
  breakSec: number;
  /** Time the final ranking stays on screen before a new match, in seconds. */
  endSec: number;
}

/**
 * wait: fewer than one player per team, free play, nothing counted.
 * ready: countdown before a round: paddles move, the puck and the obstacles wait.
 * play: a round is on. break: between rounds. end: final ranking shown.
 */
export type Phase = 'wait' | 'ready' | 'play' | 'break' | 'end';

/** One line of the individual ranking. */
export interface Rank {
  id: number;
  name: string;
  color: string;
  team: Team;
  points: number;
  goals: number;
  hits: number;
  /** Left during the match: keeps its points, gets no win bonus. */
  left?: boolean;
}

/**
 * What a snapshot carries: positions, plus the puck velocity so the client can simulate it
 * forward. Paddles are interpolated.
 */
export interface Snapshot {
  tick: number;
  score: [number, number];
  puck: Puck;
  paddles: { id: number; x: number; y: number }[];
  /** World.live: the puck reacts to obstacles. */
  live?: boolean;
  /** World.held and World.left: the obstacle holding the puck and for how long still. */
  held?: number;
  left?: number;
  /**
   * World.obs on the wire, with `gone` as ticks since removal (or -1), so it survives the u16 tick
   * wrap: { hits, since, angle } per obstacle in play.
   */
  obs?: { hits: number; since: number; angle: number; times?: number }[];
}

/**
 * The subset of WebSocket the client relies on. A real WebSocket (with
 * binaryType 'arraybuffer') and the local BroadcastChannel socket both fit.
 */
export interface SocketLike {
  binaryType: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

/** Calls cb every ms milliseconds until the returned function is called. */
export type Every = (cb: () => void, ms: number) => () => void;

/** One connected peer, as the room sees it. Transport-agnostic. */
export interface Conn {
  send(data: string | ArrayBuffer): void;
}
