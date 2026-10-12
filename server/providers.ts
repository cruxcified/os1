import { createStt, type SpeechToText } from "./stt/index.ts";
import { createTts, type TextToSpeech } from "./tts/index.ts";

/**
 * Speech providers, loaded in the background so the app opens instantly even
 * when a local model has to download first. Rebuilt when settings change.
 */
export class Providers {
  stt!: Promise<SpeechToText>;
  tts!: Promise<TextToSpeech>;

  constructor() {
    this.reload();
  }

  reload() {
    this.stt = createStt();
    this.tts = createTts();
    // Errors surface when a turn awaits them; don't crash on unhandled rejection.
    this.stt.catch((err) => console.warn("[stt]", err.message));
    this.tts.catch((err) => console.warn("[tts]", err.message));
  }
}
