import { describe, it, expect } from 'vitest';
import {
  floatTo16BitPCM,
  int16ToFloat32,
  downsample,
  int16ToBase64,
  base64ToInt16,
} from '@/lib/audio/pcm';

describe('floatTo16BitPCM', () => {
  it('maps 0 / +1 / -1 to the PCM16 range and clamps overshoot', () => {
    const pcm = floatTo16BitPCM(new Float32Array([0, 1, -1, 1.5, -2]));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(32767);
    expect(pcm[2]).toBe(-32768);
    expect(pcm[3]).toBe(32767); // clamped
    expect(pcm[4]).toBe(-32768); // clamped
  });
});

describe('int16ToFloat32', () => {
  it('round-trips within one quantization step', () => {
    const orig = new Float32Array([0, 0.5, -0.5, 0.999]);
    const back = int16ToFloat32(floatTo16BitPCM(orig));
    for (let i = 0; i < orig.length; i++) {
      expect(Math.abs(back[i] - orig[i])).toBeLessThan(1 / 32767 + 1e-6);
    }
  });
});

describe('downsample', () => {
  it('halves the sample count going 48k → 24k', () => {
    const input = new Float32Array(480); // 10ms @ 48k
    const out = downsample(input, 48000, 24000);
    expect(out.length).toBe(240); // 10ms @ 24k
  });

  it('returns the input unchanged when rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsample(input, 24000, 24000)).toBe(input); // same array, no work
  });

  it('averages (anti-alias), not naive drop-every-other', () => {
    // [1,1,0,0] @48k → 24k: box-filter windows [1,1] and [0,0] → [1, 0]
    const out = downsample(new Float32Array([1, 1, 0, 0]), 48000, 24000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(0, 5);
  });
});

describe('base64 <-> int16 round-trip', () => {
  it('preserves the samples', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 12345]);
    const back = base64ToInt16(int16ToBase64(pcm));
    expect(Array.from(back)).toEqual(Array.from(pcm));
  });
});
