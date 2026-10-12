import { config, requireKey } from "../config.ts";

export interface TextToSpeech {
  /** Speak one sentence-sized chunk. Returns an encoded audio file (mp3 or wav). */
  synthesize(text: string, signal?: AbortSignal): Promise<Buffer>;
}

export async function createTts(): Promise<TextToSpeech> {
  switch (config.tts) {
    case "elevenlabs":
      return elevenlabs();
    case "openai":
      return openai();
    case "kokoro":
      return await kokoro();
    default:
      throw new Error(`Unknown OS1_TTS provider "${config.tts}"`);
  }
}

function elevenlabs(): TextToSpeech {
  const key = requireKey("elevenlabs", "ElevenLabs text-to-speech");
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${config.voice}/stream`);
  url.searchParams.set("output_format", "mp3_44100_128");
  return {
    async synthesize(text, signal) {
      const res = await fetch(url, {
        method: "POST",
        signal,
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: config.elevenlabsModel,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.8,
            style: 0.15,
            speed: config.ttsSpeed,
          },
        }),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

function openai(): TextToSpeech {
  const key = requireKey("openai", "OpenAI text-to-speech");
  return {
    async synthesize(text, signal) {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.openaiTtsModel,
          voice: config.voice,
          input: text,
          speed: config.ttsSpeed,
          instructions:
            "Speak like a warm, calm, deep-voiced man in an intimate one-on-one conversation. " +
            "Relaxed pace, natural pauses, gentle humor. Never sound like an announcer.",
          response_format: "mp3",
        }),
      });
      if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** Kokoro-82M running on this machine's CPU. Free and offline; less expressive. */
async function kokoro(): Promise<TextToSpeech> {
  const { KokoroTTS } = await import("kokoro-js");
  console.log("[tts] loading local Kokoro voice model (first run downloads it)…");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "cpu",
  });
  type Voice = NonNullable<Parameters<typeof tts.generate>[1]>["voice"];
  return {
    async synthesize(text) {
      const audio = await tts.generate(text, {
        voice: config.voice as Voice,
        speed: config.ttsSpeed,
      });
      return Buffer.from(audio.toWav());
    },
  };
}
