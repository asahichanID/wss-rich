/**
 * Protocol and Server Types for WA Rich Game Dedicated WebSocket Server
 */
import type { WebSocket } from 'ws';

export interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  clientId: string;
  ip?: string;
  roomId?: string;
  playerId?: string;
  playerName?: string;
  connectedAt: number;
  lastPingAt: number;
  lastPongAt: number;
  latencyMs: number;
}

export interface Player {
  id: string;
  name: string;
  state: Record<string, unknown>;
  joinedAt: number;
  lastUpdatedAt: number;
  clientId: string;
}

export interface Room {
  id: string;
  createdAt: number;
  players: Map<string, Player>;
  roomState: Record<string, unknown>;
}

// Client to Server incoming messages
export type ClientMessage =
  | { type: 'ping'; timestamp?: number }
  | { type: 'join_room'; roomId: string; playerId: string; playerName?: string; state?: Record<string, unknown> }
  | { type: 'leave_room'; roomId?: string }
  | { type: 'player_state'; state: Record<string, unknown>; roomId?: string }
  | { type: 'room_state'; state: Record<string, unknown>; roomId?: string };

// Server to Client outgoing messages
export type ServerMessage =
  | { type: 'connected'; clientId: string; serverTime: number; version: string }
  | { type: 'pong'; timestamp: number; serverTime: number }
  | { type: 'room_joined'; roomId: string; playerId: string; players: PlayerPublic[]; roomState: Record<string, unknown> }
  | { type: 'room_left'; roomId: string; playerId: string; reason?: string }
  | { type: 'player_joined'; roomId: string; player: PlayerPublic }
  | { type: 'player_left'; roomId: string; playerId: string; reason?: string }
  | { type: 'player_state'; roomId: string; playerId: string; state: Record<string, unknown>; timestamp: number }
  | { type: 'room_state'; roomId: string; state: Record<string, unknown>; timestamp: number }
  | { type: 'error'; message: string; code?: string };

export interface PlayerPublic {
  id: string;
  name: string;
  state: Record<string, unknown>;
  joinedAt: number;
  lastUpdatedAt: number;
}

export interface ServerStats {
  status: string;
  uptimeSeconds: number;
  nodeVersion: string;
  platform: string;
  host: string;
  port: number;
  portSource: string;
  publicUrl: string;
  clientsCount: number;
  roomsCount: number;
  heartbeatIntervalMs: number;
  heartbeatStatus: string;
  memory: {
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
  };
  timestamp: number;
}
