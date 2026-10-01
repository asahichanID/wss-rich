import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// server.ts
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/server/roomManager.ts
var RoomManager = class {
  constructor() {
    this.rooms = /* @__PURE__ */ new Map();
    // Map of clientId -> ExtendedWebSocket
    this.clients = /* @__PURE__ */ new Map();
    // Map of playerId -> roomId
    this.playerToRoom = /* @__PURE__ */ new Map();
    // Map of clientId -> playerId
    this.clientToPlayer = /* @__PURE__ */ new Map();
  }
  // Register a connected client
  registerClient(client) {
    this.clients.set(client.clientId, client);
  }
  // Unregister a client upon disconnect
  unregisterClient(clientId) {
    const client = this.clients.get(clientId);
    const playerId = this.clientToPlayer.get(clientId);
    let result = {};
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
  getClient(clientId) {
    return this.clients.get(clientId);
  }
  getAllClients() {
    return Array.from(this.clients.values());
  }
  getClientCount() {
    return this.clients.size;
  }
  getRoomCount() {
    return this.rooms.size;
  }
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }
  getAllRooms() {
    return Array.from(this.rooms.values());
  }
  // Join or Create Room
  joinRoom(roomId, playerId, playerName = "Player", initialState = {}, client) {
    const cleanRoomId = String(roomId).trim().slice(0, 64);
    const cleanPlayerId = String(playerId).trim().slice(0, 64);
    const cleanPlayerName = String(playerName).trim().slice(0, 32) || "Player";
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
        players: /* @__PURE__ */ new Map(),
        roomState: {}
      };
      this.rooms.set(cleanRoomId, room);
      isNewRoom = true;
    }
    const replacedExisting = room.players.has(cleanPlayerId);
    const now = Date.now();
    const player = {
      id: cleanPlayerId,
      name: cleanPlayerName,
      state: { ...initialState },
      joinedAt: replacedExisting ? room.players.get(cleanPlayerId).joinedAt : now,
      lastUpdatedAt: now,
      clientId: client.clientId
    };
    room.players.set(cleanPlayerId, player);
    this.playerToRoom.set(cleanPlayerId, cleanRoomId);
    this.clientToPlayer.set(client.clientId, cleanPlayerId);
    client.roomId = cleanRoomId;
    client.playerId = cleanPlayerId;
    client.playerName = cleanPlayerName;
    return { room, player, isNewRoom, replacedExisting };
  }
  // Remove Player from Room
  removePlayer(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return void 0;
    const player = room.players.get(playerId);
    if (player) {
      room.players.delete(playerId);
      this.playerToRoom.delete(playerId);
      this.clientToPlayer.delete(player.clientId);
      const client = this.clients.get(player.clientId);
      if (client && client.roomId === roomId) {
        client.roomId = void 0;
        client.playerId = void 0;
      }
    }
    if (room.players.size === 0) {
      this.rooms.delete(roomId);
    }
    return player;
  }
  // Update Player State
  updatePlayerState(roomId, playerId, statePatch) {
    const room = this.rooms.get(roomId);
    if (!room) return { updated: false };
    const player = room.players.get(playerId);
    if (!player) return { updated: false };
    player.state = {
      ...player.state,
      ...statePatch
    };
    player.lastUpdatedAt = Date.now();
    return { player, updated: true };
  }
  // Update Room Custom State
  updateRoomState(roomId, statePatch) {
    const room = this.rooms.get(roomId);
    if (!room) return { updated: false };
    room.roomState = {
      ...room.roomState,
      ...statePatch
    };
    return { room, updated: true };
  }
  // Public summary of players in a room
  getRoomPlayersPublic(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      state: p.state,
      joinedAt: p.joinedAt,
      lastUpdatedAt: p.lastUpdatedAt
    }));
  }
  // Send message to all connected clients in a specific room
  broadcastToRoom(roomId, message, excludeClientId) {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    const payload = typeof message === "string" ? message : JSON.stringify(message);
    let sentCount = 0;
    for (const player of room.players.values()) {
      if (excludeClientId && player.clientId === excludeClientId) {
        continue;
      }
      const client = this.clients.get(player.clientId);
      if (client && client.readyState === 1) {
        try {
          client.send(payload, () => {
          });
          sentCount++;
        } catch {
        }
      }
    }
    return sentCount;
  }
};

