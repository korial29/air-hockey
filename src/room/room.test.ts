import { afterEach, describe, expect, it } from 'vitest';
import { decodeSnapshot } from '../shared/protocol';
import { RULES, Room } from './index';
import type { Conn } from './index';

describe('air-hockey/room', () => {
  let room: Room | undefined;
  afterEach(() => room?.stop());

  it('plays over any transport: a peer joins and gets the roster, then snapshots', async () => {
    room = new Room({ goals: 3 });
    const got: (string | ArrayBuffer)[] = [];
    const conn: Conn = { send: data => got.push(data) };
    room.connect(conn);
    room.start();
    room.receive(conn, JSON.stringify({ t: 'join', name: 'Ana' }));
    expect(room.size).toBe(1);
    const texts = got.filter((d): d is string => typeof d === 'string').map(d => JSON.parse(d));
    expect(texts[0]).toMatchObject({ t: 'roster', players: [{ name: 'Ana' }] });
    await new Promise(r => setTimeout(r, 50));
    const snap = got.find((d): d is ArrayBuffer => d instanceof ArrayBuffer);
    expect(decodeSnapshot(snap!)).toMatchObject({ paddles: [{}] });
    room.disconnect(conn);
    expect(room.size).toBe(0);
  });

  it('exports the default rules', () => {
    expect(RULES.goals).toBeGreaterThan(0);
  });
});
