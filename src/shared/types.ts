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

export interface World {
  puck: Puck;
  paddles: Paddle[];
  score: [number, number];
}

/** What a snapshot carries: positions only, the client interpolates. */
export interface Snapshot {
  tick: number;
  score: [number, number];
  puck: { x: number; y: number };
  paddles: { id: number; x: number; y: number }[];
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
