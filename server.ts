/**
 * Dedicated Realtime WebSocket Server for WA Rich Game Multiplayer
 * Optimized for Pterodactyl & Node 22 / Express + Vite Fullstack
 */
import http from 'http';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { RoomManager } from './src/server/roomManager.js';
import { SocketHandler } from './src/server/socketHandler.js';
import { ConsoleManager } from './src/server/consoleManager.js';
import { runDiagnostics } from './src/server/diagnostics.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';

// Port resolution
let portSource = 'DEFAULT (3000)';
let targetPort = 3000;

if (process.env.PORT) {
  targetPort = parseInt(process.env.PORT, 10);
  portSource = 'process.env.PORT';
} else if (process.env.SERVER_PORT) {
  targetPort = parseInt(process.env.SERVER_PORT, 10);
  portSource = 'process.env.SERVER_PORT';
}

const host = '0.0.0.0';

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
  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'ok',
    service: 'WA Rich Game Socket Server',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
    version: '1.0.0',
    node: process.version,
    port: (server.address() as { port: number })?.port || targetPort,
    clients: roomManager.getClientCount(),
    rooms: roomManager.getRoomCount(),
    memory: {
      rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    },
  });
});

// 2. Stats API for frontend workbench
app.get('/api/stats', (_req, res) => {
  if (consoleManager) {
    res.json(consoleManager.getStats());
  } else {
    res.json({ status: 'ONLINE', clientsCount: roomManager.getClientCount(), roomsCount: roomManager.getRoomCount() });
  }
});

// 3. Rooms API for inspect
app.get('/api/rooms', (_req, res) => {
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

// Setup Frontend Vite middleware or static files
async function setupFrontend() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
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
  process.exit(1);
});
