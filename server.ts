/**
 * Dedicated Realtime WebSocket Server for WA Rich Game Multiplayer
 * 100% Native Node.js HTTP (Zero Express dependency, Zero ERESOLVE issue)
 * Production Hardened for Pterodactyl, Node 22, and AI Studio
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './src/server/roomManager.js';
import { SocketHandler } from './src/server/socketHandler.js';
import { ConsoleManager } from './src/server/consoleManager.js';
import { runDiagnostics } from './src/server/diagnostics.js';
import { getDashboardHtml } from './src/server/dashboardHtml.js';

// Global Crash Prevention for Pterodactyl / Node.js
process.on('uncaughtException', (err: Error) => {
  const msg = err && err.message ? err.message : String(err);
  console.error(`[FATAL_PREVENTED] Uncaught Exception: ${msg}`);
  if (err && err.stack) {
    console.error(err.stack);
  }
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[FATAL_PREVENTED] Unhandled Rejection:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port Resolution with Pterodactyl priority
let portSource = 'DEFAULT (3000)';
let targetPort = 3000;

if (process.env.SERVER_PORT && !isNaN(parseInt(process.env.SERVER_PORT, 10)) && parseInt(process.env.SERVER_PORT, 10) > 0) {
  targetPort = parseInt(process.env.SERVER_PORT, 10);
  portSource = 'process.env.SERVER_PORT (Pterodactyl)';
} else if (process.env.PORT && !isNaN(parseInt(process.env.PORT, 10)) && parseInt(process.env.PORT, 10) > 0) {
  targetPort = parseInt(process.env.PORT, 10);
  portSource = 'process.env.PORT';
}

const host = process.env.HOST || process.env.SERVER_IP || '0.0.0.0';

// Public URL resolution (configured for medium.lynzz.id:2252)
const publicUrl = process.env.PUBLIC_URL || process.env.APP_URL || 'medium.lynzz.id:2252';

// Heartbeat interval (default 30s)
const heartbeatMs = process.env.HEARTBEAT_INTERVAL
  ? parseInt(process.env.HEARTBEAT_INTERVAL, 10) * 1000
  : process.env.HEARTBEAT_MS
  ? parseInt(process.env.HEARTBEAT_MS, 10)
  : 30000;

const roomManager = new RoomManager();

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Vite dev server reference if loaded
let viteDevServer: any = null;

// Native HTTP Server (No Express needed)
const server = http.createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host || `localhost:${targetPort}`;
    const url = new URL(req.url || '/', `http://${hostHeader}`);
    const pathname = url.pathname;

    // 1. Core Health Endpoint
    if (req.method === 'GET' && pathname === '/health') {
      const mem = process.memoryUsage();
      const actualPort = (server.address() as { port: number })?.port || targetPort;
      const data = {
        status: 'ok',
        service: 'WA Rich Game Socket Server',
        uptime: Math.floor(process.uptime()),
        timestamp: Date.now(),
        version: '1.0.0',
        node: process.version,
        port: actualPort,
        clients: roomManager.getClientCount(),
        rooms: roomManager.getRoomCount(),
        memory: {
          rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
          heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
          heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        },
      };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
      return;
    }

    // 2. Stats API for frontend workbench
    if (req.method === 'GET' && pathname === '/api/stats') {
      const stats = consoleManager
        ? consoleManager.getStats()
        : {
            status: 'ONLINE',
            clientsCount: roomManager.getClientCount(),
            roomsCount: roomManager.getRoomCount(),
          };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(stats));
      return;
    }

    // 3. Rooms API
    if (req.method === 'GET' && pathname === '/api/rooms') {
      const rooms = roomManager.getAllRooms().map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        playersCount: r.players.size,
        players: Array.from(r.players.values()).map((p) => ({
          id: p.id,
          name: p.name,
          state: p.state,
          joinedAt: p.joinedAt,
          lastUpdatedAt: p.lastUpdatedAt,
        })),
        roomState: r.roomState,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ rooms }));
      return;
    }

    // 4. Trigger Diagnostics API
    if (req.method === 'POST' && pathname === '/api/test') {
      const actualPort = (server.address() as { port: number })?.port || targetPort;
      const report = await runDiagnostics(actualPort, '127.0.0.1');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(report));
      return;
    }

    // 5. If Vite dev server is running, forward to it
    if (viteDevServer) {
      viteDevServer.middlewares(req, res, () => {
        res.writeHead(404);
        res.end('Not Found');
      });
      return;
    }

    // 6. Serve static files from dist/ if built
    const distPath = path.join(__dirname, 'dist');
    const distIndex = path.join(distPath, 'index.html');
    const hasDist = fs.existsSync(distIndex);

    if (hasDist) {
      let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, '');
      if (safePath === '/' || safePath === '') {
        safePath = '/index.html';
      }
      const filePath = path.join(distPath, safePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // SPA fallback to dist/index.html
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(distIndex).pipe(res);
      return;
    }

    // 7. Built-in Rich Standalone Dashboard (Serves directly on http://medium.lynzz.id:2252)
    const actualPort = (server.address() as { port: number })?.port || targetPort;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getDashboardHtml(actualPort, host, process.version));
  } catch (err: unknown) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error: ' + (err instanceof Error ? err.message : String(err)));
  }
});

// Initialize Socket Handler directly on native HTTP server
const socketHandler = new SocketHandler(server, roomManager, {
  heartbeatIntervalMs: heartbeatMs,
  maxPayloadBytes: 64 * 1024, // 64 KB limit
  logger: (tag, msg) => {
    if (consoleManager) {
      consoleManager.log(tag, msg);
    } else {
      console.log(`[${tag}] ${msg}`);
    }
  },
});

let consoleManager: ConsoleManager;

// Setup Frontend Vite middleware in development if available
async function setupViteIfDev() {
  const distIndex = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(distIndex)) {
    // Dist is already built: always serve production static files
    return;
  }

  const isPterodactyl = process.env.PTERODACTYL === 'true' || process.env.P_SERVER_UUID !== undefined || process.env.HOME === '/home/container';
  const isProduction = process.env.NODE_ENV === 'production' || isPterodactyl;

  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import('vite');
      viteDevServer = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
    } catch {
      // Vite not installed or in production headless mode, fallback smoothly
    }
  }
}

// Start Server
async function startServer() {
  await setupViteIfDev();

  server.listen(targetPort, host, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : targetPort;

    consoleManager = new ConsoleManager({
      host,
      actualPort,
      portSource,
      publicUrl,
      roomManager,
      socketHandler,
    });

    consoleManager.printBanner();
    consoleManager.log('START', `Server bound to ${host}:${actualPort} (${portSource})`);
    consoleManager.startStdin();
  });
}

// Graceful Shutdown Handler
function handleShutdown(signal: string) {
  if (consoleManager) {
    consoleManager.log('STOP', `Received ${signal}. Starting graceful shutdown...`);
    consoleManager.stopStdin();
  } else {
    console.log(`[STOP] Received ${signal}. Starting graceful shutdown...`);
  }

  socketHandler.stop().then(() => {
    server.close(() => {
      if (consoleManager) {
        consoleManager.log('STOP', 'HTTP and WebSocket server closed cleanly.');
      } else {
        console.log('[STOP] HTTP and WebSocket server closed cleanly.');
      }
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('Forced shutdown timeout exceeded. Exiting.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

startServer().catch((err) => {
  console.error('[ERROR] Failed to start server:', err);
  setTimeout(() => process.exit(1), 1000);
});
