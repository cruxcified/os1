import fs from "node:fs";
import path from "node:path";

// Load .env from the working directory if present (Node 22 built-in, no dotenv needed).
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

export type SttProvider = "deepgram" | "openai" | "local";
export type TtsProvider = "elevenlabs" | "openai" | "kokoro";
/** claude: Anthropic's API (needs a key). local: a free model on this computer, through Ollama. */
export type BrainProvider = "claude" | "local";

/**
 * Settings saved from the in-app settings screen (data/settings.json). They
 * override .env / environment variables, so the desktop app never needs a .env.
 */
export interface Settings {
  brain?: BrainProvider | "auto";
  /** Ollama model tag for the local brain, e.g. "gemma3:12b". */
  localModel?: string;
  anthropicKey?: string;
  deepgramKey?: string;
  elevenlabsKey?: string;
  openaiKey?: string;
  stt?: SttProvider | "auto";
  tts?: TtsProvider | "auto";
  voice?: string;
  userName?: string;
  /** "on": the voice performs audio tags like [laughs] (ElevenLabs only). */
  expressive?: "on" | "off";
}

const SETTINGS_ENV: Record<keyof Settings, string> = {
  brain: "OS1_BRAIN",
  localModel: "OS1_LOCAL_MODEL",
  anthropicKey: "ANTHROPIC_API_KEY",
  deepgramKey: "DEEPGRAM_API_KEY",
  elevenlabsKey: "ELEVENLABS_API_KEY",
  openaiKey: "OPENAI_API_KEY",
  stt: "OS1_STT",
  tts: "OS1_TTS",
  voice: "OS1_VOICE",
  userName: "OS1_USER_NAME",
  expressive: "OS1_EXPRESSIVE",
};

export const SECRET_SETTINGS = ["anthropicKey", "deepgramKey", "elevenlabsKey", "openaiKey"] as const;

const dataDir = path.resolve(process.env.OS1_DATA_DIR ?? "data");
const settingsFile = path.join(dataDir, "settings.json");

export function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function writeSettings(settings: Settings) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
  reloadConfig();
}

/** Good conversation on a computer with 16 GB of memory; gemma3:4b suits smaller laptops. */
export const DEFAULT_LOCAL_MODEL = "gemma3:12b";

// Every default voice below is a deeper male voice; override with OS1_VOICE.
const DEFAULT_VOICES: Record<TtsProvider, string> = {
  elevenlabs: "nPczCjzI2devNBz1zQrb", // "Brian": deep, resonant, warm
  openai: "onyx",
  kokoro: "am_fenrir",
};

function buildConfig() {
  const settings = readSettings();
  const overrides: Record<string, string> = {};
  for (const [key, envName] of Object.entries(SETTINGS_ENV)) {
    const value = settings[key as keyof Settings]?.trim();
    if (value && value !== "auto") overrides[envName] = value;
  }
  const env = (key: string) => overrides[key] ?? (process.env[key]?.trim() || undefined);

  const keys = {
    anthropic: env("ANTHROPIC_API_KEY"),
    deepgram: env("DEEPGRAM_API_KEY"),
    openai: env("OPENAI_API_KEY"),
    elevenlabs: env("ELEVENLABS_API_KEY"),
  };
  const brain =
    (env("OS1_BRAIN") as BrainProvider | undefined) ?? (keys.anthropic ? "claude" : "local");
  const ollamaHost = env("OLLAMA_HOST") ?? "127.0.0.1:11434";
  const stt =
    (env("OS1_STT") as SttProvider | undefined) ??
    (keys.deepgram ? "deepgram" : keys.openai ? "openai" : "local");
  const tts =
    (env("OS1_TTS") as TtsProvider | undefined) ??
    (keys.elevenlabs ? "elevenlabs" : keys.openai ? "openai" : "kokoro");
  // A voice ID only makes sense for the provider it was chosen for.
  const voice = env("OS1_VOICE") ?? DEFAULT_VOICES[tts];

  return {
    port: Number(env("PORT") ?? 5173),
    host: env("HOST") ?? "localhost",
    isProduction: process.env.NODE_ENV === "production",
    dataDir,
    /** Where the app's own files (dist/, node_modules/, server/persona.md) live. */
    appRoot: path.resolve(env("OS1_APP_ROOT") ?? process.cwd()),

    /** Display name before the companion has picked one for itself. */
    name: env("OS1_NAME") ?? "OS1",
    userName: env("OS1_USER_NAME"),

    brain,
    model: env("OS1_MODEL") ?? "claude-opus-5-5",
    effort: (env("OS1_EFFORT") ?? "low") as "low" | "medium" | "high",
    memoryModel: env("OS1_MEMORY_MODEL") ?? "claude-haiku-5-5",
    /** Turns of verbatim history sent each request; older ones live on as memories. */
    historyTurns: Number(env("OS1_HISTORY_TURNS") ?? 40),

    /** The free local brain: any chat model Ollama can run. */
    localModel: env("OS1_LOCAL_MODEL") ?? DEFAULT_LOCAL_MODEL,
    ollamaUrl: (/^https?:\/\//.test(ollamaHost) ? ollamaHost : `http://${ollamaHost}`).replace(/\/+$/, ""),
    /** Local models have small context windows and slow down as prompts grow. */
    localHistoryTurns: Number(env("OS1_LOCAL_HISTORY_TURNS") ?? 12),
    localContext: Number(env("OS1_LOCAL_CONTEXT") ?? 8192),

    stt,
    tts,
    voice,
    ttsSpeed: Number(env("OS1_TTS_SPEED") ?? 1),
    /** The voice performs audio tags like [laughs] and [sighs]. Only ElevenLabs can. */
    expressive: tts === "elevenlabs" && ["on", "true", "1"].includes(env("OS1_EXPRESSIVE") ?? ""),

    keys,
    elevenlabsModel: env("ELEVENLABS_MODEL") ?? "eleven_flash_v2_5",
    /** Used instead when expressive is on: needs a model that performs audio tags. */
    elevenlabsExpressiveModel: env("ELEVENLABS_EXPRESSIVE_MODEL") ?? "eleven_v4_turbo",
    openaiTtsModel: env("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts",
    openaiSttModel: env("OPENAI_STT_MODEL") ?? "gpt-4o-mini-transcribe",
    deepgramModel: env("DEEPGRAM_MODEL") ?? "nova-3",
    localSttModel: env("OS1_LOCAL_STT_MODEL") ?? "onnx-community/whisper-base.en",
  };
}

export const config = buildConfig();

/** Re-reads settings.json and the environment into `config` (in place). */
export function reloadConfig() {
  Object.assign(config, buildConfig());
}

/** Display name of what's thinking, for logs and the app. */
export function brainLabel(): string {
  return config.brain === "local" ? `${config.localModel} (on this computer)` : config.model;
}

/**
 * The app should show its welcome/settings screen: nothing has been set up yet,
 * or Claude was chosen without a key.
 */
export function needsSetup(): boolean {
  if (config.brain === "claude" && !config.keys.anthropic) return true;
  return !fs.existsSync(settingsFile) && !config.keys.anthropic && !process.env.OS1_BRAIN;
}

export function requireKey(name: keyof typeof config.keys, provider: string): string {
  const key = config.keys[name];
  if (!key) {
    throw new Error(`${provider} needs a ${name} API key. Add it in Settings.`);
  }
  return key;
}
