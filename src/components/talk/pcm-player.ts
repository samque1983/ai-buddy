import { base64ToInt16, int16ToFloat32 } from '@/lib/audio/pcm';

/**
 * Schedules streamed PCM16 chunks (base64, from OpenAI via the relay) back-to-back
 * on an AudioContext so playback is gapless. Replaces audio-queue.ts for realtime —
 * that one decodes MP3 containers (decodeAudioData), which silently fails on raw PCM.
 */
export class PCMPlayer {
  private ctx: AudioContext;
  private rate: number;
  private nextTime = 0;
  private active = new Set<AudioBufferSourceNode>();

  constructor(rate = 24000) {
    this.rate = rate;
    this.ctx = new AudioContext();
  }

  /** Enqueue one base64 PCM16 chunk for gapless playback. */
  enqueue(base64Pcm: string): void {
    const float = int16ToFloat32(base64ToInt16(base64Pcm));
    if (float.length === 0) return;
    // Buffer is authored at the source rate (24k); the context resamples to its
    // own rate on playback.
    const buffer = this.ctx.createBuffer(1, float.length, this.rate);
    buffer.getChannelData(0).set(float);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now;
    src.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.active.add(src);
    src.onended = () => this.active.delete(src);
  }

  /** Stop everything currently scheduled (barge-in / interrupt). */
  clear(): void {
    for (const src of this.active) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.active.clear();
    this.nextTime = 0;
  }

  close(): void {
    this.clear();
    void this.ctx.close();
  }
}
