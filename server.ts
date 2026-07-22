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
import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { authenticateUpgrade } from './src/lib/realtime/relay-auth';
import { createEchoSession } from './src/lib/realtime/relay-session';

const RELAY_PATH = '/api/realtime/ws';

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
    // Reject unauthenticated upgrades before opening any upstream connection.
    void authenticateUpgrade(req.headers.cookie).then((userId) => {
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const session = createEchoSession({
          send: (d) => ws.send(d),
          close: (code, reason) => ws.close(code, reason),
        });
        ws.on('message', (data, isBinary) =>
          session.onMessage(isBinary ? (data as Buffer) : data.toString(), isBinary),
        );
        ws.on('close', () => session.onClose());
        ws.on('error', () => session.onClose());
      });
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}  (realtime relay: ${RELAY_PATH})`);
  });
}

main().catch((err) => {
  console.error('server failed to start:', err);
  process.exit(1);
});
