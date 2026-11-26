// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOUNDS, sound } from './sound';

/** A Web Audio context that records the nodes started. */
class FakeAudio {
  static last?: FakeAudio;
  state = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  started: string[] = [];
  closed = false;
  constructor() {
    FakeAudio.last = this;
  }
  resume() {
    this.state = 'running';
  }
  close() {
    this.closed = true;
  }
  param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  node = (type: string) => {
    const n = {
      type,
      gain: this.param(),
      frequency: this.param(),
      connect: (o: unknown) => o,
      start: () => this.started.push(n.type),
      stop() {},
    };
    return n;
  };
  createGain = () => this.node('gain');
  createOscillator = () => this.node('osc');
  createBufferSource = () => this.node('noise');
  createBiquadFilter = () => this.node('filter');
  createBuffer = () => ({ getChannelData: () => new Float32Array(8) });
}

describe('sound', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudio);
    localStorage.clear();
    FakeAudio.last = undefined;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stays silent until the first press, then plays each note of a sound', () => {
    const target = new EventTarget();
    const ac = new AbortController();
    const s = sound(target, ac.signal);
    s.play('hit');
    expect(FakeAudio.last).toBeUndefined();
    target.dispatchEvent(new Event('pointerdown'));
    s.play('hit');
    expect(FakeAudio.last!.started).toEqual(['triangle', 'noise']);
    s.play('nothing');
    expect(FakeAudio.last!.started).toHaveLength(2);
    ac.abort();
    expect(FakeAudio.last!.closed).toBe(true);
  });

  it('remembers mute, and the sound option off keeps it silent', () => {
    const target = new EventTarget();
    const s = sound(target, new AbortController().signal);
    target.dispatchEvent(new Event('pointerdown'));
    s.muted = true;
    s.play('goal');
    expect(FakeAudio.last!.started).toHaveLength(0);
    expect(sound(new EventTarget(), new AbortController().signal).muted).toBe(true);
    s.muted = false;
    const off = sound(target, new AbortController().signal, false);
    target.dispatchEvent(new Event('pointerdown'));
    off.play('goal');
    expect(FakeAudio.last!.started).toHaveLength(0);
  });

  it('has a sound for every obstacle kind and every game event', () => {
    for (const name of ['iceberg', 'penguin', 'vortex', 'shark', 'whirlwind', 'genie']) {
      expect(SOUNDS[name]?.length).toBeGreaterThan(0);
    }
    for (const notes of Object.values(SOUNDS)) {
      for (const [, f0, f1, d, v] of notes) {
        // Exponential ramps need positive ends.
        expect(Math.min(f0, f1, d, v)).toBeGreaterThan(0);
      }
    }
  });
});
