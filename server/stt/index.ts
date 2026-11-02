import { config, requireKey } from "../config.ts";
import { decodeWav16k } from "../audio.ts";

export interface SpeechToText {
  /** Transcribe one utterance (16 kHz mono WAV). Returns "" for silence/noise. */
  transcribe(wav: Buffer): Promise<string>;
}

export async function createStt(): Promise<SpeechToText> {
  switch (config.stt) {
    case "deepgram":
      return deepgram();
    case "openai":
      return openai();
    case "local":
      return await local();
    default:
      throw new Error(`Unknown OS1_STT provider "${config.stt}"`);
  }
}

function deepgram(): SpeechToText {
  const key = requireKey("deepgram", "Deepgram speech-to-text");
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", config.deepgramModel);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("language", "en");
  return {
    async transcribe(wav) {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
        body: new Uint8Array(wav),
      });
      if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as {
        results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
      };
      return json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    },
  };
}

function openai(): SpeechToText {
  const key = requireKey("openai", "OpenAI speech-to-text");
  return {
    async transcribe(wav) {
      const form = new FormData();
      form.append("model", config.openaiSttModel);
      form.append("language", "en");
      form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) throw new Error(`OpenAI STT ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { text?: string };
      return json.text?.trim() ?? "";
    },
  };
}

/** Whisper running on this machine's CPU. Free and private, but slower. */
async function local(): Promise<SpeechToText> {
  const { pipeline } = await import("@huggingface/transformers");
  console.log(`[stt] loading local ${config.localSttModel} (first run downloads it)…`);
  const asr = await pipeline("automatic-speech-recognition", config.localSttModel, {
    dtype: "q8",
  });
  return {
    async transcribe(wav) {
      const out = await asr(decodeWav16k(wav));
      const text = (Array.isArray(out) ? out[0]?.text : out.text) ?? "";
      return text.trim();
    },
  };
}
