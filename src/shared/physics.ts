// Contract only. Agent A implements it.
import type { Team, World } from './types';

const todo = (): never => {
  throw new Error('not implemented');
};

/** Empty world: puck at the centre, no paddles, 0-0. */
export const createWorld = (): World => todo();

/** Clamps a paddle centre to its team's half and inside the walls. */
export const clampPaddle = (_team: Team, _x: number, _y: number): [number, number] => todo();

/** Spawn point for the n-th paddle of a team, spread over its half. */
export const spawnPoint = (_team: Team, _n: number): [number, number] => todo();

/**
 * Advances the world by dt seconds (always 1 / TICK_HZ in practice).
 * Moves paddles toward their target, moves the puck, resolves collisions.
 * On a goal it bumps the score, re-serves the puck and returns the scoring team; -1 otherwise.
 */
export const step = (_w: World, _dt: number): Team | -1 => todo();
