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
  BookOpen,
  Copy,
  Check,
  ExternalLink,
  MessageSquare,
  Sparkles,
  Bot,
  Globe,
  Lock,
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
  { id: 0, name: 'START', type: 'start', cost: 0, color: 'bg-emerald-600', icon: '🚩', reward: '+200k' },
  { id: 1, name: 'Jakarta', type: 'property', cost: 150, color: 'bg-blue-600', icon: '🏙️', rent: '50k' },
  { id: 2, name: 'Chest', type: 'chance', cost: 0, color: 'bg-amber-600', icon: '🎁', reward: 'Acak' },
  { id: 3, name: 'Surabaya', type: 'property', cost: 180, color: 'bg-blue-600', icon: '🌆', rent: '60k' },
  { id: 4, name: 'Kantor Pajak', type: 'tax', cost: 100, color: 'bg-rose-600', icon: '💸', reward: '-100k' },
  { id: 5, name: 'Bandung', type: 'property', cost: 200, color: 'bg-blue-500', icon: '🏰', rent: '70k' },
  { id: 6, name: 'Bandara', type: 'travel', cost: 120, color: 'bg-sky-600', icon: '✈️', reward: 'Fly' },
  { id: 7, name: 'Bali', type: 'property', cost: 280, color: 'bg-indigo-600', icon: '🏝️', rent: '90k' },
  { id: 8, name: 'Kasino', type: 'casino', cost: 0, color: 'bg-purple-600', icon: '🎰', reward: '50/50' },
  { id: 9, name: 'Medan', type: 'property', cost: 220, color: 'bg-indigo-600', icon: '🕌', rent: '75k' },
  { id: 10, name: 'PLN Pusat', type: 'utility', cost: 210, color: 'bg-yellow-600', icon: '⚡', rent: '65k' },
  { id: 11, name: 'Makassar', type: 'property', cost: 300, color: 'bg-cyan-600', icon: '⛵', rent: '100k' },
];

const PLAYER_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

