/**
 * Maps character TTS voices (OpenAI TTS names stored in the DB) to voices
 * supported by the OpenAI Realtime API, which has a different voice set.
 */
const REALTIME_VOICE_MAP: Record<string, string> = {
  nova: 'coral', // Emma — warm, patient
  echo: 'echo', // Jake — casual male
  alloy: 'alloy', // Sophia — composed
  fable: 'verse', // Leo — upbeat
};

export function toRealtimeVoice(ttsVoice: string): string {
  return REALTIME_VOICE_MAP[ttsVoice] ?? 'marin';
}
