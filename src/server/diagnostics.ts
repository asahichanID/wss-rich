/**
 * Real Diagnostic & Self-Test Suite
 * Performs ACTUAL HTTP & WebSocket transactions (no mock/simulations)
 */
import { WebSocket } from 'ws';
import type { ServerStats } from './types.js';

export interface TestResultItem {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
  error?: string;
}

export interface DiagnosticsReport {
  timestamp: number;
  allPassed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  results: TestResultItem[];
  stats?: Partial<ServerStats>;
}

export async function runDiagnostics(port: number, host = '127.0.0.1'): Promise<DiagnosticsReport> {
  const startTime = Date.now();
  const results: TestResultItem[] = [];

  const addResult = (name: string, passed: boolean, start: number, details?: string, error?: string) => {
    results.push({
      name,
      passed,
      durationMs: Date.now() - start,
      details,
      error,
    });
  };

  // 1. Test HTTP /health
  const t1 = Date.now();
  try {
    const res = await fetch(`http://${host}:${port}/health`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const healthJson = await res.json() as Record<string, unknown>;
    if (healthJson.status !== 'ok') {
      throw new Error(`Invalid status in health response: ${JSON.stringify(healthJson)}`);
    }
    addResult('1. HTTP /health Endpoint', true, t1, `HTTP 200 OK | Uptime: ${healthJson.uptime}s | Node: ${healthJson.node}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('1. HTTP /health Endpoint', false, t1, undefined, message);
  }

  // 2. Test WebSocket Connection
  const t2 = Date.now();
  let ws1: WebSocket | null = null;
  let ws2: WebSocket | null = null;

  try {
    const wsUrl = `ws://${host}:${port}`;
    ws1 = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS connection timeout (3000ms)')), 3000);
      ws1!.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws1!.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    addResult('2. WebSocket Connection Handshake', true, t2, `Connected successfully to ws://${host}:${port}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('2. WebSocket Connection Handshake', false, t2, undefined, message);
  }

  // 3. Test Ping / Pong
  if (ws1 && ws1.readyState === WebSocket.OPEN) {
    const t3 = Date.now();
    try {
      const pingTime = Date.now();
      const pongPromise = new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Pong timeout (3000ms)')), 3000);
        const onMsg = (data: Buffer | string) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === 'pong') {
              ws1!.removeListener('message', onMsg);
              clearTimeout(timeout);
              resolve(Date.now() - pingTime);
            }
          } catch {
            // ignore non-json
          }
        };
        ws1!.on('message', onMsg);
      });

      ws1.send(JSON.stringify({ type: 'ping', timestamp: pingTime }));
      const latency = await pongPromise;
      addResult('3. Ping / Pong Round-Trip', true, t3, `Ping/Pong latency: ${latency}ms`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addResult('3. Ping / Pong Round-Trip', false, t3, undefined, message);
    }
  }

  // 4. Test Join Room with Client 1
  const testRoomId = `test_room_${Date.now().toString(36)}`;
  const player1Id = 'diag_player_1';

  if (ws1 && ws1.readyState === WebSocket.OPEN) {
    const t4 = Date.now();
    try {
      const joinPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('join_room timeout (3000ms)')), 3000);
        const onMsg = (data: Buffer | string) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === 'room_joined' && parsed.roomId === testRoomId) {
              ws1!.removeListener('message', onMsg);
              clearTimeout(timeout);
              resolve(parsed);
            }
          } catch {
            // ignore
          }
        };
        ws1!.on('message', onMsg);
      });

      ws1.send(JSON.stringify({
        type: 'join_room',
        roomId: testRoomId,
        playerId: player1Id,
        playerName: 'DiagnosticBot1',
        state: { x: 10, y: 20, score: 100 },
      }));

      const joinRes = await joinPromise;
      addResult('4. Room Creation & Player Join', true, t4, `Room ${joinRes.roomId} joined by ${joinRes.playerId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addResult('4. Room Creation & Player Join', false, t4, undefined, message);
    }
  }

  // 5. Test Multi-Client (Client 2 Join & Broadcast)
  const t5 = Date.now();
  const player2Id = 'diag_player_2';
  try {
    const wsUrl = `ws://${host}:${port}`;
    ws2 = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Client 2 connection timeout')), 3000);
      ws2!.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws2!.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });

    // Client 1 should receive player_joined event when Client 2 joins
    const playerJoinedPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('player_joined broadcast timeout')), 3000);
      const onMsg = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'player_joined' && parsed.player?.id === player2Id) {
            ws1?.removeListener('message', onMsg);
            clearTimeout(timeout);
            resolve(parsed.player.name);
          }
        } catch {
          // ignore
        }
      };
      ws1?.on('message', onMsg);
    });

    ws2.send(JSON.stringify({
      type: 'join_room',
      roomId: testRoomId,
      playerId: player2Id,
      playerName: 'DiagnosticBot2',
      state: { x: 50, y: 60, score: 200 },
    }));

    const joinedName = await playerJoinedPromise;
    addResult('5. Multi-Client Room Join & Broadcast', true, t5, `Client 1 received broadcast for ${joinedName} (${player2Id})`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('5. Multi-Client Room Join & Broadcast', false, t5, undefined, message);
  }

  // 6. Test Player State Broadcast between Clients
  const t6 = Date.now();
  try {
    const stateBroadcastPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('player_state broadcast timeout')), 3000);
      const onMsg = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'player_state' && parsed.playerId === player2Id) {
            ws1?.removeListener('message', onMsg);
            clearTimeout(timeout);
            resolve(parsed.state);
          }
        } catch {
          // ignore
        }
      };
      ws1?.on('message', onMsg);
    });

    ws2?.send(JSON.stringify({
      type: 'player_state',
      state: { x: 75, y: 90, score: 350, action: 'ROLL_DICE' },
    }));

    const newState = await stateBroadcastPromise;
    addResult('6. Realtime State Sync & Broadcast', true, t6, `Synced state: x=${newState.x}, y=${newState.y}, score=${newState.score}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('6. Realtime State Sync & Broadcast', false, t6, undefined, message);
  }

  // 7. Test Disconnect & Automatic Room Cleanup
  const t7 = Date.now();
  try {
    const leaveBroadcastPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('player_left broadcast timeout')), 3000);
      const onMsg = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'player_left' && parsed.playerId === player2Id) {
            ws1?.removeListener('message', onMsg);
            clearTimeout(timeout);
            resolve(parsed.reason || 'disconnected');
          }
        } catch {
          // ignore
        }
      };
      ws1?.on('message', onMsg);
    });

    // Close ws2 to trigger disconnect
    ws2?.close();
    const leaveReason = await leaveBroadcastPromise;
    addResult('7. Disconnect Tracking & Room Notification', true, t7, `Player left event acknowledged (reason: ${leaveReason})`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('7. Disconnect Tracking & Room Notification', false, t7, undefined, message);
  }

  // 8. Test Invalid Payload & Crash Resilience
  const t8 = Date.now();
  try {
    const errorPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Error response timeout')), 3000);
      const onMsg = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'error') {
            ws1?.removeListener('message', onMsg);
            clearTimeout(timeout);
            resolve(parsed.code || parsed.message);
          }
        } catch {
          // ignore
        }
      };
      ws1?.on('message', onMsg);
    });

    // Send broken JSON
    ws1?.send('{ "type": "broken_payload", bad_json: ');
    const errCode = await errorPromise;
    addResult('8. Security & Malformed Payload Handling', true, t8, `Server handled bad payload safely with error code: ${errCode}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('8. Security & Malformed Payload Handling', false, t8, undefined, message);
  }

  // Clean up remaining test socket
  if (ws1 && ws1.readyState === WebSocket.OPEN) {
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
    results,
  };
}
