import { describe, it, expect } from 'vitest';
import { toRealtimeVoice } from '@/lib/realtime/voice-map';

describe('toRealtimeVoice', () => {
  it('maps each character TTS voice to a supported realtime voice', () => {
    expect(toRealtimeVoice('nova')).toBe('coral'); // Emma — warm female
    expect(toRealtimeVoice('echo')).toBe('echo'); // Jake — direct passthrough
    expect(toRealtimeVoice('alloy')).toBe('alloy'); // Sophia — direct passthrough
    expect(toRealtimeVoice('fable')).toBe('verse'); // Leo — energetic
  });

  it('falls back to marin for unknown voices', () => {
    expect(toRealtimeVoice('unknown-voice')).toBe('marin');
    expect(toRealtimeVoice('')).toBe('marin');
  });
});
