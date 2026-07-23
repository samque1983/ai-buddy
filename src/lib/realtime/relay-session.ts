/**
 * Transport-agnostic relay session. The server wires a real WebSocket to this via
 * the RelayTransport interface, so the session logic is unit-testable without a
 * socket. P1 is a plain echo (proves the pipe end-to-end); P2 replaces
 * `createEchoSession` with the OpenAI Realtime bridge behind the same interface.
 */

export interface RelayTransport {
  send(data: string | ArrayBufferView | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  /** Bytes queued but not yet flushed (ws.bufferedAmount) — for backpressure. */
  readonly bufferedAmount?: number;
}

export interface RelaySession {
  /** A frame arrived from the client. `isBinary` distinguishes audio from JSON events. */
  onMessage(data: string | ArrayBufferView | ArrayBuffer, isBinary: boolean): void;
  /** The client (or server) closed the connection — tear down upstream here in P2. */
  onClose(): void;
}

export function createEchoSession(transport: RelayTransport): RelaySession {
  return {
    onMessage(data) {
      transport.send(data);
    },
    onClose() {
      // Nothing upstream to tear down yet (no OpenAI connection in P1).
    },
  };
}
