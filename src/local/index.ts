// Contract only. Agent B implements it.
import type { SocketLike } from '../shared/types';

/**
 * Same-browser multiplayer: tabs of one origin play together over a
 * BroadcastChannel. One tab hosts the Room (elected with navigator.locks);
 * when it closes, another tab takes over.
 */
export const localSocket = (_room: string): SocketLike => {
  throw new Error('not implemented');
};
