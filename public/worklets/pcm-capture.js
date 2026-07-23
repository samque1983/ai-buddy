// AudioWorklet: captures mic audio at the context's native rate and posts it to
// the main thread in ~chunks. The DSP (downsample + PCM16) lives in the main
// thread (src/lib/audio/pcm.ts, unit-tested) so this file stays trivial — worklets
// can't import app modules. Registered as 'pcm-capture'.
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._count = 0;
    this._target = 2048; // ~43ms @ 48k before we post
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length) {
      this._chunks.push(new Float32Array(channel));
      this._count += channel.length;
      if (this._count >= this._target) {
        const merged = new Float32Array(this._count);
        let offset = 0;
        for (const c of this._chunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        this.port.postMessage(merged, [merged.buffer]);
        this._chunks = [];
        this._count = 0;
      }
    }
    return true; // keep the processor alive
  }
}

registerProcessor('pcm-capture', PCMCaptureProcessor);
