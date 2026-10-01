/**
 * In-Memory Room & Player Manager
 * Ultra-fast O(1) Map lookups, zero DB, zero memory leaks, automatic cleanup.
 */
import type { ExtendedWebSocket, Player, PlayerPublic, Room } from './types.js';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  // Map of clientId -> ExtendedWebSocket
  private clients: Map<string, ExtendedWebSocket> = new Map();
  // Map of playerId -> roomId
  private playerToRoom: Map<string, string> = new Map();
  // Map of clientId -> playerId
  private clientToPlayer: Map<string, string> = new Map();

  // Register a connected client
  public registerClient(client: ExtendedWebSocket): void {
    this.clients.set(client.clientId, client);
  }

  // Unregister a client upon disconnect
  public unregisterClient(clientId: string): { roomId?: string; playerId?: string; playerLeft?: Player } {
    const client = this.clients.get(clientId);
    const playerId = this.clientToPlayer.get(clientId);
    let result: { roomId?: string; playerId?: string; playerLeft?: Player } = {};

    if (playerId) {
      const roomId = this.playerToRoom.get(playerId);
      if (roomId) {
        const player = this.removePlayer(roomId, playerId);
        result = { roomId, playerId, playerLeft: player };
      }
      this.clientToPlayer.delete(clientId);
    }

    this.clients.delete(clientId);
    return result;
  }

  public getClient(clientId: string): ExtendedWebSocket | undefined {
    return this.clients.get(clientId);
  }

  public getAllClients(): ExtendedWebSocket[] {
    return Array.from(this.clients.values());
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public getRoomCount(): number {
    return this.rooms.size;
  }

  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  public getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  // Join or Create Room
  public joinRoom(
    roomId: string,
    playerId: string,
    playerName: string = 'Player',
    initialState: Record<string, unknown> = {},
    client: ExtendedWebSocket
  ): { room: Room; player: Player; isNewRoom: boolean; replacedExisting: boolean } {
    const cleanRoomId = String(roomId).trim().slice(0, 64);
    const cleanPlayerId = String(playerId).trim().slice(0, 64);
    const cleanPlayerName = String(playerName).trim().slice(0, 32) || 'Player';

    // Check if player was in another room
    const prevRoomId = this.playerToRoom.get(cleanPlayerId);
    if (prevRoomId && prevRoomId !== cleanRoomId) {
      this.removePlayer(prevRoomId, cleanPlayerId);
    }

    let isNewRoom = false;
    let room = this.rooms.get(cleanRoomId);
    if (!room) {
      room = {
        id: cleanRoomId,
        createdAt: Date.now(),
        players: new Map(),
        roomState: {},
      };
      this.rooms.set(cleanRoomId, room);
      isNewRoom = true;
    }

    const replacedExisting = room.players.has(cleanPlayerId);
    const now = Date.now();

    const player: Player = {
      id: cleanPlayerId,
      name: cleanPlayerName,
      state: { ...initialState },
      joinedAt: replacedExisting ? room.players.get(cleanPlayerId)!.joinedAt : now,
      lastUpdatedAt: now,
      clientId: client.clientId,
    };

    room.players.set(cleanPlayerId, player);
    this.playerToRoom.set(cleanPlayerId, cleanRoomId);
    this.clientToPlayer.set(client.clientId, cleanPlayerId);

    // Update socket metadata
    client.roomId = cleanRoomId;
    client.playerId = cleanPlayerId;
    client.playerName = cleanPlayerName;

    return { room, player, isNewRoom, replacedExisting };
  }

  // Remove Player from Room
  public removePlayer(roomId: string, playerId: string): Player | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const player = room.players.get(playerId);
    if (player) {
      room.players.delete(playerId);
      this.playerToRoom.delete(playerId);
      this.clientToPlayer.delete(player.clientId);

      const client = this.clients.get(player.clientId);
      if (client && client.roomId === roomId) {
        client.roomId = undefined;
        client.playerId = undefined;
      }
    }

    // Auto-cleanup: remove empty room
    if (room.players.size === 0) {
      this.rooms.delete(roomId);
    }

    return player;
  }

  // Update Player State
  public updatePlayerState(
    roomId: string,
    playerId: string,
    statePatch: Record<string, unknown>
  ): { player?: Player; updated: boolean } {
    const room = this.rooms.get(roomId);
    if (!room) return { updated: false };

    const player = room.players.get(playerId);
    if (!player) return { updated: false };

    // Deep merge shallow state
    player.state = {
      ...player.state,
      ...statePatch,
    };
    player.lastUpdatedAt = Date.now();

    return { player, updated: true };
  }

  // Update Room Custom State
  public updateRoomState(
    roomId: string,
    statePatch: Record<string, unknown>
  ): { room?: Room; updated: boolean } {
    const room = this.rooms.get(roomId);
    if (!room) return { updated: false };

    room.roomState = {
      ...room.roomState,
      ...statePatch,
    };

    return { room, updated: true };
  }

  // Public summary of players in a room
  public getRoomPlayersPublic(roomId: string): PlayerPublic[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      state: p.state,
      joinedAt: p.joinedAt,
      lastUpdatedAt: p.lastUpdatedAt,
    }));
  }

  // Send message to all connected clients in a specific room
  public broadcastToRoom(
    roomId: string,
    message: unknown,
    excludeClientId?: string
  ): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    let sentCount = 0;

    for (const player of room.players.values()) {
      if (excludeClientId && player.clientId === excludeClientId) {
        continue;
      }
      const client = this.clients.get(player.clientId);
      if (client && client.readyState === 1 /* OPEN */) {
        try {
          client.send(payload);
          sentCount++;
        } catch {
          // ignore socket write errors; cleanup will handle disconnects
        }
      }
    }

    return sentCount;
  }
}
