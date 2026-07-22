/**
 * PCM helpers for the realtime WS relay. OpenAI Realtime speaks raw PCM16 mono
 * 24kHz; the browser mic runs at 48kHz float. These pure functions do the
 * capture-side (float→PCM16, anti-aliased downsample) and playback-side
 * (PCM16→float) conversions, plus base64 framing. Kept pure so the DSP is unit
 * tested; the AudioWorklet and player just call them.
 */

/** Float32 [-1,1] → Int16 PCM, clamping overshoot. */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Int16 PCM → Float32 [-1,1]. */
export function int16ToFloat32(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] < 0 ? input[i] / 0x8000 : input[i] / 0x7fff;
  }
  return out;
}

/**
 * Downsample with a box-filter (averaging) low-pass so we don't alias high
 * frequencies back into the band — naive drop-every-other would fold 12–24kHz
 * content into artifacts and hurt STT. Good enough for speech; not a brick-wall.
 */
export function downsample(input: Float32Array, inputRate: number, targetRate: number): Float32Array {
  if (targetRate === inputRate) return input;
  if (targetRate > inputRate) throw new Error('downsample: target rate must be <= input rate');
  const ratio = inputRate / targetRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < input.length; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Int16 PCM → base64 of its little-endian byte buffer. */
export function int16ToBase64(pcm: Int16Array): string {
  return bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

/** base64 → Int16 PCM. */
export function base64ToInt16(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}
