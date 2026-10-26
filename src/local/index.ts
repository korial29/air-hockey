import { parseText } from '../shared/protocol';
import type { ClientText } from '../shared/protocol';
import { Room } from '../shared/room';
import type { Conn, Every, SocketLike } from '../shared/types';

type Data = string | ArrayBuffer;

/**
 * Channel message. kind: 'q' asks who hosts, 'h' announces the host,
 * 'm' carries a frame (to the host when `to` is absent), 'b' says bye to the host.
 */
interface Msg {
  from: string;
  to?: string;
  kind: 'q' | 'h' | 'm' | 'b';
  data?: Data;
}

/**
 * The host tab is often a hidden tab, and browsers throttle its setInterval to
 * ~1 Hz. A dedicated worker's timer is not throttled and its messages still
 * reach the hidden page. Falls back to setInterval when no worker can start
 * (no Worker, or a CSP without blob: in worker-src).
 */
const workerEvery: Every = (cb, ms) => {
  let stop = (): void => {};
  const fallback = (): void => {
    stop();
    const t = setInterval(cb, ms);
    stop = () => clearInterval(t);
  };
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`]));
    const w = new Worker(url);
    w.onmessage = cb;
    w.onerror = fallback;
    stop = () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    fallback();
  }
  return () => stop();
};

/**
 * Same-browser multiplayer: tabs of one origin play together over a
 * BroadcastChannel. One tab hosts the Room (elected with navigator.locks);
 * when it closes, another tab takes over with a fresh Room (score back to 0-0)
 * and every socket replays its join, so the client only sees a new roster.
 *
 * Without navigator.locks (old browsers, or a non-secure context such as plain
 * http on a LAN address) every tab hosts its own Room and plays alone.
 */
export const localSocket = (room: string): SocketLike => {
  const key = 'air-hockey:' + room;
  const id = Math.random().toString(36).slice(2);
  const ch = new BroadcastChannel(key);
  const abort = new AbortController();
  const locks = globalThis.navigator?.locks;
  /** Host side: the Room and one Conn per remote socket id. */
  let game: Room | undefined;
  let remotes: Map<string, Conn> | undefined;
  let release: (() => void) | undefined;
  /** Remote side: who hosts, and what was sent before anyone did. */
  let hostId: string | undefined;
  let queue: Data[] = [];
  let join: string | undefined;
  let closed = false;

  const post = (msg: Omit<Msg, 'from'>) => ch.postMessage({ from: id, ...msg });
  const deliver = (data: Data) => !closed && sock.onmessage?.({ data });
  // The host tab's own socket talks to the Room in memory, asynchronously like a WebSocket.
  const self: Conn = { send: data => queueMicrotask(() => deliver(data)) };
  /** What to replay to a new host: the frames nobody heard yet, else the last join. */
  const pending = (): Data[] => {
    const out = queue.length ? queue : join ? [join] : [];
    queue = [];
    return out;
  };

  const host = (done: () => void) => {
    if (closed) {
      return done();
    }
    release = done;
    hostId = id;
    remotes = new Map();
    game = new Room();
    game.start(workerEvery);
    game.connect(self);
    pending().forEach(d => game!.receive(self, d));
    post({ kind: 'h' });
  };

  ch.onmessage = ({ data: msg }: MessageEvent<Msg>) => {
    if (closed) {
      return;
    }
    if (game && remotes) {
      const { from, kind } = msg;
      let conn = remotes.get(from);
      if (kind === 'q') {
        post({ to: from, kind: 'h' });
      } else if (kind === 'm' && !msg.to) {
        if (!conn) {
          conn = { send: data => !closed && post({ to: from, kind: 'm', data }) };
          remotes.set(from, conn);
          game.connect(conn);
        }
        game.receive(conn, msg.data!);
      } else if (kind === 'b' && conn) {
        remotes.delete(from);
        game.disconnect(conn);
      }
    } else if (msg.to === id || !msg.to) {
      if (msg.kind === 'm' && msg.to) {
        deliver(msg.data!);
      } else if (msg.kind === 'h' && msg.from !== hostId) {
        // A new host: re-open with it, transparently for the client.
        hostId = msg.from;
        pending().forEach(data => post({ kind: 'm', data }));
      }
    }
  };

  const send = (data: Data) => {
    if (closed) {
      return;
    }
    if (typeof data === 'string' && parseText<ClientText>(data)?.t === 'join') {
      join = data;
    }
    if (game) {
      game.receive(self, data);
    } else if (hostId) {
      post({ kind: 'm', data });
    } else {
      queue.push(data);
    }
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    globalThis.removeEventListener?.('pagehide', close);
    if (game) {
      game.stop();
      release!();
    } else {
      post({ kind: 'b' });
      abort.abort();
    }
    ch.close();
    setTimeout(() => sock.onclose?.());
  };

  const sock: SocketLike = {
    binaryType: 'arraybuffer',
    onopen: null,
    onclose: null,
    onmessage: null,
    send,
    close,
  };

  if (locks) {
    // Held until close(): the next tab waiting on the lock becomes the host.
    locks.request(key, { signal: abort.signal }, () => new Promise<void>(host)).catch(() => {});
  } else {
    host(() => {});
  }
  post({ kind: 'q' });
  globalThis.addEventListener?.('pagehide', close);
  setTimeout(() => !closed && sock.onopen?.());
  return sock;
};
