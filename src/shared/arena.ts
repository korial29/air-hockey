// The ice arena: four fixed icebergs and three penguins sliding on their belly, board to board.
// Every gap fits a paddle and a puck side by side (2 · PADDLE_R + 2 · PUCK_R = 144), edge to edge:
// icebergs to the boards ≥ 145, icebergs to the nearest penguin lane 158, lane to lane 200, and
// 152 from the pair's lanes to a paddle on the centre line. So a paddle can always yield and
// nothing gets trapped. Penguins touch the boards at the ends of their lane: what they catch
// there slides out sideways. A straight shot from the centre spot reaches every point of either
// goal mouth without meeting an iceberg.
// Each round the icebergs (rocks) take a new place across the width: same x, a y drawn from the
// round's seed (see obstacles) within a band per pair, the same for both of a mirrored pair. The
// bands keep every guarantee above for any draw (size 1):
// - top pair (r 72), y in [217, 355]: ≥ 145 to the top board; its centre ≥ 101 from the line
//   from the centre spot to the top post (> r + PUCK_R) and ≥ 213 from the serve spot.
// - bottom pair (r 62), y in [758, 918]: ≥ 145 to the bottom board; its centre ≥ 91 from the
//   line to the bottom post and ≥ 199 from the serve spot.
// - the pairs stay ≥ 266 apart; spawn columns stand ≥ 130 off their x, clear at any y; the lanes
//   do not move, so the gaps to them stay as above.
// The sea arena (sea and pirates) is the same layout, slot for slot: rocks where the icebergs
// are, same size, and big sharks (SR, wider than a penguin) in the penguin lanes, swimming board
// to board in the same period and zig-zagging across their lane: a triangle wave of ZA units
// either side, ZN back-and-forths per crossing, on the lane at the boards and at mid-height. The
// swing is wide on purpose, so the sea drops the paddle-and-puck rule while a shark swings by:
// rocks to the nearest lane narrow down to 84 at the worst draw of the rocks' y (for 1/8 to 1/5
// of the period, with the draw), the pair's lanes to a
// centre-line paddle down to 78 (nearly half of it, on every inward swing), lane to lane down to
// 129 (about 1/20 of it).
// The puck alone always fits (every gap ≥ 78 > 2 · PUCK_R + 20), so no obstacle traps it, and a
// paddle caught in a squeeze is pushed out like anywhere else; cornered where a board meets the
// centre line, it slips past the shark (see out in physics.ts). The serve spots stay ≥ 101 clear,
// as on the ice. A swing grazes the outer spawn column, never over a spawned paddle; at tick 0,
// when a round starts, every spawn point is clear by the full margin. SR and ZA are as big as
// the serve spots and the centre-line gap allow together: SR + ZA = 114.
// The pair zig-zags in mirror, the centre shark across the centre line: half a zig on each
// side, so it favours neither team over time.
// A bigger rink scales all of it while paddle and puck keep their size, and fewer obstacles leave
// wider gaps: every guarantee holds at every size and count.
import { H, MAX_SIZE, TICK_HZ, W } from './constants';
import type { Arena, Obstacle } from './types';

/**
 * Icebergs (rocks at sea) of the left half, above and below its serve spot: [x, r, band top, band
 * bottom, y for seed 0]. The right half mirrors.
 */
const BERGS = [
  [450, 72, 217, 355, 270],
  [460, 62, 758, 918, 870],
];
/** Penguin radius. */
const PR = 40;
/** Shark radius: big, as wide as the gaps it swings across allow (see top). */
const SR = 44;
/**
 * Penguin lanes, [x, phase, zig-zag sign]: a pair 280 units off the centre line, in step, and one
 * on the line, half a period apart. At t = 0 the pair is at the bottom board, the middle one at
 * the top board. The pair's sharks zig-zag in mirror (opposite signs).
 */
const LANES = [
  [W / 2 - 280, 0.5, 1],
  [W / 2, 0, 1],
  [W / 2 + 280, 0.5, -1],
];
/** Ticks for a penguin to slide there and back: 2048 divides 65536, 8.5 s at 240 Hz. */
export const PERIOD = 2048;
/**
 * Shark zig-zag: amplitude either side of its lane, and back-and-forths per crossing. Wide enough
 * to read at a glance: it narrows some gaps below a paddle and a puck while it swings (see top).
 */
