/**
 * Wire protocol between an OS1 "body" (the browser UI today, maybe a pocket
 * device later) and the OS1 server. Kept dependency-free so any front end can
 * implement it: JSON text frames for control/events, binary frames for audio.
 *
 * Client -> server binary frame: one complete user utterance, 16 kHz mono WAV.
 * Server -> client binary frame: [uint32 BE turnId][audio file bytes (mp3/wav)].
 */

export type ClientMessage =
  /** voice: false = quiet mode (replies arrive as text only, no audio). */
  | { type: "hello"; voice?: boolean }
  | { type: "voice"; on: boolean }
  | { type: "text"; text: string }
  | { type: "interrupt" };

export type AgentState = "idle" | "listening" | "thinking" | "speaking";

export interface ServerInfo {
  name: string;
  model: string;
  stt: string;
  tts: string;
  voice: string;
  /** Not set up yet (or Claude chosen without a key): the app should open Settings. */
  needsSetup: boolean;
}

/** What the settings screen reads. Secrets are never sent back, only whether they're set. */
export interface SettingsView {
  keys: Record<"anthropicKey" | "deepgramKey" | "elevenlabsKey" | "openaiKey", boolean>;
  /** "claude", "local" (Ollama on this computer) or "auto" (Claude if there's a key). */
  brain: string;
  /** Ollama model tag; empty means the default. */
  localModel: string;
  stt: string;
  tts: string;
  voice: string;
  userName: string;
  /** The voice performs audio tags like [laughs]. Only takes effect with ElevenLabs. */
  expressive: boolean;
  /** Nothing set up yet, or Claude chosen without a key. */
  needsSetup: boolean;
  /** What "auto" currently resolves to. */
  active: { brain: string; localModel: string; stt: string; tts: string; voice: string };
}

/** GET /api/local/status: the free local brain (Ollama). */
export interface LocalStatus {
  running: boolean;
  installed: boolean;
  model: string;
  download?: { percent: number; status: string; error?: string };
}

export type ServerMessage =
  | { type: "ready"; info: ServerInfo }
  | { type: "state"; state: AgentState }
  | { type: "user_transcript"; text: string }
  | { type: "assistant_start"; turnId: number }
  | { type: "assistant_delta"; turnId: number; text: string }
  | { type: "assistant_done"; turnId: number; text: string; interrupted: boolean }
  | { type: "audio_end"; turnId: number }
  | { type: "memory_updated" }
  | { type: "error"; message: string };

export interface MemoryItem {
  id: string;
  about: "user" | "self";
  text: string;
  createdAt: number;
}
