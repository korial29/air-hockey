// Contract only. The physics agent implements it.
import type { Arena, Obstacle } from './types';

/**
 * The obstacles of an arena at tick t: icebergs first (fixed), then penguins (sliding). 'classic'
 * has none. t may be fractional, for drawing between steps. Penguin motion repeats with a period
 * that divides 65536 ticks, so the wrap of the u16 snapshot tick is seamless. The layout is
 * mirror-symmetric across the centre line: neither team is favoured.
 */
export const obstacles = (_arena: Arena, _t: number): Obstacle[] => {
  throw new Error('not implemented');
};
