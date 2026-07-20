import { describe, it, expect } from 'vitest';
import { SentenceChunker } from '@/lib/audio/sentence-chunker';

/** Feed the chunker a sequence of token deltas, return all flushed chunks. */
function run(deltas: string[]): string[] {
  const chunker = new SentenceChunker();
  const out: string[] = [];
  for (const d of deltas) {
    out.push(...chunker.push(d));
  }
  out.push(...chunker.flush());
  return out;
}

describe('SentenceChunker', () => {
  it('emits a sentence once a boundary is reached and min length met', () => {
    expect(run(['Hello there, my friend!', ' How was your day today?'])).toEqual([
      'Hello there, my friend!',
      'How was your day today?',
    ]);
  });

  it('holds short fragments until they reach the minimum length', () => {
    // "Nice!" alone is under the minimum — merged with what follows
    expect(run(['Nice! That sounds like a lot of fun, honestly.'])).toEqual([
      'Nice! That sounds like a lot of fun, honestly.',
    ]);
  });

  it('does not split on abbreviations like Mr. or e.g.', () => {
    const chunks = run(['Mr. Smith went to Washington because he wanted change.']);
    expect(chunks).toEqual(['Mr. Smith went to Washington because he wanted change.']);
  });

  it('does not split on decimals', () => {
    expect(run(['The bill was 3.50 dollars in total, can you believe it?'])).toEqual([
      'The bill was 3.50 dollars in total, can you believe it?',
    ]);
  });

  it('splits on question marks and exclamation points', () => {
    expect(
      run(['Are you serious right now? That is absolutely amazing news!']),
    ).toEqual(['Are you serious right now?', 'That is absolutely amazing news!']);
  });

  it('force-flushes when a chunk exceeds the max length without a boundary', () => {
    const long = 'word '.repeat(60).trim(); // 299 chars, no sentence boundary
    const chunks = run([long]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(220);
    }
  });

  it('flush() emits any trailing text without a boundary', () => {
    expect(run(['And that is why I think'])).toEqual(['And that is why I think']);
  });

  it('handles deltas that split mid-word', () => {
    expect(run(['Hel', 'lo the', 're, my good friend! Grea', 't to see you again.'])).toEqual([
      'Hello there, my good friend!',
      'Great to see you again.',
    ]);
  });

  it('handles ellipsis without spurious splits', () => {
    expect(run(['Well... let me think about that for a second, okay?'])).toEqual([
      'Well... let me think about that for a second, okay?',
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(run([])).toEqual([]);
    expect(run([''])).toEqual([]);
  });
});
