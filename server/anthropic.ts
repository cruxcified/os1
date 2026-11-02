import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";

let cached: { key: string | undefined; client: Anthropic } | undefined;

/** One client per API key, recreated if the key changes in Settings. */
export function anthropic(): Anthropic {
  const key = config.keys.anthropic;
  if (!cached || cached.key !== key) {
    // Without a key, the SDK falls back to its own credential lookup.
    cached = { key, client: new Anthropic(key ? { apiKey: key } : {}) };
  }
  return cached.client;
}
