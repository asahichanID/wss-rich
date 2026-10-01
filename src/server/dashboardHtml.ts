/**
 * Embedded Standalone Production Dashboard for WA Rich Game Socket Server
 * Serves directly to browser when visiting http://medium.lynzz.id:2252
 * 100% self-contained: zero external CDNs, zero npm build dependency, works offline & mobile.
 */

export function getDashboardHtml(actualPort: number, host: string, nodeVersion: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>WA Rich Game Socket Server • medium.lynzz.id:2252</title>
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
      <button class="tab-btn active" onclick="switchTab('guide')">📖 Panduan Bot WA</button>
      <button class="tab-btn" onclick="switchTab('board')">🎲 Live Game Board</button>
      <button class="tab-btn" onclick="switchTab('metrics')">📊 Metrik Server</button>
      <button class="tab-btn" onclick="switchTab('sandbox')">⚡ Socket Tester</button>
    </div>

    <!-- TAB 1: PANDUAN INTEGRASI BOT WA -->
    <div id="tab-guide" class="tab-content active">
      <div class="card" style="border-left: 4px solid var(--emerald);">
        <div style="font-size: 14px; font-weight: bold; color: #fff;">
          🚀 Cara Menyambungkan Bot WhatsApp ke Server Ini (WA Rich Game)
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
          text: \`🎮 *WA RICH GAME*\n\n@\${msg.player.id.split('@')[0]} telah bergabung ke meja permainan!\`,
          mentions: [msg.player.id]
        });
      } else if (msg.type === 'player_state') {
        if (msg.state?.lastAction) {
          await conn.sendMessage(msg.roomId, {
            text: \`🎲 *UPDATE PERMAINAN*\n\n\${msg.state.lastAction}\nPosisi Petak: #\${msg.state.position || 0}\nSisa Saldo: $\${msg.state.cash || 0}k\`
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
    return m.reply(\`⏳ Memasukkan \${senderName} ke meja permainan...\`);
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
          <button class="btn" style="background: #4338ca;" onclick="rollDiceGame()">🎲 Lempar Dadu</button>
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
      { id: 0, name: 'START', cost: '+200k', icon: '🚩' },
      { id: 1, name: 'Jakarta', cost: '$150k', icon: '🏙️' },
      { id: 2, name: 'Chest', cost: 'Acak', icon: '🎁' },
      { id: 3, name: 'Surabaya', cost: '$180k', icon: '🌆' },
      { id: 4, name: 'Pajak', cost: '-$100k', icon: '💸' },
      { id: 5, name: 'Bandung', cost: '$200k', icon: '🏰' },
      { id: 6, name: 'Bandara', cost: 'Fly', icon: '✈️' },
      { id: 7, name: 'Bali', cost: '$280k', icon: '🏝️' },
      { id: 8, name: 'Kasino', cost: '50/50', icon: '🎰' },
      { id: 9, name: 'Medan', cost: '$220k', icon: '🕌' },
      { id: 10, name: 'PLN Pusat', cost: '$210k', icon: '⚡' },
      { id: 11, name: 'Makassar', cost: '$300k', icon: '⛵' }
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
              document.getElementById('last-action-text').innerText = '✅ Berhasil masuk room: ' + data.roomId;
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
                document.getElementById('last-action-text').innerText = '🎲 ' + data.state.lastAction;
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
      document.getElementById('last-action-text').innerText = '🎲 ' + action;

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
      document.getElementById('last-action-text').innerText = '🚪 Telah keluar dari room.';
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
        html += (report.allPassed ? '✓ SEMUA 8 TES BERHASIL' : '✗ BEBERAPA TES GAGAL') + ' (' + report.durationMs + 'ms)</div>';
        html += '<div style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px;">';
        report.results.forEach(r => {
          html += '<div>' + (r.passed ? '✓ ' : '✗ ') + r.name + ' (' + r.durationMs + 'ms)</div>';
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
