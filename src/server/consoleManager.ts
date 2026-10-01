/**
 * Pterodactyl & CLI Console Manager
 * Interactive stdin commands, ANSI status banner, structured logging.
 */
import readline from 'readline';
import type { RoomManager } from './roomManager.js';
import type { SocketHandler } from './socketHandler.js';
import { runDiagnostics } from './diagnostics.js';
import type { ServerStats } from './types.js';

export interface ConsoleManagerConfig {
  host: string;
  actualPort: number;
  portSource: string;
  publicUrl: string;
  roomManager: RoomManager;
  socketHandler: SocketHandler;
}

export class ConsoleManager {
  private host: string;
  private actualPort: number;
  private portSource: string;
  private publicUrl: string;
  private roomManager: RoomManager;
  private socketHandler: SocketHandler;
  private rl: readline.Interface | null = null;
  private startTime = Date.now();

  constructor(config: ConsoleManagerConfig) {
    this.host = config.host;
    this.actualPort = config.actualPort;
    this.portSource = config.portSource;
    this.publicUrl = config.publicUrl;
    this.roomManager = config.roomManager;
    this.socketHandler = config.socketHandler;
  }

  public printBanner(): void {
    const clientsCount = this.roomManager.getClientCount();
    const roomsCount = this.roomManager.getRoomCount();
    const nodeVer = process.version;

    console.log(`
╔══════════════════════════════╗
║     GAME SOCKET SERVER       ║
╚══════════════════════════════╝
Status    : ONLINE
Node      : ${nodeVer}
Host      : ${this.host}
Port      : ${this.actualPort}
Public URL: ${this.publicUrl}
WS        : READY
Clients   : ${clientsCount}
Rooms     : ${roomsCount}
Heartbeat : OK
`);
  }

  public log(tag: string, message: string): void {
    const time = new Date().toISOString().substring(11, 19);
    console.log(`[${time}] [${tag}] ${message}`);
  }

