// Contract only. Agent B implements it.
import type { Server } from 'node:http';

export interface ServeOptions {
  /** Listen on this port (ignored when server is given). */
  port?: number;
  /** Attach to an existing HTTP server instead. */
  server?: Server;
}

/** Starts the WebSocket server: one Room per URL path. Returns a stop function. */
export const serve = (_opts: ServeOptions): (() => Promise<void>) => {
  throw new Error('not implemented');
};
