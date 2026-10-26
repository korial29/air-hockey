import { describe, expect, it } from 'vitest';
import { obstacles } from '../shared/arena';
import {
  GOAL,
  H,
  PADDLE_MAX_SPEED,
  PADDLE_R,
  PUCK_R,
  SNAP_EVERY,
  TICK_HZ,
  W,
} from '../shared/constants';
import { createWorld, step } from '../shared/physics';
import type { Puck, Snapshot } from '../shared/types';
import { predict, rebase, reset, view } from './predict';

/** One physics step, ms. */
const DT = 1000 / TICK_HZ;
const ME = 3;
const OTHER = 4;

const snap = (
  puck: Partial<Puck>,
  paddles = [{ id: ME, x: 300, y: 450 }],
  score: [number, number] = [0, 0],
): Snapshot => ({
  tick: 0,
  score,
  puck: { x: 800, y: 450, vx: 0, vy: 0, ...puck },
  paddles,
});

/** A prediction on the classic (empty) rink, as the match message sets it. */
const classic = () => {
  const p = predict();
  reset(p, 'play', 'classic');
  return p;
};

/** Drawn puck and own paddle at time t. */
const draw = (p: ReturnType<typeof predict>, s: Snapshot, t: number, target?: [number, number]) => {
  const v = view(p, s, t, target)!;
  return { puck: v.puck, me: v.paddles.find(q => q.id == ME), v };
};

