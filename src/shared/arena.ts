// The ice arena: four fixed icebergs and three penguins sliding on their belly, board to board.
// Every gap fits a paddle and a puck side by side (2 · PADDLE_R + 2 · PUCK_R = 144), edge to edge:
// icebergs to the boards ≥ 145, icebergs to the nearest penguin lane 158, lane to lane 200, and
// 152 from the pair's lanes to a paddle on the centre line. So a paddle can always yield and
// nothing gets trapped. Penguins touch the boards at the ends of their lane: what they catch
// there slides out sideways. A straight shot from the centre spot reaches every point of either
// goal mouth without meeting an iceberg.
// Each round the icebergs (vortices, whirlwinds) take a new place across the width: same x, a y drawn from the
// round's seed (see obstacles) within a band per pair, the same for both of a mirrored pair. The
// bands keep every guarantee above for any draw (size 1):
// - top pair (r 72), y in [217, 355]: ≥ 145 to the top board; its centre ≥ 101 from the line
//   from the centre spot to the top post (> r + PUCK_R) and ≥ 213 from the serve spot.
// - bottom pair (r 62), y in [758, 918]: ≥ 145 to the bottom board; its centre ≥ 91 from the
//   line to the bottom post and ≥ 199 from the serve spot.
// - the pairs stay ≥ 266 apart; spawn columns stand ≥ 130 off their x, clear at any y; the lanes
//   do not move, so the gaps to them stay as above.
// The sea arena (sea and pirates) is the same layout, slot for slot: vortices where the icebergs
// are, same size, and big sharks (SR, wider than a penguin) in the penguin lanes, swimming board
// to board in the same period and zig-zagging across their lane: a triangle wave of ZA units
// either side, ZN back-and-forths per crossing, on the lane at the boards and at mid-height. The
// swing is wide on purpose, so the sea drops the paddle-and-puck rule while a shark swings by:
// vortices to the nearest lane narrow down to 84 at the worst draw of the vortices' y (for 1/8 to
// 1/5 of the period, with the draw), the pair's lanes to a centre-line paddle down to 78 (nearly half of it, on every inward swing), lane to lane down to
// 129 (about 1/20 of it).
// The puck alone always fits (every gap ≥ 78 > 2 · PUCK_R + 20), so no obstacle traps it, and a
// paddle caught in a squeeze is pushed out like anywhere else; cornered where a board meets the
// centre line, it slips past the shark (see out in physics.ts). The serve spots stay ≥ 101 clear,
// as on the ice. A swing grazes the outer spawn column, never over a spawned paddle; at tick 0,
// when a round starts, every spawn point is clear by the full margin. SR and ZA are as big as
// the serve spots and the centre-line gap allow together: SR + ZA = 114.
// The pair zig-zags in mirror, the centre shark across the centre line: half a zig on each
// side, so it favours neither team over time.
// At sea a vortex sucks the puck under, and the puck comes up somewhere else on the rink; a shark
// eats it and spits it at whoever touched it last (see twirl in physics.ts).
// The desert (an Arabian Nights desert) is the ice layout, slot for slot: whirlwinds of sand where
// the icebergs are (same size, same y per seed), genies in the penguin lanes. A whirlwind catches
// the puck, spins it round and flings it out in a random direction (see twirl in physics.ts), in a
// sense of its own: clockwise on screen left of the centre line, counter-clockwise on the right
// (swirl). A genie floats at random within its band: anywhere along its lane, board to board, and
// up to GA off it either side, gliding from one waypoint drawn from the round's seed to the next
// every WANDER ticks. The pair wanders in mirror. GA trades some of the ice's room for a livelier
// float: whirlwinds to the nearest lane down to 128, lane to lane 140, the pair's lanes to a
// centre-line paddle 122. The puck alone still fits everywhere (≥ 76) and the spawn columns stay
// clear: the last one is 6 off the band.
import { H, MAX_SIZE, TICK_HZ, W } from './constants';
import type { Arena, Obstacle } from './types';

/**
 * Icebergs (vortices at sea, whirlwinds in the desert) of the left half, above and below its serve
 * spot: [x, r, band top, band bottom, y for seed 0]. The right half mirrors.
 */
const BERGS = [
  [450, 72, 217, 355, 270],
  [460, 62, 758, 918, 870],
];
/** Penguin radius, a genie's too. */
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
/** How far a genie strays either side of its lane, and ticks from one waypoint to the next. */
export const GA = 30;
export const WANDER = 1024;
/** Obstacles kept for a count of 2 to 7 (see obstacles): bit i keeps index i of the full layout. */
const MASKS = [0b11, 0b100011, 0b1010011, 0b1110011, 0b1011111, 0b1111111];

