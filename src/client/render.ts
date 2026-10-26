// Canvas drawing in field units: the rink and its obstacles, HUD bands around the rink, and the
// end-of-match stadium. The rink grows with the players (World.size): the world (obstacles, puck,
// paddles) is drawn in world units, W · size × H · size, under a transform scaled by 1 / size,
// while the rink picture, the snow, the veils and the HUD stay in base units.
import { GHOST, GOAL, H, PUCK_R, RESPAWN, TICK_HZ, W } from '../shared/constants';
import type { Obstacle, PlayerInfo, Rank, Snapshot, Team } from '../shared/types';
import type { MatchState } from './index';
import { BOT, CH, TOP, byTeam, flow, podium, rnd, shown } from './util';

let c: CanvasRenderingContext2D;
/** Base font size in field units, never under 12 CSS px. */
let f: number;
/** Rink size factor: world units per base unit. */
let u = 1;

/**
 * Starts a frame: the helpers below draw on ctx, font is the base font size, size the rink size
 * factor (World.size).
 */
export const pen = (ctx: CanvasRenderingContext2D, font: number, size = 1) => {
  c = ctx;
  f = font;
  u = size;
};

const rect = (x: number, y: number, w: number, h: number, color: string) => {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
};

export const circle = (x: number, y: number, r: number, color: string) => {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, 7);
  c.fill();
};

export const text = (
  s: string,
  x: number,
  y: number,
  size = f,
  align: CanvasTextAlign = 'center',
  color = '#fff',
  max?: number,
) => {
  c.font = `bold ${size}px sans-serif`;
  c.textAlign = align;
  c.fillStyle = color;
  c.fillText(s, x, y, max);
};

const width = (s: string, size: number) => {
  c.font = `bold ${size}px sans-serif`;
  return c.measureText(s).width;
};

/** Polyline through x, y pairs. */
const line = (color: string, w: number, ...p: number[]) => {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.beginPath();
  for (let i = 0; i < p.length; i += 2) {
    c.lineTo(p[i], p[i + 1]);
  }
  c.stroke();
};

/**
 * Fills the current path with color, then with a gradient on top: stops are [offset, color]
 * pairs, so one overlay shades any player colour (light on one side, shadow on the other).
 */
const fill = (color: string, g: CanvasGradient, ...stops: [number, string][]) => {
  c.fillStyle = color;
  c.fill();
  stops.forEach(([o, s]) => g.addColorStop(o, s));
  c.fillStyle = g;
  c.fill();
};

/** A sphere: lit from the top left. */
const ball = (x: number, y: number, r: number, color: string) => {
  c.beginPath();
  c.arc(x, y, r, 0, 7);
  fill(
    color,
    c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r),
    [0, '#fffa'],
    [0.45, '#fff0'],
    [1, '#0007'],
  );
};

/** A soft contact shadow on the floor. */
const shadow = (x: number, y: number, rx: number, ry: number, color = '#0008') => {
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  c.beginPath();
  c.arc(0, 0, rx, 0, 7);
  fill('#0000', c.createRadialGradient(0, 0, 0, 0, 0, rx), [0, color], [1, '#0000']);
  c.restore();
};

const ring = (x: number, y: number, r: number, color: string, w: number) => {
  c.beginPath();
  c.arc(x, y, r, 0, 7);
  c.strokeStyle = color;
  c.lineWidth = w;
  c.stroke();
};

const oval = (x: number, y: number, rx: number, ry: number, color: string) => {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, 7);
  c.fillStyle = color;
  c.fill();
};

const ICE_LINE = '#d8404a66';
const ICE_BLUE = '#2f6fd466';
const ORANGE = '#f39a1c';
const BLACK = '#1d2430';
const WOOD = '#7a4a24';
const PLANK = '#a8703c';
const NAIL = '#2a1a0c';
const ROPE = '#d9bf86';
const GOLD = '#a87314';

/** Clips to the rink, base rink coordinates. */
const clip = () => {
  c.save();
  c.beginPath();
  c.rect(0, 0, W, H);
  c.clip();
};

/** A red and white buoy, seen from above. */
const buoy = (x: number, y: number) => {
  circle(x, y, 15, '#d8402e');
  circle(x, y, 7, '#fff');
};

/**
 * The sea, in base rink coordinates (m: the goal mouth's top): deep water at the boards, turquoise
 * in the middle, caustics, foam along the boards, a rope with buoys for the centre line and circle,
 * a ship's rail for boards and wooden goals with a rope net. The moving waves are drawn per frame.
 */
const sea = (m: number) => {
  clip();
  fill(
    '#0b4d6e',
    c.createRadialGradient(W / 2, H / 2, H / 5, W / 2, H / 2, W * 0.6),
    [0, '#29b2c2'],
    [1, '#29b2c200'],
  );
  fill('#0000', c.createLinearGradient(0, 0, W, H), [0.3, '#fff0'], [0.4, '#fff1'], [0.5, '#fff0']);
  // Caustics: a web of short light arcs, the same every frame.
  c.beginPath();
  for (let i = 0; i < 160; i++) {
    const x = rnd(i + 500) * W;
    const y = rnd(i + 550) * H;
    const r = 30 + rnd(i + 600) * 60;
    const a = rnd(i + 650) * 7;
    c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    c.arc(x, y, r, a, a + 1 + rnd(i + 700));
  }
  c.strokeStyle = '#c4f6ff2a';
  c.lineWidth = 3;
  c.stroke();
  // Shallows in front of the goals, a rope with buoys across the middle.
  for (const x of [0, W]) {
    circle(x, H / 2, GOAL / 2 + 20, '#9ff3e826');
  }
  for (const d of [[], [12, 12]]) {
    c.setLineDash(d);
    line(d[0] ? '#8a6a3a' : ROPE, 8, W / 2, 0, W / 2, H);
    ring(W / 2, H / 2, 160, d[0] ? '#8a6a3a' : ROPE, 8);
  }
  c.setLineDash([]);
  for (let i = 0; i < 8; i++) {
    buoy(W / 2 + Math.cos(i * 0.785) * 160, H / 2 + Math.sin(i * 0.785) * 160);
    const y = (i * H) / 8 + 70;
    if (Math.abs(y - H / 2) > 200) {
      buoy(W / 2, y);
    }
  }
  // Foam along the boards: a white band and bubbles.
  line('#ffffff55', 40, 0, 0, W, 0, W, H, 0, H, 0, 0);
  c.beginPath();
  for (let i = 0; i < 240; i++) {
    const t = rnd(i + 750);
    const d = 4 + rnd(i + 800) * 30;
    const e = i % 4;
    const x = e > 1 ? (e & 1 ? W - d : d) : t * W;
    const y = e > 1 ? t * H : e ? H - d : d;
    const s = 2 + rnd(i + 850) * 6;
    c.moveTo(x + s, y);
    c.arc(x, y, s, 0, 7);
  }
  c.fillStyle = '#fffc';
  c.fill();
  c.restore();
  // Boards: a ship's rail, planks with seams and nails, open at the goal mouths.
  for (const [w, s] of [
    [26, WOOD],
    [8, PLANK],
  ] as const) {
    line(s, w, 0, m, 0, 0, W, 0, W, m);
    line(s, w, 0, m + GOAL, 0, H, W, H, W, m + GOAL);
  }
  for (let v = 60; v < W; v += 125) {
    for (const y of [0, H]) {
      line(NAIL, 3, v, y - 13, v, y + 13);
      rect(v + 6, y - 2, 5, 5, NAIL);
    }
    if (v < m || (v > m + GOAL && v < H)) {
      for (const x of [0, W]) {
        line(NAIL, 3, x - 13, v, x + 13, v);
      }
    }
  }
  // Wooden goals: a plank frame with nails, a rope net over dark water.
  for (const t of [0, 1]) {
    const x = t ? W - 50 : 0;
    rect(x, m, 50, GOAL, '#03263a66');
    c.save();
    c.beginPath();
    c.rect(x, m, 50, GOAL);
    c.clip();
    c.beginPath();
    for (let i = -50; i < GOAL; i += 25) {
      c.moveTo(x, m + i);
      c.lineTo(x + 50, m + i + 50);
      c.moveTo(x, m + i + 50);
      c.lineTo(x + 50, m + i);
    }
    c.strokeStyle = ROPE;
    c.lineWidth = 3;
    c.stroke();
    c.restore();
    const [o, b] = t ? [W - 50, W - 7] : [50, 7];
    line(WOOD, 16, o, m, b, m, b, m + GOAL, o, m + GOAL);
    line(PLANK, 5, o, m - 3, b - 3, m - 3, b - 3, m + GOAL, o, m + GOAL);
    for (let j = 0; j < 5; j++) {
      circle(b, m + (j * GOAL) / 4, 4, NAIL);
    }
    circle(o - 6, m, 4, NAIL);
    circle(o - 6, m + GOAL, 4, NAIL);
  }
};

