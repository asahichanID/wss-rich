/**
 * Dedicated Realtime WebSocket Server for WA Rich Game Multiplayer
 * Production Hardened for Pterodactyl, Node 22, and AI Studio
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { RoomManager } from './src/server/roomManager.js';
import { SocketHandler } from './src/server/socketHandler.js';
import { ConsoleManager } from './src/server/consoleManager.js';
import { runDiagnostics } from './src/server/diagnostics.js';

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

dotenv.config();

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

// Public URL resolution from actual environment only
const publicUrl = process.env.APP_URL || process.env.PUBLIC_URL || 'Not configured';

// Heartbeat interval (default 30s)
const heartbeatMs = process.env.HEARTBEAT_INTERVAL
  ? parseInt(process.env.HEARTBEAT_INTERVAL, 10) * 1000
  : process.env.HEARTBEAT_MS
  ? parseInt(process.env.HEARTBEAT_MS, 10)
  : 30000;

const app = express();
app.use(express.json());

const roomManager = new RoomManager();
const server = http.createServer(app);

// Initialize Socket Handler
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

// 1. Core Health Endpoint
app.get('/health', (_req, res) => {
  try {
    const mem = process.memoryUsage();
    const actualPort = (server.address() as { port: number })?.port || targetPort;
    res.status(200).json({
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
    });
  } catch (err: unknown) {
    res.status(500).json({ status: 'error', message: String(err) });
  }
});

// 2. Stats API for frontend workbench
app.get('/api/stats', (_req, res) => {
  try {
    if (consoleManager) {
      res.json(consoleManager.getStats());
    } else {
      res.json({
        status: 'ONLINE',
        clientsCount: roomManager.getClientCount(),
        roomsCount: roomManager.getRoomCount(),
      });
    }
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// 3. Rooms API for inspect
app.get('/api/rooms', (_req, res) => {
  try {
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
    res.json({ rooms });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// 4. Trigger Real Diagnostics API
app.post('/api/test', async (_req, res) => {
  const actualPort = (server.address() as { port: number })?.port || targetPort;
  try {
    const report = await runDiagnostics(actualPort, '127.0.0.1');
    res.json(report);
  } catch (err: unknown) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Setup Frontend Vite middleware or static files with bulletproof fallbacks
async function setupFrontend() {
  const isPterodactyl = process.env.PTERODACTYL === 'true' || process.env.P_SERVER_UUID !== undefined;
  const isProduction = process.env.NODE_ENV === 'production' || isPterodactyl;

  let viteMounted = false;

  // Try Vite in development mode only
  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      viteMounted = true;
    } catch {
      // Vite unavailable or in production headless mode, fallback smoothly
    }
  }

  // If Vite is not mounted, check if prebuilt dist/ exists
  const distPath = path.join(__dirname, 'dist');
  const distIndex = path.join(distPath, 'index.html');
  const hasDist = fs.existsSync(distIndex);

  if (hasDist) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/health') {
        return next();
      }
      res.sendFile(distIndex, (err) => {
        if (err) next();
      });
    });
  } else if (!viteMounted) {
    // Built-in status fallback page: Never throw ENOENT on Pterodactyl!
    app.get('/', (_req, res) => {
      const actualPort = (server.address() as { port: number })?.port || targetPort;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WA Rich Game Socket Server</title>
  <style>
    body { background: #020617; color: #f8fafc; font-family: ui-monospace, monospace; margin: 0; padding: 2rem; display: flex; justify-content: center; align-items: center; min-height: 80vh; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 2rem; max-width: 580px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #38bdf8; font-size: 1.3rem; margin: 0 0 1rem 0; display: flex; align-items: center; gap: 8px; }
    .badge { background: #065f46; color: #34d399; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 0.75rem; border: 1px solid #059669; }
    pre { background: #020617; padding: 1rem; border-radius: 6px; overflow-x: auto; color: #6ee7b7; border: 1px solid #1e293b; font-size: 0.85rem; line-height: 1.5; }
    .links { margin-top: 1.25rem; font-size: 0.85rem; }
    a { color: #818cf8; text-decoration: none; font-weight: bold; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>WA Rich Game Socket Server <span class="badge">ONLINE</span></h1>
    <p style="color: #94a3b8; font-size: 0.85rem;">Pterodactyl Dedicated Realtime WebSocket Server</p>
    <pre>╔══════════════════════════════╗
║     GAME SOCKET SERVER       ║
╚══════════════════════════════╝
Status    : ONLINE
Node      : ${process.version}
Host      : ${host}
Port      : ${actualPort}
Clients   : ${roomManager.getClientCount()}
Rooms     : ${roomManager.getRoomCount()}
Heartbeat : OK</pre>
    <div class="links">
      Endpoints: <a href="/health">/health</a> &bull; <a href="/api/stats">/api/stats</a> &bull; <a href="/api/rooms">/api/rooms</a>
    </div>
  </div>
</body>
</html>`);
    });
  }
}

// Start Server
async function startServer() {
  await setupFrontend();

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

  // Force close after 5 seconds if still hanging
  setTimeout(() => {
    console.error('Forced shutdown timeout exceeded. Exiting.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

startServer().catch((err) => {
  console.error('[ERROR] Failed to start server:', err);
  // Do not crash exit abruptly in Pterodactyl if recoverable
  setTimeout(() => process.exit(1), 1000);
});
