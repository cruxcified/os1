/**
 * The free local brain: a chat model running on this computer through Ollama
 * (https://ollama.com). No API key and no cost, at the price of a smaller mind
 * than Claude and replies that depend on the computer's speed.
 */
import { config } from "./config.ts";
import type { LocalStatus } from "../shared/protocol.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class LocalBrainError extends Error {}

const NOT_RUNNING =
  "My local mind isn't running. Install Ollama from ollama.com and open it, or add an Anthropic key in Settings to use Claude.";

async function call(pathname: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${config.ollamaUrl}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new LocalBrainError(NOT_RUNNING);
  }
  if (res.status === 404) {
    throw new LocalBrainError(
      `The model ${config.localModel} isn't downloaded yet. Download it in Settings, or run "ollama pull ${config.localModel}".`,
    );
  }
  if (!res.ok) {
    throw new LocalBrainError(`Ollama said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

/** Yields each JSON object of an Ollama newline-delimited stream. */
async function* lines<T>(res: Response): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as T;
}

interface ChatChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

const options = () => ({
  num_ctx: config.localContext,
  temperature: 0.8,
});

/** Streams a reply as text deltas. */
export async function* localChat(messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
  const res = await call(
    "/api/chat",
    {
      model: config.localModel,
      messages,
      stream: true,
      // Keep the model loaded between turns so replies start fast.
      keep_alive: "30m",
      options: options(),
    },
    signal,
  );
  for await (const chunk of lines<ChatChunk>(res)) {
    if (chunk.error) throw new LocalBrainError(chunk.error);
    const text = chunk.message?.content;
    if (text) yield text;
    if (chunk.done) return;
  }
}

/** One-shot reply constrained to a JSON schema (Ollama structured outputs). */
export async function localJson(messages: ChatMessage[], schema: object): Promise<unknown> {
  const res = await call("/api/chat", {
    model: config.localModel,
    messages,
    stream: false,
    format: schema,
    keep_alive: "30m",
    options: { ...options(), temperature: 0 },
  });
  const body = (await res.json()) as ChatChunk;
  if (body.error) throw new LocalBrainError(body.error);
  return JSON.parse(body.message?.content ?? "null");
}


let download: (NonNullable<LocalStatus["download"]> & { model: string }) | undefined;

export async function localStatus(): Promise<LocalStatus> {
  const model = config.localModel;
  try {
    const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    const { models = [] } = (await res.json()) as { models?: { name: string }[] };
    // "gemma3" means "gemma3:latest".
    const want = model.includes(":") ? model : `${model}:latest`;
    const installed = models.some((m) => m.name === want);
    const current = download?.model === model ? download : undefined;
    const progress = current && { percent: current.percent, status: current.status, error: current.error };
    return { running: true, installed, model, download: progress };
  } catch {
    return { running: false, installed: false, model };
  }
}

/** Starts downloading the configured model in the background; progress shows in localStatus(). */
export function pullLocalModel() {
  const model = config.localModel;
  if (download?.model === model && !download.error && download.percent < 100) return;
  download = { model, percent: 0, status: "starting" };
  void (async () => {
    try {
      const res = await call("/api/pull", { model, stream: true });
      for await (const chunk of lines<{ status?: string; completed?: number; total?: number; error?: string }>(res)) {
        if (chunk.error) throw new LocalBrainError(chunk.error);
        download = {
          model,
          status: chunk.status ?? "",
          percent:
            chunk.total && chunk.completed
              ? Math.min(99, Math.round((chunk.completed / chunk.total) * 100))
              : download?.percent ?? 0,
        };
      }
      download = { model, percent: 100, status: "success" };
    } catch (err) {
      download = { model, percent: 0, status: "failed", error: (err as Error).message };
    }
  })();
}