/**
 * Waves over the sea, per frame, in base rink coordinates: crests drifting with the swell and
 * sparkles twinkling. Two paths, light enough for 60 fps with every paddle.
 */
export const waves = (now: number) => {
  c.beginPath();
  for (let i = 0; i < 26; i++) {
    const s = 24 + rnd(i + 900) * 26;
    const x = ((rnd(i + 920) * W + now * (0.012 + rnd(i + 940) * 0.02)) % (W + 200)) - 100;
    const y = rnd(i + 960) * H + Math.sin(now / 900 + i) * 14;
    c.moveTo(x - s * 2, y);
    c.quadraticCurveTo(x - s, y - s * 0.6, x, y);
    c.quadraticCurveTo(x + s, y - s * 0.6, x + s * 2, y);
  }
  c.strokeStyle = '#ffffff45';
  c.lineWidth = 4;
  c.stroke();
  c.beginPath();
  for (let i = 0; i < 40; i++) {
    const s = 5 * Math.sin(now / 350 + i * 2.4);
    if (s > 0) {
      const x = rnd(i + 980) * W + Math.sin(now / 2000 + i) * 20;
      const y = rnd(i + 990) * H;
      c.moveTo(x + s, y);
      c.arc(x, y, s, 0, 7);
    }
  }
  c.fillStyle = '#fffd';
  c.fill();
};

/**
 * The rink, in base rink coordinates. Ice: pale ice with a sheen and skate marks, faded hockey
 * markings, blue boards, red-framed nets. Sea: see sea. Classic: the dark table.
 * Markings, boards and nets scale with the rink, so the picture is the same at any size, line
 * widths included; only the skate marks are skater-sized: more of them, smaller, as it grows.
 */
const paint = (arena: string) => {
  const m = (H - GOAL) / 2;
  if (arena == 'sea') {
    return sea(m);
  }
  if (arena != 'ice') {
    rect(0, 0, W, H, '#0d2233');
    ring(W / 2, H / 2, 150, '#fff4', 6);
    line('#fff4', 6, W / 2, 0, W / 2, H);
    rect(0, m, 12, GOAL, '#fc3');
    rect(W - 12, m, 12, GOAL, '#fc3');
    return;
  }
  clip();
  // Diagonal sheen bands, a bluer tint toward the boards.
  fill(
    '#e6f2f9',
    c.createLinearGradient(0, 0, W, H),
    [0.2, '#fff0'],
    [0.32, '#fff9'],
    [0.42, '#fff0'],
    [0.62, '#fff6'],
    [0.68, '#fff0'],
  );
  fill(
    '#0000',
    c.createRadialGradient(W / 2, H / 2, H / 3, W / 2, H / 2, W * 0.6),
    [0, '#9cc8e000'],
    [1, '#9cc8e099'],
  );
  // Skate marks: short arcs, the same every frame.
  c.beginPath();
  for (let i = 0; i < Math.round(40 * u * u); i++) {
    const x = rnd(i) * W;
    const y = rnd(i + 50) * H;
    const r = (90 + rnd(i + 99) * 320) / u;
    const a = rnd(i + 150) * 7;
    c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    c.arc(x, y, r, a, a + 0.2 + rnd(i + 200) * 0.5);
  }
  c.strokeStyle = '#a3c9de';
  c.lineWidth = 2;
  c.stroke();
  // Hockey markings, faded: red centre line, blue lines, centre and faceoff circles, creases.
  line(ICE_LINE, 12, W / 2, 0, W / 2, H);
  line(ICE_BLUE, 16, W * 0.3, 0, W * 0.3, H);
  line(ICE_BLUE, 16, W * 0.7, 0, W * 0.7, H);
  ring(W / 2, H / 2, 160, ICE_BLUE, 8);
  circle(W / 2, H / 2, 14, ICE_BLUE);
  for (let i = 0; i < 4; i++) {
    const x = W / 2 + (i & 1 ? 1 : -1) * W * 0.36;
    const y = H / 2 + (i & 2 ? 1 : -1) * H * 0.3;
    ring(x, y, 100, ICE_LINE, 6);
    circle(x, y, 12, ICE_LINE);
  }
  for (const x of [0, W]) {
    circle(x, H / 2, GOAL / 2 + 20, '#5aa8e833');
    ring(x, H / 2, GOAL / 2 + 20, ICE_LINE, 6);
  }
  c.restore();
  // Boards, open at the goal mouths; nets with a red frame open toward the rink.
  line('#2c6cb0', 24, 0, m, 0, 0, W, 0, W, m);
  line('#2c6cb0', 24, 0, m + GOAL, 0, H, W, H, W, m + GOAL);
  for (const t of [0, 1]) {
    const x = t ? W - 50 : 0;
    rect(x, m, 50, GOAL, '#0c2a4426');
    c.beginPath();
    for (let i = 0; i < GOAL; i += 19) {
      c.moveTo(x, m + i);
      c.lineTo(x + 50, m + i);
    }
    for (let i = 12; i < 50; i += 19) {
      c.moveTo(x + i, m);
      c.lineTo(x + i, m + GOAL);
    }
    c.strokeStyle = '#5d7a90';
    c.lineWidth = 2;
    c.stroke();
    const [o, b] = t ? [W - 50, W - 5] : [50, 5];
    line('#d22b2b', 10, o, m, b, m, b, m + GOAL, o, m + GOAL);
  }
};

