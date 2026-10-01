// server.ts
import http from "http";
import fs from "fs";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

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
dotenv.config();
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
var publicUrl = process.env.APP_URL || process.env.PUBLIC_URL || "Not configured";
var heartbeatMs = process.env.HEARTBEAT_INTERVAL ? parseInt(process.env.HEARTBEAT_INTERVAL, 10) * 1e3 : process.env.HEARTBEAT_MS ? parseInt(process.env.HEARTBEAT_MS, 10) : 3e4;
var app = express();
app.use(express.json());
var roomManager = new RoomManager();
var server = http.createServer(app);
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
app.get("/health", (_req, res) => {
  try {
    const mem = process.memoryUsage();
    const actualPort = server.address()?.port || targetPort;
    res.status(200).json({
      status: "ok",
      service: "WA Rich Game Socket Server",
      uptime: Math.floor(process.uptime()),
      timestamp: Date.now(),
      version: "1.0.0",
      node: process.version,
      port: actualPort,
      clients: roomManager.getClientCount(),
      rooms: roomManager.getRoomCount(),
      memory: {
        rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100
      }
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: String(err) });
  }
});
app.get("/api/stats", (_req, res) => {
  try {
    if (consoleManager) {
      res.json(consoleManager.getStats());
    } else {
      res.json({
        status: "ONLINE",
        clientsCount: roomManager.getClientCount(),
        roomsCount: roomManager.getRoomCount()
      });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
app.get("/api/rooms", (_req, res) => {
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
        lastUpdatedAt: p.lastUpdatedAt
      })),
      roomState: r.roomState
    }));
    res.json({ rooms });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
app.post("/api/test", async (_req, res) => {
  const actualPort = server.address()?.port || targetPort;
  try {
    const report = await runDiagnostics(actualPort, "127.0.0.1");
    res.json(report);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err)
    });
  }
});
async function setupFrontend() {
  const isPterodactyl = process.env.PTERODACTYL === "true" || process.env.P_SERVER_UUID !== void 0;
  const isProduction = process.env.NODE_ENV === "production" || isPterodactyl;
  let viteMounted = false;
  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
      viteMounted = true;
    } catch {
    }
  }
  const distPath = path.join(__dirname, "dist");
  const distIndex = path.join(distPath, "index.html");
  const hasDist = fs.existsSync(distIndex);
  if (hasDist) {
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path === "/health") {
        return next();
      }
      res.sendFile(distIndex, (err) => {
        if (err) next();
      });
    });
  } else if (!viteMounted) {
    app.get("/", (_req, res) => {
      const actualPort = server.address()?.port || targetPort;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
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
    <pre>\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551     GAME SOCKET SERVER       \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
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
async function startServer() {
  await setupFrontend();
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
