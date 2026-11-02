/** Messages between the desktop shell (tray, global shortcuts) and the OS1 page. */

export type DesktopCommand =
  /** Mute or unmute the microphone (wakes OS1 if it's asleep). */
  | "toggle-mic"
  /** Quiet mode on or off: answers in captions only. */
  | "toggle-quiet";

export interface DesktopState {
  phase: "connecting" | "asleep" | "waking" | "awake";
  micOn: boolean;
  quiet: boolean;
  agentState: "idle" | "listening" | "thinking" | "speaking";
}

export interface DesktopBridge {
  /** Returns an unsubscribe function. */
  onCommand(callback: (command: DesktopCommand) => void): () => void;
  reportState(state: DesktopState): void;
}
