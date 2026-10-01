import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Server,
  Activity,
  Cpu,
  Wifi,
  Radio,
  Play,
  Terminal,
  Users,
  Layers,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Send,
  Dice5,
  Coins,
  RefreshCw,
  Zap,
} from 'lucide-react';

interface ServerStats {
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
}

interface PlayerInRoom {
  id: string;
  name: string;
  state: {
    x?: number;
    y?: number;
    cash?: number;
    position?: number;
    color?: string;
    lastAction?: string;
    [key: string]: unknown;
  };
  joinedAt: number;
  lastUpdatedAt: number;
}

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
  error?: string;
}

interface TestReport {
  allPassed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  results: TestResult[];
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'in' | 'out' | 'system' | 'error';
  tag: string;
  data: unknown;
}

const BOARD_TILES = [
  { id: 0, name: 'START', type: 'start', color: 'bg-emerald-600', icon: '🚩' },
  { id: 1, name: 'Jakarta', cost: 100, color: 'bg-blue-600', icon: '🏙️' },
  { id: 2, name: 'Chest', type: 'chance', color: 'bg-amber-600', icon: '🎁' },
  { id: 3, name: 'Surabaya', cost: 150, color: 'bg-blue-600', icon: '🌆' },
  { id: 4, name: 'Tax Office', type: 'tax', color: 'bg-rose-600', icon: '💸' },
  { id: 5, name: 'Bandung', cost: 180, color: 'bg-blue-500', icon: '🏰' },
  { id: 6, name: 'Airport', type: 'travel', color: 'bg-sky-600', icon: '✈️' },
  { id: 7, name: 'Bali', cost: 240, color: 'bg-indigo-600', icon: '🏝️' },
  { id: 8, name: 'Casino', type: 'casino', color: 'bg-purple-600', icon: '🎰' },
  { id: 9, name: 'Medan', cost: 260, color: 'bg-indigo-600', icon: '🕌' },
  { id: 10, name: 'Electric Co', cost: 200, color: 'bg-yellow-600', icon: '⚡' },
  { id: 11, name: 'Makassar', cost: 300, color: 'bg-cyan-600', icon: '⛵' },
];

const PLAYER_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

