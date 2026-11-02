/**
 * OS1's non-verbal sounds, synthesized with Web Audio so there are no audio
 * files to license: a soft chime when it wakes, and an optional ambient pad
 * that sits quietly under the conversation.
 */

/** A warm two-note bell, like a small "I'm here". */
export function playChime(context: AudioContext) {
  const now = context.currentTime + 0.05;
  const out = context.createGain();
  out.gain.value = 0.12;
  const tone = context.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3500;
  out.connect(tone).connect(context.destination);

  const notes = [
    { freq: 523.25, at: 0 }, // C5
    { freq: 783.99, at: 0.16 }, // G5
  ];
  for (const { freq, at } of notes) {
    // A few slightly inharmonic partials make it sound like a bell, not a beep.
    for (const [ratio, level] of [
      [1, 1],
      [2.01, 0.25],
      [3.02, 0.08],
    ]) {
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * ratio;
      const env = context.createGain();
      const start = now + at;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(level, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 1.9 / ratio + 0.4);
      osc.connect(env).connect(out);
      osc.start(start);
      osc.stop(start + 2.5);
    }
  }
}

const PAD_LEVEL = 0.035;
const PAD_LEVEL_DUCKED = 0.012;

/** A slow, breathing chord (A major, low and soft). Off by default. */
export class AmbientPad {
  private master: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private ducked = false;

  constructor(private context: AudioContext) {}

  get running() {
    return this.master !== null;
  }

  start() {
    if (this.master) return;
    const ctx = this.context;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(this.ducked ? PAD_LEVEL_DUCKED : PAD_LEVEL, ctx.currentTime + 4);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.3;
    master.connect(filter).connect(ctx.destination);

    // A2, E3, C#4, A4: each voice swells on its own slow cycle.
    [110, 164.81, 277.18, 440].forEach((freq, i) => {
      const voice = ctx.createGain();
      voice.gain.value = i === 3 ? 0.15 : 0.35;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.023;
      const depth = ctx.createGain();
      depth.gain.value = voice.gain.value * 0.6;
      lfo.connect(depth).connect(voice.gain);
      lfo.start();
      this.oscillators.push(lfo);

      for (const [type, detune] of [
        ["sine", 0],
        ["triangle", 7],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(voice);
        osc.start();
        this.oscillators.push(osc);
      }
      voice.connect(master);
    });
    this.master = master;
  }

  stop() {
    const master = this.master;
    if (!master) return;
    const ctx = this.context;
    const oscillators = this.oscillators;
    this.master = null;
    this.oscillators = [];
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
    for (const osc of oscillators) osc.stop(ctx.currentTime + 1.6);
  }

  /** Sit further back while OS1 is talking. */
  duck(on: boolean) {
    this.ducked = on;
    this.master?.gain.setTargetAtTime(on ? PAD_LEVEL_DUCKED : PAD_LEVEL, this.context.currentTime, 0.4);
  }
}
