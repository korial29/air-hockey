import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { Room } from '../shared/room';
import type { Conn } from '../shared/types';

export interface ServeOptions {
  /** Listen on this port (ignored when server is given). */
  port?: number;
  /** Attach to an existing HTTP server instead. */
  server?: Server;
}

/** `/demo` → "demo", `/` → "default". Undecodable paths are kept as is. */
const roomName = (url = '/'): string => {
  const path = new URL(url, 'http://x').pathname.slice(1);
  let name = path;
  try {
    name = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  return name.slice(0, 64) || 'default';
};

/**
 * Starts the WebSocket server: one Room per URL path. Returns an idempotent stop
 * function that closes every socket, room, the WebSocketServer, and the HTTP
 * server only when serve created it (`{ port }`).
 */
export const serve = (opts: ServeOptions): (() => Promise<void>) => {
  const wss = new WebSocketServer({
    ...(opts.server ? { server: opts.server } : { port: opts.port }),
    // Inputs are 5 bytes and joins a few dozen: anything bigger is abuse.
    maxPayload: 1024,
  });
  const rooms = new Map<string, { room: Room; conns: number }>();

  wss.on('connection', (ws, req) => {
    const name = roomName(req.url);
    // Rooms are dropped as soon as they empty, so conns === 0 means a new one.
    const entry = rooms.get(name) ?? { room: new Room(), conns: 0 };
    const { room } = entry;
    if (!entry.conns++) {
      rooms.set(name, entry);
      room.start();
    }
    const conn: Conn = {
      send: data => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      },
    };
    room.connect(conn);

    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      // Copy the exact bytes: a Buffer is often a view into a larger pooled ArrayBuffer.
      room.receive(conn, isBinary ? new Uint8Array(buf).buffer : buf.toString());
    });
    ws.on('error', () => {
      // 'close' follows; nothing else to do.
    });
    ws.on('close', () => {
      room.disconnect(conn);
      if (!--entry.conns && rooms.get(name) === entry) {
        room.stop();
        rooms.delete(name);
      }
    });
  });

  let stopping: Promise<void> | undefined;
  return () =>
    (stopping ??= new Promise<void>((resolve, reject) => {
      wss.clients.forEach(ws => ws.terminate());
      rooms.forEach(({ room }) => room.stop());
      rooms.clear();
      wss.close(err => (err ? reject(err) : resolve()));
    }));
};
