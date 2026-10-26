// Canvas drawing in field units: the rink and its obstacles, HUD bands around the rink, and the
// end-of-match stadium.
import { GOAL, H, PUCK_R, W } from '../shared/constants';
import type { Obstacle, PlayerInfo, Rank, Team } from '../shared/types';
import type { MatchState } from './index';
import { BOT, CH, TOP, byTeam, flow, podium, rnd, shown } from './util';

let c: CanvasRenderingContext2D;
/** Base font size in field units, never under 12 CSS px. */
let f: number;

/** Starts a frame: the helpers below draw on ctx, size is the base font size. */
export const pen = (ctx: CanvasRenderingContext2D, size: number) => {
  c = ctx;
  f = size;
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

/**
 * The rink, in rink coordinates. Ice: pale ice with a sheen and skate marks, faded hockey
 * markings, blue boards, red-framed nets. Classic: the dark table.
 */
const paint = (ice: boolean) => {
  const m = (H - GOAL) / 2;
  if (!ice) {
    rect(0, 0, W, H, '#0d2233');
    ring(W / 2, H / 2, 150, '#fff4', 6);
    line('#fff4', 6, W / 2, 0, W / 2, H);
    rect(0, m, 12, GOAL, '#fc3');
    rect(W - 12, m, 12, GOAL, '#fc3');
    return;
  }
  c.save();
  c.beginPath();
  c.rect(0, 0, W, H);
  c.clip();
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
  for (let i = 0; i < 40; i++) {
    const x = rnd(i) * W;
    const y = rnd(i + 50) * H;
    const r = 90 + rnd(i + 99) * 320;
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

/** Rink images per context, with what they were drawn for: arena and scale. */
const cache = new WeakMap<object, [string, HTMLCanvasElement]>();

/**
 * Draws the rink, in rink coordinates, k canvas pixels per unit. Its full-size gradients cost
 * more than the rest of the frame: it is painted once per arena and size, then copied.
 */
export const rink = (ice: boolean, k: number) => {
  const key = `${ice}${k}`;
  let img = cache.get(c)?.[0] == key ? cache.get(c)![1] : undefined;
  if (!img) {
    const ctx = c;
    img = document.createElement('canvas');
    img.width = W * k;
    img.height = H * k;
    c = img.getContext('2d')!;
    c.scale(k, k);
    paint(ice);
    c = ctx;
    cache.set(c, [key, img]);
  }
  c.drawImage(img, 0, 0, W, H);
};

/** An iceberg: facets lit from the top left. e: hit flash, 1 → 0. */
const berg = (x: number, y: number, r: number, i: number, e: number, age: number) => {
  x += Math.sin(age / 12) * e * 8;
  shadow(x + r * 0.25, y + r * 0.3, r * 1.3, r, '#0a4a7a66');
  const n = 7 + (i % 3);
  const v: number[] = [];
  for (let j = 0; j < n; j++) {
    const a = ((j + rnd(i * 9 + j) * 0.6) / n) * 6.283;
    const d = r * (1.02 + rnd(i * 7 + j + 50) * 0.22);
    v.push(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  // Facets from a peak off-centre: bright toward the top left, shaded toward the bottom right.
  const px = x - r * 0.18;
  const py = y - r * 0.22;
  for (let j = 0; j < n * 2; j += 2) {
    const k = (j + 2) % (n * 2);
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(v[j], v[j + 1]);
    c.lineTo(v[k], v[k + 1]);
    const m = Math.atan2(v[j + 1] + v[k + 1] - 2 * y, v[j] + v[k] - 2 * x);
    c.fillStyle = `hsl(196 70% ${76 + 18 * Math.cos(m + 2.36) + 30 * e}%)`;
    c.fill();
  }
  c.beginPath();
  for (let j = 0; j < n * 2; j += 2) {
    c.moveTo(px, py);
    c.lineTo(v[j], v[j + 1]);
  }
  c.strokeStyle = '#fffa';
  c.lineWidth = 2;
  c.stroke();
  c.beginPath();
  for (let j = 0; j < n * 2; j += 2) {
    c.lineTo(v[j], v[j + 1]);
  }
  c.closePath();
  c.strokeStyle = '#4f9cc4';
  c.lineWidth = 4;
  c.lineJoin = 'round';
  c.stroke();
  if (e) {
    // Bumper flash: a ring spreading out, and ice shards flying off.
    c.globalAlpha = e;
    ring(x, y, r * (1.3 + (1 - e) * 0.6), '#7fe3ff', 8 * e);
    for (let j = 0; j < 6; j++) {
      const a = j * 1.05 + i;
      const d = r * (1.1 + (1 - e) * 1.4);
      const sx = x + Math.cos(a) * d;
      const sy = y + Math.sin(a) * d;
      const s = r * 0.12 + 3;
      c.beginPath();
      c.moveTo(sx, sy - s);
      c.lineTo(sx + s, sy + s);
      c.lineTo(sx - s, sy + s * 0.4);
      c.fillStyle = '#e6faff';
      c.fill();
      c.strokeStyle = '#4f9cc4';
      c.lineWidth = 2;
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
  shadow(x + r * 0.2, y + r * 0.25, r * 1.1, r * 0.85, '#0a4a7a55');
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
      [0, '#7fb6d600'],
      [1, '#7fb6d6aa'],
    );
  }
  // Seen three-quarter: the back is off-centre, the white belly shows on one flank.
  c.rotate(e * e * 12.6);
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
};

/** An obstacle of the ice arena; age: ms since the puck last hit it. */
export const obstacle = (
  { kind, x, y, r, vx, vy }: Obstacle,
  i: number,
  age: number,
  now: number,
) =>
  kind == 'iceberg'
    ? berg(x, y, r, i, Math.max(0, 1 - age / 400), age)
    : penguin(x, y, r, vx, vy, Math.max(0, 1 - age / 800), now);

/**
 * The puck's trail: p holds the last positions drawn (x, y pairs), the one at x, y is pushed.
 * Drawn as a fading streak while the puck is fast; a jump (serve) starts it over.
 */
export const streak = (p: number[], x: number, y: number, fast: boolean, color: string) => {
  const n = p.length;
  if (!fast || Math.hypot(x - p[n - 2], y - p[n - 1]) > 300) {
    p.length = 0;
  }
  p.push(x, y);
  if (p.length > 20) {
    p.splice(0, 2);
  }
  for (let i = 2; i < p.length; i += 2) {
    c.globalAlpha = (i / p.length) * 0.5;
    line(color, (PUCK_R * 2 * i) / p.length, p[i - 2], p[i - 1], p[i], p[i + 1]);
  }
  c.globalAlpha = 1;
};

/** Snowflakes drifting down over the rink. */
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
          : phase == 'play'
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
