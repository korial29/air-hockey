// The ice arena: four fixed icebergs and three penguins sliding on their belly, board to board.
// Every gap fits a paddle and a puck side by side (2 · PADDLE_R + 2 · PUCK_R = 144), edge to edge:
// icebergs to the boards ≥ 193, icebergs to the nearest penguin lane 158, lane to lane 200, and
// 152 from the pair's lanes to a paddle on the centre line. So a paddle can always yield and
// nothing gets trapped. Penguins touch the boards at the ends of their lane: what they catch
// there slides out sideways. A shot from the centre spot along the long axis reaches every point
// of either goal mouth without meeting an iceberg.
// The sea arena (sea and pirates) is the same layout, slot for slot: rocks where the icebergs
// are, same size, and mermaids in the penguin lanes, swimming board to board in the same period
// and zig-zagging across their lane: a triangle wave of ZA units either side, ZN back-and-forths
// per crossing, at 0 on the boards. Mermaids are smaller (MR) so the zig-zag keeps every gap:
// rocks to the nearest lane 152, lane to lane ≥ 188, the pair's lanes to a centre-line paddle 146.
// The pair zig-zags in mirror, the centre mermaid across the centre line: half a zig on each
// side, so it favours neither team over time.
// A bigger rink scales all of it while paddle and puck keep their size, and fewer obstacles leave
// wider gaps: every guarantee holds at every size and count.
import { H, MAX_SIZE, TICK_HZ, W } from './constants';
import type { Arena, Obstacle } from './types';

/**
 * Icebergs (rocks at sea) of the left half, [x, y, r], above and below its serve spot. The right
 * half mirrors.
 */
const BERGS = [
  [450, 270, 72],
  [460, 870, 62],
];
/** Penguin radius. */
const PR = 40;
/** Mermaid radius. */
const MR = 32;
/**
 * Penguin lanes, [x, phase, zig-zag sign]: a pair 280 units off the centre line, in step, and one
 * on the line, half a period apart. At t = 0 the pair is at the bottom board, the middle one at
 * the top board. The pair's mermaids zig-zag in mirror (opposite signs).
 */
const LANES = [
  [W / 2 - 280, 0.5, 1],
  [W / 2, 0, 1],
  [W / 2 + 280, 0.5, -1],
];
/** Ticks for a penguin to slide there and back: 2048 divides 65536, 8.5 s at 240 Hz. */
export const PERIOD = 2048;
/** Mermaid zig-zag: amplitude either side of its lane, and back-and-forths per crossing. */
const ZA = 14;
const ZN = 4;
/** Sideways speed of a mermaid, units per second: 4 · ZA per back-and-forth, about 52. */
const ZV = (8 * ZA * ZN * TICK_HZ) / PERIOD;
/** Obstacles kept for a count of 2 to 7 (see obstacles): bit i keeps index i of the full layout. */
const MASKS = [0b11, 0b100011, 0b1010011, 0b1110011, 0b1011111, 0b1111111];

/** Icebergs and rocks: they break after ICEBERG_HP hits. Penguins and mermaids move, go on one. */
export const fixed = (o: Obstacle): boolean => o.kind == 'iceberg' || o.kind == 'rock';

/**
 * The obstacles of an arena at tick t: icebergs (rocks) first, fixed, then penguins (mermaids),
 * moving. 'classic' has none. t may be fractional, for drawing between steps. The motion repeats
 * with a period that divides 65536 ticks, so the wrap of the u16 snapshot tick is seamless.
 * vx and vy are the velocity, units per second (a mermaid's heading). The layout is
 * mirror-symmetric across the centre line (the centre mermaid over time): neither team is favoured.
 *
 * The layout is drawn for the base rink and scaled by `size` (positions, radii, speeds: the
 * crossing time stays the same). `count` picks which obstacles stay, in the order above and
 * mirror-symmetric at every count: top icebergs (2), centre penguin (3), side penguins instead of
 * the centre one (4), all three penguins (5), bottom icebergs too (6), everything (7). Same slots
 * on the sea. Indices follow the returned order and are stable for a given count. Fresh objects
 * every call.
 */
export const obstacles = (arena: Arena, t: number, size = 1, count = 7): Obstacle[] => {
  const sea = arena == 'sea';
  const r = sea ? MR : PR;
  // Travel of a centre, board to board, and the speed to cover it twice per PERIOD (about 245).
  const span = H - 2 * r;
  const v = (2 * span * TICK_HZ) / PERIOD;
  return arena == 'classic'
    ? []
    : [
        ...BERGS.flatMap(([x, y, r]) =>
          [x, W - x].map((x): Obstacle => ({
            kind: sea ? 'rock' : 'iceberg',
            x,
            y,
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
            kind: sea ? 'mermaid' : 'penguin',
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
