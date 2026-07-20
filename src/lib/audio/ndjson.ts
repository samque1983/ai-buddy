/**
 * NDJSON event codec for the /api/converse streaming response.
 * One JSON object per line; shared by the API route (encode) and client (parse).
 */

export type ConverseEvent =
  | { type: 'stt'; text: string }
  | { type: 'text'; text: string }
  | { type: 'audio'; b64: string; mime: string }
  | { type: 'error'; message: string }
  | { type: 'done'; assistantText: string };

export function encodeEvent(event: ConverseEvent): string {
  return JSON.stringify(event) + '\n';
}

export interface EventParser {
  /** Feed a raw chunk; returns any complete events parsed from it. */
  push(chunk: string): ConverseEvent[];
}

export function createEventParser(): EventParser {
  let buffer = '';
  return {
    push(chunk: string): ConverseEvent[] {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      const events: ConverseEvent[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed.type === 'string') {
            events.push(parsed as ConverseEvent);
          }
        } catch {
          // malformed line — skip rather than kill the stream
        }
      }
      return events;
    },
  };
}