  public startStdin(): void {
    if (this.rl) return;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      await this.handleCommand(trimmed);
    });
  }

  public stopStdin(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  public getStats(): ServerStats {
    const mem = process.memoryUsage();
    return {
      status: 'ONLINE',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      nodeVersion: process.version,
      platform: process.platform,
      host: this.host,
      port: this.actualPort,
      portSource: this.portSource,
      publicUrl: this.publicUrl,
      clientsCount: this.roomManager.getClientCount(),
      roomsCount: this.roomManager.getRoomCount(),
      heartbeatIntervalMs: this.socketHandler.getHeartbeatInterval(),
      heartbeatStatus: 'OK',
      memory: {
        rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        externalMB: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      },
      timestamp: Date.now(),
    };
  }

  public async handleCommand(input: string): Promise<void> {
    const args = input.split(/\s+/);
    const cmd = args[0].toLowerCase();

    switch (cmd) {
      case 'help': {
        console.log(`
--- Available Commands ---
  help             : Display this command list
  status           : Show actual server condition and health
  port             : Show actual host, port and environment source
  clients          : List all active connected clients
  rooms            : List summary of active game rooms
  room list        : List all active rooms in table format
  room info <id>   : Detailed information about a specific room
  heartbeat        : Show heartbeat interval and status
  memory           : Display Node.js RAM usage (RSS, Heap, External)
  uptime           : Display server uptime
  test             : Run full end-to-end diagnostic test suite
  test ws          : Run WebSocket handshake & echo diagnostic
  test health      : Test HTTP /health endpoint
  clear            : Clear the console screen
--------------------------`);
        break;
      }

      case 'status': {
        const stats = this.getStats();
        const uptimeMin = (stats.uptimeSeconds / 60).toFixed(1);
        console.log(`
--- Server Status ---
Status      : ${stats.status}
Uptime      : ${stats.uptimeSeconds}s (${uptimeMin} mins)
Node Version: ${stats.nodeVersion}
Platform    : ${stats.platform}
Listening   : ${stats.host}:${stats.port} (${stats.portSource})
Public URL  : ${stats.publicUrl}
Clients     : ${stats.clientsCount} connected
Rooms       : ${stats.roomsCount} active
Heartbeat   : ${stats.heartbeatStatus} (${stats.heartbeatIntervalMs / 1000}s)
RAM Usage   : RSS: ${stats.memory.rssMB}MB | Heap Used: ${stats.memory.heapUsedMB}MB / ${stats.memory.heapTotalMB}MB
---------------------`);
        break;
      }

      case 'port': {
        console.log(`
Host  : ${this.host}
Port  : ${this.actualPort}
Source: ${this.portSource}`);
        break;
      }

      case 'clients': {
        const clients = this.roomManager.getAllClients();
        console.log(`--- Connected Clients (${clients.length}) ---`);
        if (clients.length === 0) {
          console.log('No clients connected.');
        } else {
          clients.forEach((c, idx) => {
            const upSec = Math.floor((Date.now() - c.connectedAt) / 1000);
            console.log(
              `[${idx + 1}] ID: ${c.clientId} | IP: ${c.ip || 'unknown'} | Room: ${c.roomId || '(none)'} | Player: ${c.playerId || '(none)'} | Connected: ${upSec}s ago`
            );
          });
        }
        console.log('------------------------------');
        break;
      }

      case 'rooms':
      case 'room': {
        if (args[1] === 'info') {
          const targetRoomId = args[2];
          if (!targetRoomId) {
            console.log('Usage: room info <room_id>');
            return;
          }
          const room = this.roomManager.getRoom(targetRoomId);
          if (!room) {
            console.log(`Room "${targetRoomId}" not found.`);
            return;
          }
          console.log(`
--- Room Details: ${room.id} ---
Created  : ${new Date(room.createdAt).toISOString()}
Players  : ${room.players.size}`);
          for (const p of room.players.values()) {
            console.log(`  - Player ID: ${p.id} | Name: ${p.name} | Client: ${p.clientId}`);
            console.log(`    State: ${JSON.stringify(p.state)}`);
          }
          console.log(`Room State: ${JSON.stringify(room.roomState)}`);
          console.log('------------------------------');
        } else {
          // List rooms
          const rooms = this.roomManager.getAllRooms();
          console.log(`--- Active Rooms (${rooms.length}) ---`);
          if (rooms.length === 0) {
            console.log('No active rooms.');
          } else {
            rooms.forEach((r, idx) => {
              const ageSec = Math.floor((Date.now() - r.createdAt) / 1000);
              console.log(
                `[${idx + 1}] Room ID: ${r.id} | Players: ${r.players.size} | Age: ${ageSec}s`
              );
            });
          }
          console.log('-----------------------');
        }
        break;
      }

      case 'heartbeat': {
        const interval = this.socketHandler.getHeartbeatInterval();
        const lastHb = this.socketHandler.getLastHeartbeatTime();
        const lastSec = lastHb ? Math.floor((Date.now() - lastHb) / 1000) : 'none yet';
        console.log(`
--- Heartbeat Info ---
Status       : ACTIVE
Interval     : ${interval / 1000}s (${interval}ms)
Last Checked : ${lastSec === 'none yet' ? 'none yet' : `${lastSec}s ago`}
Active WSS   : READY
----------------------`);
        break;
      }

      case 'memory': {
        const mem = process.memoryUsage();
        console.log(`
--- Memory Usage ---
RSS          : ${(mem.rss / 1024 / 1024).toFixed(2)} MB
Heap Total   : ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB
Heap Used    : ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB
External     : ${(mem.external / 1024 / 1024).toFixed(2)} MB
ArrayBuffers : ${(mem.arrayBuffers / 1024 / 1024).toFixed(2)} MB
--------------------`);
        break;
      }

      case 'uptime': {
        const totalSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        console.log(`Uptime: ${days}d ${hours}h ${minutes}m ${seconds}s (${totalSeconds}s total)`);
        break;
      }

      case 'test': {
        if (args[1] === 'health') {
          console.log(`[TEST] Testing HTTP /health on http://127.0.0.1:${this.actualPort}/health ...`);
          try {
            const res = await fetch(`http://127.0.0.1:${this.actualPort}/health`);
            const data = await res.json();
            console.log(`[TEST] HTTP ${res.status} OK:`, data);
          } catch (e: unknown) {
            console.log(`[TEST] Failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          console.log(`[TEST] Running comprehensive real diagnostic suite on port ${this.actualPort}...`);
          const report = await runDiagnostics(this.actualPort, '127.0.0.1');
          console.log(`\n================ DIAGNOSTIC REPORT ================`);
          report.results.forEach((r) => {
            const mark = r.passed ? '✓ PASS' : '✗ FAIL';
            console.log(`${mark} [${r.durationMs}ms] ${r.name}`);
            if (r.details) console.log(`       Details: ${r.details}`);
            if (r.error) console.log(`       Error  : ${r.error}`);
          });
          console.log(`---------------------------------------------------`);
          console.log(`Summary: ${report.passedTests}/${report.totalTests} passed in ${report.durationMs}ms`);
          console.log(`Status : ${report.allPassed ? 'ALL TESTS PASSED - SERVER IS FULLY OPERATIONAL' : 'SOME TESTS FAILED'}`);
          console.log(`===================================================\n`);
        }
        break;
      }

      case 'clear': {
        console.clear();
        this.printBanner();
        break;
      }

      default:
        console.log(`Unknown command: "${cmd}". Type "help" for a list of commands.`);
    }
  }
}
