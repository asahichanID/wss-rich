/**
 * WebSocket Connection & Protocol Handler
 * Event-driven, low CPU & RAM overhead, resilient error handling.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import type { IncomingMessage } from 'http';
import { RoomManager } from './roomManager.js';
import type { ExtendedWebSocket, ClientMessage, ServerMessage } from './types.js';

export interface SocketHandlerOptions {
  heartbeatIntervalMs?: number;
  maxPayloadBytes?: number;
  logger?: (tag: string, message: string) => void;
}

export class SocketHandler {
  private wss: WebSocketServer;
  private roomManager: RoomManager;
  private heartbeatIntervalMs: number;
  private maxPayloadBytes: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private logger: (tag: string, message: string) => void;
  private totalConnectionsOpened = 0;
  private lastHeartbeatAt = 0;

  constructor(
    server: HttpServer,
    roomManager: RoomManager,
    options: SocketHandlerOptions = {}
  ) {
    this.roomManager = roomManager;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 30000;
    this.maxPayloadBytes = options.maxPayloadBytes || 64 * 1024; // 64 KB
    this.logger = options.logger || ((tag, msg) => console.log(`[${tag}] ${msg}`));

    this.wss = new WebSocketServer({
      server,
      maxPayload: this.maxPayloadBytes,
    });

    this.setupListeners();
    this.startHeartbeat();
  }

  public getWss(): WebSocketServer {
    return this.wss;
  }

  public getHeartbeatInterval(): number {
    return this.heartbeatIntervalMs;
  }

  public getLastHeartbeatTime(): number {
    return this.lastHeartbeatAt;
  }

  public getTotalConnections(): number {
    return this.totalConnectionsOpened;
  }

  private setupListeners(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.totalConnectionsOpened++;
      const extWs = ws as ExtendedWebSocket;
      const clientId = 'c_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

      extWs.clientId = clientId;
      extWs.isAlive = true;
      extWs.ip = ip;
      extWs.connectedAt = Date.now();
      extWs.lastPingAt = Date.now();
      extWs.lastPongAt = Date.now();
      extWs.latencyMs = 0;

      this.roomManager.registerClient(extWs);
      this.logger('CONNECT', `Client connected: ${clientId} (${ip}) | Total: ${this.roomManager.getClientCount()}`);

      // Send initial connected packet
      this.sendSafe(extWs, {
        type: 'connected',
        clientId,
        serverTime: Date.now(),
        version: '1.0.0',
      });

      // Handle standard WS ping/pong
      extWs.on('pong', () => {
        extWs.isAlive = true;
        extWs.lastPongAt = Date.now();
        extWs.latencyMs = Math.max(0, extWs.lastPongAt - extWs.lastPingAt);
      });

      // Handle incoming messages
      extWs.on('message', (raw: Buffer | string) => {
        this.handleMessage(extWs, raw);
      });

      // Handle close
      extWs.on('close', (code, reason) => {
        const { roomId, playerId, playerLeft } = this.roomManager.unregisterClient(clientId);
        this.logger('DISCONNECT', `Client disconnected: ${clientId} (code: ${code}) | Remaining: ${this.roomManager.getClientCount()}`);

        if (roomId && playerId) {
          this.logger('LEAVE', `Player ${playerId} (${playerLeft?.name || 'Player'}) left room ${roomId}`);
          this.roomManager.broadcastToRoom(roomId, {
            type: 'player_left',
            roomId,
            playerId,
            reason: reason ? reason.toString() : 'disconnected',
          });
        }
      });

      // Handle error
      extWs.on('error', (err) => {
        this.logger('ERROR', `Socket error on client ${clientId}: ${err.message}`);
      });
    });

    this.wss.on('error', (err) => {
      this.logger('ERROR', `WebSocket server error: ${err.message}`);
    });
  }

  private handleMessage(ws: ExtendedWebSocket, raw: Buffer | string): void {
    let msgStr: string;
    if (typeof raw === 'string') {
      msgStr = raw;
    } else {
      msgStr = raw.toString('utf-8');
    }

    if (msgStr.length > this.maxPayloadBytes) {
      this.sendSafe(ws, { type: 'error', message: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
      return;
    }

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(msgStr);
    } catch {
      this.sendSafe(ws, { type: 'error', message: 'Invalid JSON format', code: 'BAD_JSON' });
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || typeof parsed.type !== 'string') {
      this.sendSafe(ws, { type: 'error', message: 'Missing or invalid "type" field', code: 'INVALID_TYPE' });
      return;
    }

    switch (parsed.type) {
      case 'ping': {
        this.sendSafe(ws, {
          type: 'pong',
          timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
          serverTime: Date.now(),
        });
        break;
      }

      case 'join_room': {
        if (!parsed.roomId || typeof parsed.roomId !== 'string' || !parsed.roomId.trim()) {
          this.sendSafe(ws, { type: 'error', message: 'Field "roomId" is required and must be a string', code: 'INVALID_ROOM_ID' });
          return;
        }

        const playerId = (parsed.playerId && typeof parsed.playerId === 'string' && parsed.playerId.trim())
          ? parsed.playerId.trim()
          : 'p_' + ws.clientId.slice(-6);

        const playerName = (parsed.playerName && typeof parsed.playerName === 'string')
          ? parsed.playerName.slice(0, 32)
          : 'Player';

        const initialState = (parsed.state && typeof parsed.state === 'object' && !Array.isArray(parsed.state))
          ? parsed.state
          : {};

        const { room, player, isNewRoom } = this.roomManager.joinRoom(
          parsed.roomId,
          playerId,
          playerName,
          initialState,
          ws
        );

        if (isNewRoom) {
          this.logger('ROOM', `Room created: ${room.id} by ${player.name} (${player.id})`);
        }
        this.logger('JOIN', `Player ${player.name} (${player.id}) joined room ${room.id} (${room.players.size} players)`);

        // Reply to the joining player with full room data
        const playersList = this.roomManager.getRoomPlayersPublic(room.id);
        this.sendSafe(ws, {
          type: 'room_joined',
          roomId: room.id,
          playerId: player.id,
          players: playersList,
          roomState: room.roomState,
        });

        // Broadcast to other players in the room
        this.roomManager.broadcastToRoom(
          room.id,
          {
            type: 'player_joined',
            roomId: room.id,
            player: {
              id: player.id,
              name: player.name,
              state: player.state,
              joinedAt: player.joinedAt,
              lastUpdatedAt: player.lastUpdatedAt,
            },
          },
          ws.clientId // exclude joining client
        );
        break;
      }

      case 'leave_room': {
        const roomId = parsed.roomId || ws.roomId;
        const playerId = ws.playerId;

        if (!roomId || !playerId) {
          this.sendSafe(ws, { type: 'error', message: 'Not currently in any room', code: 'NOT_IN_ROOM' });
          return;
        }

        const player = this.roomManager.removePlayer(roomId, playerId);
        this.logger('LEAVE', `Player ${playerId} left room ${roomId}`);

        this.sendSafe(ws, {
          type: 'room_left',
          roomId,
          playerId,
          reason: 'client_requested',
        });

        if (player) {
          this.roomManager.broadcastToRoom(roomId, {
            type: 'player_left',
            roomId,
            playerId,
            reason: 'left',
          });
        }
        break;
      }

      case 'player_state': {
        const roomId = parsed.roomId || ws.roomId;
        const playerId = ws.playerId;

        if (!roomId || !playerId) {
          this.sendSafe(ws, { type: 'error', message: 'Cannot update state: not joined to a room', code: 'NOT_IN_ROOM' });
          return;
        }

        if (!parsed.state || typeof parsed.state !== 'object' || Array.isArray(parsed.state)) {
          this.sendSafe(ws, { type: 'error', message: 'Field "state" must be an object', code: 'INVALID_STATE' });
          return;
        }

        const { player, updated } = this.roomManager.updatePlayerState(roomId, playerId, parsed.state);
        if (!updated || !player) {
          this.sendSafe(ws, { type: 'error', message: 'Room or player not found', code: 'PLAYER_NOT_FOUND' });
          return;
        }

        // Broadcast player state delta to entire room (including sender for acknowledgment or exclude if preferred; broadcasting ensures synchronized order)
        this.roomManager.broadcastToRoom(roomId, {
          type: 'player_state',
          roomId,
          playerId,
          state: player.state,
          timestamp: player.lastUpdatedAt,
        });
        break;
      }

      case 'room_state': {
        const roomId = parsed.roomId || ws.roomId;

        if (!roomId) {
          this.sendSafe(ws, { type: 'error', message: 'Cannot update room state: not joined to a room', code: 'NOT_IN_ROOM' });
          return;
        }

        if (!parsed.state || typeof parsed.state !== 'object' || Array.isArray(parsed.state)) {
          this.sendSafe(ws, { type: 'error', message: 'Field "state" must be an object', code: 'INVALID_ROOM_STATE' });
          return;
        }

        const { room, updated } = this.roomManager.updateRoomState(roomId, parsed.state);
        if (!updated || !room) {
          this.sendSafe(ws, { type: 'error', message: 'Room not found', code: 'ROOM_NOT_FOUND' });
          return;
        }

        this.roomManager.broadcastToRoom(roomId, {
          type: 'room_state',
          roomId,
          state: room.roomState,
          timestamp: Date.now(),
        });
        break;
      }

      default:
        this.sendSafe(ws, {
          type: 'error',
          message: `Unknown message type: ${(parsed as { type: string }).type}`,
          code: 'UNKNOWN_TYPE',
        });
    }
  }

  public sendSafe(ws: WebSocket, message: ServerMessage | Record<string, unknown>): boolean {
    if (ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(JSON.stringify(message), () => {});
      return true;
    } catch {
      return false;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      this.lastHeartbeatAt = Date.now();
      let terminatedCount = 0;
      let pingedCount = 0;

      for (const client of this.wss.clients) {
        const extWs = client as ExtendedWebSocket;
        if (extWs.isAlive === false) {
          terminatedCount++;
          const { roomId, playerId } = this.roomManager.unregisterClient(extWs.clientId);
          if (roomId && playerId) {
            this.roomManager.broadcastToRoom(roomId, {
              type: 'player_left',
              roomId,
              playerId,
              reason: 'heartbeat_timeout',
            });
          }
          extWs.terminate();
          continue;
        }

        extWs.isAlive = false;
        extWs.lastPingAt = Date.now();
        try {
          extWs.ping();
          pingedCount++;
        } catch {
          extWs.terminate();
        }
      }

      if (terminatedCount > 0) {
        this.logger('HEARTBEAT', `Heartbeat check: Pinged ${pingedCount} clients, terminated ${terminatedCount} dead connection(s)`);
      }
    }, this.heartbeatIntervalMs);

    // Unref timer so it does not block Node exit during shutdown
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  public stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    return new Promise((resolve) => {
      for (const client of this.wss.clients) {
        try {
          client.close(1001, 'Server shutting down');
        } catch {
          // ignore
        }
      }
      this.wss.close(() => {
        resolve();
      });
    });
  }
}