// src/server/socketHandler.ts
import { WebSocketServer, WebSocket } from "ws";
var SocketHandler = class {
  constructor(server2, roomManager2, options = {}) {
    this.heartbeatTimer = null;
    this.totalConnectionsOpened = 0;
    this.lastHeartbeatAt = 0;
    this.roomManager = roomManager2;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 3e4;
    this.maxPayloadBytes = options.maxPayloadBytes || 64 * 1024;
    this.logger = options.logger || ((tag, msg) => console.log(`[${tag}] ${msg}`));
    this.wss = new WebSocketServer({
      server: server2,
      maxPayload: this.maxPayloadBytes
    });
    this.setupListeners();
    this.startHeartbeat();
  }
  getWss() {
    return this.wss;
  }
  getHeartbeatInterval() {
    return this.heartbeatIntervalMs;
  }
  getLastHeartbeatTime() {
    return this.lastHeartbeatAt;
  }
  getTotalConnections() {
    return this.totalConnectionsOpened;
  }
  setupListeners() {
    this.wss.on("connection", (ws, req) => {
      this.totalConnectionsOpened++;
      const extWs = ws;
      const clientId = "c_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
      const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
      extWs.clientId = clientId;
      extWs.isAlive = true;
      extWs.ip = ip;
      extWs.connectedAt = Date.now();
      extWs.lastPingAt = Date.now();
      extWs.lastPongAt = Date.now();
      extWs.latencyMs = 0;
      this.roomManager.registerClient(extWs);
      this.logger("CONNECT", `Client connected: ${clientId} (${ip}) | Total: ${this.roomManager.getClientCount()}`);
      this.sendSafe(extWs, {
        type: "connected",
        clientId,
        serverTime: Date.now(),
        version: "1.0.0"
      });
      extWs.on("pong", () => {
        extWs.isAlive = true;
        extWs.lastPongAt = Date.now();
        extWs.latencyMs = Math.max(0, extWs.lastPongAt - extWs.lastPingAt);
      });
      extWs.on("message", (raw) => {
        this.handleMessage(extWs, raw);
      });
      extWs.on("close", (code, reason) => {
        const { roomId, playerId, playerLeft } = this.roomManager.unregisterClient(clientId);
        this.logger("DISCONNECT", `Client disconnected: ${clientId} (code: ${code}) | Remaining: ${this.roomManager.getClientCount()}`);
        if (roomId && playerId) {
          this.logger("LEAVE", `Player ${playerId} (${playerLeft?.name || "Player"}) left room ${roomId}`);
          this.roomManager.broadcastToRoom(roomId, {
            type: "player_left",
            roomId,
            playerId,
            reason: reason ? reason.toString() : "disconnected"
          });
        }
      });
      extWs.on("error", (err) => {
        this.logger("ERROR", `Socket error on client ${clientId}: ${err.message}`);
      });
    });
    this.wss.on("error", (err) => {
      this.logger("ERROR", `WebSocket server error: ${err.message}`);
    });
  }
  handleMessage(ws, raw) {
    let msgStr;
    if (typeof raw === "string") {
      msgStr = raw;
    } else {
      msgStr = raw.toString("utf-8");
    }
    if (msgStr.length > this.maxPayloadBytes) {
      this.sendSafe(ws, { type: "error", message: "Payload too large", code: "PAYLOAD_TOO_LARGE" });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(msgStr);
    } catch {
      this.sendSafe(ws, { type: "error", message: "Invalid JSON format", code: "BAD_JSON" });
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("type" in parsed) || typeof parsed.type !== "string") {
      this.sendSafe(ws, { type: "error", message: 'Missing or invalid "type" field', code: "INVALID_TYPE" });
      return;
    }
    switch (parsed.type) {
      case "ping": {
        this.sendSafe(ws, {
          type: "pong",
          timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
          serverTime: Date.now()
        });
        break;
      }
      case "join_room": {
        if (!parsed.roomId || typeof parsed.roomId !== "string" || !parsed.roomId.trim()) {
          this.sendSafe(ws, { type: "error", message: 'Field "roomId" is required and must be a string', code: "INVALID_ROOM_ID" });
          return;
        }
        const playerId = parsed.playerId && typeof parsed.playerId === "string" && parsed.playerId.trim() ? parsed.playerId.trim() : "p_" + ws.clientId.slice(-6);
        const playerName = parsed.playerName && typeof parsed.playerName === "string" ? parsed.playerName.slice(0, 32) : "Player";
        const initialState = parsed.state && typeof parsed.state === "object" && !Array.isArray(parsed.state) ? parsed.state : {};
        const { room, player, isNewRoom } = this.roomManager.joinRoom(
          parsed.roomId,
          playerId,
          playerName,
          initialState,
          ws
        );
        if (isNewRoom) {
          this.logger("ROOM", `Room created: ${room.id} by ${player.name} (${player.id})`);
        }
        this.logger("JOIN", `Player ${player.name} (${player.id}) joined room ${room.id} (${room.players.size} players)`);
        const playersList = this.roomManager.getRoomPlayersPublic(room.id);
        this.sendSafe(ws, {
          type: "room_joined",
          roomId: room.id,
          playerId: player.id,
          players: playersList,
          roomState: room.roomState
        });
        this.roomManager.broadcastToRoom(
          room.id,
          {
            type: "player_joined",
            roomId: room.id,
            player: {
              id: player.id,
              name: player.name,
              state: player.state,
              joinedAt: player.joinedAt,
              lastUpdatedAt: player.lastUpdatedAt
            }
          },
          ws.clientId
          // exclude joining client
        );
        break;
      }
      case "leave_room": {
        const roomId = parsed.roomId || ws.roomId;
        const playerId = ws.playerId;
        if (!roomId || !playerId) {
          this.sendSafe(ws, { type: "error", message: "Not currently in any room", code: "NOT_IN_ROOM" });
          return;
        }
        const player = this.roomManager.removePlayer(roomId, playerId);
        this.logger("LEAVE", `Player ${playerId} left room ${roomId}`);
        this.sendSafe(ws, {
          type: "room_left",
          roomId,
          playerId,
          reason: "client_requested"
        });
        if (player) {
          this.roomManager.broadcastToRoom(roomId, {
            type: "player_left",
            roomId,
            playerId,
            reason: "left"
          });
        }
        break;
      }
      case "player_state": {
        const roomId = parsed.roomId || ws.roomId;
        const playerId = ws.playerId;
        if (!roomId || !playerId) {
          this.sendSafe(ws, { type: "error", message: "Cannot update state: not joined to a room", code: "NOT_IN_ROOM" });
          return;
        }
        if (!parsed.state || typeof parsed.state !== "object" || Array.isArray(parsed.state)) {
          this.sendSafe(ws, { type: "error", message: 'Field "state" must be an object', code: "INVALID_STATE" });
          return;
        }
        const { player, updated } = this.roomManager.updatePlayerState(roomId, playerId, parsed.state);
        if (!updated || !player) {
          this.sendSafe(ws, { type: "error", message: "Room or player not found", code: "PLAYER_NOT_FOUND" });
          return;
        }
        this.roomManager.broadcastToRoom(roomId, {
          type: "player_state",
          roomId,
          playerId,
          state: player.state,
          timestamp: player.lastUpdatedAt
        });
        break;
      }
      case "room_state": {
        const roomId = parsed.roomId || ws.roomId;
        if (!roomId) {
          this.sendSafe(ws, { type: "error", message: "Cannot update room state: not joined to a room", code: "NOT_IN_ROOM" });
          return;
        }
        if (!parsed.state || typeof parsed.state !== "object" || Array.isArray(parsed.state)) {
          this.sendSafe(ws, { type: "error", message: 'Field "state" must be an object', code: "INVALID_ROOM_STATE" });
          return;
        }
        const { room, updated } = this.roomManager.updateRoomState(roomId, parsed.state);
        if (!updated || !room) {
          this.sendSafe(ws, { type: "error", message: "Room not found", code: "ROOM_NOT_FOUND" });
          return;
        }
        this.roomManager.broadcastToRoom(roomId, {
          type: "room_state",
          roomId,
          state: room.roomState,
          timestamp: Date.now()
        });
        break;
      }
      default:
        this.sendSafe(ws, {
          type: "error",
          message: `Unknown message type: ${parsed.type}`,
          code: "UNKNOWN_TYPE"
        });
    }
  }
  sendSafe(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(JSON.stringify(message), () => {
      });
      return true;
    } catch {
      return false;
    }
  }
  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      this.lastHeartbeatAt = Date.now();
      let terminatedCount = 0;
      let pingedCount = 0;
      for (const client of this.wss.clients) {
        const extWs = client;
        if (extWs.isAlive === false) {
          terminatedCount++;
          const { roomId, playerId } = this.roomManager.unregisterClient(extWs.clientId);
          if (roomId && playerId) {
            this.roomManager.broadcastToRoom(roomId, {
              type: "player_left",
              roomId,
              playerId,
              reason: "heartbeat_timeout"
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
        this.logger("HEARTBEAT", `Heartbeat check: Pinged ${pingedCount} clients, terminated ${terminatedCount} dead connection(s)`);
      }
    }, this.heartbeatIntervalMs);
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }
  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    return new Promise((resolve) => {
      for (const client of this.wss.clients) {
        try {
          client.close(1001, "Server shutting down");
        } catch {
        }
      }
      this.wss.close(() => {
        resolve();
      });
    });
  }
};

// src/server/consoleManager.ts
import readline from "readline";

