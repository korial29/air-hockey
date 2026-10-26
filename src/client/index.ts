// Contract only. Agent C implements it.
import type { SocketLike } from '../shared/types';

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

/** Mounts the game in container (Shadow DOM + canvas) and joins. */
export const airHockey = (_container: HTMLElement, _opts: AirHockeyOptions): AirHockey => {
  throw new Error('not implemented');
};
