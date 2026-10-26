import type { Rules } from './types';

// Field units. The table is landscape: team 0 defends the left goal, team 1 the right one.
export const W = 1600;
export const H = 900;
/** Height of each goal mouth, centred on H / 2. */
export const GOAL = 300;

export const PUCK_R = 28;
export const PADDLE_R = 44;

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

/** Network fixed point: a coordinate travels as round(v * SCALE) in a Uint16. */
export const SCALE = 32;

/** Default match rules. */
export const RULES: Rules = {
  rounds: 3,
  goals: 10,
  hit: 1,
  goal: 20,
  roundWin: 10,
  matchWin: 30,
  headStart: 1,
  breakSec: 3,
  endSec: 15,
};

export const MAX_PLAYERS = 16;
export const MAX_NAME = 16;
