import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "./config.ts";
import type { MemoryItem } from "../shared/protocol.ts";

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  at: number;
}

const memoryFile = path.join(config.dataDir, "memory.json");
const historyFile = path.join(config.dataDir, "history.json");
const MAX_MEMORIES = 300;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const writes = new Map<string, Promise<void>>();

/** Atomic write (temp file + rename), serialized per file. */
function writeJson(file: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 2);
  const next = (writes.get(file) ?? Promise.resolve()).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, json);
    await fs.rename(tmp, file);
  });
  writes.set(file, next.catch(() => {}));
  return next;
}

/**
 * Long-term memory lives in two small JSON files under data/:
 * - memory.json: durable facts about the user and about the companion itself
 *   (its chosen name, opinions, running jokes), so its persona stays continuous.
 * - history.json: the recent verbatim conversation, so a new session picks up
 *   where the last one left off.
 * Plain files on purpose: easy to read, edit, back up, or move to a device.
 */
export class MemoryStore {
  private items: MemoryItem[] = [];
  private history: HistoryEntry[] = [];
  private reflecting: Promise<void> = Promise.resolve();
  private client = new Anthropic();

  async load() {
    this.items = (await readJson<{ items: MemoryItem[] }>(memoryFile, { items: [] })).items;
    this.history = (await readJson<{ messages: HistoryEntry[] }>(historyFile, { messages: [] }))
      .messages;
    return this;
  }

  list(): MemoryItem[] {
    return [...this.items].sort((a, b) => b.createdAt - a.createdAt);
  }

  async remove(id: string) {
    const before = this.items.length;
    this.items = this.items.filter((m) => m.id !== id);
    if (this.items.length !== before) await this.saveMemories();
    return this.items.length !== before;
  }

  recentHistory(): HistoryEntry[] {
    return this.history.slice(-config.historyTurns * 2);
  }

  lastSpokeAt(): number | undefined {
    return this.history.at(-1)?.at;
  }

  async appendHistory(entry: HistoryEntry) {
    this.history.push(entry);
    // Keep the file bounded; anything older has already been through reflection.
    if (this.history.length > 1000) this.history = this.history.slice(-500);
    await writeJson(historyFile, { messages: this.history });
  }

  /**
   * Appends to the most recent user message (they kept talking before we
   * replied). Returns the merged text, or undefined if the last entry isn't theirs.
   */
  async extendLastUserMessage(text: string): Promise<string | undefined> {
    const last = this.history.at(-1);
    if (last?.role !== "user") return undefined;
    last.content = `${last.content} ${text}`;
    last.at = Date.now();
    await writeJson(historyFile, { messages: this.history });
    return last.content;
  }

  /** Formats memories for the system prompt. */
  render(): string {
    const about = (who: MemoryItem["about"]) =>
      this.items
        .filter((m) => m.about === who)
        .map((m) => `- ${m.text}`)
        .join("\n");
    const user = about("user");
    const self = about("self");
    return [
      "<memories_about_them>",
      user || "(nothing yet: you are just meeting)",
      "</memories_about_them>",
      "<memories_about_yourself>",
      self || "(nothing yet: you have not chosen a name or formed opinions yet)",
      "</memories_about_yourself>",
    ].join("\n");
  }

  /**
   * After each exchange, a small fast model decides what is worth remembering.
   * Runs in the background and serially, so it never delays the spoken reply.
   */
  reflect(exchange: HistoryEntry[], onUpdated: () => void) {
    this.reflecting = this.reflecting
      .then(() => this.runReflection(exchange))
      .then((changed) => {
        if (changed) onUpdated();
      })
      .catch((err) => console.warn("[memory] reflection failed:", err?.message ?? err));
  }

  private async runReflection(exchange: HistoryEntry[]): Promise<boolean> {
    const Update = z.object({
      add: z.array(
        z.object({
          about: z.enum(["user", "self"]),
          text: z.string(),
        }),
      ),
      remove: z.array(z.string()),
    });

    const existing = this.items.map((m) => `${m.id} [${m.about}] ${m.text}`).join("\n");
    const transcript = exchange
      .map((e) => `${e.role === "user" ? "Them" : "You"}: ${e.content}`)
      .join("\n");

    const response = await this.client.messages.parse({
      model: config.memoryModel,
      max_tokens: 2000,
      system:
        "You maintain the long-term memory of a voice companion. Given its existing memories " +
        "and the latest exchange, return memories to add and ids to remove.\n" +
        "Add only durable things worth recalling weeks later: names, people in their life, " +
        "preferences, plans, feelings that matter, ongoing situations, shared jokes. " +
        'Use about="self" for things the companion established about itself (a name it chose, ' +
        "an opinion, something it promised). Write each memory as one short third-person " +
        'sentence ("They have a sister named Maya."; "You chose the name Theo."). ' +
        "Remove ids that are now wrong or superseded, and do not add duplicates. " +
        "Small talk usually adds nothing; empty lists are the common case.",
      messages: [
        {
          role: "user",
          content: `<existing_memories>\n${existing || "(none)"}\n</existing_memories>\n\n<latest_exchange>\n${transcript}\n</latest_exchange>`,
        },
      ],
      output_config: { format: zodOutputFormat(Update), effort: "low" },
    });

    const update = response.parsed_output;
    if (!update) return false;
    const removeIds = new Set(update.remove);
    const now = Date.now();
    const next = this.items.filter((m) => !removeIds.has(m.id));
    for (const add of update.add) {
      const text = add.text.trim();
      if (text && !next.some((m) => m.text.toLowerCase() === text.toLowerCase())) {
        next.push({ id: randomUUID().slice(0, 8), about: add.about, text, createdAt: now });
      }
    }
    if (next.length === this.items.length && removeIds.size === 0) return false;
    this.items = next.slice(-MAX_MEMORIES);
    await this.saveMemories();
    return true;
  }

  private saveMemories() {
    return writeJson(memoryFile, { items: this.items });
  }
}
