import type { AiServices } from './types';
import { OpenAiWhisperStt } from './stt/openai-whisper';
import { OpenAiTts } from './tts/openai-tts';
import { AnthropicLlm } from './llm/anthropic';

let override: AiServices | null = null;

/** Test hook: inject fakes instead of real providers. */
export function setServicesForTesting(services: AiServices | null) {
  override = services;
}

export function getServices(): AiServices {
  if (override) return override;

  const sttProvider = process.env.STT_PROVIDER ?? 'openai';
  const ttsProvider = process.env.TTS_PROVIDER ?? 'openai';
  const llmProvider = process.env.LLM_PROVIDER ?? 'anthropic';

  if (sttProvider !== 'openai') throw new Error(`Unknown STT_PROVIDER: ${sttProvider}`);
  if (ttsProvider !== 'openai') throw new Error(`Unknown TTS_PROVIDER: ${ttsProvider}`);
  if (llmProvider !== 'anthropic') throw new Error(`Unknown LLM_PROVIDER: ${llmProvider}`);

  return {
    stt: new OpenAiWhisperStt(process.env.OPENAI_API_KEY!, process.env.STT_MODEL),
    tts: new OpenAiTts(process.env.OPENAI_API_KEY!, process.env.TTS_MODEL),
    llm: new AnthropicLlm(process.env.ANTHROPIC_API_KEY!, process.env.LLM_MODEL),
  };
}
