import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { decodeSnapshot, encodeInput } from '../shared/protocol';
import type { ServerText } from '../shared/protocol';
import { RULES } from '../shared/constants';
import { Room } from '../shared/room';
import type { Rules } from '../shared/types';
import { serve } from './index';

const until = async (check: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error('timed out');
    }
    await new Promise(r => setTimeout(r, 5));
  }
};

describe('serve', () => {
  let http: Server;
  let stop: () => Promise<void>;
  let port: number;
  const sockets: WebSocket[] = [];

  const client = (path: string, name: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    sockets.push(ws);
    ws.binaryType = 'arraybuffer';
    const texts: ServerText[] = [];
    const binaries: ArrayBuffer[] = [];
    let closed = false;
    ws.on('message', (data, isBinary) =>
      isBinary ? binaries.push(data as ArrayBuffer) : texts.push(JSON.parse(String(data))),
    );
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name })));
    ws.on('error', () => {});
    ws.on('close', () => (closed = true));
    const roster = () => {
      const r = texts.filter(m => m.t === 'roster').pop();
      return r?.t === 'roster' ? r : undefined;
    };
    const names = () => roster()?.players.map(p => p.name) ?? [];
    return { ws, texts, binaries, roster, names, closed: () => closed };
  };

  beforeEach(async () => {
    http = createServer();
    await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
    port = (http.address() as AddressInfo).port;
    stop = serve({ server: http });
  });

  afterEach(async () => {
    sockets.splice(0).forEach(ws => ws.terminate());
    await stop();
    await new Promise(r => http.close(r));
    vi.restoreAllMocks();
  });

  it('joins two clients in one room: roster, snapshots, inputs', async () => {
    const a = client('/demo', 'Ann');
    const b = client('/demo', 'Bob');
    await until(() => a.names().length === 2 && b.names().length === 2);
    expect(a.names().sort()).toEqual(['Ann', 'Bob']);
    const { you, players } = a.roster()!;
    expect(b.roster()!.you).not.toBe(you);

    await until(() => a.binaries.length > 0 && b.binaries.length > 0);
    expect(decodeSnapshot(a.binaries.at(-1)!)?.paddles).toHaveLength(2);

    // A binary input travels through the Buffer → ArrayBuffer copy and moves the paddle.
    const target = { x: players.find(p => p.id === you)!.team ? 1300 : 300, y: 700 };
    a.ws.send(encodeInput(target.x, target.y));
    await until(() => {
      const p = decodeSnapshot(a.binaries.at(-1)!)?.paddles.find(q => q.id === you);
      return !!p && Math.hypot(p.x - target.x, p.y - target.y) < 2;
    });
  });

  it('uses one room per path', async () => {
    const a = client('/demo', 'a');
    const b = client('/other', 'b');
    const c = client('/', 'c');
    const d = client('/demo?x=1', 'd');
    await until(() => [a, b, c].every(x => x.roster()) && a.names().length === 2);
    expect(a.names().sort()).toEqual(['a', 'd']);
    expect(b.names()).toEqual(['b']);
    expect(c.names()).toEqual(['c']);
    expect(d.names().sort()).toEqual(['a', 'd']);
  });

  it('stops and drops a room when its last client leaves', async () => {
    const roomStop = vi.spyOn(Room.prototype, 'stop');
    const a = client('/demo', 'a');
    const b = client('/demo', 'b');
    await until(() => a.names().length === 2);
    b.ws.close();
    await until(() => a.names().length === 1);
    expect(roomStop).not.toHaveBeenCalled();
    a.ws.close();
    await until(() => roomStop.mock.calls.length === 1);

    // A newcomer gets a fresh room.
    const c = client('/demo', 'c');
    await until(() => c.names().length === 1);
    expect(c.names()).toEqual(['c']);
  });

  it('stop() closes the sockets and the ws server, not a server it did not create', async () => {
    const a = client('/demo', 'a');
    await until(() => a.roster() !== undefined);
    const roomStop = vi.spyOn(Room.prototype, 'stop');
    await stop();
    await until(a.closed);
    expect(roomStop).toHaveBeenCalled();
    expect(http.listening).toBe(true);

    // Upgrades are no longer handled, and a second stop is harmless.
    expect(http.listenerCount('upgrade')).toBe(0);
    await expect(stop()).resolves.toBeUndefined();
  });

  it('gives the rules to every room', async () => {
    await stop();
    stop = serve({ server: http, rules: { goals: 3 } });
    const connect = vi.spyOn(Room.prototype, 'connect');
    const a = client('/a', 'a');
    const b = client('/b', 'b');
    await until(() => !!a.roster() && !!b.roster());
    const rules = connect.mock.contexts.map(r => (r as unknown as { rules: Rules }).rules);
    expect(rules).toEqual([
      { ...RULES, goals: 3 },
      { ...RULES, goals: 3 },
    ]);
    expect(a.texts.at(-1)).toEqual({ t: 'match', phase: 'wait', round: 0, wins: [0, 0] });
  });

  it('closes the HTTP server it created', async () => {
    const own = serve({ port: 0 });
    await expect(own()).resolves.toBeUndefined();
  });
});
