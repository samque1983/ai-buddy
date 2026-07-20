import type { TtsService } from '../types';

export class OpenAiTts implements TtsService {
  constructor(
    private apiKey: string,
    private model: string = 'tts-1',
  ) {}

  async synthesize(text: string, opts: { voice: string; speed?: number }): Promise<Buffer> {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        voice: opts.voice,
        input: text,
        speed: opts.speed ?? 1.0,
        response_format: 'mp3',
      }),
    });
    if (!res.ok) {
      throw new Error(`TTS failed: ${res.status} ${await res.text()}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