/** Rink images per context, with what they were drawn for: arena, scale and rink size. */
const cache = new WeakMap<object, [string, HTMLCanvasElement]>();

/**
 * Draws the rink of an arena (scene), in base rink coordinates, k canvas pixels per unit. Its
 * full-size gradients cost more than the rest of the frame: it is painted once per arena, canvas
 * size and rink size, then copied. Scenes taking turns between rounds repaint it.
 */
export const rink = (arena: string, k: number) => {
  const key = `${arena}${k}/${u}`;
  let img = cache.get(c)?.[0] == key ? cache.get(c)![1] : undefined;
  if (!img) {
    const ctx = c;
    img = document.createElement('canvas');
    img.width = W * k;
    img.height = H * k;
    c = img.getContext('2d')!;
    c.scale(k, k);
    paint(arena);
    c = ctx;
    cache.set(c, [key, img]);
  }
  c.drawImage(img, 0, 0, W, H);
};

/** Ms from removal to return, and from removal to the ghost (see ObstacleState.gone). */
const BACK = (RESPAWN * 1000) / TICK_HZ;
const SHOW = ((RESPAWN - GHOST) * 1000) / TICK_HZ;

/** Outline of iceberg i around x, y (x, y pairs), the same every frame, and its peak off-centre. */
const corners = (x: number, y: number, r: number, i: number) => {
  const n = 7 + (i % 3);
  const v: number[] = [];
  for (let j = 0; j < n; j++) {
    const a = ((j + rnd(i * 9 + j) * 0.6) / n) * 6.283;
    const d = r * (1.02 + rnd(i * 7 + j + 50) * 0.22);
    v.push(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  return [v, x - r * 0.18, y - r * 0.22] as const;
};

/**
 * Colours of a fixed obstacle, iceberg then rock: facet hue (hsl prefix) and lightness, outline,
 * ridges, crack, crack lip, hit ring, chips, shadow.
 */
const ROCKS = [
  ['hsl(196 70% ', 76, '#4f9cc4', '#fffa', '#2b6d96', '#fffd', '#7fe3ff', '#e6faff', '#0a4a7a66'],
  ['hsl(30 12% ', 44, '#3b3129', '#fff3', '#1e1712', '#e8dcc855', '#fff', '#8f8475', '#02253a88'],
] as const;

/**
 * Facet colour: bright toward the top left (m: its direction from the centre), l: extra light;
 * ice, or rock when sea.
 */
const shade = (m: number, l: number, sea = 0) =>
  `${ROCKS[sea][0]}${ROCKS[sea][1] + 18 * Math.cos(m + 2.36) + l}%)`;

/**
 * An iceberg, or a rock at sea, in world units: facets lit from the top left. e: hit flash, 1 → 0.
 * hits: puck hits taken, a crack at 1, deeper branching cracks and a chipped corner at 2. Strokes
 * and the shake scale with the rink like its radius does. A rock stands in a ring of foam, with
 * moss, barnacles and a wet highlight.
 */
const berg = (
  x: number,
  y: number,
  r: number,
  i: number,
  e: number,
  age: number,
  hits = 0,
  sea = 0,
  now = 0,
) => {
  const [, , edge, ridge, crack, lip, flash, chips, dark] = ROCKS[sea];
  x += Math.sin(age / 12) * e * 8 * u;
  shadow(x + r * 0.25, y + r * 0.3, r * 1.3, r, dark);
  if (sea) {
    circle(x, y, r * 1.25, '#ffffff30');
    ring(x, y, r * (1.18 + 0.05 * Math.sin(now / 300 + i)), '#fffc', 7 * u);
  }
  const [v, px, py] = corners(x, y, r, i);
  const n = v.length / 2;
  // Two hits: one corner knocked off, the facets around it in shadow.
  const chip = hits > 1 ? ((i * 2) % n) * 2 : -1;
  if (chip >= 0) {
    v[chip] = x + (v[chip] - x) * 0.4;
    v[chip + 1] = y + (v[chip + 1] - y) * 0.4;
  }
  // Facets from the peak: bright toward the top left, shaded toward the bottom right.
  for (let j = 0; j < n * 2; j += 2) {
    const k = (j + 2) % (n * 2);
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(v[j], v[j + 1]);
    c.lineTo(v[k], v[k + 1]);
    const m = Math.atan2(v[j + 1] + v[k + 1] - 2 * y, v[j] + v[k] - 2 * x);
    c.fillStyle = shade(m, 30 * e - (j == chip || k == chip ? (sea ? 20 : 40) : 0), sea);
    c.fill();
  }
  c.beginPath();
  for (let j = 0; j < n * 2; j += 2) {
    c.moveTo(px, py);
    c.lineTo(v[j], v[j + 1]);
  }
  c.strokeStyle = ridge;
  c.lineWidth = 2 * u;
  c.stroke();
  c.beginPath();
  for (let j = 0; j < n * 2; j += 2) {
    c.lineTo(v[j], v[j + 1]);
  }
  c.closePath();
  c.strokeStyle = edge;
  c.lineWidth = 4 * u;
  c.lineJoin = 'round';
  c.stroke();
  if (sea) {
    // Moss on the top left, barnacles on the bottom right, a wet glint.
    for (let j = 0; j < 4; j++) {
      const a = 3.4 + j * 0.5 + rnd(i + j) * 0.4;
      const d = r * (0.45 + rnd(i + j + 9) * 0.35);
      circle(
        x + Math.cos(a) * d,
        y + Math.sin(a) * d,
        r * (0.12 + rnd(i + j + 5) * 0.1),
        '#6f8f3acc',
      );
      const bx = x - Math.cos(a) * d * 0.9;
      const by = y - Math.sin(a) * d * 0.9;
      circle(bx, by, r * 0.08, '#e8e0cc');
      circle(bx, by, r * 0.035, '#4a4038');
    }
    c.beginPath();
    c.ellipse(x - r * 0.3, y - r * 0.38, r * 0.32, r * 0.09, -0.6, 0, 7);
    c.fillStyle = '#fff6';
    c.fill();
  }
  if (hits) {
    // A zigzag crack from one corner across the facets to the far side, lit on its top-left lip.
    const a = ((i * 3) % n) * 2;
    const b = (a + (n & ~1)) % (n * 2);
    const p: number[] = [];
    for (let k = 0; k < 6; k++) {
      const j = k % 5 ? (rnd(i * 11 + k) - 0.5) * r * 0.3 : 0;
      p.push(
        x + ((v[a] - x) * (5 - k) + (v[b] - x) * k) * 0.18 + j,
        y + ((v[a + 1] - y) * (5 - k) + (v[b + 1] - y) * k) * 0.18 - j,
      );
    }
    const w = hits > 1 ? 7 : 4;
    line(lip, w * u, ...p.map(q => q - w * u));
    line(crack, w * u, ...p);
    if (hits > 1) {
      // Deeper: two branches toward the next corners.
      for (const [s, t] of [
        [2, a + 4],
        [6, b + 4],
      ]) {
        const q = t % (n * 2);
        line(crack, 3 * u, p[s], p[s + 1], (p[s] + v[q]) / 2, (p[s + 1] + v[q + 1]) / 2);
      }
    }
  }
  if (e) {
    // Bumper flash: a ring spreading out, and ice shards (stone chips) flying off.
    c.globalAlpha = e;
    ring(x, y, r * (1.3 + (1 - e) * 0.6), flash, 8 * e * u);
    for (let j = 0; j < 6; j++) {
      const a = j * 1.05 + i;
      const d = r * (1.1 + (1 - e) * 1.4);
      const sx = x + Math.cos(a) * d;
      const sy = y + Math.sin(a) * d;
      const s = r * 0.12 + 3 * u;
      c.beginPath();
      c.moveTo(sx, sy - s);
      c.lineTo(sx + s, sy + s);
      c.lineTo(sx - s, sy + s * 0.4);
      c.fillStyle = chips;
      c.fill();
      c.strokeStyle = edge;
      c.lineWidth = 2 * u;
      c.stroke();
    }
    c.globalAlpha = 1;
  }
};

/**
 * A penguin sliding on its belly, head first, seen from above: a wake behind it on the ice.
 * e: hit animation, 1 → 0: it spins, flaps its flippers and sees stars.
 */
const penguin = (
  x: number,
  y: number,
  r: number,
  vx: number,
  vy: number,
  e: number,
  now: number,
) => {
  heading(x, y, r, vx, vy, e, '#8bd');
  // Seen three-quarter: the back is off-centre, the white belly shows on one flank.
  oval(-r * 0.15, r * 0.06, r * 0.85, r * 0.66, '#f7fbff');
  for (const s of [-1, 1]) {
    oval(-r * 0.95, s * r * 0.22, r * 0.22, r * 0.12, ORANGE);
    c.save();
    c.translate(0, s * r * 0.45);
    c.rotate(-s * (0.45 + Math.sin(now / 40) * e));
    oval(-r * 0.35, 0, r * 0.42, r * 0.13, BLACK);
    c.restore();
  }
  oval(-r * 0.2, -r * 0.08, r * 0.72, r * 0.44, BLACK);
  oval(-r * 0.35, -r * 0.22, r * 0.32, r * 0.09, '#fff3');
  circle(r * 0.55, 0, r * 0.4, BLACK);
  for (const s of [-1, 1]) {
    circle(r * 0.64, s * r * 0.2, r * 0.13, '#fff');
    circle(r * 0.69, s * r * 0.2, r * 0.06, '#111');
  }
  c.beginPath();
  c.moveTo(r * 0.86, -r * 0.11);
  c.lineTo(r * 1.15, 0);
  c.lineTo(r * 0.86, r * 0.11);
  c.fillStyle = ORANGE;
  c.fill();
  c.restore();
  stars(x, y, r, e, now);
};

/**
 * Starts drawing a mover at x, y, turned to its heading (local +x): shadow, then its wake (color)
 * behind it, then the hit spin (e: 1 → 0). Restore when done.
 */
const heading = (
  x: number,
  y: number,
  r: number,
  vx: number,
  vy: number,
  e: number,
  color: string,
) => {
  shadow(x + r * 0.2, y + r * 0.25, r * 1.1, r * 0.85, color == '#fff' ? '#02253a44' : '#0a4a7a55');
  c.save();
  c.translate(x, y);
  c.rotate(vx || vy ? Math.atan2(vy, vx) : 1.57);
  if (vx || vy) {
    c.beginPath();
    c.moveTo(-r * 0.6, -r * 0.5);
    c.lineTo(-r * 3, 0);
    c.lineTo(-r * 0.6, r * 0.5);
    fill(
      '#0000',
      c.createLinearGradient(-r * 3, 0, -r * 0.6, 0),
      [0, color + '0'],
      [1, color + 'a'],
    );
  }
  c.rotate(e * e * 12.6);
};

/** Stars circling a mover's head after a hit (e: 1 → 0); bubbles too at sea. */
const stars = (x: number, y: number, r: number, e: number, now: number, sea = 0) => {
  for (let k = 0; k < 3 && e; k++) {
    const b = now / 150 + k * 2.1;
    text(
      '★',
      x + Math.cos(b) * r * 0.8,
      y - r * 0.6 + Math.sin(b) * r * 0.3,
      r * 0.5,
      'center',
      '#ffc21a',
    );
  }
  for (let k = 0; k < 6 && sea && e; k++) {
    const b = k * 1.05 + now / 400;
    const d = r * (1 + (1 - e) * 0.8);
    ring(
      x + Math.cos(b) * d,
      y + Math.sin(b) * d - (1 - e) * r,
      r * (0.08 + (k % 3) * 0.04),
      '#e8fdff',
      2 * u,
    );
  }
};

const SHARK = '#7f8e9a';
const BELLY = '#e3ebef';
const FIN = '#5d6b77';

/**
 * A big grey shark swimming toward its heading, seen from above: a foam wake, a torpedo body over
 * its pale belly, bending as the tail beats side to side, swept pectoral fins, a dorsal fin with
 * its shadow, gills, small eyes and a toothy grin. i offsets its beat. e: hit animation, 1 → 0:
 * it jolts, spins, gapes, sees stars, bubbles burst out. All of it within 1.6 r of its centre.
 */
const shark = (
  x: number,
  y: number,
  r: number,
  vx: number,
  vy: number,
  e: number,
  now: number,
  i: number,
) => {
  const w = Math.sin(now / 130 + i);
  // Tail base, swinging side to side.
  const b = w * r * 0.22;
  heading(x, y, r, vx, vy, e, '#fff');
  c.translate(Math.sin(now / 20) * e * r * 0.15, 0);
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(r * 0.55, s * r * 0.35);
    c.quadraticCurveTo(r * 0.2, s * r * 1.05, -r * 0.3, s * r * (1.1 + 0.08 * w * s));
    c.quadraticCurveTo(0, s * r * 0.55, -r * 0.1, s * r * 0.35);
    c.fillStyle = FIN;
    c.fill();
  }
  // Tail fin: a crescent, the upper lobe longer, beating wider than the body.
  c.save();
  c.translate(-r * 1.1, b);
  c.rotate(w * 0.5);
  c.beginPath();
  c.moveTo(r * 0.05, 0);
  c.quadraticCurveTo(-r * 0.15, -r * 0.25, -r * 0.5, -r * 0.5);
  c.quadraticCurveTo(-r * 0.28, -r * 0.05, -r * 0.42, r * 0.35);
  c.quadraticCurveTo(-r * 0.12, r * 0.15, r * 0.05, 0);
  c.fillStyle = FIN;
  c.fill();
  c.restore();
  // The belly, then the back over it a little narrower: a pale edge all round.
  for (const k of [1, 0.8]) {
    c.beginPath();
    const h = k * r;
    c.moveTo(r * 1.5, 0);
    c.bezierCurveTo(r * 1.4, -h * 0.5, r * 0.6, -h * 0.62, 0, -h * 0.58);
    c.quadraticCurveTo(-r * 0.7, b * 0.5 - h * 0.42, -r * 1.1, b - h * 0.1);
    c.lineTo(-r * 1.1, b + h * 0.1);
    c.quadraticCurveTo(-r * 0.7, b * 0.5 + h * 0.42, 0, h * 0.58);
    c.bezierCurveTo(r * 0.6, h * 0.62, r * 1.4, h * 0.5, r * 1.5, 0);
    if (k < 1) {
      fill(
        SHARK,
        c.createLinearGradient(0, -r * 0.5, 0, r * 0.5),
        [0, '#fff4'],
        [0.5, '#fff0'],
        [1, '#0003'],
      );
    } else {
      c.fillStyle = BELLY;
      c.fill();
    }
  }
  // Gills, three slits a side.
  c.beginPath();
  for (let k = 0; k < 6; k++) {
    const gx = r * (0.7 + (k >> 1) * 0.11);
    const s = k & 1 ? 1 : -1;
    c.moveTo(gx, s * r * 0.28);
    c.lineTo(gx - r * 0.06, s * r * 0.42);
  }
  c.strokeStyle = '#3c4852';
  c.lineWidth = r * 0.035;
  c.lineCap = 'round';
  c.stroke();
  // Dorsal fin, swept back along the spine, its shadow on the back.
  for (const [o, color] of [
    [r * 0.1, '#0003'],
    [0, '#4a5863'],
  ] as const) {
    c.beginPath();
    c.moveTo(r * 0.35 - o, o);
    c.quadraticCurveTo(-r * 0.05 - o, -r * 0.16 + o, -r * 0.5 - o, b * 0.3 - r * 0.04 + o);
    c.quadraticCurveTo(-r * 0.05 - o, r * 0.1 + o, r * 0.35 - o, o);
    c.fillStyle = color;
    c.fill();
  }
  // A grin under the snout, gaping on a hit, a row of teeth showing.
  const g = r * (0.05 + 0.12 * e);
  oval(r * 1.22, 0, g, r * 0.2, '#3a1a20');
  c.beginPath();
  for (let k = -2; k <= 2; k++) {
    c.moveTo(r * 1.22 + g, k * r * 0.075 - r * 0.03);
    c.lineTo(r * 1.15 + g, k * r * 0.075);
    c.lineTo(r * 1.22 + g, k * r * 0.075 + r * 0.03);
  }
  c.fillStyle = '#f4f2e8';
  c.fill();
  for (const s of [-1, 1]) {
    circle(r * 1.05, s * r * 0.27, r * 0.065, '#111');
    circle(r * 1.07, s * r * 0.255, r * 0.022, '#fffc');
  }
  c.restore();
  stars(x, y, r, e, now, 1);
};

/**
 * Iceberg i shattering, q: 0 → 1 over 800 ms. Its facets slide apart on the ice, slowing down,
 * spinning a little and fading, in a puff of ice dust. A rock at sea crumbles: its stones roll a
 * little, then sink (shrink and darken) in rings of ripples.
 */
const shatter = (x: number, y: number, r: number, i: number, q: number, sea = 0) => {
  const [v, px, py] = corners(x, y, r, i);
  const d = r * (sea ? 0.35 : 1.6) * q * (2 - q);
  const z = 1 - sea * q * 0.9;
  c.globalAlpha = 1 - q;
  c.beginPath();
  for (let j = 0; j < (sea ? 3 : 9); j++) {
    const a = j * (sea ? 2.1 : 0.7) + i;
    const s = r * (sea ? 0.4 : 0.3 + q * (0.6 + rnd(j + i * 9)));
    const t = r * (sea ? 0.3 + q * 1.2 : 0.25 + q * 0.35);
    c.moveTo(x + Math.cos(a) * s + t, y + Math.sin(a) * s);
    c.arc(x + Math.cos(a) * s, y + Math.sin(a) * s, t, 0, 7);
  }
  if (sea) {
    c.strokeStyle = '#fff';
    c.lineWidth = 5 * u;
  } else {
    c.fillStyle = '#f8fdff';
    c.fill();
    c.strokeStyle = '#a9d4ea';
    c.lineWidth = 2 * u;
  }
  c.stroke();
  c.globalAlpha = Math.min(1, 2 - 2 * q);
  for (let j = 0; j < v.length; j += 2) {
    const k = (j + 2) % v.length;
    const cx = (px + v[j] + v[k]) / 3;
    const cy = (py + v[j + 1] + v[k + 1]) / 3;
    const m = Math.atan2(v[j + 1] + v[k + 1] - 2 * y, v[j] + v[k] - 2 * x);
    const s = d * (0.6 + rnd(i * 5 + j) * 0.8);
    c.save();
    c.translate(cx + Math.cos(m) * s, cy + Math.sin(m) * s);
    c.rotate((rnd(i + j * 3) - 0.5) * 2.5 * q);
    c.scale(z, z);
    c.beginPath();
    c.moveTo(px - cx, py - cy);
    c.lineTo(v[j] - cx, v[j + 1] - cy);
    c.lineTo(v[k] - cx, v[k + 1] - cy);
    c.closePath();
    c.fillStyle = shade(m, -30 * sea * q, sea);
    c.fill();
    c.strokeStyle = ROCKS[sea][2];
    c.lineWidth = 3 * u;
    c.stroke();
    c.restore();
  }
  c.globalAlpha = 1;
};

/**
 * A penguin shot out, q: 0 → 1 over 1 s, from where the puck hit it (x, y) along a. It flies off,
 * spinning and shrinking, stars around its head, feathers left behind; gone past the boards. A
 * shark (sea) leaves a splash: a ring of foam and droplets.
 */
const shot = (
  x: number,
  y: number,
  r: number,
  a: number,
  q: number,
  now: number,
  sea = 0,
  i = 0,
) => {
  c.globalAlpha = 1 - q;
  if (sea) {
    ring(x, y, r * (0.6 + q * 1.8), '#fff', 6 * u);
  }
  for (let j = 0; j < 6; j++) {
    const b = a + 3.14 + (rnd(j + 30) - 0.5) * 3;
    const d = r * (0.4 + q * (1.2 + rnd(j + 40)));
    c.beginPath();
    c.ellipse(x + Math.cos(b) * d, y + Math.sin(b) * d, r * 0.3, r * 0.1, b + q * j, 0, 7);
    c.fillStyle = sea ? (j % 2 ? '#fff' : '#bdf3ff') : j % 3 ? '#f7fbff' : BLACK;
    c.fill();
    c.strokeStyle = sea ? '#fff' : '#7fb6d6';
    c.lineWidth = 2 * u;
    c.stroke();
  }
  c.globalAlpha = Math.min(1, 4 - 4 * q);
  const d = r * 24 * q;
  const vx = Math.cos(a);
  const vy = Math.sin(a);
  (sea ? shark : penguin)(x + vx * d, y + vy * d, r * (1 - 0.35 * q), vx, vy, 1 - q, now, i);
  c.globalAlpha = 1;
};

/** What the host says of an obstacle, Snapshot.obs[i]. */
export type ObstacleView = NonNullable<Snapshot['obs']>[number];

/**
 * An obstacle, in world units; age: ms since the puck last hit it, back: ms since it came back in
 * play. st: its state, absent while intact and in play. Once removed (st.since ≥ 0), from where it
 * was then: an iceberg shatters, a rock crumbles, a penguin or a shark is shot out. Then nothing
 * until its ghost, at o (its lane goes on): see-through, beating faster and faster, a ring
 * closing on it, bubbles rising at sea. Back in play it pops in.
 */
export const obstacle = (
  o: Obstacle,
  i: number,
  age: number,
  now: number,
  st?: ObstacleView,
  back = 1e9,
  from = o,
) => {
  const ms = st && st.since >= 0 ? (st.since * 1000) / TICK_HZ : -1;
  const { kind, x, y, r, vx, vy } = o;
  const fixed = kind == 'iceberg' || kind == 'rock';
  const sea = kind == 'rock' || kind == 'shark' ? 1 : 0;
  if (ms >= 0 && ms < SHOW) {
    if (ms < (fixed ? 800 : 1000)) {
      if (fixed) {
        shatter(from.x, from.y, from.r, i, ms / 800, sea);
      } else {
        shot(from.x, from.y, from.r, st!.angle, ms / 1000, now, sea, i);
      }
    }
    return;
  }
  const q = back / 300;
  c.save();
  if (ms >= 0) {
    // Beats at each whole p, closer and closer: 6 of them in the last 3 s.
    const p = (ms - SHOW) / (BACK - SHOW);
    const b = (1 - ((3 * p * (1 + p)) % 1)) ** 3;
    c.globalAlpha = 0.3 + 0.6 * b;
    ring(x, y, r * (1.2 + 1.5 * (1 - p)), sea ? '#e0fbff' : '#7fe3ff', (3 + 6 * b) * u);
    for (let j = 0; j < 5 * sea; j++) {
      const h = (now / 8 + j * r * 0.5) % (r * 1.8);
      ring(
        x + (j - 2) * r * 0.35 + Math.sin(now / 300 + j) * r * 0.1,
        y + r * 0.7 - h,
        r * (0.06 + (j % 2) * 0.04),
        '#e0fbff',
        2 * u,
      );
    }
    c.globalAlpha = 0.25 + 0.2 * b;
    age = 1e9;
  } else if (q < 1) {
    const z = 0.85 + 0.15 * q + 0.2 * Math.sin(q * 3.14);
    c.translate(x, y);
    c.scale(z, z);
    c.translate(-x, -y);
  }
  if (fixed) {
    berg(x, y, r, i, Math.max(0, 1 - age / 400), age, ms < 0 ? st?.hits : 0, sea, now);
  } else {
    (sea ? shark : penguin)(x, y, r, vx, vy, Math.max(0, 1 - age / 800), now, i);
  }
  c.restore();
  if (ms < 0 && q < 1) {
    c.globalAlpha = 1 - q;
    ring(x, y, r * (1.2 + q * 0.6), '#fff', 6 * u);
    c.globalAlpha = 1;
  }
};

/**
 * Gold doubloon at sea, over the drawn puck disc (x, y, r): a dark edge, a raised rim, a cross
 * struck in the middle and a glint.
 */
export const doubloon = (x: number, y: number, r: number) => {
  circle(x, y, r, '#e9b52c');
  ring(x, y, r * 0.95, '#6e4a08', r * 0.1);
  ring(x, y, r * 0.72, GOLD, r * 0.1);
  line(GOLD, r * 0.16, x - r * 0.36, y, x + r * 0.36, y);
  line(GOLD, r * 0.16, x, y - r * 0.36, x, y + r * 0.36);
  c.beginPath();
  c.arc(x, y, r * 0.84, 3.6, 4.7);
  c.strokeStyle = '#fffa';
  c.lineWidth = r * 0.1;
  c.stroke();
};

/**
 * The puck's trail, in world units: p holds the last positions drawn (x, y pairs), the one at
 * x, y is pushed. Drawn as a fading streak while the puck is fast; a jump (serve) starts it over.
 * Speeds scale with the rink, so does the jump. r is the drawn puck radius: the streak is as wide.
 */
export const streak = (
  p: number[],
  x: number,
  y: number,
  fast: boolean,
  color: string,
  r = PUCK_R,
) => {
  const n = p.length;
  if (!fast || Math.hypot(x - p[n - 2], y - p[n - 1]) > 300 * u) {
    p.length = 0;
  }
  p.push(x, y);
  if (p.length > 20) {
    p.splice(0, 2);
  }
  for (let i = 2; i < p.length; i += 2) {
    c.globalAlpha = (i / p.length) * 0.5;
    line(color, (r * 2 * i) / p.length, p[i - 2], p[i - 1], p[i], p[i + 1]);
  }
  c.globalAlpha = 1;
};

/**
 * Marks the puck so it stays easy to spot on a big rink: a yellow glow breathing slowly (one cycle
 * every ~2.5 s) and three arcs turning around it (one turn every ~4 s). r is the drawn puck radius.
 */
export const beacon = (x: number, y: number, r: number, now: number) => {
  const b = 0.5 + 0.5 * Math.sin(now / 400);
  c.beginPath();
  c.arc(x, y, r * 3.4, 0, 7);
  fill(
    '#0000',
    c.createRadialGradient(x, y, r, x, y, r * 3.4),
    [0, `rgba(255,204,51,${0.35 + 0.4 * b})`],
    [1, '#ffcc3300'],
  );
  c.strokeStyle = '#fc3';
  c.lineWidth = r * 0.3;
  c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = now / 640 + (i * Math.PI * 2) / 3;
    c.beginPath();
    c.arc(x, y, r * 2.4, a, a + 1.2);
    c.stroke();
  }
};