export default function App() {
  const [activeTab, setActiveTab] = useState<'board' | 'guide' | 'tester' | 'diagnostics' | 'console'>('board');
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Connection Targets
  const [serverTarget, setServerTarget] = useState<'local' | 'production'>('local');
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // WebSocket Client State
  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState<string>('');
  const [latency, setLatency] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Game Room State
  const [roomId, setRoomId] = useState('rich_grup_wa_1');
  const [playerId, setPlayerId] = useState(() => 'wa_' + Math.floor(1000 + Math.random() * 9000));
  const [playerName, setPlayerName] = useState(() => 'Juragan_' + Math.floor(10 + Math.random() * 90));
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<PlayerInRoom[]>([]);
  const [myPosition, setMyPosition] = useState(0);
  const [myCash, setMyCash] = useState(1500);

  // Bot Simulator
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

  // Code Guide selection
  const [guideFramework, setGuideFramework] = useState<'baileys' | 'wweb' | 'protocol'>('baileys');

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
      // server starting up
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const timer = setInterval(fetchStats, 3000);
    return () => clearInterval(timer);
  }, [fetchStats]);

  // Connect WebSocket
  const connectWs = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl =
      serverTarget === 'production'
        ? 'ws://medium.lynzz.id:2252'
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

    addLog('system', 'CONNECTING', `Connecting to ${wsUrl}`);

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        addLog('system', 'OPEN', `Connected to ${wsUrl}`);

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

      socket.onerror = () => {
        addLog('error', 'WS_ERROR', 'WebSocket connection error.');
      };
    } catch (err: unknown) {
      addLog('error', 'INIT_FAILED', err instanceof Error ? err.message : String(err));
    }
  }, [addLog, serverTarget]);

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
      addLog('error', 'NOT_CONNECTED', 'Socket is not open.');
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
        lastAction: 'Bergabung ke meja',
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

  // Roll Dice & Move
  const handleRollDice = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !joinedRoom) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    const nextPos = (myPosition + roll) % BOARD_TILES.length;
    const tile = BOARD_TILES[nextPos];
    let cashChange = 0;

    if (tile.type === 'start') cashChange = 200;
    else if (tile.type === 'chance') cashChange = Math.random() > 0.5 ? 100 : -50;
    else if (tile.type === 'tax') cashChange = -100;
    else if (tile.type === 'casino') cashChange = Math.random() > 0.6 ? 250 : -100;
    else if (tile.type === 'property') cashChange = -30;

    const newCash = Math.max(0, myCash + cashChange);
    setMyPosition(nextPos);
    setMyCash(newCash);

    const actionText = `Dadu: [${roll}] → Mendarat di ${tile.name} ${tile.icon} (${cashChange >= 0 ? '+' : ''}${cashChange}k)`;

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

  // Bot Simulator
  const toggleBot = () => {
    if (botConnected) {
      if (botWsRef.current) {
        botWsRef.current.close();
        botWsRef.current = null;
      }
      setBotConnected(false);
      addLog('system', 'BOT_DISCONNECT', 'Bot Saingan disconnected.');
    } else {
      const wsUrl =
        serverTarget === 'production'
          ? 'ws://medium.lynzz.id:2252'
          : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

      const botSocket = new WebSocket(wsUrl);
      botWsRef.current = botSocket;

      botSocket.onopen = () => {
        setBotConnected(true);
        addLog('system', 'BOT_CONNECT', 'Bot Saingan masuk ke arena...');
        botSocket.send(
          JSON.stringify({
            type: 'join_room',
            roomId,
            playerId: 'bot_rival_sultan',
            playerName: '🤖 Bot Sultan 62',
            state: {
              position: 0,
              cash: 1500,
              color: PLAYER_COLORS[1],
              lastAction: 'Bot sultan memasuki arena',
            },
          })
        );
      };

      botSocket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'player_state' && msg.playerId === 'bot_rival_sultan') {
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
    const newCash = botCash + (tile.type === 'start' ? 200 : -25);
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
          lastAction: `🤖 Bot Dadu [${roll}] → ${tile.name}`,
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
      addLog('error', 'SOCKET_CLOSED', 'WebSocket is closed.');
      return;
    }
    try {
      const parsed = JSON.parse(rawPayload);
      wsRef.current.send(JSON.stringify(parsed));
      addLog('out', parsed.type ? parsed.type.toUpperCase() : 'CUSTOM', parsed);
    } catch {
      wsRef.current.send(rawPayload);
      addLog('out', 'RAW_MALFORMED', { raw: rawPayload });
    }
  };

  // Copy Helper
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(id);
    setTimeout(() => setCopiedLink(null), 2000);
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
      output = `Perintah Console Pterodactyl:
  status           : Cek kondisi server aktual
  port             : Info Host, Port (${serverStats?.port || 2252}), Source
  clients          : Daftar client terhubung
  rooms            : Daftar room multiplayer
  room info <id>   : Detail pemain di room tertentu
  heartbeat        : Status ping/pong 30s
  memory           : RAM Node.js (RSS, Heap)
  uptime           : Waktu aktif server
  test             : Menjalankan 8 pengujian nyata
  test health      : Tes HTTP /health
  clear            : Bersihkan layar console`;
    } else if (lower === 'status') {
      await fetchStats();
      output = `Status: ONLINE | Node: ${serverStats?.nodeVersion || '22.x'} | Host: ${serverStats?.host}:${serverStats?.port} | Public URL: ${serverStats?.publicUrl || 'medium.lynzz.id:2252'} | Clients: ${serverStats?.clientsCount} | Rooms: ${serverStats?.roomsCount} | RAM RSS: ${serverStats?.memory.rssMB}MB`;
    } else if (lower === 'port') {
      output = `Host  : 0.0.0.0\nPort  : ${serverStats?.port || 2252}\nSource: ${serverStats?.portSource || 'process.env.SERVER_PORT'}`;
    } else if (lower === 'memory') {
      output = `Penggunaan RAM:\n  RSS: ${serverStats?.memory.rssMB} MB\n  Heap Terpakai: ${serverStats?.memory.heapUsedMB} MB\n  Total Heap: ${serverStats?.memory.heapTotalMB} MB\n  External: ${serverStats?.memory.externalMB} MB`;
    } else if (lower === 'uptime') {
      output = `Server Uptime: ${serverStats?.uptimeSeconds || 0} detik`;
    } else if (lower === 'heartbeat') {
      output = `Interval Heartbeat: ${serverStats?.heartbeatIntervalMs || 30000}ms | Status: AKTIF (OK)`;
    } else if (lower.startsWith('test')) {
      output = 'Menjalankan diagnostik otomatis pada server...';
      runFullDiagnostics();
    } else {
      output = `Perintah diterima. Ketik "help" untuk daftar perintah lengkap.`;
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
                <span className="font-bold text-white tracking-wide text-sm sm:text-base">WA RICH GAME SOCKET SERVER</span>
                <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 rounded">
                  ONLINE
                </span>
                <span className="px-1.5 py-0.5 text-xs font-semibold bg-blue-500/20 text-blue-300 rounded">
                  Node 22
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Host: <span className="text-slate-200">0.0.0.0</span> &bull; Port: <span className="text-amber-300 font-bold">2252</span> &bull; Target Public: <strong className="text-sky-300 font-bold">medium.lynzz.id:2252</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs flex-wrap">
            {/* Quick Copy Link Box */}
            <div className="flex items-center bg-slate-800/90 border border-slate-700 rounded px-2.5 py-1 gap-2">
              <span className="text-slate-400">WS URL:</span>
              <code className="text-amber-300 font-bold text-[11px]">ws://medium.lynzz.id:2252</code>
              <button
                onClick={() => copyToClipboard('ws://medium.lynzz.id:2252', 'ws')}
                className="text-slate-400 hover:text-white transition"
                title="Copy WS URL"
              >
                {copiedLink === 'ws' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Socket Status indicator */}
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
        <div className="max-w-7xl mx-auto flex flex-wrap gap-1 sm:gap-2">
          <button
            onClick={() => setActiveTab('board')}
            className={`px-3 sm:px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'board'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/50'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Dice5 className="w-4 h-4" />
            Live Game Board
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`px-3 sm:px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'guide'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/50'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-white">Tata Cara Sambung Bot WA</span>
            <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 text-[10px] rounded">PENTING</span>
          </button>
          <button
            onClick={() => setActiveTab('tester')}
            className={`px-3 sm:px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'tester'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/50'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-4 h-4" />
            Sandbox & Raw JSON
          </button>
          <button
            onClick={() => setActiveTab('diagnostics')}
            className={`px-3 sm:px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'diagnostics'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/50'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Test Wajib (Diagnostic)
          </button>
          <button
            onClick={() => setActiveTab('console')}
            className={`px-3 sm:px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
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

        {/* TAB: TATA CARA SAMBUNG KE FITUR GAME RICH WA */}
        {activeTab === 'guide' && (
          <div className="flex flex-col gap-4">
            {/* Guide Header Banner */}
            <div className="bg-gradient-to-r from-emerald-950/70 via-slate-900 to-indigo-950/70 border border-emerald-500/30 p-4 rounded">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-emerald-400" />
                    Panduan Lengkap Menghubungkan WebSocket ke Bot WhatsApp (WA Rich Game)
                  </h2>
                  <p className="text-xs text-slate-300 mt-1">
                    Socket Server ini bertindak sebagai <strong>Authoritative Realtime Engine</strong> (mengatur room, giliran lempar dadu, saldo uang, dan kepemilikan aset) agar bot WA tinggal mengirim aksi dan menerima siaran event ke grup.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="http://medium.lynzz.id:2252/health"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1.5 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                    Tes Health Server
                  </a>
                </div>
              </div>
            </div>

            {/* Connection Info Box */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-slate-900 border border-slate-800 p-3 rounded">
                <span className="text-[10px] text-slate-400 block uppercase font-bold">1. Alamat WebSocket Server</span>
                <div className="flex items-center justify-between mt-1">
                  <code className="text-sm font-bold text-amber-300">ws://medium.lynzz.id:2252</code>
                  <button
                    onClick={() => copyToClipboard('ws://medium.lynzz.id:2252', 'g1')}
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                  >
                    {copiedLink === 'g1' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Gunakan URL ini di dalam constructor <code>new WebSocket(...)</code> pada bot Anda.</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-3 rounded">
                <span className="text-[10px] text-slate-400 block uppercase font-bold">2. Alamat HTTP Check / API</span>
                <div className="flex items-center justify-between mt-1">
                  <code className="text-sm font-bold text-sky-300">http://medium.lynzz.id:2252/health</code>
                  <button
                    onClick={() => copyToClipboard('http://medium.lynzz.id:2252/health', 'g2')}
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                  >
                    {copiedLink === 'g2' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Untuk pemantauan status online server secara berkala.</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-3 rounded">
                <span className="text-[10px] text-slate-400 block uppercase font-bold">3. Konsep Ruang Game (Room)</span>
                <div className="text-xs text-white font-bold mt-1">1 Grup WA = 1 Room ID</div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Gunakan JID grup WA (contoh: <code>120363xxx@g.us</code>) sebagai <code>roomId</code> agar pemain di grup tersebut terisolasi dalam room yang sama.
                </p>
              </div>
            </div>

            {/* Framework Switcher & Ready-to-copy code */}
            <div className="bg-slate-900 border border-slate-800 rounded overflow-hidden">
              <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Pilih Template Integrasi Script Bot:</span>
                </div>

                <div className="flex gap-1.5">
                  <button
                    onClick={() => setGuideFramework('baileys')}
                    className={`px-3 py-1 rounded text-xs font-bold transition ${
                      guideFramework === 'baileys'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Baileys (@whiskeysockets/baileys)
                  </button>
                  <button
                    onClick={() => setGuideFramework('wweb')}
                    className={`px-3 py-1 rounded text-xs font-bold transition ${
                      guideFramework === 'wweb'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    WhatsApp-Web.js
                  </button>
                  <button
                    onClick={() => setGuideFramework('protocol')}
                    className={`px-3 py-1 rounded text-xs font-bold transition ${
                      guideFramework === 'protocol'
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Protokol JSON (Spesifikasi)
                  </button>
                </div>
              </div>

              {/* Code Content */}
              <div className="p-4 bg-slate-950 font-mono text-xs overflow-x-auto relative">
                {guideFramework === 'baileys' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-slate-400">
                        File: <code>plugins/rich-game.js</code> atau <code>handler.js</code> pada bot Baileys
                      </span>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `import WebSocket from 'ws';

// 1. Inisialisasi Koneksi ke Server WebSocket WA Rich Game
const WS_URL = 'ws://medium.lynzz.id:2252';
let socket = null;

function connectSocket() {
  socket = new WebSocket(WS_URL);

  socket.on('open', () => {
    console.log('[RICH-GAME] Terhubung ke WebSocket server medium.lynzz.id:2252');
    // Heartbeat berkala agar koneksi tidak terputus
    setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 25000);
  });

  socket.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleServerEvent(msg);
    } catch (e) {
      console.error('[RICH-GAME] Error parsing data:', e);
    }
  });

  socket.on('close', () => {
    console.log('[RICH-GAME] Terputus. Reconnecting dalam 3 detik...');
    setTimeout(connectSocket, 3000);
  });
}

connectSocket();

// 2. Handler Event Siaran dari Server ke Grup WA
function handleServerEvent(msg) {
  // msg.roomId adalah JID grup WA (contoh: 120363xxx@g.us)
  if (!msg.roomId) return;

  switch (msg.type) {
    case 'player_joined':
      // Kirim pesan ke grup bahwa ada yang bergabung
      // conn.sendMessage(msg.roomId, { text: \`🎮 @\${msg.player.id.split('@')[0]} bergabung ke permainan!\`, mentions: [msg.player.id] });
      break;

    case 'player_state':
      // Kirim update giliran atau perpindahan petak ke grup
      // conn.sendMessage(msg.roomId, { text: \`🎲 \${msg.state.lastAction}\` });
      break;

    case 'player_left':
      // conn.sendMessage(msg.roomId, { text: \`🚪 Pemain \${msg.playerId} telah keluar dari meja.\` });
      break;
  }
}

// 3. Command Handler yang dipanggil saat user mengetik di chat WA
export async function handleRichCommand(conn, m) {
  const text = m.text || '';
  const senderId = m.sender; // Nomor pengirim
  const senderName = m.pushName || 'Pemain';
  const groupId = m.chat; // JID Grup WA

  // Command: /rich join
  if (text.startsWith('/rich join') || text.startsWith('.rich join')) {
    socket.send(JSON.stringify({
      type: 'join_room',
      roomId: groupId,
      playerId: senderId,
      playerName: senderName,
      state: { cash: 1500, position: 0 }
    }));
    return m.reply(\`✅ Permintaan join room dikirim untuk \${senderName}!\`);
  }

  // Command: /rich roll
  if (text.startsWith('/rich roll') || text.startsWith('.rich roll')) {
    const dice = Math.floor(Math.random() * 6) + 1;
    socket.send(JSON.stringify({
      type: 'player_state',
      roomId: groupId,
      state: {
        roll: dice,
        lastAction: \`@\${senderId.split('@')[0]} melempar dadu: [\${dice}]\`
      }
    }));
    return;
  }

  // Command: /rich leave
  if (text.startsWith('/rich leave')) {
    socket.send(JSON.stringify({
      type: 'leave_room',
      roomId: groupId
    }));
    return m.reply('🚪 Anda keluar dari room.');
  }
}`,
                            'c_baileys'
                          )
                        }
                        className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1.5 transition"
                      >
                        {copiedLink === 'c_baileys' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        Salin Kode Baileys
                      </button>
                    </div>

                    <pre className="text-emerald-400 text-[11px] leading-relaxed overflow-x-auto p-3 bg-slate-900 border border-slate-800 rounded">
{`import WebSocket from 'ws';

// 1. Hubungkan ke WebSocket Server Pterodactyl Anda
const WS_URL = 'ws://medium.lynzz.id:2252';
let socket = null;

function connectSocket() {
  socket = new WebSocket(WS_URL);

  socket.on('open', () => {
    console.log('[RICH-GAME] Terhubung ke WebSocket server medium.lynzz.id:2252');
    // Heartbeat otomatis 25 detik
    setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 25000);
  });

  socket.on('message', async (data) => {
    const msg = JSON.parse(data.toString());
    handleServerEvent(msg);
  });

  socket.on('close', () => {
    console.log('[RICH-GAME] Terputus. Reconnecting dalam 3 detik...');
    setTimeout(connectSocket, 3000);
  });
}

connectSocket();

// 2. Tangani Event dari Server (Siarkan ke Grup WA)
function handleServerEvent(msg) {
  if (!msg.roomId) return; // msg.roomId adalah JID Grup WA (contoh: 120363xxx@g.us)

  switch (msg.type) {
    case 'player_joined':
      // conn.sendMessage(msg.roomId, { text: \`🎮 @\${msg.player.id.split('@')[0]} masuk ke room!\` });
      break;
    case 'player_state':
      // conn.sendMessage(msg.roomId, { text: \`🎲 \${msg.state.lastAction}\` });
      break;
    case 'player_left':
      // conn.sendMessage(msg.roomId, { text: \`🚪 @\${msg.playerId.split('@')[0]} keluar dari meja.\` });
      break;
  }
}

// 3. Tangani Pesan dari Pengguna di Grup WA
export async function onMessage(conn, m) {
  const text = m.text || '';
  const sender = m.sender;
  const groupJid = m.chat;

  if (text === '.rich join') {
    socket.send(JSON.stringify({
      type: 'join_room',
      roomId: groupJid,
      playerId: sender,
      playerName: m.pushName || 'Pemain',
      state: { cash: 1500, position: 0 }
    }));
  } else if (text === '.rich roll') {
    const roll = Math.floor(Math.random() * 6) + 1;
    socket.send(JSON.stringify({
      type: 'player_state',
      roomId: groupJid,
      state: { roll, lastAction: \`Lempar dadu: [\${roll}]\` }
    }));
  }
}`}
                    </pre>
                  </div>
                )}

                {guideFramework === 'wweb' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-slate-400">
                        File: <code>richGameModule.js</code> untuk WhatsApp-Web.js
                      </span>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `const WebSocket = require('ws');
const WS_URL = 'ws://medium.lynzz.id:2252';

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('Bot terhubung ke server WA Rich Game');
});

ws.on('message', (raw) => {
  const data = JSON.parse(raw.toString());
  console.log('Event dari server game:', data);
});

// Fungsi untuk join game dari bot WA
function joinGame(chatId, senderId, senderName) {
  ws.send(JSON.stringify({
    type: 'join_room',
    roomId: chatId,
    playerId: senderId,
    playerName: senderName,
    state: { cash: 1500, position: 0 }
  }));
}

// Fungsi untuk lempar dadu
function rollDice(chatId, senderId, diceValue) {
  ws.send(JSON.stringify({
    type: 'player_state',
    roomId: chatId,
    state: {
      roll: diceValue,
      lastAction: 'Lemparan dadu: ' + diceValue
    }
  }));
}

module.exports = { joinGame, rollDice };`,
                            'c_wweb'
                          )
                        }
                        className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1.5 transition"
                      >
                        {copiedLink === 'c_wweb' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        Salin Kode WhatsApp-Web.js
                      </button>
                    </div>

                    <pre className="text-indigo-400 text-[11px] leading-relaxed overflow-x-auto p-3 bg-slate-900 border border-slate-800 rounded">
{`const WebSocket = require('ws');
const WS_URL = 'ws://medium.lynzz.id:2252';

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('Bot terhubung ke server WA Rich Game medium.lynzz.id:2252');
});

ws.on('message', (raw) => {
  const data = JSON.parse(raw.toString());
  // Tangani event player_joined, player_state, player_left
});

function joinGame(chatId, senderId, senderName) {
  ws.send(JSON.stringify({
    type: 'join_room',
    roomId: chatId,
    playerId: senderId,
    playerName: senderName,
    state: { cash: 1500, position: 0 }
  }));
}`}
                    </pre>
                  </div>
                )}

                {guideFramework === 'protocol' && (
                  <div className="space-y-3">
                    <div className="text-slate-300 text-xs">
                      Protokol format JSON yang dikirimkan antara Bot WhatsApp dan Server:
                    </div>

                    <div className="p-3 bg-slate-900 border border-slate-800 rounded">
                      <div className="text-amber-400 font-bold mb-1">A. Join / Masuk Room</div>
                      <pre className="text-slate-300 text-[11px] overflow-x-auto">
{`// Bot Kirim ke Server:
{
  "type": "join_room",
  "roomId": "12036323456789@g.us", // JID grup WA
  "playerId": "628123456789@s.whatsapp.net",
  "playerName": "Nama Pemain",
  "state": { "cash": 1500, "position": 0 }
}

// Server Membalas ke Pengirim:
{
  "type": "room_joined",
  "roomId": "12036323456789@g.us",
  "playerId": "628123456789@s.whatsapp.net",
  "players": [...]
}

// Server Menyiarkan ke Seluruh Pemain di Grup:
{
  "type": "player_joined",
  "roomId": "12036323456789@g.us",
  "player": { "id": "...", "name": "...", "state": {...} }
}`}
                      </pre>
                    </div>

                    <div className="p-3 bg-slate-900 border border-slate-800 rounded">
                      <div className="text-amber-400 font-bold mb-1">B. Update State Pemain (Lempar Dadu / Beli Aset)</div>
                      <pre className="text-slate-300 text-[11px] overflow-x-auto">
{`// Bot Kirim ke Server saat aksi terjadi:
{
  "type": "player_state",
  "roomId": "12036323456789@g.us",
  "state": {
    "position": 5,
    "cash": 1300,
    "lastAction": "Membeli petak Bandung (-200k)"
  }
}

// Server Menyiarkan ke Seluruh Pemain di Room:
{
  "type": "player_state",
  "roomId": "12036323456789@g.us",
  "playerId": "628123456789@s.whatsapp.net",
  "state": { "position": 5, "cash": 1300, "lastAction": "..." },
  "timestamp": 1727789000
}`}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step-by-Step Flow Explanation */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-slate-900 border border-slate-800 rounded">
                <div className="font-bold text-emerald-400 mb-1">Langkah 1: Koneksi Bot</div>
                <p className="text-slate-400">
                  Bot WA membuka 1 koneksi socket global ke <code>ws://medium.lynzz.id:2252</code> saat bot baru pertama kali menyala.
                </p>
              </div>

              <div className="p-3 bg-slate-900 border border-slate-800 rounded">
                <div className="font-bold text-indigo-400 mb-1">Langkah 2: Perintah Chat</div>
                <p className="text-slate-400">
                  Member grup mengetik <code>.rich join</code> atau <code>.rich roll</code>. Bot meneruskannya ke server dengan menyertakan JID grup.
                </p>
              </div>

              <div className="p-3 bg-slate-900 border border-slate-800 rounded">
                <div className="font-bold text-amber-400 mb-1">Langkah 3: Sinkronisasi</div>
                <p className="text-slate-400">
                  Server memproses state dan membroadcast event ke semua client dalam room tanpa delay dan tanpa beban ke database.
                </p>
              </div>

              <div className="p-3 bg-slate-900 border border-slate-800 rounded">
                <div className="font-bold text-rose-400 mb-1">Langkah 4: Auto-Cleanup</div>
                <p className="text-slate-400">
                  Bila grup selesai bermain atau pemain keluar, server otomatis menghapus room kosong sehingga memori RAM tetap hemat.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB: LIVE GAME BOARD */}
        {activeTab === 'board' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
            {/* Left: Game Board & Interaction */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              {/* Room Controller Bar */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Room Manager Simulator</span>
                  </div>
                  {joinedRoom && (
                    <span className="text-xs px-2.5 py-0.5 bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 rounded">
                      Room Aktif: <strong className="text-white">{joinedRoom}</strong>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">ROOM ID (JID GRUP)</label>
                    <input
                      type="text"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      disabled={!!joinedRoom}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">PLAYER ID (NOMOR WA)</label>
                    <input
                      type="text"
                      value={playerId}
                      onChange={(e) => setPlayerId(e.target.value)}
                      disabled={!!joinedRoom}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">NAMA PEMAIN</label>
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
                      <span>Papan Monopoli WA Rich Game</span>
                      <span className="text-[10px] font-normal text-slate-400">12 Petak Nusantara &bull; Realtime Sync</span>
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
                      {botConnected ? 'Hentikan Bot Saingan' : 'Munculkan Bot Saingan'}
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
                        className={`border rounded p-2.5 flex flex-col justify-between transition relative overflow-hidden min-h-[95px] ${
                          isMyPosition || isBotPosition
                            ? 'border-indigo-400 bg-slate-800/90 shadow-md ring-1 ring-indigo-500/50'
                            : 'border-slate-800 bg-slate-950/60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-300">
                            {tile.id}. {tile.name}
                          </span>
                          <span className="text-base">{tile.icon}</span>
                        </div>

                        <div className="text-[10px] text-slate-400 mt-1 flex justify-between">
                          <span>{tile.cost ? `$${tile.cost}k` : tile.reward}</span>
                          {tile.rent && <span className="text-amber-400">Sewa: ${tile.rent}</span>}
                        </div>

                        {/* Player Tokens On Tile */}
                        <div className="flex flex-wrap gap-1 mt-2 items-center">
                          {playersHere.map((p, idx) => (
                            <div
                              key={p.id || idx}
                              title={`${p.name} ($${p.state?.cash || 0}k)`}
                              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white bg-indigo-600 flex items-center gap-1 shadow"
                            >
                              <span>{p.name.slice(0, 10)}</span>
                            </div>
                          ))}
                          {isBotPosition && !playersHere.some((p) => p.id === 'bot_rival_sultan') && (
                            <div className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white bg-rose-600 shadow">
                              🤖 Bot Sultan
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
                      <span className="text-slate-400">Saldo Anda:</span>
                      <span className="font-bold text-amber-300 text-sm">${myCash}k</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Posisi:</span>
                      <span className="font-bold text-white">Petak #{myPosition} ({BOARD_TILES[myPosition].name})</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRollDice}
                      disabled={!joinedRoom}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs px-4 py-2 rounded flex items-center gap-2 shadow-lg transition"
                    >
                      <Dice5 className="w-4 h-4" />
                      Lempar Dadu & Broadcast State
                    </button>

                    {botConnected && (
                      <button
                        onClick={handleBotRoll}
                        className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-2 rounded flex items-center gap-1.5 transition"
                      >
                        🤖 Giliran Bot
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
                    Pemain di Meja ({roomPlayers.length})
                  </span>
                  <span className="text-[10px] text-slate-400">{joinedRoom || 'Belum masuk room'}</span>
                </div>

                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {roomPlayers.length === 0 ? (
                    <div className="text-xs text-slate-500 py-3 text-center">
                      Tekan tombol <strong>Join Room</strong> untuk mulai simulasi multiplayer.
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
                            ID: {player.id} &bull; Petak #{player.state?.position ?? 0}
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
                    Hapus
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 text-[11px] font-mono">
                  {logs.length === 0 ? (
                    <div className="text-slate-600 text-center py-4">Mendengarkan paket WebSocket...</div>
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

        {/* TAB: PROTOCOL & SANDBOX */}
        {activeTab === 'tester' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded flex flex-col">
              <h2 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-2">
                <Send className="w-4 h-4 text-indigo-400" />
                Pengirim Paket JSON Manual (Sandbox)
              </h2>
              <p className="text-xs text-slate-400 mb-3">
                Kirimkan payload custom langsung ke socket server untuk menguji respon dan ketahanan server.
              </p>

              <div className="flex flex-wrap gap-2 mb-2">
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
                          roomId: 'rich_grup_wa_1',
                          playerId: '62812345678@s.whatsapp.net',
                          playerName: 'Sultan Medan',
                          state: { cash: 2000, position: 0 },
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
                          state: { position: 7, cash: 1200, lastAction: 'Beli Bali ($280k)' },
                        },
                        null,
                        2
                      )
                    )
                  }
                  className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
                >
                  Template: Player State
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
                Kirim Paket ke Server
              </button>
            </div>

            {/* Protocol Spec Reference */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded overflow-y-auto">
              <h2 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Spesifikasi Event JSON
              </h2>

              <div className="space-y-3 text-xs text-slate-300">
                <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                  <div className="font-bold text-indigo-400 mb-1">1. Ping & Pong</div>
                  <pre className="text-[11px] text-slate-400 overflow-x-auto">
{`Client → { "type": "ping", "timestamp": 1727780000 }
Server → { "type": "pong", "timestamp": 1727780000, "serverTime": 1727780001 }`}
                  </pre>
                </div>

                <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                  <div className="font-bold text-indigo-400 mb-1">2. Room Join & Broadcast</div>
                  <pre className="text-[11px] text-slate-400 overflow-x-auto">
{`Client → { "type": "join_room", "roomId": "grup_1", "playerId": "p1", "playerName": "Tycoon", "state": {...} }
Server → { "type": "room_joined", "roomId": "grup_1", "players": [...] }
Room   → { "type": "player_joined", "roomId": "grup_1", "player": {...} }`}
                  </pre>
                </div>

                <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                  <div className="font-bold text-indigo-400 mb-1">3. Player State Delta</div>
                  <pre className="text-[11px] text-slate-400 overflow-x-auto">
{`Client → { "type": "player_state", "state": { "position": 4, "cash": 1200 } }
Room   → { "type": "player_state", "roomId": "grup_1", "playerId": "p1", "state": {...} }`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: DIAGNOSTICS & TEST WAJIB */}
        {activeTab === 'diagnostics' && (
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  Verifikasi Server (TEST WAJIB)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Menjalankan seluruh transaksi HTTP & WebSocket nyata pada server yang sedang aktif.
                </p>
              </div>

              <button
                onClick={runFullDiagnostics}
                disabled={runningDiag}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs py-2 px-4 rounded flex items-center gap-2 shadow transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${runningDiag ? 'animate-spin' : ''}`} />
                {runningDiag ? 'Menjalankan Tes Nyata...' : 'Jalankan Test Wajib'}
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
                        ? 'STATUS: READY FOR WA RICH GAME (SEMUA TES BERHASIL)'
                        : 'STATUS: BEBERAPA TES GAGAL'}
                    </span>
                  </div>
                  <div className="text-xs">
                    {diagnosticReport.passedTests}/{diagnosticReport.totalTests} tes lulus dalam {diagnosticReport.durationMs}ms
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
                <p className="text-xs text-slate-400">Tekan tombol &quot;Jalankan Test Wajib&quot; untuk menjalankan 8 verifikasi otomatis.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB: CONSOLE CLI EMULATOR */}
        {activeTab === 'console' && (
          <div className="bg-slate-900 border border-slate-800 rounded flex flex-col flex-1 overflow-hidden">
            <div className="bg-slate-950 px-4 py-2 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Pterodactyl Interactive Console (Standard Input)
              </span>
              <span>Ketik &quot;help&quot; untuk daftar perintah</span>
            </div>

            <div className="p-4 flex-1 overflow-y-auto font-mono text-xs text-emerald-400 space-y-3 bg-slate-950 min-h-[350px]">
              <pre className="text-slate-300 font-bold leading-relaxed whitespace-pre">
{`╔══════════════════════════════╗
║     GAME SOCKET SERVER       ║
╚══════════════════════════════╝
Status    : ONLINE
Node      : ${serverStats?.nodeVersion || '22.x'}
Host      : 0.0.0.0
Port      : ${serverStats?.port || 2252}
Public URL: ${serverStats?.publicUrl || 'medium.lynzz.id:2252'}
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
                Kirim
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
            <span>Heap: <strong className="text-slate-300">{serverStats?.memory.heapUsedMB || 0} MB</strong></span>
            <span>Heartbeat: <strong className="text-emerald-400">{serverStats?.heartbeatStatus || 'OK'} (30s)</strong></span>
            <span>Target: <strong className="text-amber-300">medium.lynzz.id:2252</strong></span>
          </div>
          <div>
            <span>WA Rich Game Dedicated WebSocket Server &bull; Pterodactyl Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