// src/server/diagnostics.ts
import { WebSocket as WebSocket2 } from "ws";
async function runDiagnostics(port, host2 = "127.0.0.1") {
  const startTime = Date.now();
  const results = [];
  const addResult = (name, passed, start, details, error) => {
    results.push({
      name,
      passed,
      durationMs: Date.now() - start,
      details,
      error
    });
  };
  const t1 = Date.now();
  try {
    const res = await fetch(`http://${host2}:${port}/health`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const healthJson = await res.json();
    if (healthJson.status !== "ok") {
      throw new Error(`Invalid status in health response: ${JSON.stringify(healthJson)}`);
    }
    addResult("1. HTTP /health Endpoint", true, t1, `HTTP 200 OK | Uptime: ${healthJson.uptime}s | Node: ${healthJson.node}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult("1. HTTP /health Endpoint", false, t1, void 0, message);
  }
  const t2 = Date.now();
  let ws1 = null;
  let ws2 = null;
  try {
    const wsUrl = `ws://${host2}:${port}`;
    ws1 = new WebSocket2(wsUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS connection timeout (3000ms)")), 3e3);
      ws1.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws1.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    addResult("2. WebSocket Connection Handshake", true, t2, `Connected successfully to ws://${host2}:${port}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult("2. WebSocket Connection Handshake", false, t2, void 0, message);
  }
  if (ws1 && ws1.readyState === WebSocket2.OPEN) {
    const t3 = Date.now();
    try {
      const pingTime = Date.now();
      const pongPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Pong timeout (3000ms)")), 3e3);
        const onMsg = (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === "pong") {
              ws1.removeListener("message", onMsg);
              clearTimeout(timeout);
              resolve(Date.now() - pingTime);
            }
          } catch {
          }
        };
        ws1.on("message", onMsg);
      });
      ws1.send(JSON.stringify({ type: "ping", timestamp: pingTime }));
      const latency = await pongPromise;
      addResult("3. Ping / Pong Round-Trip", true, t3, `Ping/Pong latency: ${latency}ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addResult("3. Ping / Pong Round-Trip", false, t3, void 0, message);
    }
  }
  const testRoomId = `test_room_${Date.now().toString(36)}`;
  const player1Id = "diag_player_1";
  if (ws1 && ws1.readyState === WebSocket2.OPEN) {
    const t4 = Date.now();
    try {
      const joinPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("join_room timeout (3000ms)")), 3e3);
        const onMsg = (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === "room_joined" && parsed.roomId === testRoomId) {
              ws1.removeListener("message", onMsg);
              clearTimeout(timeout);
              resolve(parsed);
            }
          } catch {
          }
        };
        ws1.on("message", onMsg);
      });
      ws1.send(JSON.stringify({
        type: "join_room",
        roomId: testRoomId,
        playerId: player1Id,
        playerName: "DiagnosticBot1",
        state: { x: 10, y: 20, score: 100 }
      }));
      const joinRes = await joinPromise;
      addResult("4. Room Creation & Player Join", true, t4, `Room ${joinRes.roomId} joined by ${joinRes.playerId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addResult("4. Room Creation & Player Join", false, t4, void 0, message);
    }
  }
  const t5 = Date.now();
  const player2Id = "diag_player_2";
  try {
    const wsUrl = `ws://${host2}:${port}`;
    ws2 = new WebSocket2(wsUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Client 2 connection timeout")), 3e3);
      ws2.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws2.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
    const playerJoinedPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("player_joined broadcast timeout")), 3e3);
      const onMsg = (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "player_joined" && parsed.player?.id === player2Id) {
            ws1?.removeListener("message", onMsg);
            clearTimeout(timeout);
            resolve(parsed.player.name);
          }
        } catch {
        }
      };
      ws1?.on("message", onMsg);
    });
    ws2.send(JSON.stringify({
      type: "join_room",
      roomId: testRoomId,
      playerId: player2Id,
      playerName: "DiagnosticBot2",
      state: { x: 50, y: 60, score: 200 }
    }));
    const joinedName = await playerJoinedPromise;
    addResult("5. Multi-Client Room Join & Broadcast", true, t5, `Client 1 received broadcast for ${joinedName} (${player2Id})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult("5. Multi-Client Room Join & Broadcast", false, t5, void 0, message);
  }
  const t6 = Date.now();
  try {
    const stateBroadcastPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("player_state broadcast timeout")), 3e3);
      const onMsg = (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "player_state" && parsed.playerId === player2Id) {
            ws1?.removeListener("message", onMsg);
            clearTimeout(timeout);
            resolve(parsed.state);
          }
        } catch {
        }
      };
      ws1?.on("message", onMsg);
    });
    ws2?.send(JSON.stringify({
      type: "player_state",
      state: { x: 75, y: 90, score: 350, action: "ROLL_DICE" }
    }));
    const newState = await stateBroadcastPromise;
    addResult("6. Realtime State Sync & Broadcast", true, t6, `Synced state: x=${newState.x}, y=${newState.y}, score=${newState.score}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult("6. Realtime State Sync & Broadcast", false, t6, void 0, message);
  }
  const t7 = Date.now();
  try {
    const leaveBroadcastPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("player_left broadcast timeout")), 3e3);
      const onMsg = (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "player_left" && parsed.playerId === player2Id) {
            ws1?.removeListener("message", onMsg);
            clearTimeout(timeout);
            resolve(parsed.reason || "disconnected");
          }
        } catch {
        }
      };
      ws1?.on("message", onMsg);
    });
    ws2?.close();
    const leaveReason = await leaveBroadcastPromise;
    addResult("7. Disconnect Tracking & Room Notification", true, t7, `Player left event acknowledged (reason: ${leaveReason})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult("7. Disconnect Tracking & Room Notification", false, t7, void 0, message);
  }
  const t8 = Date.now();
  try {
    const errorPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Error response timeout")), 3e3);
      const onMsg = (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "error") {
            ws1?.removeListener("message", onMsg);
            clearTimeout(timeout);
            resolve(parsed.code || parsed.message);
          }
        } catch {
        }
      };
      ws1?.on("message", onMsg);
    });
    ws1?.send('{ "type": "broken_payload", bad_json: ');
    const errCode = await errorPromise;
    addResult("8. Security & Malformed Payload Handling", true, t8, `Server handled bad payload safely with error code: ${errCode}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult("8. Security & Malformed Payload Handling", false, t8, void 0, message);
  }
  if (ws1 && ws1.readyState === WebSocket2.OPEN) {
    ws1.close();
  }
  const passedTests = results.filter((r) => r.passed).length;
  const failedTests = results.filter((r) => !r.passed).length;
  return {
    timestamp: Date.now(),
    allPassed: failedTests === 0,
    totalTests: results.length,
    passedTests,
    failedTests,
    durationMs: Date.now() - startTime,
    results
  };
}

