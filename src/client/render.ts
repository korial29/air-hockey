// Canvas drawing in field units: HUD bands around the rink, and the end-of-match stadium.
import { H, W } from '../shared/constants';
import type { PlayerInfo, Rank, Team } from '../shared/types';
import type { MatchState } from './index';
import { BOT, CH, TOP, byTeam, flow, podium, shown } from './util';

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
const shadow = (x: number, y: number, rx: number, ry: number) => {
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  c.beginPath();
  c.arc(0, 0, rx, 0, 7);
  fill('#0000', c.createRadialGradient(0, 0, 0, 0, 0, rx), [0, '#0008'], [1, '#0000']);
  c.restore();
};

/** Covers the rink (in rink coordinates) with color, label in the middle. */
export const veil = (color: string, label = '') => {
  rect(0, 0, W, H, color);
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
    Math.max(f * 1.5, 72),
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
    Math.max(f, 36),
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
  const u = Math.max(f, 64);
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
  const v = Math.max(f, 40);
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
