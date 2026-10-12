import { useCallback, useEffect, useRef, useState } from "react";
import { BrainCircuit, Captions, Mic, MicOff, Send, Settings } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/textarea";
import { useCompanion } from "@/hooks/useCompanion";
import type { MemoryItem, SettingsView } from "../../shared/protocol";
import { OS1Animation } from "./OS1Animation";
import { AudioVisualizer } from "./AudioVisualizer";
import { MemoryViewer } from "./MemoryViewer";
import { SettingsPanel } from "./SettingsPanel";
import "./OS1Animation.css";

/** Running inside the OS1 desktop app (Electron) rather than a browser tab. */
const isDesktopApp = navigator.userAgent.includes("Electron");

const STATUS: Record<string, string> = {
  listening: "listening",
  thinking: "thinking",
  speaking: "",
  idle: "",
};

export function Companion() {
  const os = useCompanion();
  const [input, setInput] = useState("");
  const [showCaptions, setShowCaptions] = useState(() => localStorage.getItem("os1_captions") !== "off");
  const [transforming, setTransforming] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  const wokeOnce = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);

  // First run: no Anthropic key yet, so open Settings before anything else.
  useEffect(() => {
    fetch("/api/settings")
      .then((res) => (res.ok ? (res.json() as Promise<SettingsView>) : null))
      .then((view) => {
        if (view && !view.keys.anthropicKey) {
          setFirstRun(true);
          setSettingsOpen(true);
        }
      })
      .catch(() => {})
      .finally(() => setSetupChecked(true));
  }, []);

  // The desktop app has no autoplay or mic-gesture restrictions: wake right away.
  // Only once: if it fails (no mic, permission denied), "tap to begin" takes over.
  const { phase, wake } = os;
  const autoWoke = useRef(false);
  useEffect(() => {
    if (!isDesktopApp || autoWoke.current || phase !== "asleep" || !setupChecked || settingsOpen) return;
    autoWoke.current = true;
    void wake();
  }, [phase, wake, setupChecked, settingsOpen]);

  useEffect(() => {
    document.body.classList.add("os1-theme");
    return () => document.body.classList.remove("os1-theme");
  }, []);

  // Play the OS1 "boot" flourish once when it first wakes up.
  useEffect(() => {
    if (os.phase !== "awake" || wokeOnce.current) return;
    wokeOnce.current = true;
    setTransforming(true);
    const t = setTimeout(() => setTransforming(false), 2500);
    return () => clearTimeout(t);
  }, [os.phase]);

  const [memoryReload, setMemoryReload] = useState(0);
  useEffect(() => {
    if (!memoryOpen) return;
    let cancelled = false;
    fetch("/api/memories")
      .then((res) => res.json() as Promise<{ items: MemoryItem[] }>)
      .then((data) => !cancelled && setMemories(data.items))
      .catch(() => {
        toast.error("Could not load memories.");
        if (!cancelled) setMemories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [memoryOpen, os.memoryVersion, memoryReload]);

  const deleteMemory = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
      if (!res.ok) toast.error("Could not delete memory.");
      setMemoryReload((n) => n + 1);
    },
    [],
  );

  const toggleCaptions = () => {
    const next = !showCaptions;
    setShowCaptions(next);
    try {
      localStorage.setItem("os1_captions", next ? "on" : "off");
    } catch {
      /* private mode */
    }
  };

  const submit = () => {
    os.sendText(input);
    setInput("");
  };

  const busy = os.agentState === "thinking" || os.agentState === "speaking";

  return (
    <div
      className="os1-container"
      onClick={os.phase === "asleep" && !settingsOpen ? () => void os.wake() : undefined}
    >
      {isDesktopApp && <div className="titlebar-drag" />}
      <OS1Animation isTTSProcessing={busy} showTransformation={transforming} />

      {os.phase === "connecting" && (
        <div className="loading-bar-container">
          <div className="loading-bar indeterminate" />
        </div>
      )}

      {(os.phase === "asleep" || os.phase === "waking") && (
        <div className="wake-prompt">{os.phase === "asleep" ? "tap to begin" : "waking up…"}</div>
      )}

      {os.phase === "awake" && (
        <>
          {showCaptions && (
            <div className="captions">
              {os.heard && <p className="caption-you">{os.heard}</p>}
              {os.said && <p className="caption-os1">{os.said}</p>}
            </div>
          )}

          <div className="status-line">
            {!os.micOn ? "muted" : os.userSpeaking ? "" : STATUS[os.agentState]}
          </div>

          {os.micStream && os.micOn && os.userSpeaking && (
            <div className="audio-visualizer-container">
              <div className="visualizer-glow"></div>
              <div className="visualizer-inner">
                <AudioVisualizer stream={os.micStream} className="os1-visualizer" />
              </div>
            </div>
          )}

          <div className="input-container ready">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Talk, or type here…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button
              className={`memory-button ${showCaptions ? "active" : ""}`}
              onClick={toggleCaptions}
              title={showCaptions ? "Hide captions" : "Show captions"}
            >
              <Captions className="icon" />
            </button>
            <button
              className="memory-button"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
            >
              <Settings className="icon" />
            </button>
            <button
              className={`memory-button ${memoryOpen ? "active" : ""}`}
              onClick={() => {
                if (!memoryOpen) setMemories(null);
                setMemoryOpen(!memoryOpen);
              }}
              title="What I remember"
            >
              <BrainCircuit className="icon" />
            </button>
            <div className="mic-button-wrapper">
              <button
                className={`mic-button ${os.micOn ? "recording" : ""}`}
                onClick={() => void os.toggleMic()}
                title={os.micOn ? "Mute microphone" : "Unmute microphone"}
              >
                {os.micOn ? <Mic className="icon" /> : <MicOff className="icon" />}
              </button>
            </div>
            <button className="send-button" onClick={submit} disabled={!input.trim()}>
              <Send />
            </button>
          </div>

          <MemoryViewer
            isOpen={memoryOpen}
            memories={memories ?? []}
            onDelete={(id) => void deleteMemory(id)}
            isLoading={memories === null}
          />
        </>
      )}
      <SettingsPanel
        open={settingsOpen}
        firstRun={firstRun}
        onClose={() => {
          setSettingsOpen(false);
          setFirstRun(false);
        }}
      />
    </div>
  );
}
