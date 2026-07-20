/**
 * Splits a streaming LLM token feed into speakable sentence chunks for TTS.
 * Stateful: feed deltas with push(), call flush() at stream end.
 */

const MIN_CHUNK = 10; // don't emit tiny fragments like "Nice!" alone
const MAX_CHUNK = 220; // force-flush so TTS latency stays bounded

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'vs', 'etc', 'approx',
]);

const TERMINATORS = '.!?';

export class SentenceChunker {
  private buffer = '';

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    let chunk: string | null;
    while ((chunk = this.extract()) !== null) {
      out.push(chunk);
    }
    return out;
  }

  flush(): string[] {
    const out: string[] = [];
    while (this.buffer.length > MAX_CHUNK) {
      out.push(this.forceCut());
    }
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest) out.push(rest);
    return out;
  }

  private forceCut(): string {
    let cut = this.buffer.lastIndexOf(' ', MAX_CHUNK);
    if (cut <= 0) cut = MAX_CHUNK;
    const chunk = this.buffer.slice(0, cut).trim();
    this.buffer = this.buffer.slice(cut).trimStart();
    return chunk;
  }

  private extract(): string | null {
    if (this.buffer.length > MAX_CHUNK) {
      return this.forceCut();
    }

    for (let i = 0; i < this.buffer.length; i++) {
      if (!TERMINATORS.includes(this.buffer[i])) continue;

      // Consume a run of terminators (ellipsis "...", "?!") as one boundary.
      let j = i;
      while (j + 1 < this.buffer.length && TERMINATORS.includes(this.buffer[j + 1])) j++;

      // Boundary at buffer end: can't decide yet — wait for more input (flush handles the tail).
      if (j + 1 >= this.buffer.length) return null;

      // Must be followed by whitespace.
      if (!/\s/.test(this.buffer[j + 1])) {
        i = j;
        continue;
      }

      // Peek at the next non-space char; need it to look like a sentence start.
      let k = j + 1;
      while (k < this.buffer.length && /\s/.test(this.buffer[k])) k++;
      if (k >= this.buffer.length) return null; // wait for the next char to arrive
      if (!/[A-Z0-9"'“‘]/.test(this.buffer[k])) {
        i = j;
        continue;
      }

      // Single "." — rule out abbreviations ("Mr. Smith") and dotted forms ("e.g.").
      if (this.buffer[i] === '.' && j === i) {
        const before = this.buffer.slice(0, i);
        const word = before.match(/([A-Za-z]+)$/)?.[1]?.toLowerCase();
        if (word && (ABBREVIATIONS.has(word) || /(?:^|\s)[A-Za-z]\.[A-Za-z]$/.test(before))) {
          i = j;
          continue;
        }
      }

      const candidate = this.buffer.slice(0, j + 1).trim();
      if (candidate.length < MIN_CHUNK) {
        i = j;
        continue;
      }

      this.buffer = this.buffer.slice(j + 1).trimStart();
      return candidate;
    }
    return null;
  }
}
