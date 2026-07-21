import { describe, it, expect } from 'vitest';
import { float32ToWav } from '@/lib/audio/wav';

function readString(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('float32ToWav', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 1.5, -1.5]); // incl. clipping
  const buffer = float32ToWav(samples, 16000);
  const view = new DataView(buffer);

  it('produces a valid RIFF/WAVE header', () => {
    expect(readString(view, 0, 4)).toBe('RIFF');
    expect(readString(view, 8, 4)).toBe('WAVE');
    expect(readString(view, 12, 4)).toBe('fmt ');
    expect(readString(view, 36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
  });

  it('declares mono 16-bit PCM at the given sample rate', () => {
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(28, true)).toBe(16000 * 2); // byte rate
  });

  it('encodes samples as clamped 16-bit PCM', () => {
    expect(buffer.byteLength).toBe(44 + samples.length * 2);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(view.getInt16(48, true)).toBe(Math.round(-0.5 * 0x8000));
    expect(view.getInt16(50, true)).toBe(0x7fff); // 1.0
    expect(view.getInt16(52, true)).toBe(-0x8000); // -1.0
    expect(view.getInt16(54, true)).toBe(0x7fff); // 1.5 clamped
    expect(view.getInt16(56, true)).toBe(-0x8000); // -1.5 clamped
  });
});