/**
 * A share in [0, 1) for draw i of a seed (pair i of icebergs, a genie's waypoint, a whirlwind's
 * hold): murmur3's integer finalizer, so host and clients draw the same, with no shared random
 * state.
 */
export const draw = (seed: number, i: number): number => {
  let h = seed * 2 + i;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};

/**
 * Icebergs, vortices and whirlwinds: they break after ICEBERG_HP hits. Penguins and genies move, go
 * on one. Sharks move and never go: they eat the puck.
 */
export const fixed = (o: Obstacle): boolean => ['iceberg', 'vortex', 'whirlwind'].includes(o.kind);

/**
 * Sense a whirlwind spins the puck in, on a rink of that size: 1 clockwise on screen (y down), left
 * of the centre line, -1 counter-clockwise on the right. Mirrored whirlwinds spin in mirror.
 */
export const swirl = (o: Obstacle, size = 1): 1 | -1 => (o.x < (W * size) / 2 ? 1 : -1);

/**
 * The obstacles of an arena at tick t: icebergs (vortices, whirlwinds) first, fixed, then penguins
 * (sharks, genies), moving. 'classic' has none. t may be fractional, for drawing between steps.
 * The motion repeats with a period that divides 65536 ticks, so the wrap of the u16 snapshot tick
 * is seamless. vx and vy are the velocity, units per second (a shark's heading). The layout is
 * mirror-symmetric across the centre line (the centre shark over time): neither team is favoured.
 *
 * The layout is drawn for the base rink and scaled by `size` (positions, radii, speeds: the
 * crossing time stays the same). `count` picks which obstacles stay, in the order above and
 * mirror-symmetric at every count: top icebergs (2), centre penguin (3), side penguins instead of
 * the centre one (4), all three penguins (5), bottom icebergs too (6), everything (7). Same slots
 * at sea and in the desert. Indices follow the returned order and are stable for a given count.
 * Fresh objects every call.
 *
 * `seed` (an integer, picked by the host each round) places the icebergs (vortices, whirlwinds)
 * across the width, each pair in its band (see BERGS), and draws the genies' waypoints; 0 keeps
 * the fixed layout of the icebergs.
 */
export const obstacles = (arena: Arena, t: number, size = 1, count = 7, seed = 0): Obstacle[] => {
  const sea = arena == 'sea';
  const [still, mover] = (
    { sea: ['vortex', 'shark'], desert: ['whirlwind', 'genie'] } as Record<
      string,
      Obstacle['kind'][]
    >
  )[arena] ?? ['iceberg', 'penguin'];
  const r = sea ? SR : PR;
  // Travel of a centre, board to board, and the speed to cover it twice per PERIOD (about 245).
  const span = H - 2 * r;
  const v = (2 * span * TICK_HZ) / PERIOD;
  return arena == 'classic'
    ? []
    : [
        ...BERGS.flatMap(([x, r, a, b, y], i) =>
          [x, W - x].map((x): Obstacle => ({
            kind: still,
            x,
            y: seed ? a + (b - a) * draw(seed, i) : y,
            r,
            vx: 0,
            vy: 0,
          })),
        ),
        ...LANES.map(([x, phase, m]): Obstacle => {
          if (arena == 'desert') {
            // Waypoint n to n + 1 (64 of them over the u16 tick), eased in and out (smoothstep):
            // e and its rate.
            const f = (t / WANDER) % 64;
            const n = f | 0;
            const u = f - n;
            const e = u * u * (3 - 2 * u);
            const de = (6 * u * (1 - u) * TICK_HZ) / WANDER;
            // Draws of this lane (the pair shares them) along the axis j (0: x, 1: y), from waypoint n.
            const at = (j: number, n: number) =>
              draw(seed, 2 + 128 * +(x == W / 2) + 64 * j + (n % 64));
            const [dx, dy] = [0, 1].map(j => at(j, n + 1) - at(j, n));
            return {
              kind: mover,
              x: x + m * GA * (2 * (at(0, n) + dx * e) - 1),
              y: r + span * (at(1, n) + dy * e),
              r,
              vx: 2 * m * GA * dx * de,
              vy: span * dy * de,
            };
          }
          // Share of the period, 0 → 1: down in the first half, back up in the second one.
          const u = (t / PERIOD + phase) % 1;
          const up = u >= 0.5;
          // Zig-zag: share of a back-and-forth, a quarter in at the boards (on the lane).
          const z = (2 * ZN * u + 0.25) % 1;
          return {
            kind: mover,
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
