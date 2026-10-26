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

export type Arena = 'ice' | 'classic';

/** A round obstacle the puck bounces off like a pinball bumper. Paddles cannot cross it. */
export interface Obstacle {
  kind: 'iceberg' | 'penguin';
  x: number;
  y: number;
  r: number;
  /** Units per second: 0 for icebergs, the slide of a penguin. */
  vx: number;
  vy: number;
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
  /** Physics steps since the world was created; obstacles(arena, tick) gives the obstacles. */
  tick: number;
  /** Indices in obstacles(arena, tick) the puck touched during the last step. */
  bumps: number[];
  /**
   * False from each serve until a paddle touches the puck: obstacles let it through meanwhile,
   * so a penguin cannot start a round alone, let alone score.
   */
  live: boolean;
  puck: Puck;
  paddles: Paddle[];
  score: [number, number];
  /** Id of the paddle that touched the puck during the last step, -1 if none. */
  hit: number;
}

/** Match rules, set by the host. Defaults in constants.ts (RULES). */
export interface Rules {
  /** 'ice': icebergs and sliding penguins; 'classic': an empty rink. */
  arena: Arena;
  /** Rounds in a match; the first team to win a majority of them wins (3 → best of 3). */
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
  /** Pause after a round, in seconds. */
  breakSec: number;
  /** Time the final ranking stays on screen before a new match, in seconds. */
  endSec: number;
}

/**
 * wait: fewer than one player per team, free play, nothing counted.
 * play: a round is on. break: between rounds. end: final ranking shown.
 */
export type Phase = 'wait' | 'play' | 'break' | 'end';

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
