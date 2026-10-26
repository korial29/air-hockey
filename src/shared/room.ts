// Contract only. Agent B implements it.
import type { Conn } from './types';

/**
 * One game, transport-agnostic. The Node server and the local host tab both
 * drive a Room: they feed it connections and frames, the room answers through Conn.send.
 */
export class Room {
  /** Number of joined players. */
  public get size(): number {
    throw new Error('not implemented');
  }

  /** A peer opened. Nothing is sent until it joins. */
  public connect(_conn: Conn): void {
    throw new Error('not implemented');
  }

  /** A text (JSON) or binary frame from a peer. */
  public receive(_conn: Conn, _data: string | ArrayBuffer): void {
    throw new Error('not implemented');
  }

  /** A peer left: its paddle goes, the roster goes out again. */
  public disconnect(_conn: Conn): void {
    throw new Error('not implemented');
  }

  /** One physics step of 1 / TICK_HZ; a snapshot goes out every SNAP_EVERY ticks. */
  public tick(): void {
    throw new Error('not implemented');
  }

  /** Drives tick() with a timer. */
  public start(): void {
    throw new Error('not implemented');
  }

  public stop(): void {
    throw new Error('not implemented');
  }
}