// src/server/consoleManager.ts
var ConsoleManager = class {
  constructor(config) {
    this.rl = null;
    this.startTime = Date.now();
    this.host = config.host;
    this.actualPort = config.actualPort;
    this.portSource = config.portSource;
    this.publicUrl = config.publicUrl;
    this.roomManager = config.roomManager;
    this.socketHandler = config.socketHandler;
  }
  printBanner() {
    const clientsCount = this.roomManager.getClientCount();
    const roomsCount = this.roomManager.getRoomCount();
    const nodeVer = process.version;
    console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551     GAME SOCKET SERVER       \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
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
  log(tag, message) {
    const time = (/* @__PURE__ */ new Date()).toISOString().substring(11, 19);
    console.log(`[${time}] [${tag}] ${message}`);
  }
  startStdin() {
    if (this.rl) return;
    try {
      if (!process.stdin || !process.stdin.readable) {
        return;
      }
      process.stdin.on("error", (_err) => {
      });
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
      });
      this.rl.on("line", async (line) => {
        try {
          const trimmed = line.trim();
          if (!trimmed) return;
          await this.handleCommand(trimmed);
        } catch (err) {
          console.error("[CMD ERROR]", err instanceof Error ? err.message : String(err));
        }
      });
      this.rl.on("error", (_err) => {
      });
      this.rl.on("close", () => {
        this.rl = null;
      });
    } catch {
    }
  }
  stopStdin() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
  getStats() {
    const mem = process.memoryUsage();
    return {
      status: "ONLINE",
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1e3),
      nodeVersion: process.version,
      platform: process.platform,
      host: this.host,
      port: this.actualPort,
      portSource: this.portSource,
      publicUrl: this.publicUrl,
      clientsCount: this.roomManager.getClientCount(),
      roomsCount: this.roomManager.getRoomCount(),
      heartbeatIntervalMs: this.socketHandler.getHeartbeatInterval(),
      heartbeatStatus: "OK",
      memory: {
        rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
        externalMB: Math.round(mem.external / 1024 / 1024 * 100) / 100
      },
      timestamp: Date.now()
    };
  }
  async handleCommand(input) {
    const args = input.split(/\s+/);
    const cmd = args[0].toLowerCase();
    switch (cmd) {
      case "help": {
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
      case "status": {
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
Heartbeat   : ${stats.heartbeatStatus} (${stats.heartbeatIntervalMs / 1e3}s)
RAM Usage   : RSS: ${stats.memory.rssMB}MB | Heap Used: ${stats.memory.heapUsedMB}MB / ${stats.memory.heapTotalMB}MB
---------------------`);
        break;
      }
      case "port": {
        console.log(`
Host  : ${this.host}
Port  : ${this.actualPort}
Source: ${this.portSource}`);
        break;
      }
      case "clients": {
        const clients = this.roomManager.getAllClients();
        console.log(`--- Connected Clients (${clients.length}) ---`);
        if (clients.length === 0) {
          console.log("No clients connected.");
        } else {
          clients.forEach((c, idx) => {
            const upSec = Math.floor((Date.now() - c.connectedAt) / 1e3);
            console.log(
              `[${idx + 1}] ID: ${c.clientId} | IP: ${c.ip || "unknown"} | Room: ${c.roomId || "(none)"} | Player: ${c.playerId || "(none)"} | Connected: ${upSec}s ago`
            );
          });
        }
        console.log("------------------------------");
        break;
      }
      case "rooms":
      case "room": {
        if (args[1] === "info") {
          const targetRoomId = args[2];
          if (!targetRoomId) {
            console.log("Usage: room info <room_id>");
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
          console.log("------------------------------");
        } else {
          const rooms = this.roomManager.getAllRooms();
          console.log(`--- Active Rooms (${rooms.length}) ---`);
          if (rooms.length === 0) {
            console.log("No active rooms.");
          } else {
            rooms.forEach((r, idx) => {
              const ageSec = Math.floor((Date.now() - r.createdAt) / 1e3);
              console.log(
                `[${idx + 1}] Room ID: ${r.id} | Players: ${r.players.size} | Age: ${ageSec}s`
              );
            });
          }
          console.log("-----------------------");
        }
        break;
      }
      case "heartbeat": {
        const interval = this.socketHandler.getHeartbeatInterval();
        const lastHb = this.socketHandler.getLastHeartbeatTime();
        const lastSec = lastHb ? Math.floor((Date.now() - lastHb) / 1e3) : "none yet";
        console.log(`
--- Heartbeat Info ---
Status       : ACTIVE
Interval     : ${interval / 1e3}s (${interval}ms)
Last Checked : ${lastSec === "none yet" ? "none yet" : `${lastSec}s ago`}
Active WSS   : READY
----------------------`);
        break;
      }
      case "memory": {
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
      case "uptime": {
        const totalSeconds = Math.floor((Date.now() - this.startTime) / 1e3);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor(totalSeconds % 86400 / 3600);
        const minutes = Math.floor(totalSeconds % 3600 / 60);
        const seconds = totalSeconds % 60;
        console.log(`Uptime: ${days}d ${hours}h ${minutes}m ${seconds}s (${totalSeconds}s total)`);
        break;
      }
      case "test": {
        if (args[1] === "health") {
          console.log(`[TEST] Testing HTTP /health on http://127.0.0.1:${this.actualPort}/health ...`);
          try {
            const res = await fetch(`http://127.0.0.1:${this.actualPort}/health`);
            const data = await res.json();
            console.log(`[TEST] HTTP ${res.status} OK:`, data);
          } catch (e) {
            console.log(`[TEST] Failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          console.log(`[TEST] Running comprehensive real diagnostic suite on port ${this.actualPort}...`);
          const report = await runDiagnostics(this.actualPort, "127.0.0.1");
          console.log(`
================ DIAGNOSTIC REPORT ================`);
          report.results.forEach((r) => {
            const mark = r.passed ? "\u2713 PASS" : "\u2717 FAIL";
            console.log(`${mark} [${r.durationMs}ms] ${r.name}`);
            if (r.details) console.log(`       Details: ${r.details}`);
            if (r.error) console.log(`       Error  : ${r.error}`);
          });
          console.log(`---------------------------------------------------`);
          console.log(`Summary: ${report.passedTests}/${report.totalTests} passed in ${report.durationMs}ms`);
          console.log(`Status : ${report.allPassed ? "ALL TESTS PASSED - SERVER IS FULLY OPERATIONAL" : "SOME TESTS FAILED"}`);
          console.log(`===================================================
`);
        }
        break;
      }
      case "clear": {
        console.clear();
        this.printBanner();
        break;
      }
      default:
        console.log(`Unknown command: "${cmd}". Type "help" for a list of commands.`);
    }
  }
};

// src/server/dashboardHtml.ts
function getDashboardHtml(actualPort, host2, nodeVersion) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>WA Rich Game Socket Server \u2022 medium.lynzz.id:2252</title>
  <style>
    :root {
      --bg: #030712;
      --card: #0f172a;
      --card-border: #1e293b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #4f46e5;
      --primary-hover: #6366f1;
      --emerald: #10b981;
      --emerald-bg: #064e3b;
      --amber: #f59e0b;
      --rose: #f43f5e;
      --code-bg: #020617;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; padding: 12px; }
    .container { max-width: 1080px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
    
    /* Header */
    .header { background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px 18px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; }
    .header-title { display: flex; align-items: center; gap: 10px; }
    .header-title h1 { font-size: 15px; font-weight: bold; color: #38bdf8; letter-spacing: 0.5px; }
    .badge { padding: 3px 8px; font-size: 11px; font-weight: bold; border-radius: 4px; border: 1px solid; }
    .badge-online { background: var(--emerald-bg); color: var(--emerald); border-color: rgba(16,185,129,0.4); }
    .badge-pill { background: #1e293b; color: #cbd5e1; border-color: #334155; }
    
    .header-info { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; align-items: center; }
    .copy-pill { background: #020617; border: 1px solid #334155; padding: 4px 10px; border-radius: 6px; display: inline-flex; align-items: center; gap: 8px; color: var(--amber); font-weight: bold; cursor: pointer; transition: all 0.2s; }
    .copy-pill:hover { border-color: var(--primary-hover); }
    .copy-btn { background: #1e293b; border: 1px solid #475569; color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; cursor: pointer; }

    /* Navigation Tabs */
    .tabs { display: flex; gap: 6px; overflow-x: auto; background: var(--card); border: 1px solid var(--card-border); padding: 6px; border-radius: 8px; }
    .tab-btn { background: transparent; border: none; color: var(--muted); padding: 8px 14px; font-size: 12px; font-weight: bold; border-radius: 6px; cursor: pointer; white-space: nowrap; transition: 0.2s; display: flex; align-items: center; gap: 6px; }
    .tab-btn.active { background: var(--primary); color: #fff; }
    .tab-btn:hover:not(.active) { color: #fff; background: #1e293b; }

    /* Tab Content Panels */
    .tab-content { display: none; }
    .tab-content.active { display: flex; flex-direction: column; gap: 14px; }

    /* Cards */
    .card { background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; padding: 16px; }
    .card-title { font-size: 13px; font-weight: bold; color: #e2e8f0; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }

    /* Metrics Grid */
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .metric-box { background: var(--code-bg); border: 1px solid var(--card-border); border-radius: 6px; padding: 12px; }
    .metric-label { font-size: 10px; color: var(--muted); text-transform: uppercase; font-weight: bold; }
    .metric-value { font-size: 18px; font-weight: bold; color: #fff; margin-top: 4px; }

    /* Game Board Grid */
    .board-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
    .tile { background: var(--code-bg); border: 1px solid var(--card-border); border-radius: 6px; padding: 10px; min-height: 85px; display: flex; flex-direction: column; justify-content: space-between; transition: 0.2s; }
    .tile.active-player { border-color: #818cf8; background: #1e1b4b; box-shadow: 0 0 10px rgba(99,102,241,0.3); }
    .tile-name { font-size: 11px; font-weight: bold; color: #cbd5e1; display: flex; justify-content: space-between; }
    .tile-price { font-size: 10px; color: var(--muted); margin-top: 4px; }
    .token-container { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .token { background: var(--primary); color: #fff; font-size: 9px; font-weight: bold; padding: 2px 6px; border-radius: 3px; }

    /* Buttons */
    .btn { background: var(--primary); color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; transition: 0.2s; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover { background: var(--primary-hover); }
    .btn-emerald { background: #059669; }
    .btn-emerald:hover { background: #10b981; }
    .btn-rose { background: #be123c; }
    .btn-rose:hover { background: #e11d48; }

    /* Code Snippet Box */
    .code-container { position: relative; background: var(--code-bg); border: 1px solid var(--card-border); border-radius: 6px; overflow: hidden; }
    .code-header { background: #090d16; padding: 8px 12px; border-bottom: 1px solid var(--card-border); display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--muted); }
    pre { padding: 14px; overflow-x: auto; font-size: 11px; line-height: 1.5; color: #a7f3d0; }

    /* Live Log */
    .log-box { background: var(--code-bg); border: 1px solid var(--card-border); border-radius: 6px; height: 180px; overflow-y: auto; padding: 10px; font-size: 11px; display: flex; flex-direction: column; gap: 6px; }
    .log-entry { padding: 4px 8px; border-radius: 4px; border: 1px solid transparent; word-break: break-all; }
    .log-in { background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.2); color: #34d399; }
    .log-out { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.2); color: #818cf8; }
    .log-sys { color: var(--muted); }

    /* Footer */
    .footer { text-align: center; font-size: 11px; color: #64748b; padding: 10px; margin-top: auto; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      <div class="header-title">
        <div>
          <h1>WA RICH GAME MULTIPLAYER ENGINE</h1>
          <div style="display: flex; gap: 6px; margin-top: 4px;">
            <span class="badge badge-online">ONLINE</span>
            <span class="badge badge-pill">PORT ${actualPort}</span>
            <span class="badge badge-pill">NODE ${nodeVersion}</span>
          </div>
        </div>
      </div>

      <div class="header-info">
        <div class="copy-pill" onclick="copyText('ws://medium.lynzz.id:2252', 'ws-banner')">
          <span>WS: ws://medium.lynzz.id:2252</span>
          <button class="copy-btn" id="ws-banner">SALIN</button>
        </div>
        <div style="font-size: 11px; color: #94a3b8;">
          Latency: <strong id="latency-text" style="color: #34d399;">-- ms</strong>
        </div>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('guide')">\u{1F4D6} Panduan Bot WA</button>
      <button class="tab-btn" onclick="switchTab('board')">\u{1F3B2} Live Game Board</button>
      <button class="tab-btn" onclick="switchTab('metrics')">\u{1F4CA} Metrik Server</button>
      <button class="tab-btn" onclick="switchTab('sandbox')">\u26A1 Socket Tester</button>
    </div>

    <!-- TAB 1: PANDUAN INTEGRASI BOT WA -->
    <div id="tab-guide" class="tab-content active">
      <div class="card" style="border-left: 4px solid var(--emerald);">
        <div style="font-size: 14px; font-weight: bold; color: #fff;">
          \u{1F680} Cara Menyambungkan Bot WhatsApp ke Server Ini (WA Rich Game)
        </div>
        <p style="font-size: 12px; color: var(--muted); margin-top: 6px; line-height: 1.5;">
          Server ini bertindak sebagai <strong>Engine Realtime</strong>. Bot WhatsApp Anda (Baileys / WA-Web.js) cukup terhubung ke WebSocket server ini satu kali, lalu meneruskan pesan command grup (seperti <code>.rich join</code> atau <code>.rich roll</code>). Seluruh giliran, perpindahan petak, dan perhitungan saldo diproses otomatis di server tanpa database.
        </p>
      </div>

      <div class="metrics-grid">
        <div class="metric-box">
          <div class="metric-label">1. WebSocket URL</div>
          <div class="metric-value" style="font-size: 13px; color: var(--amber);">ws://medium.lynzz.id:2252</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">2. Health Endpoint</div>
          <div class="metric-value" style="font-size: 13px; color: #38bdf8;">http://medium.lynzz.id:2252/health</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">3. Konsep Ruang</div>
          <div class="metric-value" style="font-size: 13px; color: #34d399;">1 Grup WA = 1 Room ID</div>
        </div>
      </div>

      <!-- Baileys Snippet -->
      <div class="card">
        <div class="card-title">
          <span>A. Template Script Bot WhatsApp (Baileys)</span>
          <button class="btn btn-emerald" style="padding: 4px 10px; font-size: 11px;" onclick="copyCode('baileys-code', this)">Salin Kode</button>
        </div>
        <div class="code-container">
          <div class="code-header">File: plugins/rich-game.js atau handler.js (Baileys)</div>
          <pre id="baileys-code">import WebSocket from 'ws';

// 1. Hubungkan ke WebSocket Server Pterodactyl Anda
const WS_URL = 'ws://medium.lynzz.id:2252';
let ws = null;

export function connectRichGame(conn) {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('[RICH-GAME] Terhubung ke WebSocket server medium.lynzz.id:2252');
    
    // Heartbeat berkala agar koneksi tidak diputus firewall
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 25000);
  });

  // Menerima siaran dari server -> Mengirimkan pesan chat ke grup WhatsApp
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!msg.roomId) return; // JID Grup WA

      if (msg.type === 'player_joined') {
        await conn.sendMessage(msg.roomId, {
          text: \`\u{1F3AE} *WA RICH GAME*

@\${msg.player.id.split('@')[0]} telah bergabung ke meja permainan!\`,
          mentions: [msg.player.id]
        });
      } else if (msg.type === 'player_state') {
        if (msg.state?.lastAction) {
          await conn.sendMessage(msg.roomId, {
            text: \`\u{1F3B2} *UPDATE PERMAINAN*

\${msg.state.lastAction}
Posisi Petak: #\${msg.state.position || 0}
Sisa Saldo: $\${msg.state.cash || 0}k\`
          });
        }
      }
    } catch (e) {
      console.error('[RICH-GAME] Error parsing data:', e);
    }
  });

  ws.on('close', () => {
    console.log('[RICH-GAME] Terputus. Menghubungkan ulang dalam 3 detik...');
    setTimeout(() => connectRichGame(conn), 3000);
  });
}

// 2. Handler Perintah Chat Pengguna di Grup WA
export async function onMessage(conn, m) {
  const text = m.text || '';
  const groupJid = m.chat; // Contoh: 120363xxx@g.us
  const senderId = m.sender; // Contoh: 628123456@s.whatsapp.net
  const senderName = m.pushName || 'Pemain';

  // Command: .rich join
  if (text === '.rich join' || text === '/rich join') {
    ws.send(JSON.stringify({
      type: 'join_room',
      roomId: groupJid,
      playerId: senderId,
      playerName: senderName,
      state: { cash: 1500, position: 0 }
    }));
    return m.reply(\`\u23F3 Memasukkan \${senderName} ke meja permainan...\`);
  }

  // Command: .rich roll (Lempar Dadu)
  if (text === '.rich roll' || text === '/rich roll') {
    const dice = Math.floor(Math.random() * 6) + 1;
    ws.send(JSON.stringify({
      type: 'player_state',
      roomId: groupJid,
      state: {
        roll: dice,
        lastAction: \`@\${senderId.split('@')[0]} melempar dadu: [\${dice}]\`
      }
    }));
  }
}</pre>
        </div>
      </div>

      <!-- JSON Protocol -->
      <div class="card">
        <div class="card-title">B. Spesifikasi Format Pesan JSON</div>
        <div style="font-size: 11px; color: var(--muted); line-height: 1.6;">
          <p><strong>1. Masuk Ruang:</strong> <code>{"type": "join_room", "roomId": "grup_jid", "playerId": "628xxx", "playerName": "Sultan", "state": {"cash": 1500, "position": 0}}</code></p>
          <p style="margin-top: 6px;"><strong>2. Lempar Dadu & Gerak:</strong> <code>{"type": "player_state", "roomId": "grup_jid", "state": {"position": 5, "cash": 1400, "lastAction": "Beli Petak Bandung"}}</code></p>
          <p style="margin-top: 6px;"><strong>3. Keluar Ruang:</strong> <code>{"type": "leave_room", "roomId": "grup_jid"}</code></p>
        </div>
      </div>
    </div>

    <!-- TAB 2: LIVE GAME BOARD -->
    <div id="tab-board" class="tab-content">
      <div class="card">
        <div class="card-title">
          <span>Kontrol Meja Game (Live Simulator)</span>
          <span id="player-cash-badge" class="badge" style="background: rgba(245,158,11,0.2); color: var(--amber); border-color: rgba(245,158,11,0.4);">
            Saldo: $1,500k
          </span>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
          <input type="text" id="input-room" value="rich_grup_wa_1" placeholder="Room ID" style="background: var(--code-bg); border: 1px solid var(--card-border); color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px; flex: 1; min-width: 140px;">
          <input type="text" id="input-player" value="Juragan_WA" placeholder="Nama Pemain" style="background: var(--code-bg); border: 1px solid var(--card-border); color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px; flex: 1; min-width: 140px;">
          <button class="btn btn-emerald" onclick="joinRoomGame()">Join Room</button>
          <button class="btn" style="background: #4338ca;" onclick="rollDiceGame()">\u{1F3B2} Lempar Dadu</button>
          <button class="btn btn-rose" onclick="leaveRoomGame()">Keluar</button>
        </div>

        <div style="font-size: 11px; color: #38bdf8; margin-bottom: 10px;" id="last-action-text">
          Status: Tekan "Join Room" untuk menghubungkan token ke papan permainan.
        </div>

        <!-- Board Grid -->
        <div class="board-grid" id="board-container">
          <!-- Rendered dynamically -->
        </div>
      </div>
    </div>

    <!-- TAB 3: METRIK SERVER -->
    <div id="tab-metrics" class="tab-content">
      <div class="metrics-grid">
        <div class="metric-box">
          <div class="metric-label">Status Server</div>
          <div class="metric-value" style="color: var(--emerald);">ONLINE</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Client Terhubung</div>
          <div class="metric-value" id="stat-clients">0</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Room Aktif</div>
          <div class="metric-value" id="stat-rooms">0</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Uptime</div>
          <div class="metric-value" id="stat-uptime">0s</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">RAM RSS</div>
          <div class="metric-value" id="stat-rss">-- MB</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Heartbeat</div>
          <div class="metric-value" style="color: #38bdf8;">30 Detik</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Verifikasi & Diagnostik Otomatis (TEST WAJIB)</span>
          <button class="btn btn-emerald" onclick="runDiagnosticsTest()">Jalankan Test Sekarang</button>
        </div>
        <div id="diag-results" style="font-size: 11px; color: var(--muted); line-height: 1.6;">
          Tekan tombol di atas untuk menjalankan 8 verifikasi socket dan health check server secara langsung.
        </div>
      </div>
    </div>

    <!-- TAB 4: SOCKET TESTER & LOGS -->
    <div id="tab-sandbox" class="tab-content">
      <div class="card">
        <div class="card-title">Kirim Paket Raw JSON</div>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <button class="btn" style="padding: 4px 8px; font-size: 10px; background: #334155;" onclick="setPreset('ping')">Preset: Ping</button>
          <button class="btn" style="padding: 4px 8px; font-size: 10px; background: #334155;" onclick="setPreset('join')">Preset: Join Room</button>
          <button class="btn" style="padding: 4px 8px; font-size: 10px; background: #334155;" onclick="setPreset('roll')">Preset: Roll State</button>
        </div>
        <textarea id="raw-input" rows="4" style="width: 100%; background: var(--code-bg); border: 1px solid var(--card-border); color: #34d399; font-size: 11px; padding: 10px; border-radius: 6px; outline: none; margin-bottom: 8px;">{"type": "ping", "timestamp": 1727780000}</textarea>
        <button class="btn" onclick="sendRawJson()">Kirim ke WebSocket</button>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Live WebSocket Event Stream</span>
          <button class="btn" style="padding: 2px 8px; font-size: 10px; background: #334155;" onclick="document.getElementById('log-stream').innerHTML=''">Hapus</button>
        </div>
        <div class="log-box" id="log-stream">
          <div class="log-entry log-sys">[SYS] Mendengarkan paket WebSocket...</div>
        </div>
      </div>
    </div>

    <footer class="footer">
      WA Rich Game Dedicated WebSocket Engine &bull; Host: 0.0.0.0:2252 &bull; medium.lynzz.id
    </footer>
  </div>

  <script>
    // Tiles Data
    const TILES = [
      { id: 0, name: 'START', cost: '+200k', icon: '\u{1F6A9}' },
      { id: 1, name: 'Jakarta', cost: '$150k', icon: '\u{1F3D9}\uFE0F' },
      { id: 2, name: 'Chest', cost: 'Acak', icon: '\u{1F381}' },
      { id: 3, name: 'Surabaya', cost: '$180k', icon: '\u{1F306}' },
      { id: 4, name: 'Pajak', cost: '-$100k', icon: '\u{1F4B8}' },
      { id: 5, name: 'Bandung', cost: '$200k', icon: '\u{1F3F0}' },
      { id: 6, name: 'Bandara', cost: 'Fly', icon: '\u2708\uFE0F' },
      { id: 7, name: 'Bali', cost: '$280k', icon: '\u{1F3DD}\uFE0F' },
      { id: 8, name: 'Kasino', cost: '50/50', icon: '\u{1F3B0}' },
      { id: 9, name: 'Medan', cost: '$220k', icon: '\u{1F54C}' },
      { id: 10, name: 'PLN Pusat', cost: '$210k', icon: '\u26A1' },
      { id: 11, name: 'Makassar', cost: '$300k', icon: '\u26F5' }
    ];

    let playerPosition = 0;
    let playerCash = 1500;
    let ws = null;
    let inRoom = false;

    // Render Board Grid
    function renderBoard() {
      const container = document.getElementById('board-container');
      container.innerHTML = '';
      TILES.forEach(tile => {
        const isHere = inRoom && playerPosition === tile.id;
        const div = document.createElement('div');
        div.className = 'tile' + (isHere ? ' active-player' : '');
        div.innerHTML = \`
          <div class="tile-name">
            <span>\${tile.id}. \${tile.name}</span>
            <span>\${tile.icon}</span>
          </div>
          <div class="tile-price">\${tile.cost}</div>
          <div class="token-container">
            \${isHere ? '<span class="token">Token Anda</span>' : ''}
          </div>
        \`;
        container.appendChild(div);
      });
    }

    // Connect WebSocket
    function connectWs() {
      const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          addLog('SYS', 'Terhubung ke ' + wsUrl);
          // Auto ping
          setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              const start = Date.now();
              ws.send(JSON.stringify({ type: 'ping', timestamp: start }));
            }
          }, 5000);
        };

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            addLog('IN', JSON.stringify(data));

            if (data.type === 'pong' && data.timestamp) {
              const rtt = Date.now() - data.timestamp;
              document.getElementById('latency-text').innerText = rtt + ' ms';
            }

            if (data.type === 'room_joined') {
              inRoom = true;
              document.getElementById('last-action-text').innerText = '\u2705 Berhasil masuk room: ' + data.roomId;
              renderBoard();
            }

            if (data.type === 'player_state' && data.state) {
              if (typeof data.state.position === 'number') {
                playerPosition = data.state.position;
              }
              if (typeof data.state.cash === 'number') {
                playerCash = data.state.cash;
                document.getElementById('player-cash-badge').innerText = 'Saldo: $' + playerCash + 'k';
              }
              if (data.state.lastAction) {
                document.getElementById('last-action-text').innerText = '\u{1F3B2} ' + data.state.lastAction;
              }
              renderBoard();
            }
          } catch(err) {
            addLog('IN', e.data);
          }
        };

        ws.onclose = () => {
          addLog('SYS', 'WebSocket terputus. Mencoba reconnect...');
          setTimeout(connectWs, 3000);
        };
      } catch(e) {
        addLog('ERR', e.message);
      }
    }

    function addLog(type, msg) {
      const stream = document.getElementById('log-stream');
      const div = document.createElement('div');
      div.className = 'log-entry ' + (type === 'IN' ? 'log-in' : type === 'OUT' ? 'log-out' : 'log-sys');
      const time = new Date().toLocaleTimeString();
      div.innerText = '[' + time + '] [' + type + '] ' + msg;
      stream.prepend(div);
    }

    function joinRoomGame() {
      const room = document.getElementById('input-room').value.trim() || 'rich_grup_wa_1';
      const player = document.getElementById('input-player').value.trim() || 'Juragan_WA';
      if (!ws || ws.readyState !== WebSocket.OPEN) return alert('WebSocket belum terhubung.');

      const payload = {
        type: 'join_room',
        roomId: room,
        playerId: 'p_' + Math.floor(Math.random() * 9000),
        playerName: player,
        state: { position: playerPosition, cash: playerCash }
      };
      ws.send(JSON.stringify(payload));
      addLog('OUT', JSON.stringify(payload));
    }

    function rollDiceGame() {
      if (!inRoom) return alert('Silakan klik Join Room terlebih dahulu!');
      const roll = Math.floor(Math.random() * 6) + 1;
      playerPosition = (playerPosition + roll) % TILES.length;
      const tile = TILES[playerPosition];
      let change = tile.id === 0 ? 200 : tile.id === 4 ? -100 : -20;
      playerCash = Math.max(0, playerCash + change);
      document.getElementById('player-cash-badge').innerText = 'Saldo: $' + playerCash + 'k';

      const action = 'Dadu: [' + roll + '] -> Mendarat di ' + tile.name + ' (' + (change>=0?'+':'') + change + 'k)';
      document.getElementById('last-action-text').innerText = '\u{1F3B2} ' + action;

      const room = document.getElementById('input-room').value.trim() || 'rich_grup_wa_1';
      const payload = {
        type: 'player_state',
        roomId: room,
        state: { position: playerPosition, cash: playerCash, roll: roll, lastAction: action }
      };
      ws.send(JSON.stringify(payload));
      addLog('OUT', JSON.stringify(payload));
      renderBoard();
    }

    function leaveRoomGame() {
      const room = document.getElementById('input-room').value.trim() || 'rich_grup_wa_1';
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leave_room', roomId: room }));
      }
      inRoom = false;
      document.getElementById('last-action-text').innerText = '\u{1F6AA} Telah keluar dari room.';
      renderBoard();
    }

    function sendRawJson() {
      const val = document.getElementById('raw-input').value;
      if (!ws || ws.readyState !== WebSocket.OPEN) return alert('Socket offline.');
      try {
        ws.send(val);
        addLog('OUT', val);
      } catch(e) {
        alert('Invalid format: ' + e.message);
      }
    }

    function setPreset(type) {
      if (type === 'ping') {
        document.getElementById('raw-input').value = JSON.stringify({ type: 'ping', timestamp: Date.now() }, null, 2);
      } else if (type === 'join') {
        document.getElementById('raw-input').value = JSON.stringify({ type: 'join_room', roomId: 'rich_grup_wa_1', playerId: '628123456', playerName: 'Sultan', state: { cash: 1500, position: 0 } }, null, 2);
      } else if (type === 'roll') {
        document.getElementById('raw-input').value = JSON.stringify({ type: 'player_state', roomId: 'rich_grup_wa_1', state: { roll: 6, position: 6, lastAction: 'Dadu [6] -> Bandara' } }, null, 2);
      }
    }

    function switchTab(id) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('tab-' + id).classList.add('active');
    }

    function copyText(txt, btnId) {
      navigator.clipboard.writeText(txt);
      const b = document.getElementById(btnId);
      const old = b.innerText;
      b.innerText = 'TERSALIN!';
      setTimeout(() => b.innerText = old, 2000);
    }

    function copyCode(preId, btn) {
      const code = document.getElementById(preId).innerText;
      navigator.clipboard.writeText(code);
      btn.innerText = 'Tersalin!';
      setTimeout(() => btn.innerText = 'Salin Kode', 2000);
    }

    // Auto fetch stats
    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          const s = await res.json();
          document.getElementById('stat-clients').innerText = s.clientsCount || 0;
          document.getElementById('stat-rooms').innerText = s.roomsCount || 0;
          document.getElementById('stat-uptime').innerText = (s.uptimeSeconds || 0) + 's';
          if (s.memory && s.memory.rssMB) {
            document.getElementById('stat-rss').innerText = s.memory.rssMB + ' MB';
          }
        }
      } catch(e) {}
    }

    async function runDiagnosticsTest() {
      const div = document.getElementById('diag-results');
      div.innerHTML = '<span style="color: #38bdf8;">Menjalankan 8 pengujian otomatis...</span>';
      try {
        const res = await fetch('/api/test', { method: 'POST' });
        const report = await res.json();
        let html = '<div style="margin-top: 8px; font-weight: bold; color: ' + (report.allPassed ? '#34d399' : '#f43f5e') + '">';
        html += (report.allPassed ? '\u2713 SEMUA 8 TES BERHASIL' : '\u2717 BEBERAPA TES GAGAL') + ' (' + report.durationMs + 'ms)</div>';
        html += '<div style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px;">';
        report.results.forEach(r => {
          html += '<div>' + (r.passed ? '\u2713 ' : '\u2717 ') + r.name + ' (' + r.durationMs + 'ms)</div>';
        });
        html += '</div>';
        div.innerHTML = html;
      } catch(e) {
        div.innerHTML = '<span style="color: #f43f5e;">Error: ' + e.message + '</span>';
      }
    }

    renderBoard();
    connectWs();
    setInterval(fetchStats, 3000);
    fetchStats();
  </script>
</body>
</html>`;
}

// server.ts
process.on("uncaughtException", (err) => {
  const msg = err && err.message ? err.message : String(err);
  console.error(`[FATAL_PREVENTED] Uncaught Exception: ${msg}`);
  if (err && err.stack) {
    console.error(err.stack);
  }
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL_PREVENTED] Unhandled Rejection:", reason);
});
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var portSource = "DEFAULT (3000)";
var targetPort = 3e3;
if (process.env.SERVER_PORT && !isNaN(parseInt(process.env.SERVER_PORT, 10)) && parseInt(process.env.SERVER_PORT, 10) > 0) {
  targetPort = parseInt(process.env.SERVER_PORT, 10);
  portSource = "process.env.SERVER_PORT (Pterodactyl)";
} else if (process.env.PORT && !isNaN(parseInt(process.env.PORT, 10)) && parseInt(process.env.PORT, 10) > 0) {
  targetPort = parseInt(process.env.PORT, 10);
  portSource = "process.env.PORT";
}
var host = process.env.HOST || process.env.SERVER_IP || "0.0.0.0";
var publicUrl = process.env.PUBLIC_URL || process.env.APP_URL || "medium.lynzz.id:2252";
var heartbeatMs = process.env.HEARTBEAT_INTERVAL ? parseInt(process.env.HEARTBEAT_INTERVAL, 10) * 1e3 : process.env.HEARTBEAT_MS ? parseInt(process.env.HEARTBEAT_MS, 10) : 3e4;
var roomManager = new RoomManager();
var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};
var viteDevServer = null;
var server = http.createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host || `localhost:${targetPort}`;
    const url = new URL(req.url || "/", `http://${hostHeader}`);
    const pathname = url.pathname;
    if (req.method === "GET" && pathname === "/health") {
      const mem = process.memoryUsage();
      const actualPort2 = server.address()?.port || targetPort;
      const data = {
        status: "ok",
        service: "WA Rich Game Socket Server",
        uptime: Math.floor(process.uptime()),
        timestamp: Date.now(),
        version: "1.0.0",
        node: process.version,
        port: actualPort2,
        clients: roomManager.getClientCount(),
        rooms: roomManager.getRoomCount(),
        memory: {
          rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100
        }
      };
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache"
      });
      res.end(JSON.stringify(data));
      return;
    }
    if (req.method === "GET" && pathname === "/api/stats") {
      const stats = consoleManager ? consoleManager.getStats() : {
        status: "ONLINE",
        clientsCount: roomManager.getClientCount(),
        roomsCount: roomManager.getRoomCount()
      };
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(stats));
      return;
    }
    if (req.method === "GET" && pathname === "/api/rooms") {
      const rooms = roomManager.getAllRooms().map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        playersCount: r.players.size,
        players: Array.from(r.players.values()).map((p) => ({
          id: p.id,
          name: p.name,
          state: p.state,
          joinedAt: p.joinedAt,
          lastUpdatedAt: p.lastUpdatedAt
        })),
        roomState: r.roomState
      }));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ rooms }));
      return;
    }
    if (req.method === "POST" && pathname === "/api/test") {
      const actualPort2 = server.address()?.port || targetPort;
      const report = await runDiagnostics(actualPort2, "127.0.0.1");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(report));
      return;
    }
    if (viteDevServer) {
      viteDevServer.middlewares(req, res, () => {
        res.writeHead(404);
        res.end("Not Found");
      });
      return;
    }
    const distPath = path.join(__dirname, "dist");
    const distIndex = path.join(distPath, "index.html");
    const hasDist = fs.existsSync(distIndex);
    if (hasDist) {
      let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, "");
      if (safePath === "/" || safePath === "") {
        safePath = "/index.html";
      }
      const filePath = path.join(distPath, safePath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(distIndex).pipe(res);
      return;
    }
    const actualPort = server.address()?.port || targetPort;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getDashboardHtml(actualPort, host, process.version));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error: " + (err instanceof Error ? err.message : String(err)));
  }
});
var socketHandler = new SocketHandler(server, roomManager, {
  heartbeatIntervalMs: heartbeatMs,
  maxPayloadBytes: 64 * 1024,
  // 64 KB limit
  logger: (tag, msg) => {
    if (consoleManager) {
      consoleManager.log(tag, msg);
    } else {
      console.log(`[${tag}] ${msg}`);
    }
  }
});
var consoleManager;
async function setupViteIfDev() {
  const distIndex = path.join(__dirname, "dist", "index.html");
  if (fs.existsSync(distIndex)) {
    return;
  }
  const isPterodactyl = process.env.PTERODACTYL === "true" || process.env.P_SERVER_UUID !== void 0 || process.env.HOME === "/home/container";
  const isProduction = process.env.NODE_ENV === "production" || isPterodactyl;
  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import("vite");
      viteDevServer = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
    } catch {
    }
  }
}
async function startServer() {
  await setupViteIfDev();
  server.listen(targetPort, host, () => {
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : targetPort;
    consoleManager = new ConsoleManager({
      host,
      actualPort,
      portSource,
      publicUrl,
      roomManager,
      socketHandler
    });
    consoleManager.printBanner();
    consoleManager.log("START", `Server bound to ${host}:${actualPort} (${portSource})`);
    consoleManager.startStdin();
  });
}
function handleShutdown(signal) {
  if (consoleManager) {
    consoleManager.log("STOP", `Received ${signal}. Starting graceful shutdown...`);
    consoleManager.stopStdin();
  } else {
    console.log(`[STOP] Received ${signal}. Starting graceful shutdown...`);
  }
  socketHandler.stop().then(() => {
    server.close(() => {
      if (consoleManager) {
        consoleManager.log("STOP", "HTTP and WebSocket server closed cleanly.");
      } else {
        console.log("[STOP] HTTP and WebSocket server closed cleanly.");
      }
      process.exit(0);
    });
  });
  setTimeout(() => {
    console.error("Forced shutdown timeout exceeded. Exiting.");
    process.exit(1);
  }, 5e3).unref();
}
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
startServer().catch((err) => {
  console.error("[ERROR] Failed to start server:", err);
  setTimeout(() => process.exit(1), 1e3);
});
