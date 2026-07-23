/**
 * Custom Node server: serves Next on port 3000 AND owns the WebSocket upgrade for
 * the realtime relay on a single port. Non-relay upgrades (Next dev HMR) are handed
 * back to Next via getUpgradeHandler so hot reload keeps working.
 *
 *   Browser ──HTTP──► Next request handler
 *           ──WSS  ──► /api/realtime/ws ──► authenticateUpgrade ──► relay session
 *
 * P1: the relay session just echoes (proves the pipe + auth). P2 swaps
 * createEchoSession for the OpenAI Realtime bridge behind the same interface.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { parse } from 'node:url';
import type { Duplex } from 'node:stream';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { createRelaySupabase } from './src/lib/realtime/relay-auth';
import { prepareRelayContext } from './src/lib/realtime/relay-context';
import { createOpenAIRelaySession } from './src/lib/realtime/relay-openai';
import { appendMessage } from './src/lib/db/conversation-context';

const RELAY_PATH = '/api/realtime/ws';
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
// Cap concurrent relayed sessions on the 512MB box (each holds 2 sockets + audio
// buffers + an OpenAI stream). Fly's proxy won't cap this for us.
const MAX_SESSIONS = 20;
// Hard ceiling on a single session: bounds a revoked/expired JWT still streaming
// (we only auth at upgrade) and reaps dead connections that never close.
const MAX_SESSION_MS = 15 * 60 * 1000;
let activeSessions = 0;

async function main() {
  const dev = process.env.NODE_ENV !== 'production';
  const port = Number(process.env.PORT ?? 3000);
  const hostname = process.env.HOSTNAME ?? '0.0.0.0';

  const app = next({ dev, hostname, port });
  await app.prepare();
  // getUpgradeHandler() requires prepare() to have run first.
  const handle = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url ?? '/', true));
  });

  // noServer: we run handleUpgrade ourselves so auth can reject BEFORE accepting.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '');
    if (pathname !== RELAY_PATH) {
      // Next dev HMR and anything else Next owns.
      void upgradeHandler(req, socket, head);
      return;
    }
    void handleRelayUpgrade(req, socket, head);
  });

  async function handleRelayUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    // Any synchronous/async throw here (e.g. misconfig) must destroy the socket, not
    // leave the client hanging or surface as an unhandledRejection.
    try {
      await acceptRelayUpgrade(req, socket, head);
    } catch (err) {
      console.error('relay upgrade failed:', err);
      try {
        socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
      } catch {
        /* socket already gone */
      }
      socket.destroy();
    }
  }

  async function acceptRelayUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    // Reject unauthenticated / over-capacity upgrades BEFORE accepting the socket
    // or opening any OpenAI connection.
    const supabase = createRelaySupabase(req.headers.cookie);
    const {
      data: { user },
    } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (activeSessions >= MAX_SESSIONS) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '', 'http://localhost');
    const explainLanguage = url.searchParams.get('lang') === 'english' ? 'english' : 'bilingual';

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      void runSession(clientWs, supabase, user.id, explainLanguage);
    });
  }

  async function runSession(
    clientWs: WebSocket,
    supabase: ReturnType<typeof createRelaySupabase>,
    userId: string,
    explainLanguage: 'bilingual' | 'english',
  ) {
    activeSessions++;
    let upstream: WebSocket | null = null;
    let torn = false;
    // Single guarded teardown: closes both sockets, clears the timer, decrements
    // the counter exactly once no matter which edge fires.
    const teardown = () => {
      if (torn) return;
      torn = true;
      clearTimeout(maxTimer);
      try {
        upstream?.close();
      } catch {
        /* already closing */
      }
      try {
        clientWs.close();
      } catch {
        /* already closing */
      }
      activeSessions--;
    };
    // Wire client teardown IMMEDIATELY, before any await, so a disconnect during
    // async prep tears down (and decrements) instead of leaking.
    clientWs.on('close', teardown);
    clientWs.on('error', teardown);
    const maxTimer = setTimeout(() => {
      try {
        clientWs.close(4003, 'session_time_limit');
      } catch {
        /* ignore */
      }
      teardown();
    }, MAX_SESSION_MS);

    try {
      const ctx = await prepareRelayContext(supabase, userId, explainLanguage);
      if (torn) return; // client vanished during prep
      if (!ctx.ok) {
        clientWs.close(4001, ctx.error); // 4000-range → client maps to a message
        teardown();
        return;
      }
      if (clientWs.readyState !== clientWs.OPEN) {
        teardown();
        return;
      }
      clientWs.send(JSON.stringify({ type: 'relay.ready', conversationId: ctx.conversationId }));

      upstream = new WebSocket(`${OPENAI_REALTIME_URL}?model=${encodeURIComponent(ctx.model)}`, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      });

      // The client starts streaming mic audio the instant its socket opens, but the
      // OpenAI socket is still CONNECTING for a beat. Buffer pre-open frames (bounded)
      // and flush after session.update, so we neither throw (ws.send on a CONNECTING
      // socket) nor clip the user's first words.
      let upstreamOpen = false;
      const pendingUp: string[] = [];
      const MAX_PENDING = 500;
      const sendUpstream = (d: string) => {
        if (upstreamOpen && upstream?.readyState === WebSocket.OPEN) {
          try {
            upstream.send(d);
          } catch {
            /* raced with close — drop */
          }
        } else if (pendingUp.length < MAX_PENDING) {
          pendingUp.push(d);
        }
        // else: pre-open buffer full — drop (bounded, protects the 512MB box)
      };

      const session = createOpenAIRelaySession({
        client: {
          send: (d) => {
            try {
              clientWs.send(d);
            } catch {
              /* client socket closing — drop */
            }
          },
          close: (code, reason) => clientWs.close(code, reason),
          get bufferedAmount() {
            return clientWs.bufferedAmount;
          },
        },
        upstream: { send: sendUpstream, close: () => upstream?.close() },
        instructions: ctx.instructions,
        voice: ctx.voice,
        transcriptionPrompt: ctx.transcriptionPrompt,
        persist: (role, content) => {
          void appendMessage(supabase, ctx.conversationId, role, content).catch(() => {});
        },
      });

      upstream.on('open', () => {
        upstreamOpen = true;
        session.onUpstreamOpen(); // session.update + response.create (sent directly)
        for (const d of pendingUp) {
          try {
            upstream!.send(d);
          } catch {
            /* ignore */
          }
        }
        pendingUp.length = 0;
      });
      upstream.on('message', (data) => session.onUpstreamMessage(data.toString()));
      upstream.on('close', () => {
        session.onUpstreamClose();
        teardown();
      });
      upstream.on('error', () => {
        session.onUpstreamClose();
        teardown();
      });
      clientWs.on('message', (data, isBinary) =>
        session.onMessage(isBinary ? (data as Buffer) : data.toString(), isBinary),
      );
    } catch (err) {
      console.error('relay session setup failed:', err);
      teardown();
    }
  }

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}  (realtime relay: ${RELAY_PATH})`);
  });
}

main().catch((err) => {
  console.error('server failed to start:', err);
  process.exit(1);
});
