import { describe, it, expect } from 'vitest';
import { isPhantomTranscript } from '@/lib/realtime/transcript-filter';

describe('isPhantomTranscript (drop hallucinated no-speech transcripts)', () => {
  it('drops empty / whitespace / punctuation-only fragments', () => {
    expect(isPhantomTranscript('')).toBe(true);
    expect(isPhantomTranscript('   ')).toBe(true);
    expect(isPhantomTranscript('.')).toBe(true);
    expect(isPhantomTranscript('…')).toBe(true);
    expect(isPhantomTranscript('。。。')).toBe(true);
    expect(isPhantomTranscript('- -')).toBe(true);
  });

  it('drops single stray latin letters (breath/noise artifacts)', () => {
    expect(isPhantomTranscript('a')).toBe(true);
    expect(isPhantomTranscript('E.')).toBe(true);
  });

  it('keeps real utterances, including short ones', () => {
    expect(isPhantomTranscript('Hi')).toBe(false);
    expect(isPhantomTranscript('No.')).toBe(false);
    expect(isPhantomTranscript("I'm gonna head out.")).toBe(false);
    expect(isPhantomTranscript('好')).toBe(false); // single CJK char can be a real reply
  });
});
