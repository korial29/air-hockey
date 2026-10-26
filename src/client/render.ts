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
  // Floodlights above the stands, their cones reaching the floor.
  for (const v of [0.1, 0.36, 0.64, 0.9]) {
    const x = v * W;
    const y = CH * 0.25;
    c.fillStyle = '#fff2';
    c.beginPath();
    c.lineTo(x, y);
    c.lineTo(x + (W / 2 - x) / 2 - 150, CH);
    c.lineTo(x + (W / 2 - x) / 2 + 150, CH);
    c.fill();
    circle(x, y, 60, '#fff2');
    for (let i = 0; i < 8; i++) {
      circle(x - 27 + (i % 4) * 18, y - 9 + (i >> 2) * 18, 7, '#fffbe6');
    }
  }
  // Confetti.
  for (let i = 0; i < 40; i++) {
    rect(
      (i * 397 + Math.sin(now / 400 + i) * 30) % W,
      (i * 233 + now * (0.04 + (i % 4) * 0.015)) % CH,
      9,
      15,
      pick(i * 5),
    );
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
  for (let i = 0; i < 3 && top[0]; i++) {
    const r = top[i];
    const m = (W - pw) / 2 + [0, -1, 1][i] * sw;
    const y = CH - u * (0.4 + [3.4, 2.7, 2.2][i]);
    rect(m - sw / 2, y, sw, CH, '#dce3ee');
    rect(m - sw / 2, y, sw, 10, '#fff');
    rect(m + sw / 2 - 10, y, 10, CH, '#0002');
    text(i + 1 + '', m, y + u * 0.75, u * 1.1, 'center', '#2a4170');
    if (r) {
      text(`${r.goals} goal${r.goals > 1 ? 's' : ''}`, m, y + u * 1.65, f, 'center', '#2a4170', sw);
      // The player: arms (raised by the winner), body, head; medal hanging on the chest.
      const b = u * 0.55;
      const t = y - u * 1.5;
      for (const e of [-b, b]) {
        line(
          r.color,
          u / 4,
          m + e * 0.7,
          t + u * 0.3,
          m + e * (i ? 1.4 : 1.8),
          t + u * (i ? 1.1 : -0.6),
        );
      }
      circle(m, t + b, b, r.color);
      rect(m - b, t + b, b * 2, y - t - b, r.color);
      circle(m, t - u * 0.42, u * 0.48, r.color);
      for (const e of [-1, 1]) {
        circle(m + e * u * 0.17, t - u * 0.48, u * 0.09, '#fff');
        circle(m + e * u * 0.17, t - u * 0.46, u * 0.045, '#000');
      }
      line('#d33', u * 0.12, m - b * 0.6, t + u * 0.1, m, t + u * 0.75, m + b * 0.6, t + u * 0.1);
      circle(m, t + u * 0.8, u * 0.26, ['#fc3', '#d5dbe3', '#cd7f32'][i]);
      circle(m, t + u * 0.8, u * 0.15, '#0002');
      text(r.name, m, t - u * 1.4, f, 'center', '#fff', sw);
    }
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
