import { describe, expect, it } from 'vitest';
import { PADDLE_MAX_SPEED, PADDLE_R, SNAP_EVERY, TICK_HZ, W } from '../shared/constants';
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

/** Drawn puck and own paddle at time t. */
const draw = (p: ReturnType<typeof predict>, s: Snapshot, t: number, target?: [number, number]) => {
  const v = view(p, s, t, target)!;
  return { puck: v.puck, me: v.paddles.find(q => q.id == ME), v };
};

describe('predict', () => {
  it('draws nothing before the first snapshot', () => {
    expect(view(predict(), undefined, 100)).toBeUndefined();
  });

  it('moves the own paddle toward the pointer at the host speed cap, inside its half', () => {
    const p = predict();
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
    const p = predict();
    rebase(p, snap({ x: 420, vx: -2000 }), ME, 0);
    expect(draw(p, snap({}), DT / 2).puck.vx).toBeLessThan(0);
    // Contact in 3 steps: the very frame that reaches it shows the puck going back.
    const hit = draw(p, snap({}), 5.5 * DT).puck;
    expect(hit.vx).toBeGreaterThan(0);

    // The host has not seen the hit yet: its puck still comes in.
    rebase(p, snap({ x: 380, vx: -1900 }), ME, 6 * DT);
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
    const p = predict();
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
    const ref = createWorld();
    Object.assign(ref.puck, n);
    let err = Infinity;
    for (let i = 1; i <= 30; i++) {
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
    const p = predict();
    const s = snap({ x: 500.03125, y: 299.96875 });
    for (let t = 0; t < 3000; t += 16.7) {
      if ((t | 0) % 3) {
        rebase(p, s, ME, t + ((t * 7) % 5));
      }
      const { puck } = draw(p, s, t + 5, [300, 450]);
      expect(puck).toMatchObject({ x: 500.03125, y: 299.96875, vx: 0, vy: 0 });
    }
  });

  it('tracks a fast puck through jittery snapshots without shaking', () => {
    // Host: a puck bouncing between the top and bottom walls; snapshots every SNAP_EVERY ticks,
    // 30 ms latency plus up to 6 ms of jitter.
    const host = createWorld();
    Object.assign(host.puck, { x: 300, y: 450, vx: 300, vy: 2000 });
    const truth: Puck[] = [];
    const arrivals: [number, Snapshot][] = [];
    for (let i = 0; i < 2 * TICK_HZ; i++) {
      step(host, 1 / TICK_HZ);
      truth.push({ ...host.puck });
      if (i % SNAP_EVERY == 0) {
        const jitter = ((i * 37) % 7) * (6 / 7);
        arrivals.push([i * DT + 30 + jitter, snap({ ...host.puck }, [])]);
      }
    }
    const p = predict();
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
        // Frame-to-frame motion follows the puck speed: no back-and-forth.
        const moved = Math.hypot(d.x - last.x, d.y - last.y);
        const speed = Math.hypot(h.vx, h.vy) / 60;
        shake = Math.max(shake, Math.abs(moved - speed));
      }
      last = d;
    }
    expect(worst).toBeLessThan(12);
    expect(shake).toBeLessThan(10);
  });

  it('freezes the puck on a local goal, leaving the score and the serve to the host', () => {
    const p = predict();
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
      const p = predict();
      rebase(p, snap({ vx: 500 }), ME, 0);
      draw(p, snap({}), 50, [700, 200]);
      reset(p, phase);
      expect(p.me).toBeUndefined();

      const frozen = snap({ x: 1000, y: 100 }, [{ id: ME, x: 650, y: 200 }]);
      rebase(p, frozen, ME, 60);
      expect(view(p, frozen, 500, [100, 100])).toBe(frozen);
      expect(p.w.puck).toMatchObject({ x: 1000, y: 100 });
      expect(p.o).toEqual([0, 0]);

      // Next round: paddles respawned, puck served, same score; nothing slides.
      reset(p, 'play');
      const served = snap({ x: W / 4, y: 450 }, [{ id: ME, x: 150, y: 450 }]);
      rebase(p, served, ME, 600);
      expect(p.me).toMatchObject({ x: 150, y: 450, tx: 150, ty: 450 });
      const d = draw(p, served, 600);
      expect(d.puck).toMatchObject({ x: W / 4, y: 450 });
      expect(d.me).toBe(p.me);
    },
  );
});