/** Snowflakes drifting down over the rink, in base rink coordinates: the same at any size. */
export const snow = (now: number) => {
  c.beginPath();
  for (let i = 0; i < 40; i++) {
    const x = (rnd(i + 300) * W + Math.sin(now / 1500 + i) * 30 + W) % W;
    const y = (rnd(i + 350) * H + now * (0.015 + rnd(i + 400) * 0.03)) % H;
    const s = 2 + rnd(i + 400) * 5;
    c.moveTo(x + s, y);
    c.arc(x, y, s, 0, 7);
  }
  c.fillStyle = '#fffd';
  c.fill();
  c.strokeStyle = '#7fb6d655';
  c.lineWidth = 2;
  c.stroke();
};

/** Covers the rink (in rink coordinates) with color, label in the middle. */
export const veil = (color: string, label = '') => {
  rect(0, 0, W, H, color);
  text(label, W / 2 + 5, H / 2 + 5, f * 2, 'center', '#0006');
  text(label, W / 2, H / 2, f * 2);
};

/**
 * The countdown over the rink centre, in rink coordinates: q goes 0 → 1 over each label, which
 * pops in big, settles, then swells and fades out. About 40 % of the rink height: some 80 CSS px
 * on a 343 px wide phone.
 */
export const countdown = (label: string, q: number, color = '#fff') => {
  const z = H * 0.42 * (1 + 0.4 * q + 0.5 * (1 - q) ** 8);
  c.globalAlpha = 1 - q * q;
  text(label, W / 2 + z / 30, H / 2 + z / 30, z, 'center', '#0006', W * 0.9);
  // A thick navy outline: readable on the white ice as on the dark classic table.
  c.strokeStyle = '#0d2240';
  c.lineWidth = z / 9;
  c.lineJoin = 'round';
  c.strokeText(label, W / 2, H / 2, W * 0.9);
  text(label, W / 2, H / 2, z, 'center', color, W * 0.9);
  c.globalAlpha = 1;
};