export const ZA = 70;
export const ZN = 3;
/** Sideways speed of a shark, units per second: 4 · ZA per back-and-forth, about 197. */
const ZV = (8 * ZA * ZN * TICK_HZ) / PERIOD;
/** Obstacles kept for a count of 2 to 7 (see obstacles): bit i keeps index i of the full layout. */
const MASKS = [0b11, 0b100011, 0b1010011, 0b1110011, 0b1011111, 0b1111111];

/**
 * A share in [0, 1) for pair i of a seed: murmur3's integer finalizer, so host and clients draw
 * the same, with no shared random state.
 */
const draw = (seed: number, i: number): number => {
  let h = seed * 2 + i;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};

/** Icebergs and rocks: they break after ICEBERG_HP hits. Penguins and sharks move, go on one. */
export const fixed = (o: Obstacle): boolean => o.kind == 'iceberg' || o.kind == 'rock';

/**
 * The obstacles of an arena at tick t: icebergs (rocks) first, fixed, then penguins (sharks),
 * moving. 'classic' has none. t may be fractional, for drawing between steps. The motion repeats
 * with a period that divides 65536 ticks, so the wrap of the u16 snapshot tick is seamless.
 * vx and vy are the velocity, units per second (a shark's heading). The layout is
 * mirror-symmetric across the centre line (the centre shark over time): neither team is favoured.
 *
 * The layout is drawn for the base rink and scaled by `size` (positions, radii, speeds: the
 * crossing time stays the same). `count` picks which obstacles stay, in the order above and
 * mirror-symmetric at every count: top icebergs (2), centre penguin (3), side penguins instead of
 * the centre one (4), all three penguins (5), bottom icebergs too (6), everything (7). Same slots
 * on the sea. Indices follow the returned order and are stable for a given count. Fresh objects
 * every call.
 *
 * `seed` (an integer, picked by the host each round) places the icebergs (rocks) across the width,
 * each pair in its band (see BERGS); 0 keeps the fixed layout.
 */
export const obstacles = (arena: Arena, t: number, size = 1, count = 7, seed = 0): Obstacle[] => {
  const sea = arena == 'sea';
  const r = sea ? SR : PR;
  // Travel of a centre, board to board, and the speed to cover it twice per PERIOD (about 245).
  const span = H - 2 * r;
  const v = (2 * span * TICK_HZ) / PERIOD;
  return arena == 'classic'
    ? []
    : [
        ...BERGS.flatMap(([x, r, a, b, y], i) =>
          [x, W - x].map((x): Obstacle => ({
            kind: sea ? 'rock' : 'iceberg',
            x,
            y: seed ? a + (b - a) * draw(seed, i) : y,
            r,
            vx: 0,
            vy: 0,
          })),
        ),
        ...LANES.map(([x, phase, m]): Obstacle => {
          // Share of the period, 0 → 1: down in the first half, back up in the second one.
          const u = (t / PERIOD + phase) % 1;
          const up = u >= 0.5;
          // Zig-zag: share of a back-and-forth, a quarter in at the boards (on the lane).
          const z = (2 * ZN * u + 0.25) % 1;
          return {
            kind: sea ? 'shark' : 'penguin',
            x: sea ? x + m * ZA * (1 - 4 * Math.abs(z - 0.5)) : x,
            y: r + span * (up ? 2 - 2 * u : 2 * u),
            r,
            vx: sea ? m * (z < 0.5 ? ZV : -ZV) : 0,
            vy: up ? -v : v,
          };
        }),
      ]
        .filter((_, i) => (MASKS[count - 2] ?? 127) & (1 << i))
        .map(o => ({
          ...o,
          x: o.x * size,
          y: o.y * size,
          r: o.r * size,
          vx: o.vx * size,
          vy: o.vy * size,
        }));
};

/**
 * Rink geometry for a number of players. The area grows with the players so each keeps the same
 * room: size = √(players / 2) on each side, from 1 (2 players) to MAX_SIZE (8 and more).
 * Obstacles: players / 2 + 2, from 3 (2 players: icebergs and the centre penguin) to 7 (10 and
 * more), always in mirrored pairs plus, when odd, a penguin on the centre line.
 */
export const layout = (players: number): { size: number; count: number } => ({
  size: Math.min(MAX_SIZE, Math.max(1, Math.sqrt(players / 2))),
  count: Math.min(7, Math.max(3, ((players / 2) | 0) + 2)),
});

/** The scene of round n (from 1; 0 while waiting plays round 1's): the rules' list takes turns. */
export const scene = (arena: Arena | Arena[], n: number): Arena => {
  const a = ([] as Arena[]).concat(arena);
  return a[(Math.max(n, 1) - 1) % a.length] ?? 'ice';
};
