import type { SttService } from '../types';

export class OpenAiWhisperStt implements SttService {
  constructor(
    private apiKey: string,
    private model: string = 'whisper-1',
  ) {}

  async transcribe(audio: Buffer, opts: { mimeType: string; language?: string }) {
    const ext = opts.mimeType.includes('mp4') ? 'mp4' : opts.mimeType.includes('mpeg') ? 'mp3' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: opts.mimeType }), `audio.${ext}`);
    form.append('model', this.model);
    if (opts.language) form.append('language', opts.language);
    form.append('response_format', 'verbose_json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`STT failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { text: string; duration?: number };
    return {
      text: data.text?.trim() ?? '',
      durationMs: data.duration ? Math.round(data.duration * 1000) : undefined,
    };
  }
}
