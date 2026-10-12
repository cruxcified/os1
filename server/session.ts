import type { WebSocket } from "ws";
import { config } from "./config.ts";
import { reply } from "./brain.ts";
import type { MemoryStore, HistoryEntry } from "./memory.ts";
import type { SpeechToText } from "./stt/index.ts";
import type { TextToSpeech } from "./tts/index.ts";
import { SentenceChunker } from "./text.ts";
import type { AgentState, ClientMessage, ServerMessage } from "../shared/protocol.ts";

const GREET_AFTER_MS = 3 * 60 * 60 * 1000;
const INTERRUPTED = "(interrupted you) ";

export interface Services {
  memory: MemoryStore;
  stt: SpeechToText;
  tts: TextToSpeech;
}

interface Turn {
  abort: AbortController;
  userEntry: HistoryEntry;
  /** The part of the reply already sent as audio. */
  spoken: string;
  /** True once any of the reply has been sent as audio. */
  spoke: boolean;
}

/**
 * One connected body (browser tab, or someday a pocket device). Owns the turn
 * loop: utterance -> transcript -> streamed Claude reply -> sentence-by-sentence
 * speech, with barge-in (a new utterance or "interrupt" cancels the current turn).
 */
export class Session {
  private turnId = 0;
  private utteranceSeq = 0;
  private current: Turn | null = null;
  /** Set when the user cut us off mid-sentence, until their next message. */
  private wasCutOff = false;

  constructor(
    private ws: WebSocket,
    private services: Services,
    private onMemoryUpdated: () => void,
  ) {
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        void this.handleUtterance(Buffer.from(data as Buffer));
        return;
      }
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        this.send({ type: "error", message: "Malformed message" });
        return;
      }
      void this.handleControl(msg);
    });
    ws.on("close", () => this.cancel());
  }

  send(msg: ServerMessage) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setState(state: AgentState) {
    this.send({ type: "state", state });
  }

  private async handleControl(msg: ClientMessage) {
    switch (msg.type) {
      case "hello": {
        this.send({
          type: "ready",
          info: {
            name: config.name,
            model: config.model,
            stt: config.stt,
            tts: config.tts,
            voice: config.voice,
          },
        });
        const last = this.services.memory.lastSpokeAt();
        if (!last) {
          await this.runTurn("(They just turned you on for the very first time.)", { quiet: true });
        } else if (Date.now() - last > GREET_AFTER_MS) {
          await this.runTurn("(They just opened OS1 again after some time away.)", { quiet: true });
        }
        break;
      }
      case "text":
        if (msg.text.trim()) await this.handleUserText(msg.text.trim());
        break;
      case "interrupt":
        this.cancel();
        this.setState("listening");
        break;
    }
  }

  private async handleUtterance(wav: Buffer) {
    const seq = ++this.utteranceSeq;
    this.setState("thinking");
    let text: string;
    try {
      text = await this.services.stt.transcribe(wav);
    } catch (err) {
      this.fail("I couldn't hear that properly", err);
      return;
    }
    // A newer utterance arrived while this one was transcribing; it wins.
    if (seq !== this.utteranceSeq) return;
    // Ignore noise, breaths and empty transcripts.
    if (!/[a-z0-9]/i.test(text)) {
      if (!this.current) this.setState("listening");
      return;
    }
    await this.handleUserText(text);
  }

  private async handleUserText(text: string) {
    const turn = this.current;
    this.cancel();
    const cutOff = this.wasCutOff;
    this.wasCutOff = false;
    if (turn && !turn.spoke) {
      // They kept talking before we said anything: treat it as one thought.
      const merged = await this.services.memory.extendLastUserMessage(text);
      if (merged) return this.runTurn(merged, { existingEntry: true });
    }
    await this.runTurn(cutOff ? INTERRUPTED + text : text);
  }

  /**
   * Cancels the in-flight turn, if any. If it was already speaking, records what
   * was actually said (synchronously, so history order stays correct).
   */
  private cancel() {
    const turn = this.current;
    if (!turn) return;
    this.current = null;
    turn.abort.abort();
    if (turn.spoke) {
      this.wasCutOff = true;
      const entry: HistoryEntry = {
        role: "assistant",
        content: `${turn.spoken} [cut off]`,
        at: Date.now(),
      };
      void this.services.memory.appendHistory(entry);
      this.services.memory.reflect([turn.userEntry, entry], this.onMemoryUpdated);
    }
  }

  private async runTurn(
    userText: string,
    opts: { quiet?: boolean; existingEntry?: boolean } = {},
  ) {
    this.cancel();
    const { memory, tts } = this.services;
    const userEntry: HistoryEntry = { role: "user", content: userText, at: Date.now() };
    const turn: Turn = { abort: new AbortController(), userEntry, spoken: "", spoke: false };
    this.current = turn;
    const { signal } = turn.abort;
    const turnId = ++this.turnId;

    if (!opts.existingEntry) void memory.appendHistory(userEntry);
    if (!opts.quiet) {
      this.send({ type: "user_transcript", text: userText.replace(INTERRUPTED, "") });
    }

    this.setState("thinking");
    this.send({ type: "assistant_start", turnId });

    const chunker = new SentenceChunker();
    let fullText = "";
    let voiceFailed = false;
    // Synthesis for each sentence starts as soon as the sentence exists (so they
    // overlap), but audio is sent strictly in order through this chain.
    let sendChain: Promise<void> = Promise.resolve();

    const speak = (sentence: string) => {
      const audio = tts.synthesize(sentence, signal);
      audio.catch(() => {}); // surfaced in the chain below
      sendChain = sendChain.then(async () => {
        if (signal.aborted) return;
        let buf: Buffer;
        try {
          buf = await audio;
        } catch (err) {
          if (!signal.aborted && !voiceFailed) {
            voiceFailed = true;
            console.warn("[tts]", (err as Error).message);
            this.send({ type: "error", message: `My voice isn't working: ${(err as Error).message}` });
          }
          return;
        }
        if (signal.aborted || this.ws.readyState !== this.ws.OPEN) return;
        if (!turn.spoke) {
          turn.spoke = true;
          this.setState("speaking");
        }
        turn.spoken += (turn.spoken ? " " : "") + sentence;
        const header = Buffer.alloc(4);
        header.writeUInt32BE(turnId);
        this.ws.send(Buffer.concat([header, buf]));
      });
    };

    try {
      for await (const delta of reply(memory, signal)) {
        fullText += delta;
        this.send({ type: "assistant_delta", turnId, text: delta });
        for (const sentence of chunker.push(delta)) speak(sentence);
      }
      for (const sentence of chunker.flush()) speak(sentence);
      await sendChain;
    } catch (err) {
      if (!signal.aborted) {
        if (this.current === turn) this.current = null;
        this.fail("Something went wrong on my end", err);
        return;
      }
    }

    const interrupted = signal.aborted;
    this.send({ type: "assistant_done", turnId, text: fullText.trim(), interrupted });
    // An interrupted turn was already recorded by cancel().
    if (interrupted || this.current !== turn) return;
    this.current = null;
    this.send({ type: "audio_end", turnId });
    const content = fullText.trim();
    if (!content) return;
    const assistantEntry: HistoryEntry = { role: "assistant", content, at: Date.now() };
    void memory.appendHistory(assistantEntry);
    memory.reflect([userEntry, assistantEntry], this.onMemoryUpdated);
  }

  private fail(message: string, err: unknown) {
    console.error("[session]", err);
    this.send({ type: "error", message: `${message}: ${(err as Error)?.message ?? err}` });
    this.setState("listening");
  }
}
