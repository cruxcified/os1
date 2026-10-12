/**
 * Wire protocol between an OS1 "body" (the browser UI today, maybe a pocket
 * device later) and the OS1 server. Kept dependency-free so any front end can
 * implement it: JSON text frames for control/events, binary frames for audio.
 *
 * Client -> server binary frame: one complete user utterance, 16 kHz mono WAV.
 * Server -> client binary frame: [uint32 BE turnId][audio file bytes (mp3/wav)].
 */

export type ClientMessage =
  | { type: "hello" }
  | { type: "text"; text: string }
  | { type: "interrupt" };

export type AgentState = "idle" | "listening" | "thinking" | "speaking";

export interface ServerInfo {
  name: string;
  model: string;
  stt: string;
  tts: string;
  voice: string;
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
