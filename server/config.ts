import fs from "node:fs";
import path from "node:path";

// Load .env from the project root if present (Node 22 built-in, no dotenv needed).
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const env = (key: string) => process.env[key]?.trim() || undefined;

export type SttProvider = "deepgram" | "openai" | "local";
export type TtsProvider = "elevenlabs" | "openai" | "kokoro";

function pickStt(): SttProvider {
  const explicit = env("OS1_STT") as SttProvider | undefined;
  if (explicit) return explicit;
  if (env("DEEPGRAM_API_KEY")) return "deepgram";
  if (env("OPENAI_API_KEY")) return "openai";
  return "local";
}

function pickTts(): TtsProvider {
  const explicit = env("OS1_TTS") as TtsProvider | undefined;
  if (explicit) return explicit;
  if (env("ELEVENLABS_API_KEY")) return "elevenlabs";
  if (env("OPENAI_API_KEY")) return "openai";
  return "kokoro";
}

const stt = pickStt();
const tts = pickTts();

// Every default voice below is a deeper male voice; override with OS1_VOICE.
const DEFAULT_VOICES: Record<TtsProvider, string> = {
  elevenlabs: "nPczCjzI2devNBz1zQrb", // "Brian": deep, resonant, warm
  openai: "onyx",
  kokoro: "am_fenrir",
};

export const config = {
  port: Number(env("PORT") ?? 5173),
  host: env("HOST") ?? "localhost",
  isProduction: process.env.NODE_ENV === "production",
  dataDir: path.resolve(env("OS1_DATA_DIR") ?? "data"),

  /** Display name before the companion has picked one for itself. */
  name: env("OS1_NAME") ?? "OS1",
  userName: env("OS1_USER_NAME"),

  model: env("OS1_MODEL") ?? "claude-opus-5-5",
  effort: (env("OS1_EFFORT") ?? "low") as "low" | "medium" | "high",
  memoryModel: env("OS1_MEMORY_MODEL") ?? "claude-haiku-5-5",
  /** Turns of verbatim history sent each request; older ones live on as memories. */
  historyTurns: Number(env("OS1_HISTORY_TURNS") ?? 40),

  stt,
  tts,
  voice: env("OS1_VOICE") ?? DEFAULT_VOICES[tts],
  ttsSpeed: Number(env("OS1_TTS_SPEED") ?? 1),

  keys: {
    anthropic: env("ANTHROPIC_API_KEY"),
    deepgram: env("DEEPGRAM_API_KEY"),
    openai: env("OPENAI_API_KEY"),
    elevenlabs: env("ELEVENLABS_API_KEY"),
  },
  elevenlabsModel: env("ELEVENLABS_MODEL") ?? "eleven_flash_v2_5",
  openaiTtsModel: env("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts",
  openaiSttModel: env("OPENAI_STT_MODEL") ?? "gpt-4o-mini-transcribe",
  deepgramModel: env("DEEPGRAM_MODEL") ?? "nova-3",
  localSttModel: env("OS1_LOCAL_STT_MODEL") ?? "onnx-community/whisper-base.en",
};

export function requireKey(name: keyof typeof config.keys, provider: string): string {
  const key = config.keys[name];
  if (!key) {
    throw new Error(
      `${provider} needs ${name.toUpperCase()}_API_KEY. Add it to .env or pick another provider.`,
    );
  }
  return key;
}