const side = (t?: Team) => (t ? 'Right' : 'Left');

/** Score and round line in the band above the rink, team rosters in the band below. */
export const hud = (
  players: PlayerInfo[],
  you: number,
  score: string,
  label: string,
  { phase, round = 0, rounds, goals, wins = [0, 0], winner }: Partial<MatchState>,
) => {
  const brk = phase == 'break';
  text(
    brk ? `${side(winner)} wins round ${round}` : score,
    W / 2,
    TOP * 0.36,
    Math.max(f * 1.5, 90),
    'center',
    '#fff',
    W - f * 2,
  );
  text(
    label ||
      (brk
        ? `Left ${wins.join(' – ')} Right`
        : phase == 'wait'
          ? 'Waiting for a player on each side'
          : phase == 'play' || phase == 'ready'
            ? `Round ${round}/${rounds} · ${wins.join('–')} · first to ${goals}`
            : ''),
    W / 2,
    TOP * 0.8,
    Math.max(f, 45),
    'center',
    label ? '#fc3' : '#fffb',
    W - f,
  );
  // Left team from the left edge, Right team mirrored from the right edge, dots outside.
  const lh = f * 1.1;
  const teams = byTeam(players).map((team, t) => {
    const ws = [side(t as Team), ...team.map(p => p.name)].map(
      (s, i) => width(s, f) + f * (i ? 1.6 : 0.7),
    );
    return [team, ws, flow(ws, W / 2 - f * 3, Math.max(1, Math.floor(BOT / lh - 0.2)))] as const;
  });
  // Rows in use, centred in the band.
  const used = Math.max(...teams.map(([, , at]) => at[at.length - 1][1])) + 1;
  const y0 = TOP + H + (BOT - used * lh + lh) / 2;
  teams.forEach(([team, ws, at], t) => {
    const put = (s: string, x: number, row: number, color = '#fff8', max?: number) =>
      text(s, t ? W - x : x, y0 + row * lh, f, t ? 'right' : 'left', color, max);
    at.forEach(([x, row], i) => {
      const p = team[i - 1];
      x += f / 2;
      if (p) {
        circle(t ? W - x - f / 3 : x + f / 3, y0 + row * lh, f / 3, p.color);
        put(p.name, x + f * 0.9, row, p.id == you ? '#fc3' : '#fff', W / 2 - f * 4);
      } else {
        put(side(t as Team), x, row);
      }
    });
    const [x, row] = at[at.length - 1];
    if (at.length < ws.length) {
      put(`+${ws.length - at.length}`, x + ws[at.length - 1] + f / 2, row);
    }
  });
};

