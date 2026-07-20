import { encodeEvent, type ConverseEvent } from '@/lib/audio/ndjson';

/**
 * Wraps a converse-turn generator as a streaming NDJSON Response.
 * onEvent runs for every event before it is sent (used for persistence).
 */
export function ndjsonResponse(
  gen: AsyncGenerator<ConverseEvent>,
  onEvent?: (event: ConverseEvent) => Promise<void> | void,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of gen) {
          await onEvent?.(event);
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
      } catch {
        controller.enqueue(
          encoder.encode(encodeEvent({ type: 'error', message: 'stream_failed' })),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
