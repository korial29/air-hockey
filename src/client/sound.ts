// Sound effects, synthesised with Web Audio: no files, a few bytes each. Nothing plays before the
// first pointer press (browsers keep audio locked until then); muted is remembered per browser.

/** A sound: [wave or 'noise', start Hz, end Hz, seconds, volume, delay s]; several play as one. */
type Note = [OscillatorType | 'noise', number, number, number, number, number?];

const KEY = 'air-hockey:muted';

/** Every sound of the game, by name. Noise is shaped by a band-pass from start to end Hz. */
export const SOUNDS: Record<string, Note[]> = {
  /** Own paddle on the puck: a sharp pock. */
  hit: [
    ['triangle', 520, 180, 0.08, 0.9],
    ['noise', 3000, 1500, 0.03, 0.5],
  ],
  /** Another paddle on the puck. */
  tap: [['triangle', 420, 160, 0.06, 0.35]],
  wall: [['sine', 260, 120, 0.06, 0.35]],
  /** Obstacles, by kind. */
  iceberg: [
    ['noise', 6000, 2500, 0.12, 0.5],
    ['square', 900, 700, 0.05, 0.15],
  ],
  penguin: [['square', 600, 1300, 0.12, 0.25]],
  vortex: [['noise', 300, 1200, 0.35, 0.6]],
  shark: [
    ['sawtooth', 160, 60, 0.25, 0.4],
    ['noise', 800, 200, 0.2, 0.4],
  ],
  whirlwind: [['noise', 500, 2500, 0.4, 0.5]],
  genie: [
    ['sine', 700, 1400, 0.15, 0.3],
    ['sine', 1050, 2100, 0.15, 0.2, 0.08],
  ],
  /** An obstacle broken or shot out. */
  crash: [
    ['noise', 4000, 400, 0.4, 0.8],
    ['sawtooth', 200, 50, 0.3, 0.3],
  ],
  /** The puck coming up from a vortex. */
  splash: [['noise', 1500, 300, 0.3, 0.6]],
  /** A genie's spell on a paddle. */
  zap: [
    ['sawtooth', 1200, 100, 0.5, 0.35],
    ['square', 80, 60, 0.5, 0.15],
  ],
  /** Countdown 3, 2, 1, then PLAY. */
  beep: [['square', 660, 660, 0.12, 0.25]],
  go: [['square', 1320, 1320, 0.35, 0.3]],
  /** A goal for the own team, against it. */
  goal: [
    ['square', 523, 523, 0.12, 0.3],
    ['square', 659, 659, 0.12, 0.3, 0.12],
    ['square', 784, 784, 0.3, 0.3, 0.24],
    ['noise', 2000, 1000, 0.6, 0.25],
  ],
  conceded: [['sawtooth', 220, 110, 0.6, 0.35]],
  /** Round or match won by the own team, lost. */
  win: [
    ['triangle', 523, 523, 0.15, 0.4],
    ['triangle', 659, 659, 0.15, 0.4, 0.15],
    ['triangle', 784, 784, 0.15, 0.4, 0.3],
    ['triangle', 1047, 1047, 0.5, 0.4, 0.45],
  ],
  lose: [
    ['triangle', 392, 392, 0.2, 0.4],
    ['triangle', 330, 330, 0.2, 0.4, 0.2],
    ['triangle', 262, 250, 0.6, 0.4, 0.4],
  ],
  /** A player joins. */
  join: [['sine', 600, 900, 0.08, 0.3]],
};

export interface Sound {
  play(name: string, volume?: number): void;
  muted: boolean;
}

/** `on`: false keeps everything silent (the game's sound option). */
export const sound = (target: EventTarget, signal: AbortSignal, on = true): Sound => {
  let ac: AudioContext | undefined;
  let noise: AudioBuffer | undefined;
  let muted = false;
  try {
    muted = localStorage.getItem(KEY) == '1';
  } catch {
    // Storage blocked: not remembered.
  }
  const unlock = () => {
    try {
      ac ??= new AudioContext();
      ac.resume();
    } catch {
      // No Web Audio: silent.
    }
  };
  target.addEventListener('pointerdown', unlock, { signal });
  signal.addEventListener('abort', () => ac?.close());

  return {
    play(name, volume = 1) {
      if (!on || muted || !ac || ac.state != 'running') {
        return;
      }
      const t0 = ac.currentTime;
      for (const [wave, f0, f1, d, v, delay = 0] of SOUNDS[name] ?? []) {
        const t = t0 + delay;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.25 * v * volume, t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + d);
        g.connect(ac.destination);
        let src: AudioScheduledSourceNode;
        if (wave == 'noise') {
          if (!noise) {
            noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
            noise.getChannelData(0).forEach((_, i, a) => (a[i] = Math.random() * 2 - 1));
          }
          const b = ac.createBufferSource();
          b.buffer = noise;
          const f = ac.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.setValueAtTime(f0, t);
          f.frequency.exponentialRampToValueAtTime(f1, t + d);
          b.connect(f).connect(g);
          src = b;
        } else {
          const o = ac.createOscillator();
          o.type = wave;
          o.frequency.setValueAtTime(f0, t);
          o.frequency.exponentialRampToValueAtTime(f1, t + d);
          o.connect(g);
          src = o;
        }
        src.start(t);
        src.stop(t + d);
      }
    },
    get muted() {
      return muted;
    },
    set muted(m) {
      muted = m;
      try {
        localStorage.setItem(KEY, m ? '1' : '0');
      } catch {
        // Not remembered.
      }
    },
  };
};
