/**
 * Splits a streaming LLM reply into speakable chunks so text-to-speech can
 * start on the first sentence while the rest is still being generated.
 */
export class SentenceChunker {
  private buffer = "";
  private emitted = 0;

  /** Feed new text; returns any complete chunks ready to be spoken. */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    // Sentence end: . ! ? … (optionally followed by closing quotes/brackets), then whitespace.
    // Also break on newlines and, for a long run-on first sentence, on a comma/dash.
    const boundary = /([.!?…]+["'”’)\]]*\s+|\n+)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = boundary.exec(this.buffer))) {
      const end = match.index + match[0].length;
      const chunk = this.buffer.slice(last, end).trim();
      // Avoid tiny fragments like "Oh." on their own except at the very start,
      // where a fast first chunk is worth more than smooth prosody.
      if (chunk.length >= (this.emitted === 0 ? 2 : 24) || /\n/.test(match[0])) {
        if (chunk) out.push(chunk);
        last = end;
        this.emitted++;
      }
    }
    this.buffer = this.buffer.slice(last);

    if (this.emitted === 0 && this.buffer.length > 90) {
      const soft = this.buffer.search(/[,;:—–]\s+(?=[^,;:—–]*$)/);
      if (soft > 40) {
        out.push(this.buffer.slice(0, soft + 1).trim());
        this.buffer = this.buffer.slice(soft + 1);
        this.emitted++;
      }
    }
    return out.map(cleanForSpeech).filter(Boolean);
  }

  /** Returns whatever is left once the stream ends. */
  flush(): string[] {
    const rest = cleanForSpeech(this.buffer.trim());
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

/** Strips markdown and stage directions that sound wrong when read aloud. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(^|\s)\*[^*\n]+\*(?=\s|$)/g, "$1") // *sighs*-style actions
    .replace(/[*_#>~]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
