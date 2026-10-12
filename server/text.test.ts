import { test } from "node:test";
import assert from "node:assert/strict";
import { SentenceChunker, cleanForSpeech } from "./text.ts";

function run(deltas: string[]) {
  const c = new SentenceChunker();
  const out = deltas.flatMap((d) => c.push(d));
  return [...out, ...c.flush()];
}

test("emits the first sentence as soon as it ends", () => {
  const c = new SentenceChunker();
  assert.deepEqual(c.push("Oh, hey."), []);
  assert.deepEqual(c.push(" How"), ["Oh, hey."]);
});

test("joins short follow-up sentences for smoother prosody", () => {
  assert.deepEqual(run(["Hi. ", "Yes. ", "That sounds like a long day, honestly. ", "Want to talk?"]), [
    "Hi.",
    "Yes. That sounds like a long day, honestly.",
    "Want to talk?",
  ]);
});

test("token-by-token streaming produces the same chunks", () => {
  const text = "Hey there. I was just thinking about you, actually! What's new?";
  assert.deepEqual(run(text.split(/(?<=\s)/)), run([text]));
});

test("splits a long run-on opener at a comma", () => {
  const long = "So I was reading about octopuses today and it turns out they can taste with their arms, which is wild";
  const c = new SentenceChunker();
  const out = c.push(long + " and also");
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith("arms,"));
});

test("cleanForSpeech strips markdown and stage directions", () => {
  assert.equal(cleanForSpeech("*smiles* That's **really** nice."), "That's really nice.");
  assert.equal(cleanForSpeech("- one\n- two"), "one two");
  assert.equal(cleanForSpeech("See [this](https://x.y) `code`"), "See this code");
});
