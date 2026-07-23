/**
 * VAD sometimes triggers on noise/echo and the transcription model hallucinates a
 * fragment on near-silence — the user sees a line they never said. Drop transcripts
 * that carry no real content before displaying/persisting them.
 *
 * Deliberately conservative: only fragments that cannot be a real utterance are
 * dropped (empty, punctuation-only, one stray latin letter). A single CJK character
 * (好/嗯) can be a genuine reply, so it stays.
 */
export function isPhantomTranscript(text: string): boolean {
  const stripped = text.replace(/[\s\p{P}\p{S}]/gu, '');
  if (stripped.length === 0) return true;
  // One lone latin letter is a breath/noise artifact, not speech.
  if (stripped.length === 1 && /[a-zA-Z]/.test(stripped)) return true;
  return false;
}
