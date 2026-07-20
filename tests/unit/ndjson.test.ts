import { describe, it, expect } from 'vitest';
import { encodeEvent, createEventParser, type ConverseEvent } from '@/lib/audio/ndjson';

describe('ndjson event codec', () => {
  const events: ConverseEvent[] = [
    { type: 'stt', text: 'Hello, I am learning English.' },
    { type: 'text', text: "That's great!" },
    { type: 'audio', b64: 'AAAA', mime: 'audio/mpeg' },
    { type: 'error', message: 'boom' },
    { type: 'done', assistantText: "That's great!" },
  ];

  it('round-trips every event type', () => {
    const parser = createEventParser();
    const received: ConverseEvent[] = [];
    for (const e of events) {
      received.push(...parser.push(encodeEvent(e)));
    }
    expect(received).toEqual(events);
  });

  it('handles chunks that split lines arbitrarily', () => {
    const wire = events.map(encodeEvent).join('');
    const parser = createEventParser();
    const received: ConverseEvent[] = [];
    // feed 7 bytes at a time
    for (let i = 0; i < wire.length; i += 7) {
      received.push(...parser.push(wire.slice(i, i + 7)));
    }
    expect(received).toEqual(events);
  });

  it('handles multiple events in a single chunk', () => {
    const parser = createEventParser();
    const wire = events.map(encodeEvent).join('');
    expect(parser.push(wire)).toEqual(events);
  });

  it('ignores blank lines and tolerates malformed lines', () => {
    const parser = createEventParser();
    const received = parser.push('\n\nnot-json\n' + encodeEvent({ type: 'text', text: 'hi' }));
    expect(received).toEqual([{ type: 'text', text: 'hi' }]);
  });
});
