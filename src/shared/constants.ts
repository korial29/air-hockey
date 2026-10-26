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
export const PADDLE_MAX_SPEED = 3000;

/** Physics steps per second (fixed step, server or local host). */
export const TICK_HZ = 120;
/** A snapshot goes out every SNAP_EVERY ticks: 120 / 4 = 30 Hz. */
export const SNAP_EVERY = 4;
/** Client render delay used for interpolation, in ms. */
export const INTERP_DELAY = 100;

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
