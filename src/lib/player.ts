/**
 * Gapless playback of the sentence-sized audio clips the server streams back.
 * Clips are decoded as they arrive and scheduled back-to-back on one AudioContext.
 */
export class SpeechPlayer {
  readonly context = new AudioContext();
  /** Tap this for visuals (e.g. making the animation react to the voice). */
  readonly analyser: AnalyserNode;
  private output: GainNode;
  private sources = new Set<AudioBufferSourceNode>();
  private nextStart = 0;
  private decodeChain: Promise<void> = Promise.resolve();
  private generation = 0;
  private streamEnded = false;

  constructor(private onIdle: () => void) {
    this.output = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.output.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  get playing() {
    return this.sources.size > 0;
  }

  /** Must be called from a user gesture at least once (browser autoplay rules). */
  resume() {
    return this.context.resume();
  }

  enqueue(clip: ArrayBuffer) {
    const generation = this.generation;
    this.streamEnded = false;
    // Decode in order so sentences never play out of sequence.
    this.decodeChain = this.decodeChain.then(async () => {
      let buffer: AudioBuffer;
      try {
        buffer = await this.context.decodeAudioData(clip);
      } catch (err) {
        console.warn("Could not decode audio clip", err);
        return;
      }
      if (generation !== this.generation) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.output);
      const startAt = Math.max(this.context.currentTime + 0.02, this.nextStart);
      source.start(startAt);
      this.nextStart = startAt + buffer.duration;
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        if (this.sources.size === 0 && this.streamEnded && generation === this.generation) {
          this.onIdle();
        }
      };
    });
  }

  /** The server has sent every clip for this reply. */
  endOfStream() {
    this.decodeChain = this.decodeChain.then(() => {
      this.streamEnded = true;
      if (this.sources.size === 0) this.onIdle();
    });
  }

  /** Barge-in: stop talking immediately and drop anything queued. */
  stop() {
    this.generation++;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.nextStart = 0;
  }

  /** Duck the volume while the user might be starting to talk. */
  setVolume(volume: number) {
    this.output.gain.setTargetAtTime(volume, this.context.currentTime, 0.05);
  }
}
