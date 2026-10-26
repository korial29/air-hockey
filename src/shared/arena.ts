// The ice arena: four fixed icebergs and three penguins sliding on their belly, board to board.
// Every gap fits a paddle and a puck side by side (2 · PADDLE_R + 2 · PUCK_R = 144), edge to edge:
// icebergs to the boards ≥ 193, icebergs to the nearest penguin lane 158, lane to lane 200, and
// 152 from the pair's lanes to a paddle on the centre line. So a paddle can always yield and
// nothing gets trapped. Penguins touch the boards at the ends of their lane: what they catch
// there slides out sideways. A shot from the centre spot along the long axis reaches every point
// of either goal mouth without meeting an iceberg.
import { H, TICK_HZ, W } from './constants';
import type { Arena, Obstacle } from './types';

/** Icebergs of the left half, [x, y, r], above and below its serve spot. The right half mirrors. */
const BERGS = [
  [450, 270, 72],
  [460, 870, 62],
];
/** Penguin radius. */
const PR = 40;
/**
 * Penguin lanes, [x, phase]: a pair 280 units off the centre line, in step, and one on the line,
 * half a period apart. At t = 0 the pair is at the bottom board, the middle one at the top board.
 */
const LANES = [
  [W / 2 - 280, 0.5],
  [W / 2, 0],
  [W / 2 + 280, 0.5],
];
/** Ticks for a penguin to slide there and back: 2048 divides 65536, 8.5 s at 240 Hz. */
export const PERIOD = 2048;
/** Travel of a penguin centre, board to board. */
const SPAN = H - 2 * PR;
/** Slide speed, units per second: 2 · SPAN per PERIOD, about 245. */
const V = (2 * SPAN * TICK_HZ) / PERIOD;

/**
 * The obstacles of an arena at tick t: icebergs first (fixed), then penguins (sliding). 'classic'
 * has none. t may be fractional, for drawing between steps. Penguin motion repeats with a period
 * that divides 65536 ticks, so the wrap of the u16 snapshot tick is seamless. The layout is
 * mirror-symmetric across the centre line: neither team is favoured.
 *
 * Indices are stable: 0-3 icebergs (left top, right top, left bottom, right bottom), 4-6 penguins
 * (left lane, centre lane, right lane). Fresh objects on every call.
 */
export const obstacles = (arena: Arena, t: number): Obstacle[] =>
  arena == 'classic'
    ? []
    : [
        ...BERGS.flatMap(([x, y, r]) =>
          [x, W - x].map((x): Obstacle => ({ kind: 'iceberg', x, y, r, vx: 0, vy: 0 })),
        ),
        ...LANES.map(([x, phase]): Obstacle => {
          // Share of the period, 0 → 1: down in the first half, back up in the second one.
          const u = (t / PERIOD + phase) % 1;
          const up = u >= 0.5;
          return {
            kind: 'penguin',
            x,
            y: PR + SPAN * (up ? 2 - 2 * u : 2 * u),
            r: PR,
            vx: 0,
            vy: up ? -V : V,
          };
        }),
      ];