/** End of match, full canvas: stadium at night, podium of the top scorers, points ranking. */
export const stadium = (ranking: Rank[], winner: Team | undefined, now: number) => {
  const u = Math.max(f, 80);
  const crowd = ranking.map(r => r.color);
  const pick = (i: number) => crowd[i % (crowd.length + 3)] ?? '#3b4870';
  // Night sky, lighter toward the horizon.
  for (let i = 0; i < 24; i++) {
    rect(0, (i * CH) / 24, W, CH / 24 + 1, `hsl(226 50% ${3 + i * 0.6}%)`);
  }
  // Stands: rows of spectators in the players' colours, bobbing.
  const s1 = CH * 0.66;
  c.globalAlpha = 0.5;
  for (let j = 0, y = CH * 0.33; y < s1; j++, y += 34) {
    rect(0, y - 17, W, 34, j % 2 ? '#0c1630' : '#101d3d');
    for (let i = 0, x = (j % 2) * 15 + 10; x < W; i++, x += 30) {
      circle(x, y + Math.sin(now / 150 + i * 2 + j) * 3, 10, pick(i * 7 + j * 13 + i * j));
    }
  }
  c.globalAlpha = 1;
  rect(0, s1, W, CH, '#14213b');
  rect(0, s1, W, 12, '#2b3d68');
  // Floodlight heads above the stands; their beams are drawn last, over the podium.
  const lamps = [0.1, 0.36, 0.64, 0.9].map(v => v * W);
  for (const x of lamps) {
    const y = CH * 0.25;
    circle(x, y, 60, '#fff2');
    for (let i = 0; i < 8; i++) {
      circle(x - 27 + (i % 4) * 18, y - 9 + (i >> 2) * 18, 7, '#fffbe6');
    }
  }

  text(
    `🏆 ${winner == null ? 'Match over' : side(winner) + ' team wins'}`,
    W / 2,
    u * 1.1,
    u * 1.5,
    'center',
    '#fff',
    W - u,
  );
  // The winning team's players, in their colours, squeezed to fit the width.
  const v = Math.max(f, 50);
  const team = ranking.filter(r => r.team == winner && !r.left);
  const ws = team.map(r => width(r.name, v) + v);
  const z = Math.min(1, (W - v * 2) / ws.reduce((a, b) => a + b, 0));
  let x = W / 2 - (ws.reduce((a, b) => a + b, -v) * z) / 2;
  team.forEach((r, i) => {
    text(r.name, x, u * 2.4, v, 'left', r.color, (ws[i] - v) * z);
    x += ws[i] * z;
  });

  // Podium left of the ranking: 1st in the middle and highest, 2nd left, 3rd right.
  const pw = Math.min(W * 0.36, f * 12);
  const sw = Math.min(u * 5, (W - pw) / 3.4);
  const top = podium(ranking);
  const med = ['#fc3', '#cfd6df', '#cd7f32'];
  // One stepped block seen from the front, slightly above: the top faces recede toward a single
  // vanishing point above the centre step, and the shading spans the whole front, so the three
  // steps read as one piece. Side steps first, the centre step is drawn over them.
  const d = sw * 0.16;
  const pc = (W - pw) / 2;
  const at = (i: number) => pc + [0, -1, 1][i] * sw;
  const ys = [3.4, 2.7, 2.2].map(h => CH - u * (0.4 + h));
  const back = (x: number) => pc + (x - pc) * 0.88;
  for (const i of top[0] ? [1, 2, 0] : []) {
    const m = at(i);
    const y = ys[i];
    const l = m - sw / 2;
    c.beginPath();
    c.moveTo(l, y);
    c.lineTo(back(l), y - d);
    c.lineTo(back(l + sw), y - d);
    c.lineTo(l + sw, y);
    fill('#f4f7fb', c.createLinearGradient(0, y - d, 0, y), [0, '#fff0'], [1, '#b8c4d688']);
    c.beginPath();
    c.rect(l, y, sw, CH - y);
    fill(
      '#d6deea',
      c.createLinearGradient(pc - sw * 1.5, 0, pc + sw * 1.5, 0),
      [0, '#0005'],
      [0.25, '#fff3'],
      [0.5, '#fff0'],
      [1, '#0005'],
    );
    fill('#0000', c.createLinearGradient(0, ys[0], 0, CH), [0, '#0000'], [1, '#0006']);
    rect(l, y + u * 0.14, sw, u * 0.16, med[i]);
    line('#fff', 4, l, y, l + sw, y);
    // Embossed rank: dark below right, light above left.
    const n = i + 1 + '';
    const ny = y + u * 0.95;
    text(n, m + 4, ny + 4, u * 1.1, 'center', '#0004');
    text(n, m - 2, ny - 2, u * 1.1, 'center', '#fff');
    text(n, m, ny, u * 1.1, 'center', '#2a4170');
    const r = top[i];
    if (r) {
      text(
        `${r.goals} goal${r.goals == 1 ? '' : 's'}`,
        m,
        ny + u * 0.9,
        f,
        'center',
        '#2a4170',
        sw,
      );
    }
  }
  // The players, once every block is drawn, about 6.5 heads tall: shadow, shoes, legs, shirt in
  // the player's colour, arms, neck, head with hair, and the medal hanging on the chest.
  // The winner sways both arms up; the others wave with their outer arm.
  const q = u * 1.2;
  top.forEach((r, i) => {
    if (!r) {
      return;
    }
    const m = at(i);
    const g = ys[i] - d / 2;
    const hp = g - q * 1.45;
    const sh = hp - q * 1.2;
    const hy = sh - q * 0.42;
    const skin = ['#f1c7a0', '#d9a273', '#a86d43', '#6b4429'][r.id % 4];
    const wave = Math.sin(now / 190 + i * 2);
    shadow(m, g, q * 0.6, d * 0.3);
    rect(m - q * 0.27, hp - q * 0.1, q * 0.54, q * 0.3, '#2b3446');
    for (const e of [-1, 1]) {
      line('#2b3446', q * 0.26, m + e * q * 0.14, hp, m + e * q * 0.15, g - q * 0.12);
      line(
        '#fff2',
        q * 0.06,
        m + e * q * 0.14 - q * 0.06,
        hp,
        m + e * q * 0.15 - q * 0.06,
        g - q * 0.14,
      );
      ball(m + e * q * 0.18, g - q * 0.07, q * 0.11, '#1d2433');
    }
    c.beginPath();
    c.moveTo(m - q * 0.4, sh);
    c.lineTo(m + q * 0.4, sh);
    c.lineTo(m + q * 0.29, hp + q * 0.05);
    c.lineTo(m - q * 0.29, hp + q * 0.05);
    fill(
      r.color,
      c.createLinearGradient(m - q * 0.4, 0, m + q * 0.4, 0),
      [0, '#0006'],
      [0.3, '#fff4'],
      [0.55, '#fff0'],
      [1, '#0007'],
    );
    for (const e of [-1, 1]) {
      const sx = m + e * q * 0.36;
      const sy = sh + q * 0.08;
      const up = !i || e == (i == 1 ? -1 : 1);
      const sway = up ? (i ? wave * 0.18 : wave * 0.1) : wave * 0.02;
      const [ex, ey, hx, hy2] = up
        ? [
            m + e * q * (i ? 0.62 : 0.6 + sway / 2),
            sh + q * (i ? 0.02 : -0.32),
            m + e * q * (0.72 + sway),
            sh - q * (i ? 0.48 : 0.86),
          ]
        : [m + e * q * 0.47, sh + q * 0.62, m + e * q * (0.5 + sway), sh + q * 1.12];
      line(skin, q * 0.15, sx, sy, ex, ey, hx, hy2);
      line(r.color, q * 0.21, sx, sy, (sx + ex) / 2, (sy + ey) / 2);
      ball(hx, hy2, q * 0.09, skin);
    }
    rect(m - q * 0.07, sh - q * 0.14, q * 0.14, q * 0.16, skin);
    c.save();
    c.translate(m, hy);
    c.scale(1, 1.15);
    ball(0, 0, q * 0.25, skin);
    c.beginPath();
    c.arc(0, -q * 0.02, q * 0.26, 3.3, 6.1);
    c.fillStyle = ['#2b1d14', '#5a3a22', '#c89a4a', '#111'][r.id % 4];
    c.fill();
    c.restore();
    for (const e of [-1, 1]) {
      circle(m + e * q * 0.08, hy + q * 0.01, q * 0.03, '#222');
    }
    c.beginPath();
    c.arc(m, hy + q * 0.06, q * 0.09, 0.4, 2.7);
    c.strokeStyle = '#6a2a1a';
    c.lineWidth = q * 0.03;
    c.stroke();
    line('#c22', q * 0.07, m - q * 0.2, sh + q * 0.02, m, sh + q * 0.52);
    line('#2a5bd7', q * 0.07, m + q * 0.2, sh + q * 0.02, m, sh + q * 0.52);
    ball(m, sh + q * 0.62, q * 0.17, med[i]);
    text(r.name, m, hy - q * 0.7, f, 'center', '#fff', sw);
  });

  // Floodlight beams sweeping slowly over the podium, added on top so they light it.
  c.globalCompositeOperation = 'lighter';
  lamps.forEach((x, j) => {
    const y = CH * 0.25;
    const aim = pc + (x - pc) * 0.35 + Math.sin(now / 1800 + j * 1.7) * sw * 0.9;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(aim - 130, CH);
    c.lineTo(aim + 130, CH);
    fill('#0000', c.createLinearGradient(0, y, 0, CH), [0, '#fff3'], [1, '#fff1']);
  });
  c.globalCompositeOperation = 'source-over';
  // Confetti: a light rain, each piece flipping (its width) as it drifts down.
  for (let i = 0; i < 70; i++) {
    const w = 10 * Math.abs(Math.cos(now / 260 + i));
    rect(
      ((i * 397 + Math.sin(now / 700 + i) * 40) % W) - w / 2,
      (i * 233 + now * (0.02 + (i % 5) * 0.008)) % CH,
      w + 1,
      8,
      pick(i * 5),
    );
  }

  // Points ranking, small, bottom-right; players who left are greyed.
  const lh = f * 1.2;
  const [k, more] = shown(ranking.length, Math.floor((CH * 0.5) / lh) - 1);
  const ph = (k + (more ? 2 : 1)) * lh + f / 2;
  const x0 = W - pw - u * 0.3;
  const y0 = CH - u * 0.3 - ph;
  rect(x0, y0, pw, ph, '#000b');
  text('Points', x0 + f / 2, y0 + lh * 0.7, f, 'left', '#fff8');
  for (let i = 0; i < k; i++) {
    const r = ranking[i];
    const y = y0 + lh * (i + 1.7);
    c.globalAlpha = r.left ? 0.4 : 1;
    text(`${i + 1}. ${r.name}`, x0 + f / 2, y, f, 'left', r.color, pw - f * 3.2);
    text(r.points + '', x0 + pw - f / 2, y, f, 'right');
  }
  c.globalAlpha = 1;
  if (more) {
    text(`+${more} more`, x0 + f / 2, y0 + lh * (k + 1.7), f, 'left', '#fff8');
  }
};