describe('predict', () => {
  it('draws nothing before the first snapshot', () => {
    expect(view(classic(), undefined, 100)).toBeUndefined();
  });

  it('moves the own paddle toward the pointer at the host speed cap, inside its half', () => {
    const p = classic();
    const s = snap({}, [
      { id: ME, x: 200, y: 450 },
      { id: OTHER, x: 1400, y: 450 },
    ]);
    rebase(p, s, ME, 0);
    expect(p.me).toMatchObject({ id: ME, team: 0, x: 200, y: 450 });
    expect(p.w.paddles.find(q => q.id == OTHER)).toMatchObject({ team: 1, x: 1400 });

    // 8 steps of PADDLE_MAX_SPEED / TICK_HZ = 25 units.
    const a = draw(p, s, 8.5 * DT, [700, 450]);
    expect(a.me!.x).toBeCloseTo(200 + (8 * PADDLE_MAX_SPEED) / TICK_HZ);
    // Other paddles are drawn from the interpolated snapshot, untouched.
    expect(a.v.paddles.find(q => q.id == OTHER)).toBe(s.paddles[1]);

    // A target across the centre line stops at the line, as on the host.
    let b = draw(p, s, 9 * DT, [1000, 450]);
    for (let t = 10 * DT; t < 500; t += 16) {
      b = draw(p, s, t);
    }
    expect(b.me).toMatchObject({ x: W / 2 - PADDLE_R, y: 450 });
  });

  it('redirects the puck on an own hit at once and ignores snapshots that miss it for a while', () => {
    const p = classic();
    rebase(p, snap({ x: 420, vx: -2000 }), ME, 0);
    expect(draw(p, snap({}), DT / 2).puck.vx).toBeLessThan(0);
    // Contact in 3 steps: the very frame that reaches it shows the puck going back.
    const hit = draw(p, snap({}), 46).puck;
    expect(hit.vx).toBeGreaterThan(0);

    // The host has not seen the hit yet: its puck still comes in.
    rebase(p, snap({ x: 380, vx: -1900 }), ME, 50);
    expect(p.w.puck.vx).toBeGreaterThan(0);

    // Past the grace period, a disagreeing host wins, without a jump on screen.
    const t = 300;
    const before = draw(p, snap({}), t).puck;
    rebase(p, snap({ x: 600, y: 200, vx: -100 }), ME, t);
    expect(p.w.puck).toMatchObject({ x: 600, y: 200, vx: -100 });
    const after = draw(p, snap({}), t).puck;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('rebases on a snapshot and slides the drawn puck onto it', () => {
    const p = classic();
    rebase(p, snap({ x: 800, y: 450, vx: 1000 }), ME, 0);
    let t = 0;
    for (; t < 100; t += 16) {
      draw(p, snap({}), t);
    }
    const shown = draw(p, snap({}), t).puck;
    const n = { x: 900, y: 300, vx: -500, vy: 200 };
    rebase(p, snap(n), ME, t);
    expect(p.w.puck).toEqual(n);
    expect(draw(p, snap({}), t).puck).toMatchObject({ x: shown.x, y: shown.y });

    // Reference: the snapshot simulated without any correction.
    const ref = createWorld('classic');
    Object.assign(ref.puck, n);
    let err = Infinity;
    // Two steps per frame for 500 ms.
    for (let i = 1; i <= 500 / (2 * DT); i++) {
      step(ref, 1 / TICK_HZ);
      step(ref, 1 / TICK_HZ);
      const d = draw(p, snap({}), t + i * 2 * DT + 0.1).puck;
      const e = Math.hypot(d.x - ref.puck.x, d.y - ref.puck.y);
      // The gap shrinks every frame, never in one go.
      expect(e).toBeLessThan(err);
      if (i == 1) {
        expect(e).toBeGreaterThan(Math.hypot(shown.x - n.x, shown.y - n.y) / 2);
      }
      err = e;
    }
    expect(err).toBeLessThan(0.5);
  });

  it('keeps a puck at rest still whatever the snapshot timing', () => {
    const p = classic();
    const s = snap({ x: 500.0625, y: 299.9375 });
    for (let t = 0; t < 3000; t += 16.7) {
      if ((t | 0) % 3) {
        rebase(p, s, ME, t + ((t * 7) % 5));
      }
      const { puck } = draw(p, s, t + 5, [300, 450]);
      expect(puck).toMatchObject({ x: 500.0625, y: 299.9375, vx: 0, vy: 0 });
    }
  });

  it('tracks a fast puck through jittery snapshots without shaking', () => {
    // Host: a puck bouncing between the top and bottom walls; snapshots every SNAP_EVERY ticks,
    // 30 ms latency plus up to 6 ms of jitter.
    const host = createWorld('classic');
    Object.assign(host.puck, { x: 300, y: 450, vx: 300, vy: 2000 });
    const truth: Puck[] = [];
    const arrivals: [number, Snapshot][] = [];
    for (let i = 0; i < 2 * TICK_HZ; i++) {
      step(host, 1 / TICK_HZ);
      truth.push({ ...host.puck });
      if (i % SNAP_EVERY == 0) {
        const jitter = (((i / SNAP_EVERY) * 2 * 37) % 7) * (6 / 7);
        arrivals.push([i * DT + 30 + jitter, snap({ ...host.puck }, [])]);
      }
    }
    const p = classic();
    let last: Puck | undefined;
    let worst = 0;
    let shake = 0;
    for (let t = 100; t < 1800; t += 1000 / 60) {
      while (arrivals[0][0] <= t) {
        const [at, s] = arrivals.shift()!;
        rebase(p, s, ME, at);
      }
      const d = draw(p, snap({}, []), t).puck;
      // Host state the client should show, 30 ms in the past.
      const h = truth[Math.round((t - 30) / DT)];
      worst = Math.max(worst, Math.hypot(d.x - h.x, d.y - h.y));
      if (last) {
        // Away from the walls, frame-to-frame motion follows the host puck's own motion over the
        // same frame: no back-and-forth. Bounce frames are left to `worst`: there a few units of
        // lead shift where the path folds, which says nothing about smoothness.
        const g = truth[Math.round((t - 1000 / 60 - 30) / DT)];
        const near = (y: number) => y < 80 || y > H - 80;
        if (![d.y, last.y, h.y, g.y].some(near)) {
          const moved = Math.hypot(d.x - last.x, d.y - last.y);
          shake = Math.max(shake, Math.abs(moved - Math.hypot(h.x - g.x, h.y - g.y)));
        }
      }
      last = d;
    }
    expect(worst).toBeLessThan(12);
    expect(shake).toBeLessThan(4);
  });

  it('freezes the puck on a local goal, leaving the score and the serve to the host', () => {
    const p = classic();
    rebase(p, snap({ x: 60, y: 450, vx: -2000 }), ME, 0);
    const a = draw(p, snap({}), 150).puck;
    expect(p.w.score).toEqual([0, 0]);
    expect(p.wait).toBe(true);
    expect(a.x).toBeLessThan(0);
    expect(a).toMatchObject({ vx: 0, vy: 0 });
    expect(draw(p, snap({}), 300).puck).toEqual(a);

    // The host scores and serves: the new score rebases the puck as is.
    rebase(p, snap({ x: W / 4, y: 450 }, undefined, [0, 1]), ME, 310);
    expect(p.wait).toBe(false);
    expect(draw(p, snap({}), 310).puck).toMatchObject({ x: W / 4, y: 450 });
  });

  it.each(['break', 'end'] as const)(
    'draws snapshots as they are in %s, then restarts from the respawn',
    phase => {
      const p = classic();
      rebase(p, snap({ vx: 500 }), ME, 0);
      draw(p, snap({}), 50, [700, 200]);
      reset(p, phase, 'classic');
      expect(p.me).toBeUndefined();

      const frozen = snap({ x: 1000, y: 100 }, [{ id: ME, x: 650, y: 200 }]);
      rebase(p, frozen, ME, 60);
      expect(view(p, frozen, 500, [100, 100])).toBe(frozen);
      expect(p.w.puck).toMatchObject({ x: 1000, y: 100 });
      expect(p.o).toEqual([0, 0]);

      // Next round: paddles respawned, puck served, same score; nothing slides.
      reset(p, 'play', 'classic');
      const served = snap({ x: W / 4, y: 450 }, [{ id: ME, x: 150, y: 450 }]);
      rebase(p, served, ME, 600);
      expect(p.me).toMatchObject({ x: 150, y: 450, tx: 150, ty: 450 });
      const d = draw(p, served, 600);
      expect(d.puck).toMatchObject({ x: W / 4, y: 450 });
      expect(d.me).toBe(p.me);
    },
  );

  it('rebases the world tick on each snapshot and draws the fractional tick at now', () => {
    const p = predict();
    rebase(p, { ...snap({}, []), tick: 100 }, ME, 0);
    expect(p.w.tick).toBe(100);
    const v = view(p, snap({}, []), 2.5 * DT)!;
    expect(p.w.tick).toBe(102);
    expect(v.tick).toBeCloseTo(102.5, 9);

    // The u16 wrap: the arena repeats over it, so the local tick may run past 65535.
    rebase(p, { ...snap({}, []), tick: 65535 }, ME, 3 * DT);
    expect(view(p, snap({}, []), 4.25 * DT)!.tick).toBeCloseTo(65536.25, 9);
    expect(obstacles('ice', 65536.25)).toEqual(obstacles('ice', 0.25));
    rebase(p, { ...snap({}, []), tick: 3 }, ME, 7 * DT);
    expect(view(p, snap({}, []), 7 * DT)!.tick).toBe(3);

    // Frozen host: the snapshot as is, its tick included.
    reset(p, 'break', 'ice');
    const frozen = { ...snap({}, []), tick: 40 };
    rebase(p, frozen, ME, 8 * DT);
    expect(view(p, frozen, 9.5 * DT)).toBe(frozen);
  });

  it('bounces the local puck off the arena of the match and stamps each obstacle hit', () => {
    const [berg] = obstacles('ice', 0);
    // 20 units from the iceberg at 1000 units/s: contact in the 5th step, ~21 ms.
    const s = {
      ...snap({ x: berg.x - berg.r - PUCK_R - 20, y: berg.y, vx: 1000 }, []),
      live: true,
    };
    const p = predict();
    reset(p, 'play', 'ice');
    rebase(p, s, ME, 1000);
    expect(p.hits).toEqual([]);
    const v = view(p, s, 1050)!;
    expect(v.puck.vx).toBeLessThan(0);
    expect(Object.keys(p.hits)).toEqual(['0']);
    expect(p.hits[0]).toBeCloseTo(1000 + 5 * DT, 9);

    // A served puck nobody touched goes through, as on the host.
    const r = predict();
    reset(r, 'play', 'ice');
    rebase(r, { ...s, live: false }, ME, 1000);
    expect(view(r, s, 1050)!.puck.vx).toBeGreaterThan(0);
    expect(r.hits).toEqual([]);

    // The classic rink has nothing there.
    const q = predict();
    reset(q, 'play', 'classic');
    rebase(q, s, ME, 1000);
    expect(view(q, s, 1050)!.puck.vx).toBeGreaterThan(0);
    expect(q.hits).toEqual([]);
  });

  it('plays on the rink of the match message: scaled clamp, speeds, walls and obstacles', () => {
    const p = predict();
    reset(p, 'play', 'classic', 2, 5);
    expect(p.w).toMatchObject({ arena: 'classic', size: 2, count: 5 });
    // At x 1500 the own paddle is on the left half of a size-2 rink: team 0; past W, team 1.
    const s = snap({ x: W, y: H }, [
      { id: ME, x: 1500, y: 1500 },
      { id: OTHER, x: 2100, y: 300 },
    ]);
    rebase(p, s, ME, 0);
    expect(p.me).toMatchObject({ team: 0 });
    expect(p.w.paddles.find(q => q.id == OTHER)).toMatchObject({ team: 1 });
    // 8 steps at twice the top speed.
    const a = draw(p, s, 8.5 * DT, [1500, 100]);
    expect(a.me!.y).toBeCloseTo(1500 - (8 * 2 * PADDLE_MAX_SPEED) / TICK_HZ);
    // Up to the scaled centre line and bottom wall.
    let b = a;
    for (let t = 10 * DT; t < 500; t += 16) {
      b = draw(p, s, t, [3000, 3000]);
    }
    expect(b.me).toMatchObject({ x: W - PADDLE_R, y: 2 * H - PADDLE_R });

    // The drawn puck keeps to the scaled boards, and may go past a line only in the scaled mouth.
    // (New scores: the puck jumps there.)
    rebase(p, snap({ x: 2 * W - 40, y: H + GOAL * 0.9, vx: 2000 }, [], [0, 1]), ME, 600);
    expect(draw(p, s, 620).puck.x).toBeGreaterThan(2 * W - PUCK_R);
    rebase(p, snap({ x: 300, y: 2 * H - 40, vy: 2000 }, [], [0, 2]), ME, 700);
    const y = draw(p, s, 702).puck.y;
    expect(y).toBeGreaterThan(2 * H - 40);
    expect(y).toBeLessThanOrEqual(2 * H - PUCK_R);
  });

  it('bounces off the scaled obstacles of the match, their hit times dropped on a new count', () => {
    const [berg] = obstacles('ice', 0, 2, 3);
    const s = {
      ...snap({ x: berg.x - berg.r - PUCK_R - 20, y: berg.y, vx: 2000 }, []),
      live: true,
    };
    const p = predict();
    reset(p, 'play', 'ice', 2, 3);
    rebase(p, s, ME, 1000);
    expect(view(p, s, 1050)!.puck.vx).toBeLessThan(0);
    expect(Object.keys(p.hits)).toEqual(['0']);
    reset(p, 'break', 'ice', 2, 3);
    expect(Object.keys(p.hits)).toEqual(['0']);
    reset(p, 'play', 'ice', Math.SQRT2, 4);
    expect(p.hits).toEqual([]);
  });
});
