import { useCallback, useEffect, useRef, useState } from "react";
import type { MicVAD } from "@ricky0123/vad-web";
import { toast } from "sonner";
import { SpeechPlayer } from "@/lib/player";
import { encodeWav16k } from "@/lib/wav";
import type { AgentState, ClientMessage, ServerInfo, ServerMessage } from "../../shared/protocol";

export type Phase = "connecting" | "asleep" | "waking" | "awake";

// How sure the VAD must be that someone is talking. Higher while OS1 is speaking,
// so its own voice leaking from the speakers doesn't count as an interruption.
const SPEECH_THRESHOLD = 0.5;
const SPEECH_THRESHOLD_WHILE_TALKING = 0.8;

export function useCompanion() {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [memoryVersion, setMemoryVersion] = useState(0);

  const ws = useRef<WebSocket | null>(null);
  const player = useRef<SpeechPlayer | null>(null);
  const vad = useRef<MicVAD | null>(null);
  const awake = useRef(false);
  /** Audio for turns at or below this id is stale (we were interrupted). */
  const droppedTurn = useRef(0);
  const currentTurn = useRef(0);

  const send = useCallback((msg: ClientMessage | ArrayBuffer) => {
    const socket = ws.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(msg instanceof ArrayBuffer ? msg : JSON.stringify(msg));
    return true;
  }, []);

  const getPlayer = useCallback(() => {
    player.current ??= new SpeechPlayer(() => {
      setAgentState("listening");
      vad.current?.setOptions({ positiveSpeechThreshold: SPEECH_THRESHOLD });
    });
    return player.current;
  }, []);

  /** Stop talking now (the user is speaking over us). */
  const bargeIn = useCallback(() => {
    const p = player.current;
    if (!p?.playing) return;
    p.stop();
    p.setVolume(1);
    droppedTurn.current = currentTurn.current;
    send({ type: "interrupt" });
  }, [send]);

  // --- Server connection (auto-reconnects) ---
  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: number | undefined;

    const onMessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const turnId = new DataView(event.data).getUint32(0);
        if (turnId <= droppedTurn.current || turnId < currentTurn.current) return;
        const p = getPlayer();
        p.enqueue(event.data.slice(4));
        vad.current?.setOptions({ positiveSpeechThreshold: SPEECH_THRESHOLD_WHILE_TALKING });
        return;
      }
      const msg = JSON.parse(event.data as string) as ServerMessage;
      switch (msg.type) {
        case "ready":
          setInfo(msg.info);
          break;
        case "state":
          // "listening" after speaking is decided locally, once playback finishes.
          if (msg.state !== "listening" || !player.current?.playing) setAgentState(msg.state);
          break;
        case "user_transcript":
          setHeard(msg.text);
          break;
        case "assistant_start":
          currentTurn.current = msg.turnId;
          setSaid("");
          break;
        case "assistant_delta":
          if (msg.turnId === currentTurn.current) setSaid((s) => s + msg.text);
          break;
        case "audio_end":
          if (msg.turnId === currentTurn.current && msg.turnId > droppedTurn.current) {
            getPlayer().endOfStream();
          }
          break;
        case "assistant_done":
          break;
        case "memory_updated":
          setMemoryVersion((v) => v + 1);
          break;
        case "error":
          toast.error(msg.message);
          break;
      }
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.binaryType = "arraybuffer";
      ws.current = socket;
      socket.onopen = () => {
        retry = 0;
        if (awake.current) {
          send({ type: "hello" });
        } else {
          setPhase("asleep");
        }
      };
      socket.onmessage = onMessage;
      socket.onclose = () => {
        if (closed) return;
        setPhase((p) => (p === "awake" ? p : "connecting"));
        timer = window.setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
      };
    };
    connect();

    return () => {
      closed = true;
      window.clearTimeout(timer);
      ws.current?.close();
    };
  }, [getPlayer, send]);

  // --- Wake up: needs a user gesture for the mic and for audio playback ---
  const wake = useCallback(async () => {
    if (awake.current) return;
    setPhase("waking");
    try {
      await getPlayer().resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      setMicStream(stream);
      // Loaded on demand: the VAD pulls in onnxruntime, the bulk of the bundle.
      const { MicVAD } = await import("@ricky0123/vad-web");
      vad.current = await MicVAD.new({
        model: "v5",
        baseAssetPath: "/vendor/vad/",
        onnxWASMBasePath: "/vendor/ort/",
        getStream: async () => stream,
        pauseStream: async () => {},
        resumeStream: async () => stream,
        positiveSpeechThreshold: SPEECH_THRESHOLD,
        negativeSpeechThreshold: 0.35,
        // How long a pause ends your turn. Shorter = snappier, longer = fewer cut-offs.
        redemptionMs: 700,
        preSpeechPadMs: 300,
        minSpeechMs: 250,
        onSpeechStart: () => {
          setUserSpeaking(true);
          player.current?.setVolume(0.3);
        },
        onSpeechRealStart: bargeIn,
        onVADMisfire: () => {
          setUserSpeaking(false);
          player.current?.setVolume(1);
        },
        onSpeechEnd: (audio) => {
          setUserSpeaking(false);
          player.current?.setVolume(1);
          send(encodeWav16k(audio));
        },
      });
      await vad.current.start();
      awake.current = true;
      setPhase("awake");
      setAgentState("listening");
      send({ type: "hello" });
    } catch (err) {
      console.error(err);
      setPhase("asleep");
      toast.error(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "OS1 needs microphone access to hear you."
          : `Couldn't start listening: ${(err as Error).message}`,
      );
    }
  }, [bargeIn, getPlayer, send]);

  // Release the mic and audio on unmount.
  useEffect(
    () => () => {
      const v = vad.current;
      void v?.destroy();
      void player.current?.context.close();
    },
    [],
  );
  useEffect(() => () => micStream?.getTracks().forEach((t) => t.stop()), [micStream]);

  const toggleMic = useCallback(async () => {
    const v = vad.current;
    if (!v) return;
    if (micOn) await v.pause();
    else await v.start();
    setMicOn(!micOn);
  }, [micOn]);

  const sendText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      bargeIn();
      setHeard(text.trim());
      send({ type: "text", text: text.trim() });
    },
    [bargeIn, send],
  );

  return {
    phase,
    agentState,
    userSpeaking,
    micOn,
    micStream,
    info,
    heard,
    said,
    memoryVersion,
    wake,
    toggleMic,
    sendText,
  };
}