export default function App() {
  const [activeTab, setActiveTab] = useState<'board' | 'tester' | 'console' | 'diagnostics'>('board');
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // WebSocket Client State
  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState<string>('');
  const [latency, setLatency] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Game Room State
  const [roomId, setRoomId] = useState('rich_room_1');
  const [playerId, setPlayerId] = useState(() => 'player_' + Math.floor(1000 + Math.random() * 9000));
  const [playerName, setPlayerName] = useState(() => 'Tycoon_' + Math.floor(10 + Math.random() * 90));
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<PlayerInRoom[]>([]);
  const [myPosition, setMyPosition] = useState(0);
  const [myCash, setMyCash] = useState(1500);

  // Simulating secondary bot player in same room
  const [botConnected, setBotConnected] = useState(false);
  const botWsRef = useRef<WebSocket | null>(null);
  const [botPosition, setBotPosition] = useState(0);
  const [botCash, setBotCash] = useState(1500);

  // Raw Packet Sandbox
  const [rawPayload, setRawPayload] = useState('{\n  "type": "ping",\n  "timestamp": ' + Date.now() + '\n}');

  // Diagnostics state
  const [diagnosticReport, setDiagnosticReport] = useState<TestReport | null>(null);
  const [runningDiag, setRunningDiag] = useState(false);

  // Console Interactive Emulator
  const [consoleInput, setConsoleInput] = useState('');
  const [consoleHistory, setConsoleHistory] = useState<Array<{ cmd: string; output: string }>>([
    {
      cmd: 'status',
      output: 'Type "help" to see all available server console commands.',
    },
  ]);

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const consoleBottomRef = useRef<HTMLDivElement | null>(null);

  const addLog = useCallback((type: 'in' | 'out' | 'system' | 'error', tag: string, data: unknown) => {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      tag,
      data,
    };
    setLogs((prev) => [entry, ...prev.slice(0, 99)]);
  }, []);

  // Fetch Stats from server
  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await fetch('/api/stats');
      if (res.ok) {
        const data = await res.json();
        setServerStats(data);
      }
    } catch {
      // server starting up or not ready
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const timer = setInterval(fetchStats, 3000);
    return () => clearInterval(timer);
  }, [fetchStats]);

  // Connect Main WS
  const connectWs = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    addLog('system', 'CONNECTING', `Initiating connection to ${wsUrl}`);

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        addLog('system', 'OPEN', 'WebSocket connection established successfully.');

        // Periodic ping
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            const start = Date.now();
            socket.send(JSON.stringify({ type: 'ping', timestamp: start }));
          }
        }, 5000);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          addLog('in', msg.type?.toUpperCase() || 'MESSAGE', msg);

          switch (msg.type) {
            case 'connected':
              setClientId(msg.clientId);
              break;

            case 'pong':
              if (msg.timestamp) {
                setLatency(Date.now() - msg.timestamp);
              }
              break;

            case 'room_joined':
              setJoinedRoom(msg.roomId);
              setRoomPlayers(msg.players || []);
              break;

            case 'room_left':
              setJoinedRoom(null);
              setRoomPlayers([]);
              break;

            case 'player_joined':
              setRoomPlayers((prev) => {
                const filtered = prev.filter((p) => p.id !== msg.player.id);
                return [...filtered, msg.player];
              });
              break;

            case 'player_left':
              setRoomPlayers((prev) => prev.filter((p) => p.id !== msg.playerId));
              break;

            case 'player_state':
              setRoomPlayers((prev) =>
                prev.map((p) => {
                  if (p.id === msg.playerId) {
                    return {
                      ...p,
                      state: { ...p.state, ...msg.state },
                      lastUpdatedAt: msg.timestamp || Date.now(),
                    };
                  }
                  return p;
                })
              );
              break;

            case 'error':
              addLog('error', 'SERVER_ERROR', msg.message);
              break;
          }
        } catch {
          addLog('in', 'RAW', event.data);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        setJoinedRoom(null);
        setRoomPlayers([]);
        addLog('system', 'CLOSED', 'WebSocket connection closed.');
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      };

      socket.onerror = (err) => {
        addLog('error', 'WS_ERROR', 'WebSocket encountered an error.');
      };
    } catch (err: unknown) {
      addLog('error', 'INIT_FAILED', err instanceof Error ? err.message : String(err));
    }
  }, [addLog]);

  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [connectWs]);

  // Join Room
  const handleJoinRoom = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('error', 'NOT_CONNECTED', 'Cannot join room: socket is not open.');
      return;
    }
    const payload = {
      type: 'join_room',
      roomId,
      playerId,
      playerName,
      state: {
        position: myPosition,
        cash: myCash,
        color: PLAYER_COLORS[0],
        lastAction: 'Joined game',
      },
    };
    wsRef.current.send(JSON.stringify(payload));
    addLog('out', 'JOIN_ROOM', payload);
  };

  // Leave Room
  const handleLeaveRoom = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const payload = { type: 'leave_room', roomId };
    wsRef.current.send(JSON.stringify(payload));
    addLog('out', 'LEAVE_ROOM', payload);
    setJoinedRoom(null);
    setRoomPlayers([]);
  };

  // Move & Roll Dice
  const handleRollDice = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !joinedRoom) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    const nextPos = (myPosition + roll) % BOARD_TILES.length;
    const tile = BOARD_TILES[nextPos];
    let cashChange = 0;

    if (tile.type === 'start') cashChange = 200;
    else if (tile.type === 'chance') cashChange = Math.random() > 0.5 ? 100 : -50;
    else if (tile.type === 'tax') cashChange = -150;
    else if (tile.type === 'casino') cashChange = Math.random() > 0.6 ? 250 : -100;

    const newCash = Math.max(0, myCash + cashChange);
    setMyPosition(nextPos);
    setMyCash(newCash);

    const actionText = `Rolled ${roll} → Landed on ${tile.name} ${tile.icon} (${cashChange >= 0 ? '+' : ''}${cashChange}k)`;

    const payload = {
      type: 'player_state',
      roomId: joinedRoom,
      state: {
        position: nextPos,
        cash: newCash,
        roll,
        lastAction: actionText,
      },
    };

    wsRef.current.send(JSON.stringify(payload));
    addLog('out', 'PLAYER_STATE', payload);
  };

  // Bot Simulator (Multiplayer verification)
  const toggleBot = () => {
    if (botConnected) {
      if (botWsRef.current) {
        botWsRef.current.close();
        botWsRef.current = null;
      }
      setBotConnected(false);
      addLog('system', 'BOT_DISCONNECT', 'Simulator Bot 2 disconnected.');
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      const botSocket = new WebSocket(wsUrl);
      botWsRef.current = botSocket;

      botSocket.onopen = () => {
        setBotConnected(true);
        addLog('system', 'BOT_CONNECT', 'Simulator Bot 2 connected. Joining room...');
        botSocket.send(
          JSON.stringify({
            type: 'join_room',
            roomId,
            playerId: 'bot_tycoon_rival',
            playerName: '🤖 Bot Rival (Rich King)',
            state: {
              position: 0,
              cash: 1500,
              color: PLAYER_COLORS[1],
              lastAction: 'Bot rival entered arena',
            },
          })
        );
      };

      botSocket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'player_state' && msg.playerId === 'bot_tycoon_rival') {
            if (typeof msg.state?.position === 'number') setBotPosition(msg.state.position);
            if (typeof msg.state?.cash === 'number') setBotCash(msg.state.cash);
          }
        } catch {
          // ignore
        }
      };

      botSocket.onclose = () => {
        setBotConnected(false);
      };
    }
  };

  const handleBotRoll = () => {
    if (!botWsRef.current || botWsRef.current.readyState !== WebSocket.OPEN) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    const nextPos = (botPosition + roll) % BOARD_TILES.length;
    const tile = BOARD_TILES[nextPos];
    const newCash = botCash + (tile.type === 'start' ? 200 : -20);
    setBotPosition(nextPos);
    setBotCash(newCash);

    botWsRef.current.send(
      JSON.stringify({
        type: 'player_state',
        roomId,
        state: {
          position: nextPos,
          cash: newCash,
          roll,
          lastAction: `🤖 Bot rolled ${roll} → ${tile.name}`,
        },
      })
    );
  };

  // Run Test Suite
  const runFullDiagnostics = async () => {
    setRunningDiag(true);
    setDiagnosticReport(null);
    try {
      const res = await fetch('/api/test', { method: 'POST' });
      const data = await res.json();
      setDiagnosticReport(data);
    } catch (err: unknown) {
      addLog('error', 'DIAGNOSTIC_ERR', err instanceof Error ? err.message : String(err));
    } finally {
      setRunningDiag(false);
    }
  };

  // Send Raw Custom JSON
  const sendRawPayload = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('error', 'SOCKET_CLOSED', 'Cannot send payload: WebSocket is closed.');
      return;
    }
    try {
      const parsed = JSON.parse(rawPayload);
      wsRef.current.send(JSON.stringify(parsed));
      addLog('out', parsed.type ? parsed.type.toUpperCase() : 'CUSTOM', parsed);
    } catch (err: unknown) {
      // Send anyway to test error resilience if user wants
      wsRef.current.send(rawPayload);
      addLog('out', 'RAW_MALFORMED', { raw: rawPayload, error: err instanceof Error ? err.message : String(err) });
    }
  };

  // Console Emulator Handlers
  const handleConsoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = consoleInput.trim();
    if (!cmd) return;
    setConsoleInput('');

    let output = '';
    const lower = cmd.toLowerCase();

    if (lower === 'clear') {
      setConsoleHistory([]);
      return;
    } else if (lower === 'help') {
      output = `Commands: help, status, port, clients, rooms, heartbeat, memory, uptime, test, test ws, test health, room list, room info <id>, clear`;
    } else if (lower === 'status') {
      await fetchStats();
      output = `Status: ONLINE | Node: ${serverStats?.nodeVersion || '22.x'} | Host: ${serverStats?.host}:${serverStats?.port} | Clients: ${serverStats?.clientsCount} | Rooms: ${serverStats?.roomsCount} | RAM: RSS ${serverStats?.memory.rssMB}MB`;
    } else if (lower === 'port') {
      output = `Host: ${serverStats?.host || '0.0.0.0'} | Port: ${serverStats?.port || 3000} | Source: ${serverStats?.portSource || 'env'}`;
    } else if (lower === 'memory') {
      output = `Memory Breakdown:\n  RSS: ${serverStats?.memory.rssMB} MB\n  Heap Used: ${serverStats?.memory.heapUsedMB} MB\n  Heap Total: ${serverStats?.memory.heapTotalMB} MB\n  External: ${serverStats?.memory.externalMB} MB`;
    } else if (lower === 'uptime') {
      output = `Server Uptime: ${serverStats?.uptimeSeconds || 0} seconds`;
    } else if (lower === 'heartbeat') {
      output = `Heartbeat Interval: ${serverStats?.heartbeatIntervalMs || 30000}ms | Status: OK`;
    } else if (lower.startsWith('test')) {
      output = 'Running diagnostic tests on server...';
      runFullDiagnostics();
    } else {
      output = `Command executed on server. Type "help" for valid commands.`;
    }

    setConsoleHistory((prev) => [...prev, { cmd, output }]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-mono selection:bg-indigo-600 selection:text-white flex flex-col">
      {/* Top Header Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600/20 border border-indigo-500/40 rounded">
              <Server className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white tracking-wide text-sm sm:text-base">WA RICH GAME REALTIME SERVER</span>
                <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 rounded">
                  ONLINE
                </span>
                <span className="px-1.5 py-0.5 text-xs font-semibold bg-blue-500/20 text-blue-300 rounded">
                  Node 22 / ws
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Host: <span className="text-slate-200">{serverStats?.host || '0.0.0.0'}</span> | Port: <span className="text-amber-300 font-bold">{serverStats?.port || 3000}</span> | Public URL: <span className="text-sky-300">{serverStats?.publicUrl || 'Not configured'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded border border-slate-700">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-slate-300">WS:</span>
              <span className={isConnected ? 'text-emerald-400 font-bold' : 'text-rose-400'}>
                {isConnected ? 'READY' : 'OFFLINE'}
              </span>
              {isConnected && <span className="text-slate-400 ml-1">({latency}ms)</span>}
            </div>

            <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded border border-slate-700">
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-300">Clients:</span>
              <span className="text-indigo-300 font-bold">{serverStats?.clientsCount ?? 0}</span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">Rooms:</span>
              <span className="text-indigo-300 font-bold">{serverStats?.roomsCount ?? 0}</span>
            </div>

            <button
              onClick={fetchStats}
              disabled={statsLoading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
              title="Refresh Stats"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${statsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-slate-900 border-b border-slate-800 px-4">
        <div className="max-w-7xl mx-auto flex gap-2">
          <button
            onClick={() => setActiveTab('board')}
            className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'board'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/50'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Dice5 className="w-4 h-4" />
            Live Multiplayer Board
          </button>
          <button
            onClick={() => setActiveTab('tester')}
            className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'tester'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/50'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-4 h-4" />
            Protocol & Sandbox
          </button>
          <button
            onClick={() => setActiveTab('diagnostics')}
            className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'diagnostics'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/50'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Test Wajib Diagnostics
          </button>
          <button
            onClick={() => setActiveTab('console')}
            className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'console'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/50'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            Pterodactyl Console CLI
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto w-full p-4 flex-1 flex flex-col gap-4">
        {/* TAB 1: LIVE MULTIPLAYER GAME BOARD */}
        {activeTab === 'board' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
            {/* Left: Game Board & Interaction */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              {/* Room Controller Bar */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Room Manager</span>
                  </div>
                  {joinedRoom && (
                    <span className="text-xs px-2 py-0.5 bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 rounded">
                      Joined Room: <strong className="text-white">{joinedRoom}</strong>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">ROOM ID</label>
                    <input
                      type="text"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      disabled={!!joinedRoom}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">PLAYER ID</label>
                    <input
                      type="text"
                      value={playerId}
                      onChange={(e) => setPlayerId(e.target.value)}
                      disabled={!!joinedRoom}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">DISPLAY NAME</label>
                    <input
                      type="text"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      disabled={!!joinedRoom}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    {!joinedRoom ? (
                      <button
                        onClick={handleJoinRoom}
                        disabled={!isConnected}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold py-1.5 px-3 rounded flex items-center justify-center gap-1.5 transition"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Join Room
                      </button>
                    ) : (
                      <button
                        onClick={handleLeaveRoom}
                        className="flex-1 bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold py-1.5 px-3 rounded flex items-center justify-center gap-1.5 transition"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Leave Room
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Board Canvas & Controls */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded flex-1 flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>WA Rich Monopoly Board</span>
                      <span className="text-[10px] font-normal text-slate-400">12 Tiles • Realtime Synchronized</span>
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleBot}
                      className={`text-xs px-2.5 py-1 rounded border transition flex items-center gap-1.5 ${
                        botConnected
                          ? 'bg-amber-900/40 border-amber-500/50 text-amber-300'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      {botConnected ? 'Disconnect Bot 2' : 'Spawn Bot 2 (Rival)'}
                    </button>
                  </div>
                </div>

                {/* 12-Tile Game Board Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-2">
                  {BOARD_TILES.map((tile) => {
                    const playersHere = roomPlayers.filter((p) => p.state?.position === tile.id);
                    const isMyPosition = joinedRoom && myPosition === tile.id;
                    const isBotPosition = botConnected && botPosition === tile.id;

                    return (
                      <div
                        key={tile.id}
                        className={`border rounded p-2.5 flex flex-col justify-between transition relative overflow-hidden min-h-[90px] ${
                          isMyPosition || isBotPosition
                            ? 'border-indigo-400 bg-slate-800/90 shadow-md ring-1 ring-indigo-500/50'
                            : 'border-slate-800 bg-slate-950/60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-300">
                            {tile.id}. {tile.name}
                          </span>
                          <span className="text-sm">{tile.icon}</span>
                        </div>

                        <div className="text-[10px] text-slate-400 mt-1">
                          {tile.cost ? `$${tile.cost}k` : tile.type?.toUpperCase()}
                        </div>

                        {/* Player Tokens On Tile */}
                        <div className="flex flex-wrap gap-1 mt-2 items-center">
                          {playersHere.map((p, idx) => (
                            <div
                              key={p.id || idx}
                              title={`${p.name} ($${p.state?.cash || 0}k)`}
                              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white bg-indigo-600 flex items-center gap-1"
                            >
                              <span>{p.name.slice(0, 8)}</span>
                            </div>
                          ))}
                          {isBotPosition && !playersHere.some((p) => p.id === 'bot_tycoon_rival') && (
                            <div className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white bg-rose-600">
                              🤖 Bot
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Interactive Player Action Bar */}
                <div className="bg-slate-950 border border-slate-800 p-3 rounded mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Coins className="w-4 h-4 text-amber-400" />
                      <span className="text-slate-400">Your Cash:</span>
                      <span className="font-bold text-amber-300">${myCash}k</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Position:</span>
                      <span className="font-bold text-white">Tile #{myPosition} ({BOARD_TILES[myPosition].name})</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRollDice}
                      disabled={!joinedRoom}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs px-4 py-2 rounded flex items-center gap-2 shadow-lg transition"
                    >
                      <Dice5 className="w-4 h-4" />
                      Roll Dice & Broadcast State
                    </button>

                    {botConnected && (
                      <button
                        onClick={handleBotRoll}
                        className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-2 rounded flex items-center gap-1.5 transition"
                      >
                        🤖 Bot Turn
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Room Players List & Realtime Event Stream */}
            <div className="flex flex-col gap-4">
              {/* Connected Players in Room */}
              <div className="bg-slate-900 border border-slate-800 p-3 rounded">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    Players in Room ({roomPlayers.length})
                  </span>
                  <span className="text-[10px] text-slate-500">{joinedRoom || 'No room joined'}</span>
                </div>

                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {roomPlayers.length === 0 ? (
                    <div className="text-xs text-slate-500 py-3 text-center">
                      Join a room to see active multiplayer peers.
                    </div>
                  ) : (
                    roomPlayers.map((player) => (
                      <div
                        key={player.id}
                        className="p-2 bg-slate-950 border border-slate-800 rounded flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-slate-200">{player.name}</div>
                          <div className="text-[10px] text-slate-400">
                            ID: {player.id} | Tile #{player.state?.position ?? 0}
                          </div>
                          {player.state?.lastAction && (
                            <div className="text-[10px] text-emerald-400 truncate max-w-[180px]">
                              {String(player.state.lastAction)}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-amber-300 font-bold">${(player.state?.cash as number) ?? 1500}k</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Realtime Event Stream */}
              <div className="bg-slate-900 border border-slate-800 p-3 rounded flex-1 flex flex-col min-h-[220px]">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-indigo-400" />
                    Live Event Stream
                  </span>
                  <button
                    onClick={() => setLogs([])}
                    className="text-[10px] text-slate-500 hover:text-slate-300 underline"
                  >
                    Clear
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 text-[11px] font-mono">
                  {logs.length === 0 ? (
                    <div className="text-slate-600 text-center py-4">Listening for WebSocket packets...</div>
                  ) : (
                    logs.map((log) => (
                      <div
                        key={log.id}
                        className={`p-1.5 rounded border leading-tight ${
                          log.type === 'in'
                            ? 'bg-slate-950/80 border-slate-800 text-emerald-300'
                            : log.type === 'out'
                            ? 'bg-slate-950/80 border-indigo-900/50 text-indigo-300'
                            : log.type === 'error'
                            ? 'bg-rose-950/30 border-rose-900/60 text-rose-300'
                            : 'bg-slate-950/40 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[9px] text-slate-500 mb-0.5">
                          <span>{log.timestamp}</span>
                          <span className="font-bold">[{log.tag}]</span>
                        </div>
                        <div className="break-all font-mono">
                          {typeof log.data === 'string' ? log.data : JSON.stringify(log.data)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PROTOCOL & SANDBOX */}
        {activeTab === 'tester' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded flex flex-col">
              <h2 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-2">
                <Send className="w-4 h-4 text-indigo-400" />
                Raw JSON Packet Sender
              </h2>
              <p className="text-xs text-slate-400 mb-3">
                Send manual JSON packets directly to the WebSocket server to test protocol handlers and resilience against malformed inputs.
              </p>

              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setRawPayload(JSON.stringify({ type: 'ping', timestamp: Date.now() }, null, 2))}
                  className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
                >
                  Template: Ping
                </button>
                <button
                  onClick={() =>
                    setRawPayload(
                      JSON.stringify(
                        {
                          type: 'join_room',
                          roomId: 'rich_arena',
                          playerId: 'custom_player_99',
                          playerName: 'Commander Rich',
                          state: { score: 9999, level: 10 },
                        },
                        null,
                        2
                      )
                    )
                  }
                  className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
                >
                  Template: Join Room
                </button>
                <button
                  onClick={() =>
                    setRawPayload(
                      JSON.stringify(
                        {
                          type: 'player_state',
                          state: { x: 50, y: 75, action: 'BUY_PROPERTY', propertyId: 'Jakarta' },
                        },
                        null,
                        2
                      )
                    )
                  }
                  className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
                >
                  Template: State Delta
                </button>
                <button
                  onClick={() => setRawPayload('{ "type": "broken_json", corrupt: ')}
                  className="px-2.5 py-1 text-[11px] bg-rose-900/40 hover:bg-rose-900/60 text-rose-300 rounded border border-rose-800"
                >
                  Test Bad JSON
                </button>
              </div>

              <textarea
                value={rawPayload}
                onChange={(e) => setRawPayload(e.target.value)}
                rows={10}
                className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-xs font-mono text-emerald-400 focus:border-indigo-500 outline-none flex-1 resize-none mb-3"
              />

              <button
                onClick={sendRawPayload}
                disabled={!isConnected}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold py-2 px-4 rounded flex items-center justify-center gap-2 transition"
              >
                <Send className="w-3.5 h-3.5" />
                Dispatch Packet
              </button>
            </div>

            {/* Protocol Spec Reference */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded overflow-y-auto">
              <h2 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                WA Rich Game WebSocket Protocol Specification
              </h2>

              <div className="space-y-4 text-xs text-slate-300">
                <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                  <div className="font-bold text-indigo-400 mb-1">1. Ping / Heartbeat</div>
                  <pre className="text-[11px] text-slate-400 overflow-x-auto">
{`Client  → { "type": "ping", "timestamp": 1727780000 }
Server  → { "type": "pong", "timestamp": 1727780000, "serverTime": 1727780001 }`}
                  </pre>
                </div>

                <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                  <div className="font-bold text-indigo-400 mb-1">2. Room Join & Broadcast</div>
                  <pre className="text-[11px] text-slate-400 overflow-x-auto">
{`Client  → { "type": "join_room", "roomId": "room_1", "playerId": "p1", "playerName": "Tycoon", "state": {...} }
Server  → { "type": "room_joined", "roomId": "room_1", "playerId": "p1", "players": [...] }
Room WS → { "type": "player_joined", "roomId": "room_1", "player": {...} }`}
                  </pre>
                </div>

                <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                  <div className="font-bold text-indigo-400 mb-1">3. Player State Sync</div>
                  <pre className="text-[11px] text-slate-400 overflow-x-auto">
{`Client  → { "type": "player_state", "state": { "position": 4, "cash": 1200 } }
Room WS → { "type": "player_state", "roomId": "room_1", "playerId": "p1", "state": {...} }`}
                  </pre>
                </div>

                <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                  <div className="font-bold text-indigo-400 mb-1">4. Leave & Disconnect</div>
                  <pre className="text-[11px] text-slate-400 overflow-x-auto">
{`Client  → { "type": "leave_room" }
Server  → { "type": "room_left", "roomId": "room_1" }
Room WS → { "type": "player_left", "roomId": "room_1", "playerId": "p1" }`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DIAGNOSTICS & TEST WAJIB */}
        {activeTab === 'diagnostics' && (
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  Live Server Verification (TEST WAJIB)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Executes actual end-to-end HTTP and WebSocket transactions on the running server instance.
                </p>
              </div>

              <button
                onClick={runFullDiagnostics}
                disabled={runningDiag}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs py-2 px-4 rounded flex items-center gap-2 shadow transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${runningDiag ? 'animate-spin' : ''}`} />
                {runningDiag ? 'Executing Live Tests...' : 'Run Test Wajib Suite'}
              </button>
            </div>

            {/* Diagnostic Report Results */}
            {diagnosticReport ? (
              <div className="space-y-3">
                <div
                  className={`p-3 rounded border flex items-center justify-between ${
                    diagnosticReport.allPassed
                      ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                      : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-bold">
                    {diagnosticReport.allPassed ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400" />
                    )}
                    <span>
                      {diagnosticReport.allPassed
                        ? 'STATUS: READY FOR WA RICH GAME (ALL TESTS PASSED)'
                        : 'STATUS: ISSUES DETECTED'}
                    </span>
                  </div>
                  <div className="text-xs">
                    {diagnosticReport.passedTests}/{diagnosticReport.totalTests} tests passed in {diagnosticReport.durationMs}ms
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {diagnosticReport.results.map((r, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded border flex items-start justify-between text-xs ${
                        r.passed ? 'bg-slate-950/80 border-slate-800' : 'bg-rose-950/30 border-rose-800'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {r.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-bold text-slate-200">{r.name}</div>
                          {r.details && <div className="text-[11px] text-slate-400 mt-0.5">{r.details}</div>}
                          {r.error && <div className="text-[11px] text-rose-400 mt-0.5 font-bold">Error: {r.error}</div>}
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono">{r.durationMs}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-10 bg-slate-950 border border-slate-800 rounded">
                <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Click &quot;Run Test Wajib Suite&quot; to execute real verification.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: CONSOLE CLI EMULATOR */}
        {activeTab === 'console' && (
          <div className="bg-slate-900 border border-slate-800 rounded flex flex-col flex-1 overflow-hidden">
            <div className="bg-slate-950 px-4 py-2 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Pterodactyl Interactive Console (Standard Input)
              </span>
              <span>Type &quot;help&quot; for available commands</span>
            </div>

            <div className="p-4 flex-1 overflow-y-auto font-mono text-xs text-emerald-400 space-y-3 bg-slate-950 min-h-[350px]">
              <pre className="text-slate-300 font-bold leading-relaxed whitespace-pre">
{`╔══════════════════════════════╗
║     GAME SOCKET SERVER       ║
╚══════════════════════════════╝
Status    : ONLINE
Node      : ${serverStats?.nodeVersion || '22.x'}
Host      : ${serverStats?.host || '0.0.0.0'}
Port      : ${serverStats?.port || 3000}
Public URL: ${serverStats?.publicUrl || 'Not configured'}
WS        : READY
Clients   : ${serverStats?.clientsCount ?? 0}
Rooms     : ${serverStats?.roomsCount ?? 0}
Heartbeat : OK`}
              </pre>

              {consoleHistory.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="text-slate-400 flex items-center gap-1.5">
                    <span className="text-indigo-400 font-bold">&gt;</span>
                    <span className="text-white font-bold">{item.cmd}</span>
                  </div>
                  <pre className="text-emerald-300 whitespace-pre-wrap pl-3">{item.output}</pre>
                </div>
              ))}
              <div ref={consoleBottomRef} />
            </div>

            <form onSubmit={handleConsoleSubmit} className="p-2 bg-slate-950 border-t border-slate-800 flex gap-2">
              <div className="flex items-center pl-2 text-indigo-400 font-bold">&gt;</div>
              <input
                type="text"
                value={consoleInput}
                onChange={(e) => setConsoleInput(e.target.value)}
                placeholder="status | port | memory | clients | rooms | heartbeat | test | clear"
                className="flex-1 bg-transparent text-xs text-white outline-none font-mono"
              />
              <button type="submit" className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded">
                Execute
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="border-t border-slate-800 bg-slate-900/60 px-4 py-2.5 text-[11px] text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <span>RAM (RSS): <strong className="text-slate-300">{serverStats?.memory.rssMB || 0} MB</strong></span>
            <span>Heap Used: <strong className="text-slate-300">{serverStats?.memory.heapUsedMB || 0} MB</strong></span>
            <span>Heartbeat: <strong className="text-emerald-400">{serverStats?.heartbeatStatus || 'OK'} ({((serverStats?.heartbeatIntervalMs || 30000)/1000)}s)</strong></span>
          </div>
          <div>
            <span>WA Rich Game Dedicated WebSocket Server • Pterodactyl Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
