import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeSnapshot } from '../shared/protocol';
import type { ServerText } from '../shared/protocol';
import { RULES } from '../shared/constants';
import { Room } from '../shared/room';
import type { Rules, SocketLike } from '../shared/types';
import { localSocket } from './index';

const until = async (check: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error('timed out');
    }
    await new Promise(r => setTimeout(r, 5));
  }
};

let rooms = 0;
const sockets: SocketLike[] = [];

/** A socket driven like the client does: join right after onopen. */
const player = (room: string, name: string, rules?: Partial<Rules>) => {
  const sock = localSocket(room, rules);
  sockets.push(sock);
  const texts: ServerText[] = [];
  const binaries: ArrayBuffer[] = [];
  let open = false;
  let closed = false;
  sock.onopen = () => {
    open = true;
    sock.send(JSON.stringify({ t: 'join', name }));
  };
  sock.onclose = () => (closed = true);
  sock.onmessage = ({ data }) =>
    typeof data === 'string' ? texts.push(JSON.parse(data)) : binaries.push(data);
  const roster = () => {
    const r = texts.filter(m => m.t === 'roster').pop();
    return r?.t === 'roster' ? r : undefined;
  };
  const names = () => roster()?.players.map(p => p.name) ?? [];
  return { sock, texts, binaries, roster, names, isOpen: () => open, isClosed: () => closed };
};

describe('localSocket', () => {
  afterEach(() => {
    sockets.splice(0).forEach(s => s.close());
    vi.unstubAllGlobals();
  });

  it('opens asynchronously', async () => {
    const a = player(`r${rooms++}`, 'a');
    expect(a.isOpen()).toBe(false);
    await until(a.isOpen);
  });

  it('plays two sockets together: rosters and snapshots', async () => {
    const room = `r${rooms++}`;
    const a = player(room, 'Ann');
    const b = player(room, 'Bob');
    await until(() => a.names().length === 2 && b.names().length === 2);
    expect(a.names()).toEqual(['Ann', 'Bob']);
    expect(a.roster()!.you).not.toBe(b.roster()!.you);

    await until(() => a.binaries.length > 0 && b.binaries.length > 0);
    expect(b.binaries[0]).toBeInstanceOf(ArrayBuffer);
    expect(decodeSnapshot(b.binaries.at(-1)!)?.paddles).toHaveLength(2);
  });

  it('keeps other rooms apart', async () => {
    const a = player(`r${rooms++}`, 'a');
    const b = player(`r${rooms++}`, 'b');
    await until(() => a.names().length === 1 && b.names().length === 1);
    await new Promise(r => setTimeout(r, 30));
    expect(a.names()).toEqual(['a']);
    expect(b.names()).toEqual(['b']);
  });

  it('hands over to the next socket when the host closes', async () => {
    const room = `r${rooms++}`;
    const a = player(room, 'host');
    await until(() => a.names().length === 1);
    const b = player(room, 'guest');
    await until(() => b.names().length === 2);

    a.sock.close();
    await until(a.isClosed);
    // b becomes the host, replays its join: a fresh roster with b alone.
    await until(() => b.names().join() === 'guest');
    const seen = b.binaries.length;
    await until(() => b.binaries.length > seen);

    // A newcomer joins the new host.
    const c = player(room, 'late');
    await until(() => b.names().length === 2 && c.names().length === 2);
    expect(c.names()).toEqual(['guest', 'late']);
  });

  it('removes a remote socket from the roster when it closes', async () => {
    const room = `r${rooms++}`;
    const a = player(room, 'a');
    await until(() => a.names().length === 1);
    const b = player(room, 'b');
    await until(() => a.names().length === 2);
    b.sock.close();
    await until(() => a.names().length === 1);
    expect(b.isClosed()).toBe(true);
  });

  it('closes on pagehide', async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (type: string, fn: () => void) => listeners.set(type, fn));
    vi.stubGlobal('removeEventListener', (type: string) => listeners.delete(type));
    const a = player(`r${rooms++}`, 'a');
    await until(() => a.names().length === 1);
    listeners.get('pagehide')!();
    await until(a.isClosed);
    expect(listeners.size).toBe(0);
  });

  it("gives the rules to the host's room", async () => {
    const connect = vi.spyOn(Room.prototype, 'connect');
    const a = player(`r${rooms++}`, 'a', { rounds: 5 });
    await until(() => a.names().length === 1);
    const room = connect.mock.contexts[0] as unknown as { rules: Rules };
    expect(room.rules).toEqual({ ...RULES, rounds: 5 });
    connect.mockRestore();
  });

  it('hosts alone without navigator.locks', async () => {
    vi.stubGlobal('navigator', {});
    const room = `r${rooms++}`;
    const a = player(room, 'a');
    const b = player(room, 'b');
    await until(() => a.names().length === 1 && b.names().length === 1);
    await new Promise(r => setTimeout(r, 30));
    expect(a.names()).toEqual(['a']);
    expect(b.names()).toEqual(['b']);
  });
});
