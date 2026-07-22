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
    // Reject unauthenticated upgrades BEFORE accepting the socket or opening OpenAI.
    const supabase = createRelaySupabase(req.headers.cookie);
    const {
      data: { user },
    } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '', 'http://localhost');
    const explainLanguage = url.searchParams.get('lang') === 'english' ? 'english' : 'bilingual';

    wss.handleUpgrade(req, socket, head, async (clientWs) => {
      const ctx = await prepareRelayContext(supabase, user.id, explainLanguage);
      if (!ctx.ok) {
        // 4000-range close code → client maps to an actionable message.
        clientWs.close(4001, ctx.error);
        return;
      }
      // Tell the client its conversationId (needed to finalize the session later).
      clientWs.send(JSON.stringify({ type: 'relay.ready', conversationId: ctx.conversationId }));

      const upstream = new WebSocket(
        `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(ctx.model)}`,
        { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' } },
      );
      const session = createOpenAIRelaySession({
        client: { send: (d) => clientWs.send(d), close: (code, reason) => clientWs.close(code, reason) },
        upstream: { send: (d) => upstream.send(d), close: () => upstream.close() },
        instructions: ctx.instructions,
        voice: ctx.voice,
        persist: (role, content) => {
          void appendMessage(supabase, ctx.conversationId, role, content).catch(() => {});
        },
      });

      upstream.on('open', () => session.onUpstreamOpen());
      upstream.on('message', (data) => session.onUpstreamMessage(data.toString()));
      upstream.on('close', () => session.onUpstreamClose());
      upstream.on('error', () => session.onUpstreamClose());
      clientWs.on('message', (data, isBinary) =>
        session.onMessage(isBinary ? (data as Buffer) : data.toString(), isBinary),
      );
      clientWs.on('close', () => session.onClose());
      clientWs.on('error', () => session.onClose());
    });
  }

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}  (realtime relay: ${RELAY_PATH})`);
  });
}

main().catch((err) => {
  console.error('server failed to start:', err);
  process.exit(1);
});
