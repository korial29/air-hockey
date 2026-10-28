import type { Rules } from './types';

// Field units. The table is landscape: team 0 defends the left goal, team 1 the right one.
export const W = 2000;
export const H = 1125;
/** Height of each goal mouth, centred on H / 2. */
export const GOAL = 380;

export const PUCK_R = 28;
/**
 * Radius of the crease, the half-disc in front of each goal, centred on its mouth: only one
 * defender in it stops the puck (see solid in physics.ts).
 */
export const CREASE = 300;
export const PADDLE_R = 75;

/** Units per second. */
export const PUCK_MAX_SPEED = 2400;
/** Fast enough to keep up with a quick mouse flick (about 3000 px/s on a laptop-sized table). */
export const PADDLE_MAX_SPEED = 7200;

/** Physics steps per second (fixed step, server or local host). */
export const TICK_HZ = 240;
/** A snapshot goes out every SNAP_EVERY ticks: 240 / 4 = 60 Hz. */
export const SNAP_EVERY = 4;
/**
 * Client render delay of the other paddles, interpolated between snapshots, in ms: about two
 * snapshot intervals. The puck and the own paddle are predicted, drawn in the present.
 */
export const INTERP_DELAY = 35;

/**
 * Network fixed point: a coordinate travels as round(v * SCALE) in a Uint16, so up to
 * 65535 / SCALE = 4095 units: the widest rink, W · MAX_SIZE, fits.
 */
export const SCALE = 16;

/** The rink grows with the players (see layout in arena.ts), up to this factor on each side. */
export const MAX_SIZE = 2;

/** Puck hits an iceberg takes before it shatters. A penguin goes on the first hit. */
export const ICEBERG_HP = 3;
/** Ticks from an obstacle's removal to its return in play (10 s). */
export const RESPAWN = 10 * TICK_HZ;
/** Its ghost shows, blocking nothing, for the last GHOST ticks before it returns (3 s). */
export const GHOST = 3 * TICK_HZ;
/** Ticks a genie's spell paralyses the paddle that shot the puck at it (5 s). */
export const STUN = 5 * TICK_HZ;

/** Default match rules. */
export const RULES: Rules = {
  arena: ['ice', 'sea', 'desert'],
  rounds: 3,
  goals: 5,
  hit: 1,
  goal: 20,
  roundWin: 10,
  matchWin: 30,
  headStart: 1,
  readySec: 3,
  breakSec: 3,
  endSec: 15,
};

export const MAX_PLAYERS = 16;
export const MAX_NAME = 16;
