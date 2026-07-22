import { describe, it, expect } from 'vitest';
import { createEchoSession } from '@/lib/realtime/relay-session';

// P1: the relay session just echoes frames back. This is the seam that P2 replaces
// with the OpenAI Realtime bridge — same transport interface, different handler.
describe('createEchoSession', () => {
  it('echoes a text frame back through the transport', () => {
    const sent: unknown[] = [];
    const s = createEchoSession({ send: (d) => sent.push(d), close: () => {} });
    s.onMessage('hello', false);
    expect(sent).toEqual(['hello']);
  });

  it('echoes a binary frame back unchanged', () => {
    const sent: unknown[] = [];
    const s = createEchoSession({ send: (d) => sent.push(d), close: () => {} });
    const buf = new Uint8Array([1, 2, 3]);
    s.onMessage(buf, true);
    expect(sent[0]).toBe(buf);
  });

  it('does not close the transport on a normal message', () => {
    let closed = false;
    const s = createEchoSession({ send: () => {}, close: () => { closed = true; } });
    s.onMessage('x', false);
    expect(closed).toBe(false);
  });
});
