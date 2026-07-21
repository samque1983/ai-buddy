import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ChatMessage, LlmService } from '../types';

export class AnthropicLlm implements LlmService {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string = 'claude-sonnet-5',
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async *streamChat(params: {
    system: string;
    messages: ChatMessage[];
    maxTokens?: number;
  }): AsyncIterable<string> {
    // Voice chat is latency-sensitive: thinking off, short replies.
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: params.maxTokens ?? 220,
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
      messages: params.messages,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  async extractStructured<T>(params: {
    system: string;
    input: string;
    schema: z.ZodType<T>;
    schemaName: string;
    maxTokens?: number;
  }): Promise<T> {
    const jsonSchema = z.toJSONSchema(params.schema, { target: 'draft-7' });

    const callOnce = async (extraNote?: string) => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: params.maxTokens ?? 2048,
        system: params.system,
        tools: [
          {
            name: params.schemaName,
            description: `Record the ${params.schemaName} result.`,
            input_schema: jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: params.schemaName },
        messages: [
          {
            role: 'user',
            content: extraNote ? `${params.input}\n\n${extraNote}` : params.input,
          },
        ],
      });
      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (!toolUse) throw new Error('No tool_use block in structured extraction response');
      return params.schema.parse(toolUse.input);
    };

    try {
      return await callOnce();
    } catch (err) {
      // One retry with the validation error appended so the model can self-correct.
      const note = `Your previous attempt failed validation: ${err instanceof Error ? err.message : String(err)}. Return data matching the schema exactly.`;
      return await callOnce(note);
    }
  }
}
