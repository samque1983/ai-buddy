/**
 * Sequential Web Audio playback of base64 mp3 chunks.
 * Framework-free class so it can be unit-tested with a mock context.
 */

export interface MinimalAudioContext {
  state: AudioContextState;
  destination: AudioDestinationNode;
  resume(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): AudioBufferSourceNode;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class AudioQueue {
  private pending: ArrayBuffer[] = [];
  private playing = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private stopped = false;

  /** Called when the queue drains (all enqueued audio has finished). */
  onIdle: (() => void) | null = null;

  constructor(private ctx: MinimalAudioContext) {}

  enqueue(b64: string): void {
    this.stopped = false;
    this.pending.push(base64ToArrayBuffer(b64));
    if (!this.playing) {
      this.playing = true;
      void this.playNext();
    }
  }

  stop(): void {
    this.stopped = true;
    this.pending = [];
    try {
      this.currentSource?.stop();
    } catch {
      // already stopped
    }
    this.currentSource = null;
    this.playing = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private async playNext(): Promise<void> {
    const data = this.pending.shift();
    if (!data || this.stopped) {
      this.playing = false;
      if (!this.stopped) this.onIdle?.();
      return;
    }
    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const buffer = await this.ctx.decodeAudioData(data);
      if (this.stopped) {
        this.playing = false;
        return;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      this.currentSource = source;
      source.onended = () => {
        if (this.currentSource === source) this.currentSource = null;
        if (!this.stopped) void this.playNext();
      };
      source.start();
    } catch {
      // undecodable chunk — skip it and continue
      void this.playNext();
    }
  }
}
