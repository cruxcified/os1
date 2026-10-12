import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropic.ts";
import { config } from "./config.ts";
import type { MemoryStore } from "./memory.ts";

/** A persona.md in the data folder overrides the built-in one, and is re-read each turn. */
function persona(): string {
  for (const file of [
    path.join(config.dataDir, "persona.md"),
    path.join(config.appRoot, "server", "persona.md"),
  ]) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      /* try the next one */
    }
  }
  throw new Error("persona.md not found");
}

// Server-side refusal fallback is supported on these models; others just stop.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export function stamp(at: number): string {
  return new Date(at).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function systemPrompt(memory: MemoryStore): Anthropic.Beta.BetaTextBlockParam[] {
  const intro = config.userName
    ? `The person you talk with is ${config.userName}.`
    : "";
  return [
    // Persona is static: keep it first so it stays a stable cache prefix.
    { type: "text", text: persona() },
    { type: "text", text: [intro, memory.render()].filter(Boolean).join("\n\n") },
  ];
}

/**
 * Streams a spoken reply from Claude. Yields text deltas as they arrive so the
 * caller can start text-to-speech on the first sentence immediately.
 */
export async function* reply(
  memory: MemoryStore,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = memory.recentHistory().map((m) => ({
    role: m.role,
    content: m.role === "user" ? `[${stamp(m.at)}] ${m.content}` : m.content,
  }));
  // The API requires the conversation to start with the user.
  while (messages.length && messages[0].role !== "user") messages.shift();

  const fallback = FALLBACK_MODELS.has(config.model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  const stream = anthropic().beta.messages.stream(
    {
      model: config.model,
      max_tokens: 4000,
      system: systemPrompt(memory),
      messages,
      // Conversation is latency-sensitive and rarely needs deep reasoning.
      output_config: { effort: config.effort },
      cache_control: { type: "ephemeral" },
      ...fallback,
    },
    { signal },
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    yield "Hm. I'd rather not go there. Can we talk about something else?";
  }
}
