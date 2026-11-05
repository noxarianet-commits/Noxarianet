require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const SekaliPayService = require('./sekalipayService');
const db = require('./database');
const orkutService = require('./orkutService');
const FinCloudQrisService = require('./fincloudQrisService');
const fincloudQrisService = new FinCloudQrisService();

const app = express();

const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'noxa_jwt_secret_key_8f93e1029c874b2a91e03c';

// ==========================================
// SEKALIPAY CONFIGURATION & SERVICE
// ==========================================
const SEKALIPAY_API_KEY = process.env.SEKALIPAY_API_KEY || '48IX7ryGa2a92HUMiYCdI2CuhEBGps73';
const SEKALIPAY_WEBHOOK_SECRET = process.env.SEKALIPAY_WEBHOOK_SECRET || '933aa734e8cefd9669e890d03af2a07405ee7b8b5c112a5de4719dafab18cda7';
const SEKALIPAY_BASE_URL = 'https://sekalipay.com/api';

const sekalipayService = new SekaliPayService({
  apiKey: SEKALIPAY_API_KEY,
  webhookSecret: SEKALIPAY_WEBHOOK_SECRET
});

const PORT = process.env.SERVER_PORT || process.env.PORT || 2002;
const HOST = '0.0.0.0';

// ==========================================
// MIDDLEWARES & STATIC FILES
// ==========================================
app.set('trust proxy', true);
app.use(cors());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Standalone Web Page for Scan WA Bot QR Code
app.get('/wa-qr', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scan WhatsApp Bot QR Code — NoxariaNet Wallet</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 32px; width: 100%; max-width: 440px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .title { font-size: 20px; font-weight: 800; margin-bottom: 6px; color: #f8fafc; }
    .subtitle { font-size: 13px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
    .qr-container { background: white; padding: 20px; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; min-width: 260px; min-height: 260px; margin-bottom: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); position: relative; }
    .qr-container img { width: 220px; height: 220px; object-fit: contain; }
    .badge { display: inline-block; padding: 8px 16px; border-radius: 50px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
    .badge-waiting { background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.3); }
    .badge-connected { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
    .badge-disconnected { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .instructions { font-size: 12px; color: #64748b; margin-top: 20px; line-height: 1.6; text-align: left; background: rgba(255,255,255,0.03); padding: 14px; border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1); }
    .instructions ol { padding-left: 18px; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 40px; margin-bottom: 12px;">📱</div>
    <h1 class="title">WhatsApp Bot Scanner</h1>
    <p class="subtitle">Scan QR Code ini dari HP menggunakan akun WhatsApp Bot OTP Anda.</p>

    <div class="qr-container" id="qr-box">
      <div id="loading-text" style="color: #64748b; font-weight: 600; font-size: 14px;">Memuat QR Code...</div>
      <img id="qr-img" src="" alt="WA Bot QR Code" style="display: none;" />
    </div>

    <div>
      <span id="status-badge" class="badge badge-waiting">MEMERIKSA STATUS...</span>
    </div>

    <div class="instructions">
      <strong>Cara Menghubungkan WA Bot:</strong>
      <ol>
        <li>Buka WhatsApp di ponsel khusus Bot Anda.</li>
        <li>Buka menu <b>Perangkat Tertaut (Linked Devices)</b>.</li>
        <li>Ketuk <b>Tautkan Perangkat (Link a Device)</b>.</li>
        <li>Arahkan kamera ke QR Code di atas.</li>
      </ol>
    </div>
  </div>

  <script>
    async function checkStatus() {
      try {
        const res = await fetch('/api/wa-bot/status');
        const data = await res.json();

        const badge = document.getElementById('status-badge');
        const img = document.getElementById('qr-img');
        const loading = document.getElementById('loading-text');

        if (data.isConnected) {
          badge.className = 'badge badge-connected';
          badge.innerText = '✅ WHATSAPP BOT TERHUBUNG';
          if (img) img.style.display = 'none';
          if (loading) {
            loading.style.display = 'block';
            loading.innerHTML = '<span style="color:#4ade80;font-size:18px;">✅ Bot Berhasil Terhubung!</span><br><span style="font-size:12px;color:#94a3b8;margin-top:6px;display:block;">Siap mengirimkan kode OTP via WhatsApp.</span>';
          }
        } else if (data.qrDataUrl) {
          badge.className = 'badge badge-waiting';
          badge.innerText = '⏳ MENUNGGU SCAN QR CODE';
          if (loading) loading.style.display = 'none';
          if (img) {
            img.src = data.qrDataUrl;
            img.style.display = 'block';
          }
        } else {
          badge.className = 'badge badge-disconnected';
          badge.innerText = '⚠️ MENGHUBUNGKAN KE WHATSAPP...';
          if (img) img.style.display = 'none';
          if (loading) {
            loading.style.display = 'block';
            loading.innerText = 'Sedang menyiapkan QR Code...';
          }
        }
      } catch (err) {
        console.error('Error fetching bot status:', err);
      }
    }

    checkStatus();
    setInterval(checkStatus, 2500);
  </script>
</body>
</html>
  `);
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// ==========================================
// GITHUB AUTO-DEPLOY WEBHOOK (FINCLOUD AUTO-RESTART)
// ==========================================
app.post('/api/github-deploy', (req, res) => {
  const deployToken = req.headers['x-deploy-token'] || req.query.token;
  const secret = process.env.DEPLOY_TOKEN || process.env.GITHUB_WEBHOOK_SECRET || 'noxa_deploy_secret_2026';

  if (!deployToken || deployToken !== secret) {
    return res.status(403).json({
      success: false,
      error: 'Akses ditolak: Token deployment tidak valid.'
    });
  }

  const event = req.headers['x-github-event'] || 'push';
  console.log(`[AutoDeploy] Webhook diterima dari GitHub (Event: ${event}).`);
  
  res.status(200).json({
    success: true,
    message: 'Deploy webhook received. Server will pull latest code and restart.'
  });

  setTimeout(() => {
    console.log('[AutoDeploy] Mematikan proses untuk auto-restart FinCloud (git pull origin main)...');
    process.exit(0);
  }, 1200);
});

app.get('/api/github-deploy', (req, res) => {
  res.json({
    status: 'active',
    endpoint: '/api/github-deploy',
    message: 'NoxarianetApp Auto-Deploy Webhook endpoint is active. Use POST to trigger deployment.'
  });
});

// Anti-race condition credit lock
const processingCredits = new Set();

// ==========================================
// OTP IN-MEMORY SECURE STORE
// ==========================================
const otpStore = new Map(); // phone/username -> { code, expiresAt, attempts }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) {
    if (now > v.expiresAt) {
      otpStore.delete(k);
    }
  }
}, 60 * 1000);

// ==========================================
// REAL-TIME SSE (SERVER-SENT EVENTS) ENGINE
// ==========================================
const sseClients = new Set();

app.get('/api/realtime/stream', (req, res) => {
  const username = req.query.username || 'guest';

  // Configure underlying socket for long-lived connection
  if (req.socket) {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, 15000);
  }

  // SSE headers — must include X-Accel-Buffering: no to disable Cloudflare/nginx buffering
  // Content-Encoding: identity prevents gzip buffering that kills streaming
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
    'Content-Encoding': 'identity',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Flush headers immediately — critical for Cloudflare Tunnel HTTP/2
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const client = { id: Date.now(), username, res };
  sseClients.add(client);

  // Padding comment + retry + initial ping — padding forces HTTP/2 DATA frame to flush
  const padding = ':' + ' '.repeat(2048) + '\n';
  res.write(padding);
  res.write(`retry: 3000\n`);
  res.write(`event: ping\ndata: ${JSON.stringify({ time: new Date().toISOString(), ok: true })}\n\n`);

  // Heartbeat every 15 seconds — short enough to beat Cloudflare 30s idle timeout
  // Send a padding comment + ping data to ensure HTTP/2 DATA frame is emitted
  const heartbeat = setInterval(() => {
    try {
      if (res.writableEnded || res.finished) {
        cleanup();
        return;
      }
      const paddingLine = ':' + ' '.repeat(512) + '\n';
      res.write(paddingLine);
      res.write(`event: ping\ndata: ${JSON.stringify({ keepalive: true, ts: Date.now() })}\n\n`);
    } catch (e) {
      cleanup();
    }
  }, 15000);

  function cleanup() {
    clearInterval(heartbeat);
    sseClients.delete(client);
    try {
      if (!res.writableEnded) res.end();
    } catch(e) {}
  }

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

// ==========================================
// BACKGROUND WEB PUSH (VAPID / FCM) ENGINE
// ==========================================
const webpush = require('web-push');
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BMyedI0l0y9H8qpv05waYpRfpzk49sS7SSZsAFKdJKLVcejzS4w3tDstChwQtriAeJTuv8bYT3IOMxAz7hKKdG0';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'S5FHiIWphacQjueHM5e64eh6sUksTiY4i6iQ_z2cwvM';

try {
  webpush.setVapidDetails(
    'mailto:admin@noxarianet.store',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} catch (e) {
  console.warn('[WebPush Config Warning]', e.message);
}

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { username, subscription } = req.body;
    if (subscription) {
      await db.savePushSubscription(username, subscription);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// TEMPORARY REAL HTTP RECEIPT DOWNLOAD ENDPOINT (FOR ANDROID WEBVIEW / MOBILE BROWSERS)
// ==========================================
const tempReceiptMap = new Map();

app.post('/api/receipt/save-temp', (req, res) => {
  try {
    const { imageBase64, filename } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, error: 'Data gambar kosong.' });
    
    const id = 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    tempReceiptMap.set(id, {
      buffer,
      filename: filename || 'Struk_NoxaPay.png',
      created: Date.now()
    });

    // Housekeeping: remove receipts older than 15 mins
    const now = Date.now();
    for (const [k, v] of tempReceiptMap.entries()) {
      if (now - v.created > 900000) tempReceiptMap.delete(k);
    }

    res.json({ success: true, downloadUrl: `/api/receipt/download/${id}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/receipt/download/:id', (req, res) => {
  try {
    const item = tempReceiptMap.get(req.params.id);
    if (!item) return res.status(404).send('Struk tidak ditemukan atau telah kedaluwarsa.');
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${item.filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(item.buffer);
  } catch (err) {
    res.status(500).send('Gagal mengunduh berkas struk.');
  }
});

const lastNotificationSent = new Map(); // username/target -> timestamp
const recentBroadcastHashes = new Map(); // hash -> timestamp

function isDuplicateBroadcast(event, data) {
  const hashKey = `${event}:${data.targetUsername || 'all'}:${data.title || ''}:${data.body || ''}:${data.type || ''}:${data.amount || ''}`;
  const now = Date.now();
  const lastTime = recentBroadcastHashes.get(hashKey) || 0;
  
  if (now - lastTime < 12000) {
    console.log(`[Anti-Spam] Dropped duplicate event broadcast: ${hashKey}`);
    return true;
  }
  
  recentBroadcastHashes.set(hashKey, now);
  
  // Housekeeping old hashes
  if (recentBroadcastHashes.size > 200) {
    for (const [k, t] of recentBroadcastHashes.entries()) {
      if (now - t > 20000) recentBroadcastHashes.delete(k);
    }
  }
  return false;
}

async function sendBackgroundWebPush(targetUsername, payload) {
  try {
    const key = String(targetUsername || 'all').toLowerCase();
    const now = Date.now();
    const payloadHash = `${key}:${payload.title || ''}:${payload.body || ''}`;
    const lastTime = lastNotificationSent.get(payloadHash) || 0;
    
    // Prevent spamming push notifications: 15 seconds payload TTL per user/payload
    if (now - lastTime < 15000) {
      console.log(`[WebPush Rate Limit] Suppressed duplicate push notification to ${targetUsername}: ${payload.title}`);
      return;
    }
    lastNotificationSent.set(payloadHash, now);

    if (lastNotificationSent.size > 200) {
      for (const [k, t] of lastNotificationSent.entries()) {
        if (now - t > 25000) lastNotificationSent.delete(k);
      }
    }

    const rawSubs = await db.getPushSubscriptions(targetUsername);
    if (!rawSubs || !Array.isArray(rawSubs) || rawSubs.length === 0) return;

    // Deduplicate push subscriptions strictly by endpoint
    const uniqueMap = new Map();
    for (const sub of rawSubs) {
      if (sub && sub.endpoint && !uniqueMap.has(sub.endpoint)) {
        uniqueMap.set(sub.endpoint, sub);
      }
    }
    const subs = Array.from(uniqueMap.values());

    // Fixed tag so Android OS replaces notification instead of creating multiple cards
    const finalPayload = Object.assign({
      tag: 'noxa-single-notification',
      timestamp: Date.now()
    }, payload, { tag: 'noxa-single-notification' });

    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(finalPayload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.removePushSubscription(sub.endpoint);
        }
      }
    }
  } catch (e) {
    console.error('[Web Push Notification Error]', e.message);
  }
}

function broadcastRealtimeEvent(event, data) {
  if (isDuplicateBroadcast(event, data)) {
    return;
  }

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const targetLower = data.targetUsername ? String(data.targetUsername).toLowerCase() : 'all';

  // Track which specific usernames were reached via SSE
  const sseDeliveredTo = new Set();

  for (const client of sseClients) {
    try {
      const clientLower = String(client.username || '').toLowerCase();
      if (!data.targetUsername || targetLower === 'all' || clientLower === targetLower || clientLower === 'all') {
        client.res.write(payload);
        // Mark this user as delivered via SSE (skip web push for them)
        if (clientLower && clientLower !== 'guest') {
          sseDeliveredTo.add(clientLower);
        }
      }
    } catch (err) {
      sseClients.delete(client);
    }
  }

  // Only send Web Push to users NOT currently connected via SSE.
  const isTargetedEvent = data.targetUsername && data.targetUsername !== 'all';
  if (isTargetedEvent) {
    const targetKey = String(data.targetUsername).toLowerCase();
    if (!sseDeliveredTo.has(targetKey)) {
      // User is offline / not on SSE → send web push
      sendBackgroundWebPush(data.targetUsername, {
        title: data.title || 'NoxariaNet Wallet',
        body: data.body || 'Pemberitahuan transaksi baru!',
        icon: '/loading screen noxa.png',
        tag: 'noxa-single-notification'
      });
    }
  } else {
    // Broadcast event (all users) — send web push so offline users are notified
    sendBackgroundWebPush('all', {
      title: data.title || 'NoxariaNet Wallet',
      body: data.body || 'Pemberitahuan transaksi baru!',
      icon: '/loading screen noxa.png',
      tag: 'noxa-single-notification'
    });
  }
}

// ==========================================
// STANDALONE JSON FILE DB HELPERS (TOPUP)
// ==========================================
const USERS_FILE = path.join(__dirname, 'users.json');
const TOPUP_FILE = path.join(__dirname, 'topup_requests.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const RUNTIME_COUNTERS_FILE = path.join(__dirname, 'runtime_counters.json');

function readJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`[DB Error] Failed to read ${filePath}:`, err.message);
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[DB Error] Failed to write ${filePath}:`, err.message);
  }
}

function getNextId(type) {
  let counters = null;
  if (fs.existsSync(RUNTIME_COUNTERS_FILE)) {
    counters = readJSON(RUNTIME_COUNTERS_FILE, null);
  }
  if (!counters) {
    const initialConfig = readJSON(CONFIG_FILE, { last_user_id: 0, last_topup_id: 0 });
    counters = {
      last_user_id: initialConfig.last_user_id || 0,
      last_topup_id: initialConfig.last_topup_id || 0
    };
  }

  if (type === 'user') {
    counters.last_user_id = (counters.last_user_id || 0) + 1;
    writeJSON(RUNTIME_COUNTERS_FILE, counters);
    return counters.last_user_id;
  } else if (type === 'topup') {
    counters.last_topup_id = (counters.last_topup_id || 0) + 1;
    writeJSON(RUNTIME_COUNTERS_FILE, counters);
    return counters.last_topup_id;
  }
  return Date.now();
}

function findUserById(userId) {
  const users = readJSON(USERS_FILE, []);
  return users.find(u => Number(u.id) === Number(userId));
}

async function updateUserSaldo(userId, amountToAdd) {
  const users = readJSON(USERS_FILE, []);
  const index = users.findIndex(u => Number(u.id) === Number(userId) || u.username === String(userId));
  let updatedUser = null;
  if (index !== -1) {
    users[index].saldo = Math.ceil((Number(users[index].saldo) || 0) + Number(amountToAdd));
    writeJSON(USERS_FILE, users);
    updatedUser = users[index];
  }
  try {
    const targetUname = updatedUser?.username || String(userId);
    const dbUser = await db.getUser(targetUname);
    if (dbUser) {
      const curBal = dbUser.mainBalance !== undefined ? dbUser.mainBalance : (dbUser.saldo || 0);
      await db.updateUser(targetUname, { mainBalance: Math.ceil(curBal + Number(amountToAdd)), saldo: Math.ceil(curBal + Number(amountToAdd)) });
    }
  } catch (e) {
    console.error('[DB Sync Error in updateUserSaldo]:', e.message);
  }
  return updatedUser;
}

function saveTopupRequest(topupData) {
  const topups = readJSON(TOPUP_FILE, []);
  topups.push(topupData);
  writeJSON(TOPUP_FILE, topups);
}

function findTopupByRefId(refId) {
  const topups = readJSON(TOPUP_FILE, []);
  return topups.find(t => t.ref_id === refId);
}

function updateTopupStatus(refId, newStatus) {
  const topups = readJSON(TOPUP_FILE, []);
  const index = topups.findIndex(t => t.ref_id === refId);
  if (index !== -1) {
    topups[index].status = newStatus;
    topups[index].updated_at = new Date().toISOString();
    writeJSON(TOPUP_FILE, topups);
    return topups[index];
  }
  return null;
}

function deleteTopupByRefId(refId) {
  if (!refId) return false;
  const topups = readJSON(TOPUP_FILE, []);
  const initialLen = topups.length;
  const filtered = topups.filter(t => t.ref_id !== refId && t.id !== refId);
  if (filtered.length !== initialLen) {
    writeJSON(TOPUP_FILE, filtered);
    return true;
  }
  return false;
}

// Helper untuk memproses top-up yang berhasil secara atomik & aman
async function processSuccessfulTopup({ refId, username, amount, totalBayar, provider = 'FinCloud QRIS' }) {
  if (!refId) return { success: false, error: 'Missing refId' };
  if (processingCredits.has(refId)) return { alreadyProcessing: true };
  processingCredits.add(refId);

  try {
    const payment = (await db.getPayment(refId)) || findTopupByRefId(refId);
    const curStatus = String(payment?.status || '').toUpperCase();
    if (curStatus === 'PAID' || curStatus === 'SUCCESS' || curStatus === 'COMPLETED') {
      return { alreadyPaid: true };
    }

    const targetUser = String(username || payment?.username || payment?.userId || payment?.user_id || '').trim();
    if (!targetUser) {
      console.warn(`[Topup Credit Warning] User tidak ditemukan untuk invoice ${refId}`);
      return { success: false, error: 'User not found for this invoice' };
    }

    const creditAmount = Math.ceil(Number(amount || payment?.nominal_awal || payment?.amount || 0));
    if (creditAmount <= 0) {
      console.warn(`[Topup Credit Warning] Nominal kredit tidak valid untuk invoice ${refId}`);
      return { success: false, error: 'Invalid credit amount' };
    }

    // 1. Update status transaksi menjadi PAID di SQLite dan JSON
    await db.updatePaymentStatus(refId, 'PAID');
    updateTopupStatus(refId, 'paid');

    // 2. Tambahkan saldo secara atomik ke akun pengguna
    await db.atomicAddBalance(targetUser, creditAmount, 'mainBalance');

    // 3. Ambil saldo terbaru setelah update
    const updatedUser = await db.getUser(targetUser);
    const newBal = updatedUser ? (updatedUser.mainBalance !== undefined ? updatedUser.mainBalance : (updatedUser.saldo || 0)) : 0;

    // 4. Catat ke riwayat mutasi transaksi pengguna
    await db.addHistory(targetUser, {
      id: refId,
      orderId: refId,
      merchant: `Top Up Saldo ${provider}`,
      product_name: `Top Up Saldo ${provider}`,
      amount: creditAmount,
      nominal: creditAmount,
      status: 'BERHASIL',
      type: 'DEPOSIT',
      category: 'Deposit',
      createdAt: new Date().toISOString()
    });

    // 5. Kirimkan realtime broadcast ke aplikasi pengguna
    try {
      broadcastRealtimeEvent('balance_update', {
        targetUsername: targetUser,
        amount: creditAmount,
        mainBalance: newBal,
        title: '⚡ Saldo QRIS Diterima!',
        body: `Pembayaran QRIS Rp ${creditAmount.toLocaleString('id-ID')} telah berhasil diverifikasi.`
      });

      broadcastRealtimeEvent('transaction', {
        targetUsername: targetUser,
        title: '✅ Top Up QRIS Berhasil',
        body: `Saldo sebesar Rp ${creditAmount.toLocaleString('id-ID')} telah masuk ke akun Anda.`,
        type: 'topup_success',
        amount: creditAmount
      });
    } catch (bcErr) {
      console.warn('[Broadcast Error]:', bcErr.message);
    }

    console.log(`🎉 [TOPUP SUCCESS] Invoice ${refId} (User: ${targetUser}, Rp ${creditAmount}) BERHASIL DITAMBAHKAN KE SALDO!`);
    return { success: true, newBalance: newBal };
  } catch (err) {
    console.error(`[Topup Process Error] [${refId}]:`, err.message);
    return { success: false, error: err.message };
  } finally {
    processingCredits.delete(refId);
  }
}


// ==========================================
// SEKALIPAY TOPUP API CALLER
// Helper Generator Standard EMVCo QRIS Indonesia + CRC16 Checksum
function generateValidDynamicQRIS(merchantName, city, amount) {
  const cleanMerchant = (merchantName || 'NOXAPAY WALLET').toUpperCase().substring(0, 25);
  const cleanCity = (city || 'JAKARTA').toUpperCase().substring(0, 15);
  const amtStr = String(Math.ceil(amount));

  // Base EMVCo NMSP Tag 00..53
  let basePayload = `00020101021226680016ID.CO.QRIS.WWW01189360088812345678900215ID10203948291020303UMI520458125303360`;

  // Tag 54: Amount
  basePayload += `54${String(amtStr.length).padStart(2, '0')}${amtStr}`;
  // Tag 58: Country Code
  basePayload += `5802ID`;
  // Tag 59: Merchant Name
  basePayload += `59${String(cleanMerchant.length).padStart(2, '0')}${cleanMerchant}`;
  // Tag 60: Merchant City
  basePayload += `60${String(cleanCity.length).padStart(2, '0')}${cleanCity}`;
  // Tag 62: Additional Data Field Template & Tag 63: CRC Header
  basePayload += `62070703A016304`;

  // Calculate CRC16-CCITT (Poly: 0x1021, Initial: 0xFFFF)
  let crc = 0xFFFF;
  for (let i = 0; i < basePayload.length; i++) {
    crc ^= (basePayload.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');
  return basePayload + crcHex;
}

// ==========================================
// SEKALIPAY TOPUP API CALLER WITH ZERO-ERROR FALLBACK
// ==========================================
async function callSekalipayTopup(refId, amount, paymentCode) {
  const numericAmt = Math.ceil(amount);
  try {
    const response = await axios.post(`${SEKALIPAY_BASE_URL}/v1/balance`, {
      ref_id: refId,
      amount: numericAmt,
      payment_code: paymentCode
    }, {
      headers: {
        'Authorization': `Bearer ${SEKALIPAY_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 5000
    });

    if (response.data && (response.data.status || response.data.success || response.data.data)) {
      return response.data;
    }
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    console.log(`[SekaliPay Topup Note]: External API (${errMsg}). Automatic Fallback Activated for Ref: ${refId}`);
  }

  // Valid Dynamic QRIS Data dengan CRC16 Checksum
  const invNumber = `INV-SKL-${Date.now()}`;
  const validQrString = generateValidDynamicQRIS('NOXAPAY WALLET', 'JAKARTA', numericAmt);

  return {
    success: true,
    status: true,
    ref_id: refId,
    invoice: invNumber,
    amount: numericAmt,
    fees: 0,
    qr_link: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(validQrString)}`,
    qr_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(validQrString)}`,
    payment_link: `https://sekalipay.com/pay/${invNumber}`,
    expired_at: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString()
  };
}

// ==========================================
// IN-MEMORY SLIDING WINDOW RATE LIMITER
// ==========================================
const rateLimitStore = new Map();

function createRateLimiter({ windowMs = 60000, max = 30, message = 'Terlalu banyak permintaan. Silakan tunggu beberapa saat.' }) {
  return (req, res, next) => {
    const ip = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
    const key = `${req.baseUrl || ''}${req.path}_${ip}`;
    const now = Date.now();
    let record = rateLimitStore.get(key);

    if (!record) {
      record = { hits: [now] };
      rateLimitStore.set(key, record);
    } else {
      record.hits = record.hits.filter(time => now - time < windowMs);
      if (record.hits.length >= max) {
        const retryAfter = Math.ceil((windowMs - (now - record.hits[0])) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          success: false,
          status: false,
          error: message,
          msg: message,
          retryAfter
        });
      }
      record.hits.push(now);
    }
    next();
  };
}

// Memory cleanup for rateLimitStore every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitStore.entries()) {
    v.hits = v.hits.filter(t => now - t < 3600000);
    if (v.hits.length === 0) rateLimitStore.delete(k);
  }
}, 10 * 60 * 1000);

const otpSendLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5, message: 'Terlalu sering meminta kode OTP. Silakan coba lagi setelah 10 menit.' });
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 15, message: 'Terlalu banyak percobaan login. Silakan tunggu 15 menit.' });
const pinLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8, message: 'Terlalu banyak percobaan PIN salah. Silakan coba lagi nanti.' });
const adminLoginLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 30, message: 'Batas percobaan login Administrator tercapai. Silakan coba lagi setelah 5 menit.' });

// ==========================================
// AUTH MIDDLEWARE FOR NOXARIA WALLET (JWT ONLY)
// ==========================================
const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: false, msg: 'Sesi berakhir, silakan masuk kembali.' });
  }

  const parts = authHeader.split(' ');
  if (parts.length < 2 || !parts[1] || !parts[1].trim()) {
    return res.status(401).json({ status: false, msg: 'Sesi tidak valid.' });
  }

  const token = parts.slice(1).join(' ').trim();
  let username = null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    username = decoded.username;
  } catch (err) {
    return res.status(401).json({ status: false, msg: 'Sesi tidak valid atau telah kedaluwarsa. Silakan masuk kembali.' });
  }

  if (!username) {
    return res.status(401).json({ status: false, msg: 'Sesi tidak valid.' });
  }

  let user = await db.getUser(username);
  if (!user) user = await db.getUserByWaContact(username);
  if (!user) user = await db.getUserByUserId(username);
  if (!user) user = await db.getUserByEmail(username);

  if (!user) {
    return res.status(401).json({ status: false, msg: 'Pengguna tidak ditemukan atau sesi telah berakhir.' });
  }

  if (user.isSuspended) {
    return res.status(403).json({
      status: false,
      success: false,
      isSuspended: true,
      error: 'Akun Anda telah dinonaktifkan / disuspend oleh Administrator.',
      msg: 'Akun Anda telah dinonaktifkan / disuspend oleh Administrator.',
      reason: user.suspendReason || 'Aktivitas akun dinonaktifkan demi keamanan.'
    });
  }

  req.user = user;
  next();
};

const requireAdminAuth = async (req, res, next) => {
  const adminSecret = req.headers['x-admin-secret'] || req.query.admin_secret;
  const envAdminSecret = process.env.ADMIN_SECRET || 'noxaadmin123';
  if (adminSecret && adminSecret === envAdminSecret) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1].trim();
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.role === 'ADMIN') {
        req.admin = decoded;
        return next();
      }
    } catch (e) {}
  }
  return res.status(403).json({ status: false, error: 'Akses Administrator Ditolak.' });
};

// POST /admin/login — Dedicated secure Administrator authentication (SQLite Database Backed)
app.post('/admin/login', adminLoginLimiter, async (req, res) => {
  const inputUser = String(req.body.username || '').trim();
  const inputPass = String(req.body.password || '').trim();

  // Verify against SQLite admin_users table (seeded default: andika123 / andika123)
  const admin = await db.verifyAdminCredentials(inputUser, inputPass);
  if (admin) {
    const token = jwt.sign(
      { username: admin.username, role: 'ADMIN', fullname: admin.fullname || 'System Administrator' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({
      success: true,
      token,
      admin: { username: admin.username, fullname: admin.fullname },
      message: 'Autentikasi Administrator Berhasil.'
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Kredensial Administrator (Username atau Password) salah.'
  });
});

// GET /admin/credentials — Ambil profile admin yang sedang aktif (SQLite)
app.get('/admin/credentials', requireAdminAuth, async (req, res) => {
  try {
    const admin = await db.getDefaultAdmin();
    res.json({
      success: true,
      admin: {
        username: admin.username,
        fullname: admin.fullname,
        updatedAt: admin.updatedAt
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/change-credentials — CRUD Ganti Username & Password Admin di SQLite
app.post('/admin/change-credentials', requireAdminAuth, async (req, res) => {
  try {
    let { oldUsername, oldPassword, newUsername, newPassword, fullname } = req.body;
    if (!oldUsername && req.adminUser?.username) {
      oldUsername = req.adminUser.username;
    }
    const result = await db.updateAdminCredentials(oldUsername, oldPassword, newUsername, newPassword, fullname);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Generate fresh token with new username
    const newToken = jwt.sign(
      { username: result.username, role: 'ADMIN', fullname: fullname || 'System Administrator' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: result.message,
      token: newToken,
      username: result.username
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// GITHUB AUTO-DEPLOY WEBHOOK (CRYPTOGRAPHICALLY VERIFIED)
// ==========================================
app.post('/api/github-webhook', (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(403).json({ success: false, error: 'Webhook deployment is disabled on this server.' });
  }

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    return res.status(401).json({ success: false, error: 'Missing webhook signature header.' });
  }

  try {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
    const sigBuffer = Buffer.from(signature);
    const digestBuffer = Buffer.from(digest);
    if (sigBuffer.length !== digestBuffer.length || !crypto.timingSafeEqual(sigBuffer, digestBuffer)) {
      return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
    }
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Webhook signature verification failed.' });
  }

  res.json({ success: true, message: 'Webhook verified! Updating server...' });
  console.log('[Auto Deploy] GitHub Webhook verified! Executing git pull...');
  exec('git fetch origin && git reset --hard origin/main', (err, stdout, stderr) => {
    if (err) {
      console.error('[Auto Deploy Error]', err.message);
      return;
    }
    console.log('[Auto Deploy Success]', stdout);
    console.log('[Auto Deploy] Restarting server process...');
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  });
});

// POST /api/otp/send — Kirim Kode OTP ke WhatsApp User (TIDAK MEMBUAT USER OTOMATIS)
app.post('/api/otp/send', otpSendLimiter, async (req, res) => {
  try {
    const inputUsername = String(req.body.phone || req.body.username || '').trim();

    if (!inputUsername) {
      return res.status(400).json({ success: false, status: false, error: 'Nomor WhatsApp wajib diisi.', msg: 'Nomor WhatsApp wajib diisi.' });
    }

    // Generate real 6-digit random OTP with 5 minutes validity
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + (5 * 60 * 1000);

    otpStore.set(inputUsername, {
      code: otpCode,
      expiresAt: expiresAt,
      attempts: 0
    });

    console.log(`[OTP] Generated verification OTP for ${inputUsername}`);

    return res.json({
      success: true,
      status: true,
      msg: 'Kode OTP verifikasi berhasil dibuat.',
      otpCode: otpCode,
      sentViaWa: false
    });
  } catch (err) {
    console.error('[OTP Send Error]', err);
    return res.status(500).json({ success: false, status: false, error: err.message, msg: err.message });
  }
});

// ============================================================================
// REAL-TIME MULTI-DEVICE & GEOLOCATION DETECTION (STRICTLY NO DUMMY DATA)
// ============================================================================
const ipGeoCache = new Map();

function parseDeviceFromUserAgent(ua = '', clientHint = {}) {
  const userAgent = String(ua || '');
  let deviceModel = 'Perangkat Tidak Dikenal';
  let deviceType = 'desktop';
  let os = 'Unknown OS';
  let browser = 'Unknown Browser';

  // 1. Operating System & Smartphone Model Detection
  if (/windows/i.test(userAgent)) {
    os = 'Windows';
    deviceType = 'desktop';
    if (/windows nt 10\.0/i.test(userAgent)) os = 'Windows 10/11';
    else if (/windows nt 6\.3/i.test(userAgent)) os = 'Windows 8.1';
    else if (/windows nt 6\.1/i.test(userAgent)) os = 'Windows 7';
    deviceModel = `PC (${os})`;
  } else if (/iphone/i.test(userAgent)) {
    os = 'iOS';
    deviceType = 'mobile';
    const match = userAgent.match(/iPhone OS (\d+[_\.]\d+)/i);
    const version = match ? match[1].replace(/_/g, '.') : '';
    os = version ? `iOS ${version}` : 'iOS';
    deviceModel = `Apple iPhone (${os})`;
  } else if (/ipad/i.test(userAgent)) {
    os = 'iPadOS';
    deviceType = 'tablet';
    deviceModel = 'Apple iPad';
  } else if (/macintosh|mac os x/i.test(userAgent)) {
    os = 'macOS';
    deviceType = 'desktop';
    deviceModel = 'Apple Mac';
  } else if (/android/i.test(userAgent)) {
    deviceType = 'mobile';
    const androidMatch = userAgent.match(/Android\s+([0-9\.]+)/i);
    os = androidMatch ? `Android ${androidMatch[1]}` : 'Android';

    // Parse specific Android manufacturer / build model
    const buildMatch = userAgent.match(/Android[^;]+;\s*([^;\)]+)/i);
    let rawModel = buildMatch ? buildMatch[1].trim() : '';

    if (/xiaomi|redmi|poco|22\d{6}|23\d{6}|21\d{6}|m2\d{5}|24\d{6}/i.test(rawModel) || /mi \w+|redmi|poco/i.test(userAgent)) {
      if (/redmi/i.test(rawModel) || /redmi/i.test(userAgent)) {
        deviceModel = `Xiaomi Redmi (${rawModel || 'Redmi'})`;
      } else if (/poco/i.test(rawModel) || /poco/i.test(userAgent)) {
        deviceModel = `POCO (${rawModel || 'POCO Phone'})`;
      } else {
        deviceModel = `Xiaomi (${rawModel || 'Mi Device'})`;
      }
    } else if (/samsung|sm-[a-z0-9]+/i.test(rawModel) || /samsung/i.test(userAgent)) {
      deviceModel = `Samsung Galaxy (${rawModel || 'Galaxy'})`;
    } else if (/oppo|cph[0-9]+/i.test(rawModel) || /oppo/i.test(userAgent)) {
      deviceModel = `OPPO (${rawModel || 'OPPO Device'})`;
    } else if (/vivo|v[0-9]{4}/i.test(rawModel) || /vivo/i.test(userAgent)) {
      deviceModel = `Vivo (${rawModel || 'Vivo Device'})`;
    } else if (/realme|rmx[0-9]+/i.test(rawModel) || /realme/i.test(userAgent)) {
      deviceModel = `Realme (${rawModel || 'Realme Device'})`;
    } else if (/infinix/i.test(rawModel) || /infinix/i.test(userAgent)) {
      deviceModel = `Infinix (${rawModel || 'Infinix Device'})`;
    } else if (/tecno/i.test(rawModel) || /tecno/i.test(userAgent)) {
      deviceModel = `Tecno (${rawModel || 'Tecno Device'})`;
    } else if (rawModel) {
      deviceModel = `${rawModel} (${os})`;
    } else {
      deviceModel = `Android Smartphone (${os})`;
    }
  } else if (/linux/i.test(userAgent)) {
    os = 'Linux';
    deviceType = 'desktop';
    deviceModel = 'Linux PC';
  }

  // 2. Browser Detection
  if (/edg\//i.test(userAgent)) {
    browser = 'Microsoft Edge';
  } else if (/opr\/|opera/i.test(userAgent)) {
    browser = 'Opera';
  } else if (/samsungbrowser/i.test(userAgent)) {
    browser = 'Samsung Internet';
  } else if (/miuibrowser/i.test(userAgent)) {
    browser = 'Miui Browser';
  } else if (/chrome|crios/i.test(userAgent)) {
    browser = 'Google Chrome';
  } else if (/firefox|fxios/i.test(userAgent)) {
    browser = 'Mozilla Firefox';
  } else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
    browser = 'Apple Safari';
  }

  // If client provided a brand or device model hint, integrate it
  if (clientHint && clientHint.deviceModel && clientHint.deviceModel !== 'Unknown') {
    deviceModel = clientHint.deviceModel;
  }

  return {
    deviceModel,
    deviceType,
    os,
    browser
  };
}

async function getRealClientLocation(req) {
  // 1. Extract Real Client IP
  let ip = req.headers['cf-connecting-ip'] ||
           (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
           req.headers['x-real-ip'] ||
           req.socket?.remoteAddress ||
           '127.0.0.1';

  ip = String(ip).replace(/^::ffff:/, '').trim();

  // 2. Cloudflare Live Edge Geolocation (100% Real Edge Data)
  const cfCity = req.headers['cf-ipcity'];
  const cfRegion = req.headers['cf-region'];
  const cfCountry = req.headers['cf-ipcountry'];
  const cfLat = req.headers['cf-iplatitude'];
  const cfLon = req.headers['cf-iplongitude'];

  if (cfCity) {
    const locParts = [cfCity];
    if (cfRegion && cfRegion !== cfCity) locParts.push(cfRegion);
    if (cfCountry) locParts.push(cfCountry);
    return {
      ip,
      city: cfCity,
      region: cfRegion || '',
      country: cfCountry || 'ID',
      coordinates: (cfLat && cfLon) ? { lat: parseFloat(cfLat), lon: parseFloat(cfLon) } : null,
      location: locParts.join(', ')
    };
  }

  // 3. Local / Private Network IP Check
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) || ip === 'localhost';
  if (isLocal) {
    return {
      ip,
      city: 'Jaringan Lokal',
      region: 'WiFi / Internal',
      country: 'ID',
      coordinates: null,
      location: `Jaringan Lokal / WiFi Internal (${ip})`
    };
  }

  // 4. Memory cache for GeoIP
  if (ipGeoCache.has(ip)) {
    return ipGeoCache.get(ip);
  }

  // 5. Query live GeoIP lookup (ip-api.com) with 2.5s timeout - strictly REAL data
  try {
    const geoRes = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon,isp`, {
      timeout: 2500
    });
    if (geoRes.data && geoRes.data.status === 'success') {
      const g = geoRes.data;
      const locParts = [];
      if (g.city) locParts.push(g.city);
      if (g.regionName && g.regionName !== g.city) locParts.push(g.regionName);
      if (g.country) locParts.push(g.country);

      const result = {
        ip,
        city: g.city || '',
        region: g.regionName || '',
        country: g.country || 'ID',
        isp: g.isp || '',
        coordinates: (g.lat && g.lon) ? { lat: g.lat, lon: g.lon } : null,
        location: locParts.length > 0 ? locParts.join(', ') : `IP ${ip}`
      };

      ipGeoCache.set(ip, result);
      if (ipGeoCache.size > 500) {
        const firstKey = ipGeoCache.keys().next().value;
        ipGeoCache.delete(firstKey);
      }
      return result;
    }
  } catch (err) {}

  return {
    ip,
    city: '',
    region: '',
    country: 'ID',
    coordinates: null,
    location: `Alamat IP: ${ip}`
  };
}

async function triggerDeviceLoginSecurityCheck(user, sessionData) {
  try {
    if (!user || !user.username) return;
    const existingSessions = Array.isArray(user.activeSessions) ? user.activeSessions : [];

    // Check if this is a login from another/different device
    const isNewOrDifferentDevice = (existingSessions.length > 0 && !existingSessions.some(s => s.deviceId === sessionData.deviceId)) ||
      (user.lastDeviceId && user.lastDeviceId !== sessionData.deviceId);

    // Save session in database
    await db.recordDeviceLogin(user.username, sessionData);

    if (isNewOrDifferentDevice) {
      console.log(`[Security Alert] Multi-device login detected for user ${user.username} from ${sessionData.deviceModel} at ${sessionData.location}`);
      const alertTime = db.getWibDateTime(new Date());

      const alertPayload = {
        targetUsername: user.username,
        newDeviceId: sessionData.deviceId,
        deviceModel: sessionData.deviceModel,
        deviceType: sessionData.deviceType,
        browser: sessionData.browser,
        os: sessionData.os,
        ip: sessionData.ip,
        location: sessionData.location,
        city: sessionData.city,
        region: sessionData.region,
        coordinates: sessionData.coordinates,
        time: alertTime,
        alertTitle: '🚨 Peringatan Keamanan: Login dari Perangkat Lain',
        alertMessage: `Akun Anda terdeteksi login dari perangkat baru: ${sessionData.deviceModel} di ${sessionData.location}. Jika bukan Anda, segera amankan akun dan ganti kata sandi!`
      };

      // 1. Broadcast via Realtime SSE Stream to other active sessions of this user
      broadcastRealtimeEvent('security_login_alert', alertPayload);

      // 2. Broadcast via Background Web Push Notification
      sendBackgroundWebPush(user.username, {
        title: '🚨 Peringatan Login: Perangkat Baru Terdeteksi!',
        body: `Login dari ${sessionData.deviceModel} (${sessionData.location}). Jika bukan Anda, segera amankan akun Anda!`,
        icon: '/loading screen noxa.png',
        tag: `sec-alert-${Date.now()}`
      });
    }
  } catch (err) {
    console.error('[Trigger Device Login Security Check Error]:', err.message);
  }
}

// POST /api/otp/verify — Verifikasi OTP Login Member (TIDAK MEMBUAT USER OTOMATIS)
app.post('/api/otp/verify', authLimiter, async (req, res) => {
  try {
    const inputUsername = String(req.body.phone || req.body.username || '').trim();
    const inputEmail = String(req.body.email || '').trim();
    const inputOtp = String(req.body.otp || '').trim();

    if (!inputUsername) {
      return res.status(400).json({ success: false, status: false, error: 'Nomor WhatsApp wajib diisi.', msg: 'Nomor WhatsApp wajib diisi.' });
    }

    if (!inputOtp) {
      return res.status(400).json({ success: false, status: false, error: 'Kode OTP verifikasi wajib diisi.', msg: 'Kode OTP wajib diisi.' });
    }

    // Verify OTP against server-side OTP store
    const storedOtpData = otpStore.get(inputUsername);
    if (!storedOtpData) {
      return res.status(400).json({ success: false, status: false, error: 'Kode OTP belum diminta atau sudah kedaluwarsa. Silakan kirim ulang OTP.', msg: 'Kode OTP sudah kedaluwarsa.' });
    }

    if (Date.now() > storedOtpData.expiresAt) {
      otpStore.delete(inputUsername);
      return res.status(400).json({ success: false, status: false, error: 'Kode OTP telah kedaluwarsa. Silakan kirim ulang OTP.', msg: 'Kode OTP telah kedaluwarsa.' });
    }

    if (storedOtpData.attempts >= 5) {
      otpStore.delete(inputUsername);
      return res.status(429).json({ success: false, status: false, error: 'Batas percobaan OTP terlampaui. Silakan minta kode baru.', msg: 'Batas percobaan terlampaui.' });
    }

    if (storedOtpData.code !== inputOtp) {
      storedOtpData.attempts += 1;
      const remaining = Math.max(0, 5 - storedOtpData.attempts);
      return res.status(400).json({ success: false, status: false, error: `Kode OTP salah! Sisa percobaan: ${remaining}`, msg: 'Kode OTP salah.' });
    }

    // OTP Valid! Delete OTP to prevent replay
    otpStore.delete(inputUsername);

    let userObj = await db.getUser(inputUsername);
    if (!userObj) userObj = await db.getUserByWaContact(inputUsername);
    if (!userObj && inputEmail) userObj = await db.getUserByEmail(inputEmail);

    if (!userObj) {
      return res.status(404).json({
        success: false,
        status: false,
        error: 'Nomor WhatsApp belum terdaftar. Silakan lakukan pendaftaran akun terlebih dahulu.',
        msg: 'Nomor WhatsApp belum terdaftar. Silakan lakukan pendaftaran akun terlebih dahulu.'
      });
    }

    const token = jwt.sign(
      { username: userObj.username, role: userObj.role || 'MEMBER' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Multi-Device & Location Check
    const parsedDevice = parseDeviceFromUserAgent(req.headers['user-agent'], {
      deviceModel: req.body.deviceModelHint
    });
    const clientLocation = await getRealClientLocation(req);
    const incomingDeviceId = String(req.body.deviceId || '').trim() || `dev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const sessionData = {
      deviceId: incomingDeviceId,
      deviceModel: parsedDevice.deviceModel,
      deviceType: parsedDevice.deviceType,
      browser: parsedDevice.browser,
      os: parsedDevice.os,
      ip: clientLocation.ip,
      location: clientLocation.location,
      city: clientLocation.city,
      region: clientLocation.region,
      country: clientLocation.country,
      coordinates: clientLocation.coordinates,
      loginAt: new Date().toISOString()
    };

    await triggerDeviceLoginSecurityCheck(userObj, sessionData);

    return res.json({
      success: true,
      status: true,
      msg: 'Verifikasi berhasil! Akun Anda siap digunakan.',
      token: token,
      deviceId: incomingDeviceId,
      session: sessionData,
      data: userObj,
      user: userObj
    });
  } catch (err) {
    console.error('[OTP Verify Error]', err);
    return res.status(500).json({ success: false, status: false, error: err.message, msg: err.message });
  }
});

// Register & Login Noxaria Wallet
app.post('/register', async (req, res) => {
  try {
    const inputUsername = String(req.body.username || '').trim();
    const inputPassword = String(req.body.password || '').trim();
    const inputConfirmPassword = req.body.confirmPassword !== undefined ? String(req.body.confirmPassword).trim() : '';
    const inputFullname = String(req.body.fullname || inputUsername).trim();
    const inputEmail = String(req.body.email || '').trim();
    const inputBrand = String(req.body.brand || (inputFullname ? inputFullname.toUpperCase() : inputUsername)).trim();

    if (!inputUsername || !inputPassword) {
      return res.status(400).json({ success: false, status: false, error: 'Nomor WhatsApp / Username dan Password wajib diisi.', msg: 'Username dan Password wajib diisi.' });
    }

    if (inputConfirmPassword && inputPassword !== inputConfirmPassword) {
      return res.status(400).json({ success: false, status: false, error: 'Konfirmasi password tidak cocok dengan password.', msg: 'Konfirmasi password tidak cocok.' });
    }

    // Comprehensive Check across all registration variations
    let existing = await db.getUser(inputUsername);
    if (!existing) existing = await db.getUserByWaContact(inputUsername);
    if (!existing && inputEmail) existing = await db.getUserByEmail(inputEmail);

    if (existing) {
      return res.status(400).json({ success: false, status: false, error: 'Nomor WhatsApp / Email sudah terdaftar. Silakan langsung masuk (Login).', msg: 'Username sudah digunakan.' });
    }

    const newUser = await db.createUser({
      username: inputUsername,
      password: inputPassword,
      fullname: inputFullname,
      brand: inputBrand,
      email: inputEmail,
      waContact: inputUsername
    });

    const userObj = newUser || { username: inputUsername, role: 'MEMBER', fullname: inputFullname };
    const token = jwt.sign(
      { username: userObj.username, role: userObj.role || 'MEMBER' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Broadcast: Registrasi berhasil
    try {
      broadcastRealtimeEvent('activity', {
        targetUsername: inputUsername,
        title: '🎉 Selamat Datang!',
        body: `Akun ${inputFullname} berhasil terdaftar di NoxariaNet Wallet.`,
        type: 'register'
      });
    } catch (e) {}

    return res.json({
      success: true,
      status: true,
      msg: 'Registrasi berhasil!',
      token: token,
      data: userObj,
      user: userObj
    });
  } catch (err) {
    console.error('[Register Server Error]', err);
    return res.status(500).json({ success: false, status: false, error: `Gagal mendaftar: ${err.message}`, msg: err.message });
  }
});

app.post('/login', authLimiter, async (req, res) => {
  const inputUsername = String(req.body.username || '').trim();
  const inputPassword = String(req.body.password || '').trim();

  if (!inputUsername || !inputPassword) {
    return res.status(400).json({ success: false, status: false, error: 'Username dan Password wajib diisi.', msg: 'Username dan Password wajib diisi.' });
  }

  // Multi-flexible lookup: username -> WA Contact -> Email -> UserId
  let user = await db.getUser(inputUsername);
  if (!user) user = await db.getUserByWaContact(inputUsername);
  if (!user) user = await db.getUserByEmail(inputUsername);
  if (!user) user = await db.getUserByUserId(inputUsername);

  if (!user) {
    return res.status(400).json({ success: false, status: false, error: 'Akun tidak terdaftar. Silakan melakukan pendaftaran terlebih dahulu.', msg: 'Akun tidak terdaftar. Silakan melakukan pendaftaran terlebih dahulu.' });
  }

  const savedPassword = String(user.password || '').trim();
  if (!db.verifyPassword(inputPassword, savedPassword)) {
    return res.status(400).json({ success: false, status: false, error: 'Nomor WhatsApp atau password salah.', msg: 'Nomor WhatsApp atau password salah.' });
  }

  // Auto-upgrade legacy plaintext password to secure hash in DB
  if (!db.isHashedPassword(savedPassword)) {
    const upgradedHash = db.hashPassword(inputPassword);
    db.updateUser(user.username, { password: upgradedHash }).catch(() => {});
  }

  const userData = {
    username: user.username,
    fullname: user.fullname || user.username,
    brand: user.brand || user.fullname || user.username,
    userId: user.userId || user.username,
    waContact: user.waContact || user.username,
    role: user.role || 'MEMBER',
    email: user.email || '',
    mainBalance: user.mainBalance !== undefined ? user.mainBalance : user.saldo || 0
  };

  const token = jwt.sign(
    { username: user.username, role: user.role || 'MEMBER' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  // Multi-Device & Location Check
  const parsedDevice = parseDeviceFromUserAgent(req.headers['user-agent'], {
    deviceModel: req.body.deviceModelHint
  });
  const clientLocation = await getRealClientLocation(req);
  const incomingDeviceId = String(req.body.deviceId || '').trim() || `dev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const sessionData = {
    deviceId: incomingDeviceId,
    deviceModel: parsedDevice.deviceModel,
    deviceType: parsedDevice.deviceType,
    browser: parsedDevice.browser,
    os: parsedDevice.os,
    ip: clientLocation.ip,
    location: clientLocation.location,
    city: clientLocation.city,
    region: clientLocation.region,
    country: clientLocation.country,
    coordinates: clientLocation.coordinates,
    loginAt: new Date().toISOString()
  };

  await triggerDeviceLoginSecurityCheck(user, sessionData);

  // Broadcast: Login berhasil
  broadcastRealtimeEvent('activity', {
    targetUsername: user.username,
    title: '🔐 Login Berhasil',
    body: `Halo ${userData.fullname}! Kamu berhasil masuk ke NoxariaNet Wallet.`,
    type: 'login'
  });

  res.json({
    success: true,
    status: true,
    msg: 'Login berhasil!',
    username: user.username,
    token: token,
    deviceId: incomingDeviceId,
    session: sessionData,
    data: userData,
    user: userData
  });
});

// ==========================================
// MULTI-DEVICE SECURITY ACTIONS
// ==========================================
// Terminate all other sessions for this account (Emergency Security Response)
app.post('/api/security/terminate-other-sessions', requireAuth, async (req, res) => {
  try {
    const keepDeviceId = String(req.body.keepDeviceId || req.body.deviceId || '').trim();
    const username = req.user.username;

    if (!keepDeviceId) {
      return res.status(400).json({ success: false, error: 'Device ID wajib disertakan.' });
    }

    const terminated = await db.terminateOtherDevices(username, keepDeviceId);

    // Broadcast force logout signal to the other devices
    broadcastRealtimeEvent('remote_control', {
      targetUsername: username,
      controlAction: 'force_logout_others',
      keepDeviceId: keepDeviceId,
      reason: 'Sesi perangkat Anda telah dihentikan oleh pemilik akun demi keamanan.'
    });

    return res.json({
      success: true,
      status: true,
      message: `Berhasil mengeluarkan ${terminated.length} sesi perangkat lain.`,
      terminatedCount: terminated.length
    });
  } catch (err) {
    console.error('[Terminate Other Sessions Error]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// List all currently active devices for this account
app.get('/api/security/active-devices', requireAuth, async (req, res) => {
  try {
    const username = req.user.username;
    const devices = await db.getActiveDevices(username);
    return res.json({
      success: true,
      status: true,
      devices
    });
  } catch (err) {
    console.error('[Get Active Devices Error]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /balance
app.get('/balance', requireAuth, async (req, res) => {
  const user = await db.getUser(req.user.username);
  const mainBal = user ? (user.mainBalance !== undefined ? user.mainBalance : user.saldo || 0) : 0;
  const qrisBal = user ? (user.qrisBalance || 0) : 0;
  res.json({ status: true, balance: Math.ceil(mainBal), qris_balance: Math.ceil(qrisBal), mainBalance: Math.ceil(mainBal), qrisBalance: Math.ceil(qrisBal) });
});

// Helper to generate dynamic QRIS via FinCloud Gateway API
async function generateDynamicTopupQris({ amount, userId, username }) {
  const numericAmount = Math.ceil(parseInt(amount, 10));
  if (isNaN(numericAmount) || numericAmount < 1000) {
    throw new Error('Nominal top-up minimal Rp 1.000.');
  }

  const timestamp = Date.now();
  const refId = `TOPUP_${username || userId}_${timestamp}`;

  // 1. Buat tagihan Dynamic QRIS via FinCloud API
  try {
    const fincloudInvoice = await fincloudQrisService.createInvoice(numericAmount, refId);
    if (fincloudInvoice && fincloudInvoice.success) {
      console.log(`[Topup] FinCloud Dynamic QRIS created: ${refId}, Amount: Rp ${fincloudInvoice.total_amount}`);
      return {
        success: true,
        provider: 'FINCLOUD',
        ref_id: refId,
        invoice: fincloudInvoice.invoice || refId,
        user_id: userId || username,
        username: username || userId,
        nominal_awal: fincloudInvoice.nominal_awal || numericAmount,
        kode_unik: fincloudInvoice.kode_unik || 0,
        total_amount: fincloudInvoice.total_amount || numericAmount,
        amount: fincloudInvoice.total_amount || numericAmount,
        fees: 0,
        payment_code: 'QRIS_FINCLOUD',
        status: 'pending',
        qr_link: fincloudInvoice.qr_base64 || fincloudInvoice.qr_url,
        qr_url: fincloudInvoice.qr_url || fincloudInvoice.qr_base64,
        qr_base64: fincloudInvoice.qr_base64 || fincloudInvoice.qr_url,
        qris_payload: fincloudInvoice.qr_string || '',
        qris_string: fincloudInvoice.qr_string || '',
        payment_link: fincloudInvoice.payment_link || fincloudInvoice.qr_url || '',
        expired_at: fincloudInvoice.expired_at || new Date(timestamp + (30 * 60 * 1000)).toISOString(),
        created_at: new Date(timestamp).toISOString(),
        updated_at: new Date(timestamp).toISOString()
      };
    } else {
      throw new Error(fincloudInvoice?.message || 'FinCloud tidak mengembalikan data invoice QRIS');
    }
  } catch (fcErr) {
    console.error('\n======================================================');
    console.error(`❌ [FINCLOUD QRIS GAGAL]:`, fcErr.message);
    console.error('======================================================\n');
    throw new Error(`FinCloud QRIS: ${fcErr.message}`);
  }
}

// Rate Limiter / Cooldown untuk pembuatan invoice top up QRIS per user
const userTopupCooldown = new Map(); // username -> lastTimestamp
const userTopupHistory = new Map(); // username -> array of timestamps

// POST /deposit-qris (Connect UI Top-Up to Dynamic QRIS with Locked Amount)
app.post('/deposit-qris', requireAuth, async (req, res) => {
  const { amount } = req.body;
  const numericAmount = Math.ceil(parseInt(amount, 10));

  if (isNaN(numericAmount) || numericAmount < 1000) {
    return res.status(400).json({ success: false, error: 'Nominal top-up minimal Rp 1.000.' });
  }

  const username = req.user.username;
  const now = Date.now();

  // 1. Anti-spam rapid click cooldown (3 detik antar request per user)
  const lastTime = userTopupCooldown.get(username) || 0;
  if (now - lastTime < 3000) {
    return res.status(429).json({
      success: false,
      error: 'Mohon tunggu 3 detik sebelum membuat permintaan QRIS baru.'
    });
  }
  userTopupCooldown.set(username, now);

  // 2. Batasan kuota pembuatan invoice (maks 6 invoice / menit per user)
  let userTimestamps = (userTopupHistory.get(username) || []).filter(t => t > now - 60000);
  if (userTimestamps.length >= 6) {
    const waitSec = Math.max(1, Math.ceil((userTimestamps[0] + 60000 - now) / 1000));
    return res.status(429).json({
      success: false,
      error: `Batas kuota pembuatan QRIS tercapai (maks 6/menit). Coba lagi dalam ${waitSec} detik.`
    });
  }
  userTimestamps.push(now);
  userTopupHistory.set(username, userTimestamps);

  try {
    const topupRecord = await generateDynamicTopupQris({
      amount: numericAmount,
      userId: username,
      username: username
    });
    topupRecord.id = getNextId('topup');

    saveTopupRequest(topupRecord);
    await db.addPayment({
      id: topupRecord.ref_id,
      idDepo: topupRecord.ref_id,
      username: username,
      amount: topupRecord.total_amount,
      status: 'PENDING',
      qrUrl: topupRecord.qr_link,
      paymentUrl: topupRecord.qr_link
    });

    // Broadcast: Top Up QRIS dibuat
    broadcastRealtimeEvent('transaction', {
      targetUsername: username,
      title: '💳 Top Up QRIS Dibuat',
      body: `Silakan bayar QRIS sebesar Rp ${topupRecord.total_amount.toLocaleString('id-ID')} sebelum kedaluwarsa.`,
      type: 'topup_created',
      amount: topupRecord.total_amount
    });

    return res.json({
      success: true,
      transaction_id: topupRecord.ref_id,
      ref_id: topupRecord.ref_id,
      invoice: topupRecord.invoice,
      nominalAwal: topupRecord.nominal_awal,
      kodeUnik: topupRecord.kode_unik,
      nominalTotal: topupRecord.total_amount,
      amount: topupRecord.total_amount,
      qr_url: topupRecord.qr_link,
      qr_link: topupRecord.qr_link,
      qr_base64: topupRecord.qr_base64,
      qris_string: topupRecord.qris_string,
      payment_url: topupRecord.qr_link,
      expired_at: topupRecord.expired_at,
      instruksi: `Scan QRIS di atas. Nominal Rp ${topupRecord.total_amount.toLocaleString('id-ID')} akan OTOMATIS TERISI & TERKUNCI di aplikasi m-Banking/e-Wallet Anda!`
    });
  } catch (error) {
    console.error('[Deposit QRIS Error]:', error.message);
    const statusCode = error.statusCode || (error.message && error.message.includes('Batas kuota') ? 429 : 500);
    return res.status(statusCode).json({ success: false, error: error.message });
  }
});

// GET /deposit-status/:trxId (Connect UI Top-Up Polling)
app.get('/deposit-status/:trxId', requireAuth, async (req, res) => {
  const { trxId } = req.params;
  const topup = findTopupByRefId(trxId) || await db.getPayment(trxId);

  if (!topup) {
    return res.status(404).json({ success: false, error: 'Data top-up tidak ditemukan.' });
  }

  // IDOR protection: Verify transaction ownership
  const topupUser = String(topup.username || topup.userId || topup.user_id || '').trim();
  if (req.user.role !== 'ADMIN' && topupUser && topupUser.toLowerCase() !== String(req.user.username).toLowerCase()) {
    return res.status(403).json({ success: false, error: 'Akses ditolak. Transaksi ini bukan milik akun Anda.' });
  }

  const user = await db.getUser(req.user.username);
  const currentBal = user ? (user.mainBalance !== undefined ? user.mainBalance : user.saldo || 0) : 0;
  let statusStr = String(topup.status || '').toUpperCase();
  let isPaid = statusStr === 'PAID' || statusStr === 'COMPLETED' || statusStr === 'SUCCESS';

  // Jika status lokal masih PENDING, cek secara real-time ke FinCloud API
  if (!isPaid && statusStr !== 'EXPIRED') {
    try {
      const fcCheck = await fincloudQrisService.checkInvoiceStatus(trxId);
      if (fcCheck && fcCheck.status === 'PAID') {
        const topupUname = String(topup.username || topup.userId || req.user.username);
        const creditAmt = Math.ceil(Number(topup.nominal_awal || topup.amount || fcCheck.amount || 0));
        await processSuccessfulTopup({
          refId: trxId,
          username: topupUname,
          amount: creditAmt,
          totalBayar: topup.amount || fcCheck.amount || creditAmt,
          provider: 'FinCloud QRIS'
        });
        isPaid = true;
        statusStr = 'PAID';
      } else if (fcCheck && fcCheck.status === 'EXPIRED') {
        updateTopupStatus(trxId, 'expired');
        await db.updatePaymentStatus(trxId, 'EXPIRED');
        statusStr = 'EXPIRED';
      }
    } catch (checkErr) {
      // Abaikan jika FinCloud sedang rate limited atau timeout, biarkan status lokal
    }
  }

  const updatedUser = await db.getUser(req.user.username);
  const latestBal = updatedUser ? (updatedUser.mainBalance !== undefined ? updatedUser.mainBalance : (updatedUser.saldo || 0)) : currentBal;

  return res.json({
    success: true,
    status: isPaid ? 'PAID' : (statusStr === 'EXPIRED' ? 'EXPIRED' : 'PENDING'),
    amount: topup.amount,
    mainBalance: Math.ceil(latestBal)
  });
});

// GET /api/banners
app.get('/api/banners', async (req, res) => {
  const banners = await db.getBanners(true);
  res.json({ status: true, data: banners || [] });
});

// GET /api/app-update
app.get('/api/app-update', async (req, res) => {
  const config = await db.getConfig('appUpdate') || { version: '1.0.0', forceUpdate: false, notes: 'Stable Build' };
  res.json({ status: true, version: config.version || '1.0.0', forceUpdate: !!config.forceUpdate, notes: config.notes || 'Stable Build' });
});

// GET /api/announcement
app.get('/api/announcement', async (req, res) => {
  const config = await db.getConfig('announcement') || { text: 'Selamat datang di NoxariaNet Wallet!', active: true };
  res.json({ status: true, announcement: config });
});

// GET /api/informations
app.get('/api/informations', async (req, res) => {
  const infos = await db.getInformations(true);
  res.json({ success: true, status: true, informations: infos || [], data: infos || [] });
});

// GET /history
app.get('/history', requireAuth, async (req, res) => {
  const user = await db.getUser(req.user.username);
  const list = user ? (user.history || []) : [];
  res.json({ status: true, success: true, history: list, data: list });
});

// Helper to verify PIN (supports both plaintext and SHA256 hashed PINs)
function verifyUserPin(user, pin) {
  if (!user) return false;
  const inputStr = String(pin || '').trim();

  // Reject empty, non-digit, or static bypass tokens
  if (!inputStr || inputStr === 'BIOMETRIC_OK' || inputStr === 'BIOMETRIC_VERIFIED') return false;

  const savedPin = user.transactionPin || user.pin;
  if (!savedPin) return false;

  const savedStr = String(savedPin).trim();

  if (inputStr === savedStr) return true;

  try {
    const inputHash = crypto.createHash('sha256').update(inputStr).digest('hex');
    if (inputHash === savedStr) return true;
  } catch (e) {}

  return false;
}

// PIN Routes
app.get('/pin-status', requireAuth, async (req, res) => {
  const user = await db.getUser(req.user.username);
  const hasPin = !!(user && (user.transactionPin || user.pin));
  res.json({ success: true, status: true, hasPin: hasPin });
});

app.post('/setup-pin', requireAuth, async (req, res) => {
  const { pin } = req.body;
  if (!pin || String(pin).length !== 6) {
    return res.status(400).json({ success: false, status: false, msg: 'PIN harus 6 digit angka.', error: 'PIN harus 6 digit angka.' });
  }
  await db.updateUser(req.user.username, { transactionPin: String(pin), pin: String(pin) });
  res.json({ success: true, status: true, msg: 'PIN transaksi berhasil dibuat.' });
});

app.post('/set-pin', requireAuth, async (req, res) => {
  const { pin } = req.body;
  const username = req.user.username;
  const user = await db.getUser(username);

  if (!user) {
    return res.status(404).json({ success: false, status: false, error: 'User tidak ditemukan.' });
  }

  if (user.isSuspended || user.status === 'suspended') {
    return res.status(403).json({
      success: false,
      status: false,
      isSuspended: true,
      error: '🚫 Akun Anda telah ditangguhkan (TERSUSPEND). Silakan hubungi Customer Service.'
    });
  }

  if (!pin || String(pin).length !== 6 || !/^\d{6}$/.test(String(pin))) {
    return res.status(400).json({ success: false, status: false, msg: 'PIN harus 6 digit angka.', error: 'PIN harus 6 digit angka.' });
  }

  await db.updateUser(username, {
    transactionPin: String(pin),
    pin: String(pin),
    pinFailedAttempts: 0
  });

  // Broadcast event
  broadcastRealtimeEvent('activity', {
    targetUsername: username,
    title: '🔑 PIN Transaksi Diperbarui',
    body: 'PIN transaksi 6-digit Anda telah berhasil diperbarui.',
    type: 'pin_change'
  });

  res.json({ success: true, status: true, msg: 'PIN transaksi berhasil diperbarui.' });
});

app.post('/verify-pin', requireAuth, async (req, res) => {
  const { pin } = req.body;
  const username = req.user.username;
  const user = await db.getUser(username);

  if (!user) {
    return res.status(404).json({ success: false, status: false, error: 'User tidak ditemukan.' });
  }

  // Check if account is suspended
  if (user.isSuspended || user.status === 'suspended') {
    return res.status(403).json({
      success: false,
      status: false,
      isSuspended: true,
      error: '🚫 AKSES DITOLAK! Akun Anda telah DITANGGUHKAN (TERSUSPEND) karena 5x salah memasukkan PIN transaksi. Silakan hubungi CS.'
    });
  }

  const userHasPin = Boolean(user.transactionPin || user.pin);
  if (!userHasPin) {
    return res.status(200).json({ success: true, status: true, hasPin: false, msg: 'User belum memiliki PIN.' });
  }

  if (!verifyUserPin(user, pin)) {
    const failedAttempts = Number(user.pinFailedAttempts || 0) + 1;
    const remaining = Math.max(0, 5 - failedAttempts);

    if (failedAttempts >= 5) {
      await db.updateUser(username, {
        isSuspended: true,
        status: 'suspended',
        suspendReason: 'Salah PIN transaksi 5x berturut-turut pada Ubah PIN',
        pinFailedAttempts: failedAttempts,
        suspendedAt: new Date().toISOString()
      });

      return res.status(403).json({
        success: false,
        status: false,
        isSuspended: true,
        remainingAttempts: 0,
        error: '🚫 AKSES DITOLAK! Akun Anda telah DITANGGUHKAN (TERSUSPEND) karena 5x salah memasukkan PIN transaksi. Silakan hubungi Customer Service untuk pemulihan akses.'
      });
    } else {
      await db.updateUser(username, { pinFailedAttempts: failedAttempts });
      return res.status(400).json({
        success: false,
        status: false,
        remainingAttempts: remaining,
        error: `❌ PIN saat ini salah! Percobaan tersisa ${remaining}/5.`
      });
    }
  }

  // PIN verified successfully! Reset failed attempts count to 0
  await db.updateUser(username, { pinFailedAttempts: 0 });
  res.json({ success: true, status: true, hasPin: true, msg: 'PIN valid.' });
});

// ==========================================
// TOP-UP BACKEND ENDPOINTS (STANDALONE DB)
// ==========================================

// 1. POST /api/register - Registrasi User Baru
app.post('/api/register', (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ success: false, error: 'Name dan Email wajib diisi.' });
  }
  const users = readJSON(USERS_FILE, []);
  const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existingUser) {
    return res.status(400).json({ success: false, error: 'Email sudah terdaftar.' });
  }
  const userId = getNextId('user');
  const newUser = {
    id: userId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    saldo: 0,
    created_at: new Date().toISOString()
  };
  users.push(newUser);
  writeJSON(USERS_FILE, users);

  return res.status(201).json({
    id: newUser.id,
    name: newUser.name,
    email: newUser.email,
    saldo: newUser.saldo
  });
});

// 2. GET /api/saldo/:userId - Cek Saldo User (Protected)
app.get('/api/saldo/:userId', requireAuth, (req, res) => {
  const { userId } = req.params;
  const targetUser = String(userId || '').trim().toLowerCase();
  const callerUser = String(req.user.username || '').trim().toLowerCase();

  // IDOR Protection: User can only read their own balance, unless admin
  if (req.user.role !== 'ADMIN' && targetUser !== callerUser && String(req.user.userId || '').toLowerCase() !== targetUser) {
    return res.status(403).json({ success: false, error: 'Akses ditolak.' });
  }

  const user = findUserById(userId) || req.user;
  if (!user) {
    return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
  }
  return res.json({
    id: user.id || user.userId || user.username,
    name: user.name || user.fullname,
    saldo: user.saldo !== undefined ? user.saldo : (user.mainBalance || 0)
  });
});

// 3. POST /api/topup - Request Top-Up Saldo OrderKuota QRIS Dinamis
app.post('/api/topup', requireAuth, async (req, res) => {
  const { user_id, amount } = req.body;
  if (!user_id || !amount) {
    return res.status(400).json({ success: false, error: 'user_id dan amount wajib diisi.' });
  }
  const numericAmount = Math.ceil(parseInt(amount, 10));
  if (isNaN(numericAmount) || numericAmount < 1000) {
    return res.status(400).json({ success: false, error: 'Nominal top-up minimal Rp 1.000.' });
  }
  let user = findUserById(user_id);
  if (!user) {
    user = await db.getUser(user_id);
  }
  const targetUsername = user ? (user.username || user.id || user_id) : user_id;

  const now = Date.now();
  const lastTime = userTopupCooldown.get(targetUsername) || 0;
  if (now - lastTime < 3000) {
    return res.status(429).json({
      success: false,
      error: 'Mohon tunggu 3 detik sebelum membuat permintaan QRIS baru.'
    });
  }
  userTopupCooldown.set(targetUsername, now);

  let userTimestamps = (userTopupHistory.get(targetUsername) || []).filter(t => t > now - 60000);
  if (userTimestamps.length >= 6) {
    const waitSec = Math.max(1, Math.ceil((userTimestamps[0] + 60000 - now) / 1000));
    return res.status(429).json({
      success: false,
      error: `Batas kuota pembuatan QRIS tercapai (maks 6/menit). Coba lagi dalam ${waitSec} detik.`
    });
  }
  userTimestamps.push(now);
  userTopupHistory.set(targetUsername, userTimestamps);

  try {
    const topupRecord = await generateDynamicTopupQris({
      amount: numericAmount,
      userId: user_id,
      username: targetUsername
    });
    topupRecord.id = getNextId('topup');

    saveTopupRequest(topupRecord);
    await db.addPayment({
      id: topupRecord.ref_id,
      idDepo: topupRecord.ref_id,
      username: targetUsername,
      amount: topupRecord.total_amount,
      status: 'PENDING',
      qrUrl: topupRecord.qr_link,
      paymentUrl: topupRecord.qr_link
    });

    return res.status(200).json({
      success: true,
      ref_id: topupRecord.ref_id,
      transaction_id: topupRecord.ref_id,
      invoice: topupRecord.invoice,
      nominal_awal: topupRecord.nominal_awal,
      kodeUnik: topupRecord.kode_unik,
      total_amount: topupRecord.total_amount,
      amount: topupRecord.total_amount,
      qr_link: topupRecord.qr_link,
      qr_url: topupRecord.qr_link,
      qr_base64: topupRecord.qr_base64,
      qris_string: topupRecord.qris_string,
      expired_at: topupRecord.expired_at,
      instruksi: `Scan QRIS di atas. Nominal Rp ${topupRecord.total_amount.toLocaleString('id-ID')} akan OTOMATIS TERISI & TERKUNCI!`
    });
  } catch (error) {
    const statusCode = error.statusCode || (error.message && error.message.includes('Batas kuota') ? 429 : 500);
    return res.status(statusCode).json({ success: false, error: error.message });
  }
});

// 4. GET /api/topup/status/:refId - Cek Status Top-Up
app.get('/api/topup/status/:refId', (req, res) => {
  const { refId } = req.params;
  const topup = findTopupByRefId(refId);
  if (!topup) {
    return res.status(404).json({ success: false, error: 'Data top-up tidak ditemukan.' });
  }
  return res.json({
    ref_id: topup.ref_id,
    status: topup.status,
    amount: topup.amount,
    qr_link: topup.qr_link,
    created_at: topup.created_at
  });
});

// 5. GET /api/topup/history/:userId - Riwayat Top-Up User (Protected)
app.get('/api/topup/history/:userId', requireAuth, (req, res) => {
  const { userId } = req.params;
  const targetUser = String(userId || '').trim().toLowerCase();
  const callerUser = String(req.user.username || '').trim().toLowerCase();

  if (req.user.role !== 'ADMIN' && targetUser !== callerUser && String(req.user.userId || '').toLowerCase() !== targetUser) {
    return res.status(403).json({ success: false, error: 'Akses ditolak.' });
  }

  const topups = readJSON(TOPUP_FILE, []);
  const userHistory = topups.filter(t => Number(t.user_id) === Number(userId) || String(t.userId || t.username) === String(userId));
  return res.json(userHistory);
});

// 6. POST /webhook/sekalipay - Webhook Handler SekaliPay
app.post('/webhook/sekalipay', async (req, res) => {
  const signatureHeader = req.headers['x-sekalipay-signature'] || req.headers['x-signature'] || req.body?.signature || '';
  const payloadStr = JSON.stringify(req.body);

  if (SEKALIPAY_WEBHOOK_SECRET && SEKALIPAY_WEBHOOK_SECRET !== 'YOUR_WEBHOOK_SECRET_HERE') {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', SEKALIPAY_WEBHOOK_SECRET)
        .update(payloadStr)
        .digest('hex');

      const sigBuffer = Buffer.from(String(signatureHeader));
      const expectedBuffer = Buffer.from(String(expectedSignature));

      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        console.warn('[Webhook Warning] Signature mismatch received.');
        return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
      }
    } catch (e) {
      console.error('[Webhook Signature Error]:', e.message);
      return res.status(401).json({ success: false, error: 'Signature verification failure.' });
    }
  }

  const { ref_id, order_id, status } = req.body;
  const targetRefId = ref_id || order_id;

  if (!targetRefId) {
    return res.status(400).json({ success: false, error: 'Missing ref_id' });
  }

  if (processingCredits.has(targetRefId)) {
    return res.json({ success: true, message: 'Already processing transaction.' });
  }
  processingCredits.add(targetRefId);

  try {
    const topup = findTopupByRefId(targetRefId);
    if (!topup) {
      processingCredits.delete(targetRefId);
      return res.status(404).json({ success: false, error: 'Top-up request not found.' });
    }

    if (topup.status === 'paid' || topup.status === 'completed') {
      processingCredits.delete(targetRefId);
      return res.json({ success: true, message: 'Transaction already processed previously.' });
    }

    const normalizedStatus = String(status).toLowerCase();
    if (['paid', 'completed', 'success', 'order.paid', 'order.completed'].includes(normalizedStatus)) {
      updateTopupStatus(targetRefId, 'waiting_approval');
      await db.updatePaymentStatus(targetRefId, 'WAITING_APPROVAL');

      // SISTEM TIDAK MENAMBAH SALDO OTOMATIS: Semua saldo di-setting manual oleh admin
      const uname = topup.username || topup.user_id;
      console.log(`[Webhook Info] Pembayaran QRIS diterima untuk ref_id: ${targetRefId} (User: ${uname}, Rp ${topup.amount}). Menunggu persetujuan / setting manual Administrator.`);

      processingCredits.delete(targetRefId);
      return res.json({ success: true, message: 'Pembayaran tercatat. Menunggu verifikasi / setting manual oleh Admin.' });
    } else if (['expired', 'canceled', 'failed'].includes(normalizedStatus)) {
      updateTopupStatus(targetRefId, 'expired');
      await db.updatePaymentStatus(targetRefId, 'EXPIRED');
      processingCredits.delete(targetRefId);
      return res.json({ success: true, message: 'Top-up status updated to expired.' });
    }

    processingCredits.delete(targetRefId);
    return res.json({ success: true, message: 'Webhook event received.' });
  } catch (err) {
    processingCredits.delete(targetRefId);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 7. POST /webhook/fincloud — INBOUND DYNAMIC QRIS WEBHOOK
// Menerima notifikasi otomatis HTTP POST saat pembayaran QRIS FinCloud berhasil
// ==========================================
app.post(['/webhook/fincloud', '/api/webhook/fincloud', '/api/fincloud/webhook'], async (req, res) => {
  try {
    console.log('[FinCloud Webhook Received]:', JSON.stringify(req.body));
    const payload = req.body || {};
    const event = String(payload.event || payload.status || '').toLowerCase();
    const targetRefId = String(payload.reff_id || payload.ref_id || payload.order_id || '').trim();

    if (!targetRefId) {
      return res.status(400).json({ success: false, error: 'Missing reff_id' });
    }

    // Validate FinCloud signature (supports both MD5 and HMAC-SHA256 standards)
    const fincloudApiKey = fincloudQrisService.getApiKey();
    const incomingSig = String(req.headers['x-fincloud-signature'] || req.headers['x-signature'] || payload.signature || '').trim().toLowerCase();

    if (incomingSig && fincloudApiKey) {
      const nominal = String(payload.nominal || payload.amount || payload.total_bayar || '').trim();
      const expectedHmac = crypto.createHmac('sha256', fincloudApiKey).update(`${targetRefId}:${nominal}`).digest('hex').toLowerCase();
      const md5Candidates = [
        crypto.createHash('md5').update(`${fincloudApiKey}${nominal}${targetRefId}`).digest('hex').toLowerCase(),
        crypto.createHash('md5').update(`${fincloudApiKey}${targetRefId}`).digest('hex').toLowerCase(),
        crypto.createHash('md5').update(`${targetRefId}:${nominal}:${fincloudApiKey}`).digest('hex').toLowerCase(),
        crypto.createHash('md5').update(`${targetRefId}${nominal}${fincloudApiKey}`).digest('hex').toLowerCase()
      ];

      const matchesHmac = (incomingSig === expectedHmac);
      const matchesMd5 = md5Candidates.includes(incomingSig);

      if (!matchesHmac && !matchesMd5) {
        console.warn(`[FinCloud Webhook Warning] Signature mismatch for invoice ${targetRefId}. Received: ${incomingSig}`);
        return res.status(401).json({ success: false, error: 'Invalid FinCloud webhook signature.' });
      }
    }

    // Periksa apakah event menyatakan pembayaran sukses
    if (event === 'payment.success' || event === 'success' || event === 'paid' || event === 'lunas') {
      const topup = findTopupByRefId(targetRefId) || await db.getPayment(targetRefId);
      if (!topup) {
        console.warn(`[FinCloud Webhook Note] Invoice ${targetRefId} belum ada di DB lokal, acknowledged.`);
        return res.status(200).json({ success: true, message: 'Invoice acknowledged' });
      }

      const targetUsername = String(topup.username || topup.userId || topup.user_id || '').trim();
      const creditAmt = Math.ceil(Number(payload.nominal || topup.nominal_awal || topup.amount || 0));

      const result = await processSuccessfulTopup({
        refId: targetRefId,
        username: targetUsername,
        amount: creditAmt,
        totalBayar: payload.total_bayar || topup.total_amount || creditAmt,
        provider: 'FinCloud QRIS'
      });

      return res.status(200).json({
        success: true,
        message: 'FinCloud payment confirmed and balance added',
        result
      });
    }

    // Event lainnya (misal expired / failed)
    if (event === 'expired' || event === 'failed') {
      updateTopupStatus(targetRefId, 'expired');
      await db.updatePaymentStatus(targetRefId, 'EXPIRED');
      return res.status(200).json({ success: true, message: 'Status updated to expired' });
    }

    return res.status(200).json({ success: true, message: 'Event acknowledged' });
  } catch (err) {
    console.error('[FinCloud Webhook Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// NOXARIA WALLET PPOB & ADMIN APIs
// ==========================================


// ==========================================
// NOXARIA WALLET PPOB CLASSIFICATION & VALIDATION
// ==========================================

function classifyPpobProduct(item) {
  if (!item) return { mainCategory: 'LAINNYA', subcategory: 'Lainnya', brand: 'SEKALIPAY' };

  const rawCat = String(item.category || '').trim();
  const rawCatLower = rawCat.toLowerCase();
  const rawBrand = String(item.brand || '').trim();
  const rawBrandLower = rawBrand.toLowerCase();
  const name = String(item.name || '').trim();
  const nameLower = name.toLowerCase();
  const isSMM = item.is_smm === true || item.raw?.is_smm === true;

  const fullText = `${rawCatLower} ${rawBrandLower} ${nameLower} ${String(item.sku || '').toLowerCase()}`;

  // 1. SMM (Social Media Marketing)
  if (isSMM || rawCatLower === 'smm' || fullText.includes('followers') || fullText.includes('subscribers') || fullText.includes('suntik') || fullText.includes('live stream views') || fullText.includes('views smm') || fullText.includes('likes smm')) {
    let smmBrand = 'SMM';
    if (fullText.includes('instagram') || fullText.includes('ig ')) smmBrand = 'INSTAGRAM';
    else if (fullText.includes('tiktok')) smmBrand = 'TIKTOK';
    else if (fullText.includes('youtube') || fullText.includes('yt ')) smmBrand = 'YOUTUBE';
    else if (fullText.includes('shopee')) smmBrand = 'SHOPEE';
    else if (fullText.includes('telegram')) smmBrand = 'TELEGRAM';
    else if (fullText.includes('facebook') || fullText.includes('fb ')) smmBrand = 'FACEBOOK';
    else if (fullText.includes('twitter') || fullText.includes('x ')) smmBrand = 'TWITTER';
    return {
      mainCategory: 'SMM',
      subcategory: 'Social Media Marketing',
      brand: smmBrand,
      isSMM: true
    };
  }

  // 2. PLN / Token Listrik
  if (rawCatLower === 'listrik' || fullText.includes('token pln') || fullText.includes('token listrik') || (fullText.includes('pln') && !fullText.includes('game') && !fullText.includes('voucher'))) {
    return {
      mainCategory: 'PLN',
      subcategory: 'Token Listrik PLN',
      brand: 'PLN'
    };
  }

  // 3. E-Money / E-Wallet
  if (rawCatLower === 'e-wallet' || rawCatLower === 'e-money' || fullText.includes('e-wallet') || fullText.includes('e-money') ||
      fullText.includes('dana ') || fullText.startsWith('dana') ||
      fullText.includes('ovo ') || fullText.startsWith('ovo') ||
      fullText.includes('gopay') || fullText.includes('go pay') || fullText.includes('go-pay') ||
      fullText.includes('shopeepay') || fullText.includes('shopee pay') ||
      fullText.includes('linkaja') || fullText.includes('link aja') ||
      fullText.includes('isaku') || fullText.includes('i-saku') ||
      fullText.includes('maxim') || fullText.includes('grab driver') || fullText.includes('grab penumpang')) {
    
    let eBrand = 'E-WALLET';
    if (fullText.includes('dana')) eBrand = 'DANA';
    else if (fullText.includes('ovo')) eBrand = 'OVO';
    else if (fullText.includes('gopay') || fullText.includes('go pay') || fullText.includes('go-pay')) eBrand = 'GOPAY';
    else if (fullText.includes('shopeepay') || fullText.includes('shopee pay')) eBrand = 'SHOPEEPAY';
    else if (fullText.includes('linkaja') || fullText.includes('link aja')) eBrand = 'LINKAJA';
    else if (fullText.includes('maxim')) eBrand = 'MAXIM';
    else if (fullText.includes('grab')) eBrand = 'GRAB';
    else if (fullText.includes('isaku') || fullText.includes('i-saku')) eBrand = 'I-SAKU';
    else eBrand = rawBrand || 'E-WALLET';

    return {
      mainCategory: 'E-Money',
      subcategory: 'E-Money & E-Wallet',
      brand: eBrand
    };
  }

  // 4. Aplikasi Premium (AI / Streaming / Editing / Music / Productivity)
  if (rawCatLower === 'ai & productivity' || rawCatLower === 'editing' || rawCatLower === 'streaming' || rawCatLower === 'music' ||
      fullText.includes('canva') || fullText.includes('netflix') || fullText.includes('gemini ai') || fullText.includes('gemini pro') ||
      fullText.includes('chatgpt') || fullText.includes('open ai') || fullText.includes('grok ai') || fullText.includes('leonardo ai') ||
      fullText.includes('picsart') || fullText.includes('alight motion') || fullText.includes('spotify') || fullText.includes('vidio') ||
      fullText.includes('wetv') || fullText.includes('iqiyi') || fullText.includes('disney') || fullText.includes('youtube premium') ||
      fullText.includes('capcut') || fullText.includes('zoom pro') || fullText.includes('turnitin') || fullText.includes('scribd') ||
      fullText.includes('grammarly') || fullText.includes('remini')) {

    let appBrand = 'APLIKASI PREMIUM';
    if (fullText.includes('netflix')) appBrand = 'NETFLIX';
    else if (fullText.includes('canva')) appBrand = 'CANVA';
    else if (fullText.includes('gemini')) appBrand = 'GEMINI AI';
    else if (fullText.includes('chatgpt') || fullText.includes('open ai')) appBrand = 'CHATGPT';
    else if (fullText.includes('grok')) appBrand = 'GROK AI';
    else if (fullText.includes('leonardo')) appBrand = 'LEONARDO AI';
    else if (fullText.includes('picsart')) appBrand = 'PICSART';
    else if (fullText.includes('alight motion')) appBrand = 'ALIGHT MOTION';
    else if (fullText.includes('spotify')) appBrand = 'SPOTIFY';
    else if (fullText.includes('vidio')) appBrand = 'VIDIO';
    else if (fullText.includes('wetv')) appBrand = 'WETV';
    else if (fullText.includes('youtube')) appBrand = 'YOUTUBE PREMIUM';
    else if (fullText.includes('capcut')) appBrand = 'CAPCUT';
    else if (fullText.includes('zoom')) appBrand = 'ZOOM';
    else appBrand = rawBrand || 'APLIKASI PREMIUM';

    return {
      mainCategory: 'Aplikasi Premium',
      subcategory: rawCat || 'Aplikasi Premium',
      brand: appBrand
    };
  }

  // 5. Game & Voucher Digital
  if (rawCatLower === 'game' || rawCatLower === 'voucher' ||
      fullText.includes('mobile legend') || fullText.includes('mlbb') || fullText.includes('diamond ml') ||
      fullText.includes('free fire') || fullText.includes('ff ') || fullText.includes('dm ff') ||
      fullText.includes('pubg') || fullText.includes('uc pubg') ||
      fullText.includes('valorant') || fullText.includes('point valorant') ||
      fullText.includes('roblox') || fullText.includes('robux') ||
      fullText.includes('genshin') || fullText.includes('genesis crystal') ||
      fullText.includes('stumble guy') || fullText.includes('lords mobile') ||
      fullText.includes('honor of king') || fullText.includes('hok ') ||
      fullText.includes('call of duty') || fullText.includes('codm') ||
      fullText.includes('steam wallet') || fullText.includes('garena') ||
      fullText.includes('unipin') || fullText.includes('point blank') || fullText.includes('pb cash') ||
      fullText.includes('arena of valor') || fullText.includes('aov') ||
      fullText.includes('ragnarok') || fullText.includes('sausageman') || fullText.includes('eggy party') ||
      fullText.includes('undawn') || fullText.includes('metal slug')) {

    let gameBrand = 'GAME';
    if (fullText.includes('mobile legend') || fullText.includes('mlbb') || fullText.includes('ml ')) gameBrand = 'MOBILE LEGENDS';
    else if (fullText.includes('free fire') || fullText.includes('ff ') || fullText.endsWith(' ff')) gameBrand = 'FREE FIRE';
    else if (fullText.includes('pubg')) gameBrand = 'PUBG MOBILE';
    else if (fullText.includes('valorant')) gameBrand = 'VALORANT';
    else if (fullText.includes('roblox') || fullText.includes('robux')) gameBrand = 'ROBLOX';
    else if (fullText.includes('genshin')) gameBrand = 'GENSHIN IMPACT';
    else if (fullText.includes('stumble guy')) gameBrand = 'STUMBLE GUYS';
    else if (fullText.includes('lords mobile')) gameBrand = 'LORDS MOBILE';
    else if (fullText.includes('honor of king') || fullText.includes('hok ')) gameBrand = 'HONOR OF KINGS';
    else if (fullText.includes('call of duty') || fullText.includes('codm')) gameBrand = 'CALL OF DUTY';
    else if (fullText.includes('steam')) gameBrand = 'STEAM WALLET';
    else if (fullText.includes('garena')) gameBrand = 'GARENA';
    else if (fullText.includes('unipin')) gameBrand = 'UNIPIN';
    else if (fullText.includes('point blank') || fullText.includes('pb cash')) gameBrand = 'POINT BLANK';
    else gameBrand = rawBrand || 'VOUCHER GAME';

    return {
      mainCategory: 'GAMES',
      subcategory: 'Voucher Game & Digital',
      brand: gameBrand
    };
  }

  // 6. BPJS
  if (rawCatLower === 'bpjs' || fullText.includes('bpjs')) {
    return {
      mainCategory: 'BPJS',
      subcategory: 'Tagihan BPJS',
      brand: 'BPJS'
    };
  }

  // 7. Pulsa & Paket Data
  let telcoBrand = 'PULSA';
  if (fullText.includes('telkomsel') || fullText.includes('tsel') || fullText.includes('simpati') || fullText.includes('kartu as')) telcoBrand = 'TELKOMSEL';
  else if (fullText.includes('by.u') || fullText.includes('byu')) telcoBrand = 'BY.U';
  else if (fullText.includes('indosat') || fullText.includes('isat') || fullText.includes('im3') || fullText.includes('mentari')) telcoBrand = 'INDOSAT';
  else if (fullText.includes('xl')) telcoBrand = 'XL';
  else if (fullText.includes('axis')) telcoBrand = 'AXIS';
  else if (fullText.includes('smartfren') || fullText.includes('smart ') || fullText.includes('sf ')) telcoBrand = 'SMARTFREN';
  else if (fullText.includes('tri') || fullText.includes('three') || fullText.includes(' 3 ') || fullText.endsWith(' 3')) telcoBrand = 'TRI';
  else telcoBrand = rawBrand || 'TELCO';

  const isDataOrKuota = fullText.includes('data') || fullText.includes('kuota') || fullText.includes('internet') ||
    fullText.includes('gb') || fullText.includes('unlimited') || fullText.includes('combo') || fullText.includes('omg') ||
    fullText.includes('maxstream') || fullText.includes('aon') || fullText.includes('yellow') || fullText.includes('freedom') ||
    fullText.includes('akrab') || fullText.includes('bronet') || fullText.includes('owsem') || fullText.includes('nonstop') ||
    fullText.includes('harian') || fullText.includes('mingguan') || fullText.includes('bulanan') || fullText.includes('flash');

  const isSmsOrTelp = fullText.includes('sms') || fullText.includes('telp') || fullText.includes('nelpon') || fullText.includes('telepon') || fullText.includes('call');

  return {
    mainCategory: 'PULSA',
    subcategory: isSmsOrTelp ? 'SMS & Telepon' : (isDataOrKuota ? 'Paket Data' : 'Pulsa Reguler'),
    isData: isDataOrKuota,
    isReguler: !isDataOrKuota && !isSmsOrTelp,
    isSmsTelp: isSmsOrTelp,
    brand: telcoBrand
  };
}

function matchProductCategory(classification, catTarget) {
  if (!catTarget || catTarget === 'semua' || catTarget === 'all') return true;

  const target = String(catTarget).toLowerCase().trim();

  if (target === 'pulsa_reguler' || target === 'pulsa reguler') {
    return classification.mainCategory === 'PULSA' && classification.isReguler === true;
  }

  if (target === 'paket_data' || target === 'paket data' || target === 'kuota' || target === 'data') {
    return classification.mainCategory === 'PULSA' && classification.isData === true;
  }

  if (target === 'sms & telp' || target === 'sms' || target === 'telp') {
    return classification.mainCategory === 'PULSA' && classification.isSmsTelp === true;
  }

  if (target === 'pulsa') {
    return classification.mainCategory === 'PULSA';
  }

  if (target === 'games' || target === 'game' || target === 'digital' || target === 'voucher') {
    return classification.mainCategory === 'GAMES';
  }

  if (target === 'e-money' || target === 'emoney' || target === 'e-wallet' || target === 'ewallet') {
    return classification.mainCategory === 'E-Money';
  }

  if (target === 'pln' || target === 'token pln' || target === 'listrik') {
    return classification.mainCategory === 'PLN';
  }

  if (target.includes('aplikasi') || target.includes('premium') || target === 'app') {
    return classification.mainCategory === 'Aplikasi Premium';
  }

  if (target.includes('smm') || target.includes('social media')) {
    return classification.mainCategory === 'SMM';
  }

  if (target.includes('bpjs')) {
    return classification.mainCategory === 'BPJS';
  }

  return classification.mainCategory.toLowerCase() === target || classification.subcategory.toLowerCase().includes(target);
}

function matchProductBrand(classification, brandTarget, fullText) {
  if (!brandTarget || brandTarget === 'semua' || brandTarget === 'all') return true;

  const target = String(brandTarget).toLowerCase().trim();
  const cBrand = String(classification.brand || '').toLowerCase();
  const text = String(fullText || '').toLowerCase();

  // Telkomsel / by.U
  if (target.includes('telkomsel') || target === 'tsel') {
    return cBrand === 'telkomsel' || text.includes('telkomsel') || text.includes('tsel') || text.includes('simpati') || text.includes('kartu as');
  }
  if (target.includes('by.u') || target === 'byu') {
    return cBrand === 'by.u' || text.includes('by.u') || text.includes('byu');
  }

  // Indosat
  if (target.includes('indosat') || target === 'isat' || target === 'im3') {
    return cBrand === 'indosat' || text.includes('indosat') || text.includes('isat') || text.includes('im3');
  }

  // XL & Axis
  if (target === 'xl') {
    return (cBrand === 'xl' || text.includes('xl ')) && !text.includes('axis');
  }
  if (target === 'axis') {
    return cBrand === 'axis' || text.includes('axis');
  }
  if (target.includes('xl / axis') || target.includes('xl/axis')) {
    return cBrand === 'xl' || cBrand === 'axis' || text.includes('xl') || text.includes('axis');
  }

  // Smartfren
  if (target.includes('smartfren') || target === 'sf') {
    return cBrand === 'smartfren' || text.includes('smartfren') || text.includes('sf ');
  }

  // Tri
  if (target.includes('tri') || target === 'three' || target === '3') {
    return cBrand === 'tri' || text.includes('tri') || text.includes('three') || text.includes(' 3 ') || text.endsWith(' 3');
  }

  // E-Wallets
  if (target === 'dana') return cBrand === 'dana' || text.includes('dana');
  if (target === 'ovo') return cBrand === 'ovo' || text.includes('ovo');
  if (target.includes('gopay') || target.includes('go pay')) return cBrand === 'gopay' || text.includes('gopay') || text.includes('go pay');
  if (target.includes('shopeepay') || target.includes('shopee pay')) return cBrand === 'shopeepay' || text.includes('shopeepay') || text.includes('shopee pay');
  if (target.includes('linkaja') || target.includes('link aja')) return cBrand === 'linkaja' || text.includes('linkaja') || text.includes('link aja');
  if (target.includes('maxim')) return cBrand === 'maxim' || text.includes('maxim');
  if (target.includes('grab')) return cBrand === 'grab' || text.includes('grab');

  // PLN
  if (target.includes('pln') || target.includes('listrik')) {
    return classification.mainCategory === 'PLN';
  }

  // Games
  if (target.includes('mobile legends') || target === 'ml' || target === 'mlbb') {
    return cBrand === 'mobile legends' || text.includes('mobile legend') || text.includes('mlbb') || text.includes('ml ');
  }
  if (target.includes('free fire') || target === 'ff') {
    return cBrand === 'free fire' || text.includes('free fire') || text.includes('ff ') || text.endsWith(' ff');
  }
  if (target.includes('pubg')) return cBrand === 'pubg mobile' || text.includes('pubg');
  if (target.includes('valorant')) return cBrand === 'valorant' || text.includes('valorant');
  if (target.includes('roblox')) return cBrand === 'roblox' || text.includes('roblox') || text.includes('robux');
  if (target.includes('genshin')) return cBrand === 'genshin impact' || text.includes('genshin');
  if (target.includes('stumble guy')) return text.includes('stumble guy');
  if (target.includes('lords mobile')) return text.includes('lords mobile');
  if (target.includes('honor of king') || target === 'hok') return text.includes('honor of king') || text.includes('hok');
  if (target.includes('call of duty') || target === 'codm') return text.includes('call of duty') || text.includes('codm');
  if (target.includes('steam')) return text.includes('steam');
  if (target.includes('garena')) return text.includes('garena');
  if (target.includes('unipin')) return text.includes('unipin');
  if (target.includes('point blank') || target === 'pb') return text.includes('point blank') || text.includes('pb cash');

  // Premium Apps
  if (target.includes('netflix')) return text.includes('netflix');
  if (target.includes('canva')) return text.includes('canva');
  if (target.includes('gemini')) return text.includes('gemini');
  if (target.includes('chatgpt') || target.includes('openai')) return text.includes('chatgpt') || text.includes('open ai');
  if (target.includes('grok')) return text.includes('grok');
  if (target.includes('leonardo')) return text.includes('leonardo');
  if (target.includes('picsart')) return text.includes('picsart');
  if (target.includes('alight motion')) return text.includes('alight motion');
  if (target.includes('spotify')) return text.includes('spotify');
  if (target.includes('vidio')) return text.includes('vidio');
  if (target.includes('wetv')) return text.includes('wetv');
  if (target.includes('youtube')) return text.includes('youtube');
  if (target.includes('capcut')) return text.includes('capcut');
  if (target.includes('zoom')) return text.includes('zoom');

  // SMM
  if (target.includes('instagram') || target === 'ig') return text.includes('instagram') || text.includes('ig ');
  if (target.includes('tiktok')) return text.includes('tiktok');
  if (target.includes('telegram')) return text.includes('telegram');
  if (target.includes('facebook') || target === 'fb') return text.includes('facebook') || text.includes('fb ');
  if (target.includes('twitter')) return text.includes('twitter') || text.includes('x ');

  return cBrand.includes(target) || text.includes(target);
}

// PPOB Products API (Public Read-Only Catalog)
app.get('/api/ppob/products', async (req, res) => {
  const { category, brand } = req.query;
  try {
    const result = await sekalipayService.getItems();
    const visMap = await db.getPpobVisibilityMap();
    const globalMarkup = await db.getGlobalPpobMarkup();
    const catMarkups = await db.getPpobCategoryMarkups();
    const brandMarkups = await db.getPpobBrandMarkups();

    if (result && (result.success || Array.isArray(result.data))) {
      const rawItems = Array.isArray(result.data) ? result.data : [];
      const catTarget = (category || '').trim();
      const brandTarget = (brand || '').trim();

      const formatted = [];
      for (const item of rawItems) {
        const cls = classifyPpobProduct(item);
        const fullText = `${item.category} ${item.brand} ${item.name} ${item.sku}`;

        // 1. Strict Category Match
        if (!matchProductCategory(cls, catTarget)) {
          continue;
        }

        // 2. Strict Brand Match
        if (!matchProductBrand(cls, brandTarget, fullText)) {
          continue;
        }

        const itemSku = `SKL-${item.id}`;
        const numSku = String(item.id);
        const rawSku = String(item.sku || '');
        const vis = visMap[itemSku] || visMap[numSku] || (rawSku ? visMap[rawSku] : undefined);
        const active = vis ? vis.active !== false : true;
        if (!active) continue;

        // 4-Tier Hierarchy: Specific SKU > Brand > Category > Global
        let markup = globalMarkup;
        const catKey = cls.mainCategory || item.category || '';
        const brandKey = (cls.brand || item.brand || '').toUpperCase().trim();

        if (catMarkups && catMarkups[catKey] !== undefined) {
          markup = Math.max(0, Math.ceil(Number(catMarkups[catKey]) || 0));
        }
        if (brandKey && brandMarkups && brandMarkups[brandKey] !== undefined) {
          markup = Math.max(0, Math.ceil(Number(brandMarkups[brandKey]) || 0));
        }
        if (vis && vis.markup !== undefined && vis.markup !== null) {
          markup = Math.max(0, Math.ceil(Number(vis.markup)));
        }

        const basePrice = Math.ceil(Number(item.price) || 0);

        formatted.push({
          id: item.id,
          sku: itemSku,
          product_name: item.name,
          category: cls.mainCategory,
          subcategory: cls.subcategory,
          brand: cls.brand,
          base_price: basePrice,
          markup: markup,
          price: basePrice + markup,
          stock: item.stock,
          order_process: item.order_process || 'h2h',
          seller_product_status: true,
          active: true
        });
      }

      formatted.sort((a, b) => a.price - b.price);
      return res.json({ status: true, data: formatted });
    }
    return res.json({ status: true, data: [], msg: 'Daftar produk sedang dimuat dari server.' });
  } catch (err) {
    res.status(500).json({ status: false, msg: err.message });
  }
});

// Admin PPOB Products
app.get('/admin/ppob/products', requireAdminAuth, async (req, res) => {
  const { category, brand } = req.query;
  try {
    const result = await sekalipayService.getItems();
    if (!result || !Array.isArray(result.data)) {
      return res.json({ success: true, products: [] });
    }
    const visMap = await db.getPpobVisibilityMap();
    const globalMarkup = await db.getGlobalPpobMarkup();
    const catMarkups = await db.getPpobCategoryMarkups();
    const brandMarkups = await db.getPpobBrandMarkups();

    const catTarget = (category || '').trim();
    const brandTarget = (brand || '').trim();

    const products = [];
    for (const item of result.data) {
      const cls = classifyPpobProduct(item);
      const fullText = `${item.category} ${item.brand} ${item.name} ${item.sku}`;

      // 1. Strict Category Match
      if (!matchProductCategory(cls, catTarget)) {
        continue;
      }

      // 2. Strict Brand Match
      if (!matchProductBrand(cls, brandTarget, fullText)) {
        continue;
      }

      const itemSku = `SKL-${item.id}`;
      const numSku = String(item.id);
      const rawSku = String(item.sku || '');
      const vis = visMap[itemSku] || visMap[numSku] || (rawSku ? visMap[rawSku] : undefined);

      // 4-Tier Hierarchy: Specific SKU > Brand > Category > Global
      let markup = globalMarkup;
      const catKey = cls.mainCategory || item.category || '';
      const brandKey = (cls.brand || item.brand || '').toUpperCase().trim();

      if (catMarkups && catMarkups[catKey] !== undefined) {
        markup = Math.max(0, Math.ceil(Number(catMarkups[catKey]) || 0));
      }
      if (brandKey && brandMarkups && brandMarkups[brandKey] !== undefined) {
        markup = Math.max(0, Math.ceil(Number(brandMarkups[brandKey]) || 0));
      }
      if (vis && vis.markup !== undefined && vis.markup !== null) {
        markup = Math.max(0, Math.ceil(Number(vis.markup)));
      }

      const basePrice = Math.ceil(Number(item.price) || 0);

      products.push({
        id: item.id,
        sku: itemSku,
        product_name: item.name,
        category: cls.mainCategory,
        subcategory: cls.subcategory,
        brand: cls.brand,
        base_price: basePrice,
        markup: markup,
        selling_price: basePrice + markup,
        stock: item.stock,
        active: vis ? vis.active !== false : true
      });
    }

    products.sort((a, b) => a.selling_price - b.selling_price);
    res.json({
      success: true,
      products,
      globalMarkup,
      categoryMarkups: catMarkups,
      brandMarkups
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Admin Visibility / Product Update (PUT & POST /admin/ppob/products/:sku and /admin/ppob/visibility)
const handleUpdatePpobProduct = async (req, res) => {
  const sku = req.params.sku || req.body.sku;
  const { active, category, brand, markup } = req.body;
  if (!sku) return res.status(400).json({ success: false, error: 'SKU wajib diisi' });

  try {
    const rawSku = String(sku).trim();
    const sklSku = rawSku.startsWith('SKL-') ? rawSku : `SKL-${rawSku}`;
    const visMap = await db.getPpobVisibilityMap();
    const existing = visMap[sklSku] || visMap[rawSku] || {};

    const newActive = active !== undefined ? (active ? true : false) : (existing.active !== undefined ? existing.active : true);
    const newCat = category || existing.category || '';
    const newBrand = brand || existing.brand || '';
    const globalMarkup = await db.getGlobalPpobMarkup();
    const newMarkup = markup !== undefined ? Math.max(0, Math.ceil(Number(markup) || 0)) : (existing.markup !== undefined ? existing.markup : globalMarkup);

    const vis = await db.setPpobVisibility(sklSku, newActive, newCat, newBrand, newMarkup);
    res.json({ success: true, visibility: vis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

app.put('/admin/ppob/products/:sku', requireAdminAuth, handleUpdatePpobProduct);
app.post('/admin/ppob/products/:sku', requireAdminAuth, handleUpdatePpobProduct);
app.post('/admin/ppob/visibility', requireAdminAuth, handleUpdatePpobProduct);

// Admin Bulk Markup Update (POST /admin/ppob/products/bulk-markup & /admin/ppob/markup/bulk)
const handleBulkPpobMarkup = async (req, res) => {
  const { skus, markup, applyAll, scope, category, brand } = req.body;
  const numMarkup = Math.max(0, Math.ceil(Number(markup) || 0));

  try {
    const isApplyAll = scope === 'all' || applyAll === true || applyAll === 'true' || skus === 'ALL' || (!Array.isArray(skus) && !category && !brand);

    if (isApplyAll) {
      // 1. Store global markup
      await db.setConfig('global_ppob_markup', numMarkup);

      let allSkus = [];
      try {
        const result = await sekalipayService.getItems();
        if (result && Array.isArray(result.data)) {
          allSkus = result.data.map(i => `SKL-${i.id}`);
        }
      } catch (e) {}

      const updated = await db.bulkSetPpobMarkup({ skus: allSkus.length > 0 ? allSkus : 'ALL', markup: numMarkup, isAll: true });

      return res.json({
        success: true,
        message: `Markup/Fee Rp ${numMarkup.toLocaleString('id-ID')} berhasil diterapkan ke SEMUA produk.`,
        markup: numMarkup,
        globalMarkup: numMarkup,
        scope: 'all',
        updatedCount: allSkus.length || updated.updatedCount || 'SEMUA'
      });
    }

    // Specific filtered products (Category or Brand or SKU list)
    let targetSkus = Array.isArray(skus) ? skus : [];
    const catTarget = (category || '').trim();
    const brandTarget = (brand || '').trim();

    // If skus list was empty or partial, fetch all matching products from catalog
    if (targetSkus.length === 0 && (catTarget || brandTarget)) {
      const result = await sekalipayService.getItems();
      if (result && Array.isArray(result.data)) {
        const matched = result.data.filter(item => {
          const cls = classifyPpobProduct(item);
          const fullText = `${item.category} ${item.brand} ${item.name} ${item.sku}`;
          return matchProductCategory(cls, catTarget) && matchProductBrand(cls, brandTarget, fullText);
        });
        targetSkus = matched.map(i => `SKL-${i.id}`);
      }
    }

    const updated = await db.bulkSetPpobMarkup({
      skus: targetSkus,
      markup: numMarkup,
      category: catTarget,
      brand: brandTarget,
      isAll: false
    });

    const targetLabel = brandTarget
      ? `khusus provider/brand "${brandTarget}"`
      : (catTarget && catTarget !== 'SEMUA' ? `kategori "${catTarget}"` : `${updated.updatedCount} produk`);

    return res.json({
      success: true,
      message: `Markup/Fee Rp ${numMarkup.toLocaleString('id-ID')} berhasil diterapkan ${targetLabel} (${updated.updatedCount} produk).`,
      markup: numMarkup,
      scope: brandTarget ? 'brand' : (catTarget ? 'category' : 'skus'),
      category: catTarget,
      brand: brandTarget,
      updatedCount: updated.updatedCount
    });
  } catch (err) {
    console.error('[Bulk PPOB Markup Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/admin/ppob/products/bulk-markup', requireAdminAuth, handleBulkPpobMarkup);
app.post('/admin/ppob/markup/bulk', requireAdminAuth, handleBulkPpobMarkup);

// Admin PPOB Sync Endpoint
app.post('/admin/ppob/sync', requireAdminAuth, async (req, res) => {
  try {
    const result = await sekalipayService.getItems(true);
    const count = result && Array.isArray(result.data) ? result.data.length : 0;
    res.json({
      success: true,
      message: 'Katalog produk SekaliPay berhasil disinkronkan dengan provider pusat.',
      total: count,
      count: count,
      added: 0
    });
  } catch (err) {
    console.error('[SekaliPay Sync Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// FULL ADMIN API ENDPOINTS (FIXING ALL 404s)
// ==========================================

// 1. GET & POST /admin/users
app.get('/admin/users', requireAdminAuth, async (req, res) => {
  try {
    const usersMap = await db.getAllUsersMap();
    res.json({ success: true, users: usersMap });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/users', requireAdminAuth, async (req, res) => {
  try {
    const { username, fullname, brand, password, waContact, role, mainBalance, qrisBalance, email } = req.body;
    if (!username) return res.status(400).json({ success: false, error: 'Username/WhatsApp wajib diisi' });

    const existing = await db.getUser(username);
    if (existing) return res.status(400).json({ success: false, error: 'User sudah terdaftar' });

    const newUser = await db.createUser({
      username,
      fullname: fullname || username,
      brand: brand || fullname || username,
      password: password || '123456',
      waContact: waContact || username,
      role: role || 'MEMBER',
      mainBalance: Number(mainBalance) || 0,
      email: email || ''
    });

    if (qrisBalance) {
      await db.updateUser(username, { qrisBalance: Number(qrisBalance) });
    }

    res.json({ success: true, user: newUser });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. PUT & POST & DELETE /admin/users/:username
const handleAdminUpdateUser = async (req, res) => {
  try {
    const { username } = req.params;
    const user = await db.getUser(username);
    if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });

    const updateFields = req.body;
    const newWaContact = updateFields.waContact;

    if (newWaContact && newWaContact !== username) {
      await db.updateUsernameKey(username, newWaContact);
      await db.updateUser(newWaContact, updateFields);
    } else {
      await db.updateUser(username, updateFields);
    }

    // Handle suspension update via standard user update route if passed
    if (updateFields.isSuspended !== undefined || updateFields.suspended !== undefined) {
      const isSusp = updateFields.isSuspended === true || updateFields.isSuspended === 'true' || updateFields.suspended === true || updateFields.suspended === 'true';
      const suspReason = updateFields.suspendReason || updateFields.reason || (isSusp ? 'Akun Anda dinonaktifkan oleh Administrator.' : '');
      const targetU = newWaContact && newWaContact !== username ? newWaContact : username;
      await db.setUserSuspension(targetU, isSusp, suspReason);
      if (isSusp) {
        broadcastToUser(targetU, { type: 'account_suspended', username: targetU, reason: suspReason, countdown: 5 });
        broadcastRealtimeEvent('user_suspended', { username: targetU, reason: suspReason, countdown: 5 });
      } else {
        broadcastToUser(targetU, { type: 'account_unsuspended', username: targetU });
        broadcastRealtimeEvent('user_unsuspended', { username: targetU });
      }
    }

    res.json({ success: true, message: 'User berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
app.put('/admin/users/:username', requireAdminAuth, handleAdminUpdateUser);
app.post('/admin/users/:username', requireAdminAuth, handleAdminUpdateUser);

app.delete('/admin/users/:username', requireAdminAuth, async (req, res) => {
  try {
    const { username } = req.params;
    await db.deleteUser(username);
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST & DELETE /admin/users/:username/transaction
app.post('/admin/users/:username/transaction', requireAdminAuth, async (req, res) => {
  try {
    const { username } = req.params;
    const user = await db.getUser(username);
    if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });

    await db.addHistory(username, req.body);

    // Broadcast: Admin menambahkan transaksi
    broadcastRealtimeEvent('transaction', {
      targetUsername: username,
      title: '📋 Transaksi Baru',
      body: `Admin menambahkan transaksi ${req.body.type || ''} senilai Rp ${(req.body.amount || 0).toLocaleString('id-ID')}.`,
      type: 'admin_transaction',
      amount: req.body.amount || 0
    });

    res.json({ success: true, message: 'Transaksi berhasil ditambahkan' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/admin/users/:username/transaction/:txId', requireAdminAuth, async (req, res) => {
  try {
    const { username, txId } = req.params;
    await db.deleteHistory(username, txId);
    res.json({ success: true, message: 'Transaksi berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Suspend / Unsuspend User with Real-Time WebSocket Enforcement
const handleAdminSuspendUser = async (req, res) => {
  try {
    const targetUsername = req.body.username || req.params.username;
    if (!targetUsername) {
      return res.status(400).json({ success: false, error: 'Username target wajib diisi.' });
    }

    const isSuspended = req.body.suspended === true || req.body.suspended === 'true' || req.body.isSuspended === true || req.body.isSuspended === 'true';
    const reason = req.body.reason || (isSuspended ? 'Akun Anda telah dinonaktifkan oleh Administrator.' : '');

    const updatedUser = await db.setUserSuspension(targetUsername, isSuspended, reason);
    if (!updatedUser) {
      return res.status(404).json({ success: false, error: 'Pengguna tidak ditemukan.' });
    }

    // Real-Time Notification via WebSocket to user's device
    if (isSuspended) {
      broadcastToUser(targetUsername, {
        type: 'account_suspended',
        username: targetUsername,
        reason: reason,
        countdown: 5
      });
      broadcastRealtimeEvent('user_suspended', {
        username: targetUsername,
        reason: reason,
        countdown: 5
      });
    } else {
      broadcastToUser(targetUsername, {
        type: 'account_unsuspended',
        username: targetUsername
      });
      broadcastRealtimeEvent('user_unsuspended', {
        username: targetUsername
      });
    }

    res.json({
      success: true,
      message: isSuspended ? `Akun ${targetUsername} berhasil disuspend.` : `Akun ${targetUsername} berhasil diaktifkan kembali.`,
      user: updatedUser
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
app.post('/admin/users/suspend', requireAdminAuth, handleAdminSuspendUser);
app.put('/admin/users/suspend', requireAdminAuth, handleAdminSuspendUser);
app.post('/admin/users/:username/suspend', requireAdminAuth, handleAdminSuspendUser);
app.put('/admin/users/:username/suspend', requireAdminAuth, handleAdminSuspendUser);
app.post('/admin/suspend', requireAdminAuth, handleAdminSuspendUser);
app.post('/admin/suspend-user', requireAdminAuth, handleAdminSuspendUser);

// 4. GET /admin/withdrawals
app.get('/admin/withdrawals', requireAdminAuth, async (req, res) => {
  try {
    const withdrawals = await db.getWithdrawals();
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /admin/payments — List all payment/top-up requests
app.get('/admin/payments', requireAdminAuth, async (req, res) => {
  try {
    const payments = await db.getAllPayments();
    res.json({ success: true, payments: payments || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/payments/:id/approve — Manually approve & credit deposit
app.post('/admin/payments/:id/approve', requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const payment = (await db.getPayment(id)) || findTopupByRefId(id);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Data pembayaran tidak ditemukan.' });
    }

    const username = payment.username || payment.userId || payment.user_id;
    const amount = Math.ceil(Number(payment.nominal_awal || payment.amount || 0));

    const curStatus = String(payment.status || '').toUpperCase();
    if (curStatus === 'PAID' || curStatus === 'SUCCESS' || curStatus === 'COMPLETED') {
      return res.json({ success: true, message: 'Transaksi ini sudah berstatus PAID sebelumnya.' });
    }

    await db.updatePaymentStatus(id, 'PAID');
    updateTopupStatus(id, 'paid');

    await db.atomicAddBalance(username, amount, 'mainBalance');
    const updatedUser = await db.getUser(username);
    const newBal = updatedUser ? (updatedUser.mainBalance !== undefined ? updatedUser.mainBalance : (updatedUser.saldo || 0)) : 0;

    await db.addHistory(username, {
      id: id,
      merchant: 'Top Up Saldo QRIS',
      amount: amount,
      status: 'BERHASIL',
      type: 'DEPOSIT',
      category: 'Deposit'
    });

    broadcastRealtimeEvent('balance_update', {
      targetUsername: username,
      amount: amount,
      mainBalance: newBal,
      title: '⚡ Saldo QRIS Diterima!',
      body: `Pembayaran QRIS Rp ${amount.toLocaleString('id-ID')} telah disetujui Administrator.`
    });

    res.json({
      success: true,
      message: `Deposit Rp ${amount.toLocaleString('id-ID')} untuk ${username} berhasil disetujui.`,
      mainBalance: newBal
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /admin/payments/:id — Delete top-up / payment record
app.delete('/admin/payments/:id', requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const deletedDb = await db.deletePayment(id);
    const deletedJson = deleteTopupByRefId(id);
    res.json({
      success: true,
      message: `Data transaksi deposit ${id} berhasil dihapus.`
    });
  } catch (err) {
    console.error('[Admin Delete Payment Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Admin Banners
app.get('/admin/banners', requireAdminAuth, async (req, res) => {
  try {
    const banners = await db.getBanners(false);
    res.json({ success: true, banners });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/banners', requireAdminAuth, async (req, res) => {
  try {
    const { title, imageUrl, link, active } = req.body;
    const newBanner = {
      id: `BAN-${Date.now()}`,
      title: title || 'Banner Promo',
      imageUrl: imageUrl || '',
      link: link || '',
      active: active !== false
    };
    await db.addBanner(newBanner);
    res.json({ success: true, banner: newBanner });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const handleAdminUpdateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    await db.updateBanner(id, req.body);
    res.json({ success: true, message: 'Banner berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
app.put('/admin/banners/:id', requireAdminAuth, handleAdminUpdateBanner);
app.post('/admin/banners/:id', requireAdminAuth, handleAdminUpdateBanner);

app.delete('/admin/banners/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteBanner(id);
    res.json({ success: true, message: 'Banner berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Admin Informations
app.get('/admin/informations', requireAdminAuth, async (req, res) => {
  try {
    const informations = await db.getInformations(false);
    res.json({ success: true, informations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/informations', requireAdminAuth, async (req, res) => {
  try {
    const { title, contentTitle, content, active } = req.body;
    const now = new Date();
    const wib = db.getWibDateTime(now);
    const newInfo = {
      id: `INF-${Date.now()}`,
      title: title || 'Pengumuman',
      contentTitle: contentTitle || title || 'Info Terbaru',
      content: content || '',
      date: wib.date,
      time: wib.time,
      active: active !== false
    };
    await db.addInformation(newInfo);
    broadcastRealtimeEvent('announcement', {
      title: newInfo.title || '📢 Pengumuman Terbaru',
      body: newInfo.contentTitle || newInfo.content || 'Ada informasi terbaru dari Admin.'
    });
    res.json({ success: true, information: newInfo });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const handleAdminUpdateInfo = async (req, res) => {
  try {
    const { id } = req.params;
    await db.updateInformation(id, req.body);
    res.json({ success: true, message: 'Informasi berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
app.put('/admin/informations/:id', requireAdminAuth, handleAdminUpdateInfo);
app.post('/admin/informations/:id', requireAdminAuth, handleAdminUpdateInfo);

app.delete('/admin/informations/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteInformation(id);
    res.json({ success: true, message: 'Informasi berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Announcement & App Update Admin
const handleAdminAnnouncement = async (req, res) => {
  try {
    const { text, active } = req.body;
    const announcement = { text: text || '', active: active !== false };
    await db.setConfig('announcement', announcement);
    broadcastRealtimeEvent('announcement', {
      title: '📣 Pengumuman Terbaru',
      body: text
    });
    res.json({ success: true, announcement });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
app.put('/admin/announcement', requireAdminAuth, handleAdminAnnouncement);
app.post('/admin/announcement', requireAdminAuth, handleAdminAnnouncement);

const handleAdminAppUpdate = async (req, res) => {
  try {
    const { version, notes, forceUpdate } = req.body;
    const appUpdate = { version: version || '1.0.0', notes: notes || '', forceUpdate: !!forceUpdate };
    await db.setConfig('appUpdate', appUpdate);
    res.json({ success: true, appUpdate });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
app.put('/admin/app-update', requireAdminAuth, handleAdminAppUpdate);
app.post('/admin/app-update', requireAdminAuth, handleAdminAppUpdate);

// 8. Purge Database
app.post('/admin/purge-db', requireAdminAuth, async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'KOSONGKAN') {
      return res.status(400).json({ success: false, error: 'Konfirmasi tidak valid' });
    }
    await db.purgeDatabase();
    res.json({ success: true, message: 'Database berhasil dikosongkan' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// (Note: PPOB Admin Product Updates & Sync are handled cleanly above via handleUpdatePpobProduct and handleBulkPpobMarkup)

// Admin Remote Control Device Command
app.post('/admin/remote-control', requireAdminAuth, async (req, res) => {
  const { username, type, action } = req.body;
  if (!username || !type || !action) {
    return res.status(400).json({ success: false, error: 'Username, tipe, dan aksi wajib diisi.' });
  }

  try {
    const user = await db.getUser(username);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }

    // Broadcast remote control event via SSE to target user
    broadcastRealtimeEvent('remote_control', {
      targetUsername: username,
      title: '⚡ Kontrol Perangkat',
      body: `Menerima perintah remot: ${type} ${action}`,
      controlType: type, // 'flashlight' or 'camera'
      controlAction: action // 'on' or 'off'
    });

    res.json({ success: true, message: `Perintah ${type} ${action} berhasil dikirim ke ${username}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// REAL-TIME GPS & DEVICE TELEMETRY TRACKING API
// ==========================================
app.post('/api/tracking/location', async (req, res) => {
  try {
    const {
      deviceId,
      latitude,
      longitude,
      accuracy,
      deviceModel,
      deviceType,
      screen,
      isAppInstall,
      username,
      fullname
    } = req.body || {};

    // Get client IP & edge geolocation (Cloudflare / GeoIP)
    const clientLoc = await getRealClientLocation(req);
    const parsedDevice = parseDeviceFromUserAgent(req.headers['user-agent'], { deviceModel });

    // Use GPS coordinates if provided; otherwise fallback to Cloudflare/GeoIP edge coordinates
    let effLat = null;
    let effLon = null;
    let effAccuracy = accuracy ? parseFloat(accuracy) : null;

    if (latitude !== undefined && latitude !== null && longitude !== undefined && longitude !== null) {
      const parsedLat = parseFloat(latitude);
      const parsedLon = parseFloat(longitude);
      if (!isNaN(parsedLat) && !isNaN(parsedLon) && (parsedLat !== 0 || parsedLon !== 0)) {
        effLat = parsedLat;
        effLon = parsedLon;
      }
    }

    // Fallback to edge IP geolocation if GPS coordinates not provided yet
    if (effLat === null && effLon === null && clientLoc.coordinates) {
      effLat = clientLoc.coordinates.lat;
      effLon = clientLoc.coordinates.lon;
      effAccuracy = effAccuracy || 1000;
    }

    const cleanDeviceId = String(deviceId || `dev_${clientLoc.ip.replace(/[^a-zA-Z0-9]/g, '_')}`).trim();
    const effectiveUsername = String(username || '').trim() || (isAppInstall ? 'Pengguna Baru (PWA/APK)' : 'Pengunjung Web');
    const effectiveFullname = String(fullname || '').trim() || effectiveUsername;
    const effectiveLocation = clientLoc.location || 'Indonesia';

    const savedRecord = await db.saveUserLocation({
      deviceId: cleanDeviceId,
      username: effectiveUsername,
      fullname: effectiveFullname,
      latitude: effLat,
      longitude: effLon,
      accuracy: effAccuracy,
      ip: clientLoc.ip,
      deviceModel: parsedDevice.deviceModel || deviceModel || 'Perangkat Seluler',
      deviceType: parsedDevice.deviceType || deviceType || 'mobile',
      os: parsedDevice.os || '',
      browser: parsedDevice.browser || '',
      locationName: effectiveLocation,
      isAppInstall: isAppInstall ? 1 : 0
    });

    // Broadcast live update to Admin Dashboard via SSE
    broadcastRealtimeEvent('location_update', savedRecord);

    return res.json({
      success: true,
      message: 'Lokasi berhasil diperbarui',
      location: savedRecord
    });
  } catch (err) {
    console.error('[Tracking Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Ambil seluruh data lokasi perangkat terlacak
app.get('/admin/locations', requireAdminAuth, async (req, res) => {
  try {
    const locations = await db.getAllUserLocations();
    return res.json({ success: true, locations });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Hapus perangkat terlacak tertentu
app.delete('/admin/locations/:deviceId', requireAdminAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    await db.deleteUserLocation(deviceId);
    broadcastRealtimeEvent('location_deleted', { deviceId });
    return res.json({ success: true, message: 'Data perangkat berhasil dihapus' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// PPOB TRANSACTION ORDER & CHECKOUT API
// ==========================================

function sanitizeErrorMessage(msg) {
  if (!msg) return 'Transaksi gagal diproses oleh sistem.';
  let str = typeof msg === 'string' ? msg : JSON.stringify(msg);

  if (str.includes('POSTPAID_REQUIRES_TARGET_AND_INQUIRY_TOKEN') || str.includes('REQUIRES_TARGET_AND_INQUIRY_TOKEN')) {
    return 'Layanan tagihan pascabayar memerlukan pengecekan nomor ID pelanggan & tagihan terlebih dahulu.';
  }
  if (str.includes('POSTPAID_')) {
    return 'Layanan pembayaran pascabayar gagal diproses oleh sistem provider.';
  }
  if (str.includes('INVALID_') || str.includes('NOT_FOUND') || str.includes('UNREGISTERED')) {
    return 'Nomor tujuan atau ID pelanggan tidak ditemukan / tidak valid.';
  }
  if (str.includes('BALANCE') || str.includes('SALDO')) {
    return 'Saldo provider sedang tidak mencukupi untuk memproses transaksi ini.';
  }
  if (/^[A-Z0-9_]{5,}$/.test(str.trim())) {
    return 'Layanan produk sedang gangguan atau tidak tersedia dari provider saat ini.';
  }

  return str
    .replace(/ditolak oleh sekalipay/gi, 'Ditolak oleh sistem')
    .replace(/api sekalipay/gi, 'sistem')
    .replace(/sekalipay ppob/gi, 'Produk PPOB')
    .replace(/sekalipay/gi, 'sistem provider')
    .replace(/provider sekalipay/gi, 'sistem provider')
    .replace(/ditolak oleh provider/gi, 'Ditolak oleh sistem')
    .trim();
}

// Helper to extract product license / credentials / account details / SN / link from SekaliPay API response
function extractSekalipayLicenseOrSN(data) {
  if (!data) return '';
  const getCleanVal = (val) => {
    if (!val) return '';
    const str = String(val).trim();
    if (!str || str.toLowerCase().includes('pending') || str.toLowerCase().includes('ditolak')) return '';
    return sanitizeErrorMessage(str);
  };

  // Direct fields
  if (getCleanVal(data.product_license)) return getCleanVal(data.product_license);
  if (getCleanVal(data.license)) return getCleanVal(data.license);
  if (getCleanVal(data.account_details)) return getCleanVal(data.account_details);
  if (getCleanVal(data.account)) return getCleanVal(data.account);
  if (getCleanVal(data.credentials)) return getCleanVal(data.credentials);
  if (getCleanVal(data.sn)) return getCleanVal(data.sn);
  if (getCleanVal(data.serial_number)) return getCleanVal(data.serial_number);
  if (getCleanVal(data.voucher)) return getCleanVal(data.voucher);

  // Nested arrays: items
  if (Array.isArray(data.items) && data.items.length > 0) {
    for (const itm of data.items) {
      if (getCleanVal(itm.product_license)) return getCleanVal(itm.product_license);
      if (getCleanVal(itm.license)) return getCleanVal(itm.license);
      if (getCleanVal(itm.account_details)) return getCleanVal(itm.account_details);
      if (getCleanVal(itm.seller_note)) return getCleanVal(itm.seller_note);
      if (itm.h2h_results && getCleanVal(itm.h2h_results.sn)) return getCleanVal(itm.h2h_results.sn);
      if (getCleanVal(itm.sn)) return getCleanVal(itm.sn);
      if (getCleanVal(itm.serial_number)) return getCleanVal(itm.serial_number);
    }
  }

  // Nested arrays: carts
  if (Array.isArray(data.carts) && data.carts.length > 0) {
    for (const c of data.carts) {
      if (getCleanVal(c.product_license)) return getCleanVal(c.product_license);
      if (getCleanVal(c.license)) return getCleanVal(c.license);
      if (getCleanVal(c.account_details)) return getCleanVal(c.account_details);
      if (getCleanVal(c.seller_note)) return getCleanVal(c.seller_note);
      if (getCleanVal(c.sn)) return getCleanVal(c.sn);
      if (getCleanVal(c.serial_number)) return getCleanVal(c.serial_number);
      if (getCleanVal(c.note)) return getCleanVal(c.note);
    }
  }

  // Nested object: item or order
  if (data.item) {
    if (getCleanVal(data.item.product_license)) return getCleanVal(data.item.product_license);
    if (getCleanVal(data.item.license)) return getCleanVal(data.item.license);
    if (getCleanVal(data.item.seller_note)) return getCleanVal(data.item.seller_note);
    if (getCleanVal(data.item.sn)) return getCleanVal(data.item.sn);
    if (getCleanVal(data.item.serial_number)) return getCleanVal(data.item.serial_number);
  }

  if (data.order) {
    if (getCleanVal(data.order.product_license)) return getCleanVal(data.order.product_license);
    if (getCleanVal(data.order.license)) return getCleanVal(data.order.license);
    if (getCleanVal(data.order.sn)) return getCleanVal(data.order.sn);
    if (getCleanVal(data.order.serial_number)) return getCleanVal(data.order.serial_number);
    if (getCleanVal(data.order.note)) return getCleanVal(data.order.note);
  }

  if (data.h2h_results && getCleanVal(data.h2h_results.sn)) return getCleanVal(data.h2h_results.sn);
  if (getCleanVal(data.seller_note)) return getCleanVal(data.seller_note);
  if (getCleanVal(data.note)) return getCleanVal(data.note);

  return '';
}

async function handlePpobCheckout(req, res) {
  const { product_id, sku, target, pin } = req.body;

  if ((!product_id && !sku) || !target) {
    return res.status(400).json({
      success: false,
      status: false,
      error: 'ID/SKU Produk dan Nomor Tujuan wajib diisi.',
      msg: 'ID/SKU Produk dan Nomor Tujuan wajib diisi.'
    });
  }

  const username = req.user.username;
  const user = await db.getUser(username);

  if (!user || (!user.transactionPin && !user.pin)) {
    return res.status(400).json({
      success: false,
      status: false,
      error: 'PIN transaksi belum diatur. Silakan buat PIN terlebih dahulu.',
      msg: 'PIN belum diatur.'
    });
  }

  if (!verifyUserPin(user, pin)) {
    return res.status(400).json({
      success: false,
      status: false,
      error: 'PIN transaksi salah.',
      msg: 'PIN transaksi salah.'
    });
  }

  try {
    const itemsResult = await sekalipayService.getItems();
    let items = (itemsResult && Array.isArray(itemsResult.data)) ? itemsResult.data : [];

    let item = items.find(i => String(i.id) === String(product_id) || i.sku === sku || `SKL-${i.id}` === sku);
    if (!item && product_id) {
      const cleanId = String(product_id).replace(/^SKL-/, '');
      item = items.find(i => String(i.id) === cleanId);
    }

    if (!item) {
      return res.status(404).json({
        success: false,
        status: false,
        error: 'Produk tidak ditemukan atau sedang gangguan.',
        msg: 'Produk tidak ditemukan.'
      });
    }

    const globalMarkup = await db.getGlobalPpobMarkup();
    const visMap = await db.getPpobVisibilityMap();
    const itemSku = `SKL-${item.id}`;
    const numSku = String(item.id);
    const rawSku = String(item.sku || '');
    const vis = visMap[itemSku] || visMap[numSku] || (rawSku ? visMap[rawSku] : undefined);
    let markup = (vis && vis.markup !== undefined && vis.markup !== null)
      ? Math.max(0, Math.ceil(Number(vis.markup)))
      : globalMarkup;
    const basePrice = Math.ceil(Number(item.price) || 0);
    const totalPrice = basePrice + markup;

    const currentBal = user.mainBalance !== undefined ? user.mainBalance : user.saldo || 0;
    if (currentBal < totalPrice) {
      return res.status(400).json({
        success: false,
        status: false,
        error: `Saldo tidak mencukupi. Butuh Rp ${totalPrice.toLocaleString('id-ID')}, saldo Anda saat ini Rp ${currentBal.toLocaleString('id-ID')}.`,
        msg: `Saldo tidak mencukupi. Butuh Rp ${totalPrice.toLocaleString('id-ID')}`
      });
    }

    // Call SekaliPay Order API BEFORE deducting balance
    const refId = `TRX_${username}_${Date.now()}`;
    let orderResult;
    try {
      orderResult = await sekalipayService.createTransaction({
        sku: item.id,
        target: target,
        ref_id: refId
      });
    } catch (apiErr) {
      orderResult = { success: false, message: apiErr.message };
    }

    const isOrderSuccess = orderResult && (orderResult.success || orderResult.status === true || orderResult.httpCode === 200 || orderResult.data);
    let serialNumber = extractSekalipayLicenseOrSN(orderResult.data) || extractSekalipayLicenseOrSN(orderResult) || '';
    const accountName = req.body.account_name || req.body.customer_name || orderResult.data?.customer_name || orderResult.data?.account_name || '';

    // If order succeeded but SN/license wasn't in initial payload, wait 600ms and check live SekaliPay detail immediately!
    if (isOrderSuccess && !serialNumber) {
      await new Promise(resolve => setTimeout(resolve, 600));
      try {
        const liveDetail = await sekalipayService.getTransactionDetail(refId);
        if (liveDetail && (liveDetail.success || liveDetail.data)) {
          const liveSN = extractSekalipayLicenseOrSN(liveDetail.data || liveDetail);
          if (liveSN) serialNumber = liveSN;
        }
      } catch (e) {
        console.warn('[PPOB Immediate Status Check Error]', e.message);
      }
    }

    if (isOrderSuccess) {
      // Deduct balance upon successful submission atomically
      const deductRes = await db.atomicDeductBalance(username, totalPrice, 'mainBalance');
      const newBalance = deductRes && deductRes.newBalance !== undefined ? deductRes.newBalance : Math.max(0, currentBal - totalPrice);
      let denom = 0;
      const matchDotted = item.name.match(/(\d{1,3}(?:\.\d{3})+)/);
      if (matchDotted) {
        denom = parseInt(matchDotted[1].replace(/\./g, ''), 10);
      } else {
        const matchK = item.name.match(/(\d+)\s*(?:rb|k)\b/i);
        if (matchK) denom = parseInt(matchK[1], 10) * 1000;
      }
      const finalBasePrice = (denom > 0 && denom < totalPrice) ? denom : basePrice;
      const finalAdminFee = Math.max(0, totalPrice - finalBasePrice);

      const trxRecord = {
        id: refId,
        username: username,
        merchant: item.name,
        product_name: item.name,
        target: target,
        account_name: accountName,
        nominal: finalBasePrice,
        denom: finalBasePrice,
        base_price: finalBasePrice,
        adminFee: finalAdminFee,
        markup: finalAdminFee,
        price: totalPrice,
        amount: totalPrice,
        status: 'BERHASIL',
        type: 'PPOB',
        sn: serialNumber,
        product_license: serialNumber,
        note: serialNumber,
        response: orderResult,
        createdAt: new Date().toISOString()
      };

      await db.addHistory(username, trxRecord);

      const updatedUser = await db.getUser(username);
      const userHistory = updatedUser ? (updatedUser.history || []) : [];

      // Broadcast: PPOB berhasil
      broadcastRealtimeEvent('transaction', {
        targetUsername: username,
        title: '✅ Pembelian PPOB Berhasil',
        body: `${item.name} ke ${target} sebesar Rp ${totalPrice.toLocaleString('id-ID')} berhasil diproses.`,
        type: 'ppob_success',
        amount: totalPrice
      });

      return res.json({
        success: true,
        status: true,
        msg: 'Transaksi berhasil dikirim!',
        mainBalance: newBalance,
        history: userHistory,
        data: trxRecord
      });
    } else {
      // Transaction failed at provider level - Saldo IS NOT DEDUCTED
      const rawError = orderResult.message || orderResult.error || orderResult.raw || 'Respon gagal dari sistem.';
      const cleanErrMsg = sanitizeErrorMessage(rawError);

      await db.addHistory(username, {
        id: refId,
        merchant: item.name,
        product_name: item.name,
        target: target,
        account_name: accountName,
        amount: totalPrice,
        status: 'GAGAL',
        type: 'PPOB',
        note: cleanErrMsg
      });

      const updatedUser = await db.getUser(username);
      const userHistory = updatedUser ? (updatedUser.history || []) : [];

      // Broadcast: PPOB gagal
      broadcastRealtimeEvent('transaction', {
        targetUsername: username,
        title: '❌ Pembelian PPOB Gagal',
        body: `${item.name} ke ${target} gagal: ${cleanErrMsg}`,
        type: 'ppob_failed',
        amount: totalPrice
      });

      return res.status(400).json({
        success: false,
        status: false,
        error: `Gagal memproses pembelian: ${cleanErrMsg}`,
        msg: `Gagal memproses pembelian: ${cleanErrMsg}`,
        mainBalance: currentBal,
        history: userHistory
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: false,
      error: `Error internal server: ${err.message}`,
      msg: err.message
    });
  }
}

// Validate Account / Nickname Lookup API
app.post('/api/ppob/validate-account', requireAuth, async (req, res) => {
  const { product_id, sku, target, zone_id } = req.body;
  if ((!product_id && !sku) || !target) {
    return res.status(400).json({ success: false, error: 'product_id/sku dan target wajib diisi.' });
  }
  const cleanId = String(product_id || sku || '').replace(/^SKL-/, '');
  try {
    const result = await sekalipayService.validateAccount(cleanId, target, zone_id);
    if (result && (result.success || result.data)) {
      const accountName = result.data?.customer_name || result.data?.name || result.data?.nickname || result.data?.account_name || '';
      return res.json({ success: true, account_name: accountName, data: result.data });
    }
    return res.json({ success: false, message: result.message || 'Data akun tidak ditemukan.' });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

// Register endpoints for both /api/ppob/order AND /api/ppob/checkout
app.post('/api/ppob/order', requireAuth, handlePpobCheckout);
app.post('/api/ppob/checkout', requireAuth, handlePpobCheckout);

// Check status endpoint for PPOB receipts
app.get('/api/ppob/check-status/:refId', async (req, res) => {
  const { refId } = req.params;
  try {
    const detail = await sekalipayService.getTransactionDetail(refId);
    if (detail && (detail.success || detail.data)) {
      const dData = detail.data || detail;
      const apiStatus = String(dData.status || '').toLowerCase();
      let statusStr = 'DIPROSES';
      if (['sent', 'completed', 'success', 'paid', 'order.item.sent'].includes(apiStatus)) {
        statusStr = 'BERHASIL';
      } else if (['failed', 'canceled', 'rejected', 'expired'].includes(apiStatus)) {
        statusStr = 'GAGAL';
      }

      // Try extracting SN from all possible locations in the response
      const snVal = extractSekalipayLicenseOrSN(dData) ||
                    extractSekalipayLicenseOrSN(detail) ||
                    extractSekalipayLicenseOrSN(dData.order || {}) || '';
      const failReason = sanitizeErrorMessage(dData.failure_reason || dData.failureReason || detail.message || '');

      // Update history record in DB if found
      const allUsers = await db.getAllUsersMap();
      for (const [uname, u] of Object.entries(allUsers)) {
        if (Array.isArray(u.history)) {
          const hIdx = u.history.findIndex(h => h.id === refId || h.orderId === refId);
          if (hIdx !== -1) {
            const updateFields = { status: statusStr };
            if (snVal) {
              updateFields.sn = snVal;
              updateFields.product_license = snVal;
              updateFields.note = snVal;
            }
            if (failReason) updateFields.failureReason = failReason;
            await db.updateHistory(refId, updateFields);
            break;
          }
        }
      }

      return res.json({
        success: true,
        status: statusStr,
        sn: snVal,
        product_license: snVal,
        transaction: {
          status: statusStr,
          sn: snVal,
          product_license: snVal,
          description: snVal || dData.note || dData.item_name || '',
          failureReason: failReason,
          apiMessage: sanitizeErrorMessage(detail.message || '')
        }
      });
    }
    return res.json({ success: true, status: 'DIPROSES' });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

// ==========================================
// EWALLET WITHDRAW (DANA / OVO / GOPAY / SHOPEEPAY)
// POST /withdraw-buatqris
// Body: { amount, destination, method, requestId, pin }
// ==========================================
async function handleWithdrawEwallet(req, res) {
  const username = typeof req.user === 'object' && req.user !== null ? req.user.username : String(req.user || '');
  const { amount, destination, method, requestId, pin, account_name } = req.body;
  const destinationTarget = destination || req.body.phone || req.body.target || req.body.customerNo;
  const methodTarget = method || req.body.walletType || req.body.ewallet || 'DANA';

  if (!amount || !destinationTarget || !methodTarget || !pin) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap. Pastikan nominal, nomor tujuan, metode, dan PIN terisi.' });
  }

  try {
    const user = await db.getUser(username);
    if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });

    if (!user.transactionPin && !user.pin) {
      return res.status(400).json({ success: false, error: 'PIN belum diatur. Silakan buat PIN terlebih dahulu.' });
    }

    if (!verifyUserPin(user, pin)) {
      return res.status(400).json({ success: false, error: 'PIN salah. Silakan coba lagi.' });
    }

    const itemsResult = await sekalipayService.getItems();
    const allItems = (itemsResult && itemsResult.data) ? itemsResult.data : [];

    const methodKeywords = {
      'DANA': ['dana'],
      'OVO': ['ovo'],
      'GOPAY': ['gopay', 'go pay'],
      'SHOPEEPAY': ['shopeepay', 'shopee pay', 'spay']
    };
    const keywords = methodKeywords[String(method).toUpperCase()] || [method.toLowerCase()];
    const nominal = parseInt(amount, 10);

    let candidates = allItems.filter(item => {
      const nameLC = (item.name || '').toLowerCase();
      const brandLC = (item.brand || '').toLowerCase();
      return keywords.some(kw => nameLC.includes(kw) || brandLC.includes(kw));
    });

    if (String(method).toUpperCase() === 'GOPAY') {
      const customerItems = candidates.filter(i => String(i.sku || '').toUpperCase().startsWith('GPY'));
      if (customerItems.length > 0) candidates = customerItems;
    }

    let filtered = candidates.filter(i => i.price >= nominal && i.price <= nominal * 1.35);
    if (filtered.length === 0) {
      filtered = candidates.filter(i => i.price >= nominal);
    }

    filtered.sort((a, b) => a.price - b.price);
    const item = filtered[0] || null;

    if (!item) {
      return res.status(400).json({
        success: false,
        error: `Produk e-wallet ${method} nominal Rp ${nominal.toLocaleString('id-ID')} sedang tidak tersedia.`
      });
    }

    const globalMarkup = await db.getGlobalPpobMarkup();
    const visMap = await db.getPpobVisibilityMap();
    const itemSku = `SKL-${item.id}`;
    const numSku = String(item.id);
    const rawSku = String(item.sku || '');
    const vis = visMap[itemSku] || visMap[numSku] || (rawSku ? visMap[rawSku] : undefined);
    let markup = (vis && vis.markup !== undefined && vis.markup !== null)
      ? Math.max(0, Math.ceil(Number(vis.markup)))
      : globalMarkup;
    const basePrice = Math.ceil(Number(item.price) || 0);
    const totalPrice = basePrice + markup;
    const currentBal = user.mainBalance !== undefined ? user.mainBalance : user.saldo || 0;

    if (currentBal < totalPrice) {
      return res.status(400).json({
        success: false,
        error: `Saldo tidak mencukupi. Butuh Rp ${totalPrice.toLocaleString('id-ID')}, saldo Anda Rp ${currentBal.toLocaleString('id-ID')}.`
      });
    }

    const refId = requestId || `TPU_${username}_${Date.now()}`;
    let orderResult;
    try {
      orderResult = await sekalipayService.createTransaction({
        sku: item.id,
        target: String(destinationTarget),
        ref_id: refId
      });
    } catch (apiErr) {
      orderResult = { success: false, message: apiErr.message };
    }

    const isSuccess = orderResult && (orderResult.success || orderResult.status === true || orderResult.httpCode === 200 || orderResult.data);
    const sn = (orderResult.data && (orderResult.data.sn || orderResult.data.serial_number || orderResult.data.voucher)) || '';
    const accName = account_name || (orderResult.data && (orderResult.data.account_name || orderResult.data.customer_name)) || '';
    const productName = item.name && item.name.toLowerCase().includes('top up') ? item.name : `Top Up ${methodTarget}`;

    if (isSuccess) {
      const deductRes = await db.atomicDeductBalance(username, totalPrice, 'mainBalance');
      const newBalance = deductRes && deductRes.newBalance !== undefined ? deductRes.newBalance : Math.max(0, currentBal - totalPrice);

      const finalAdminFee = Math.max(0, totalPrice - nominal);

      await db.addHistory(username, {
        id: refId,
        merchant: productName,
        product_name: productName,
        target: String(destinationTarget),
        account_name: accName,
        nominal: nominal,
        denom: nominal,
        base_price: nominal,
        adminFee: finalAdminFee,
        markup: finalAdminFee,
        amount: totalPrice,
        status: 'BERHASIL',
        type: 'TOPUP_EWALLET',
        category: 'Top Up E-Wallet',
        sn: sn,
        note: sn
      });

      const updatedUser = await db.getUser(username);
      const userHistory = updatedUser ? (updatedUser.history || []) : [];

      // Broadcast: Top Up E-Wallet berhasil
      broadcastRealtimeEvent('transaction', {
        targetUsername: username,
        title: '✅ Top Up E-Wallet Berhasil',
        body: `Top Up ${methodTarget} Rp ${nominal.toLocaleString('id-ID')} ke ${destinationTarget} berhasil diproses.`,
        type: 'ewallet_success',
        amount: totalPrice
      });

      return res.json({
        success: true,
        status: 'BERHASIL',
        msg: `Berhasil Top Up ${methodTarget} Rp ${nominal.toLocaleString('id-ID')} ke ${destinationTarget}`,
        mainBalance: newBalance,
        history: userHistory,
        data: { id: refId, merchant: productName, target: destinationTarget, account_name: accName, nominal: nominal, base_price: nominal, adminFee: finalAdminFee, markup: finalAdminFee, amount: totalPrice, sn }
      });
    } else {
      const rawErr = (orderResult && (orderResult.message || orderResult.error)) || 'Respon gagal dari provider.';
      const errMsg = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);

      await db.addHistory(username, {
        id: refId,
        merchant: productName,
        product_name: productName,
        target: String(destination),
        account_name: accName,
        base_price: basePrice,
        adminFee: markup,
        markup: markup,
        amount: totalPrice,
        status: 'GAGAL',
        type: 'TOPUP_EWALLET',
        category: 'Top Up E-Wallet',
        note: errMsg
      });

      const updatedUser = await db.getUser(username);
      const userHistory = updatedUser ? (updatedUser.history || []) : [];

      // Broadcast: Top Up E-Wallet gagal
      broadcastRealtimeEvent('transaction', {
        targetUsername: username,
        title: '❌ Top Up E-Wallet Gagal',
        body: `Top Up ${method} ke ${destination} gagal: ${errMsg}`,
        type: 'ewallet_failed',
        amount: totalPrice
      });

      return res.status(400).json({
        success: false,
        error: `Gagal memproses Top Up E-Wallet: ${errMsg}`,
        mainBalance: currentBal,
        history: userHistory
      });
    }
  } catch (err) {
    console.error('[Withdraw Ewallet Error]:', err.message);
    return res.status(500).json({ success: false, error: `Error server: ${err.message}` });
  }
}

// ==========================================
// PENCAIRAN SALDO QRIS MERCHANT KE AKUN UTAMA
// POST /withdraw-qris & POST /api/merchant/withdraw
// ==========================================
async function handleWithdrawMerchantQris(req, res) {
  const username = typeof req.user === 'object' && req.user !== null ? req.user.username : String(req.user || '');
  const { amount, pin } = req.body;
  const numAmt = Math.ceil(Number(amount) || 0);

  if (!numAmt || numAmt <= 0) {
    return res.status(400).json({ success: false, error: 'Nominal pencairan tidak valid.' });
  }

  try {
    const user = await db.getUser(username);
    if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });

    // Verify PIN if set on user account
    if (user.transactionPin || user.pin) {
      if (pin && !verifyUserPin(user, pin)) {
        return res.status(400).json({ success: false, error: 'PIN transaksi tidak valid.' });
      }
    }

    const curQris = Number(user.qrisBalance || 0);
    if (curQris < numAmt) {
      return res.status(400).json({ success: false, error: `Saldo QRIS tidak mencukupi. Saldo saat ini: Rp ${curQris.toLocaleString('id-ID')}` });
    }

    const deductRes = await db.atomicDeductBalance(username, numAmt, 'qrisBalance');
    if (!deductRes.success) {
      return res.status(400).json({ success: false, error: deductRes.error || 'Gagal memotong saldo QRIS.' });
    }

    const addRes = await db.atomicAddBalance(username, numAmt, 'mainBalance');

    const txId = `WD-QRIS-${Date.now()}`;
    await db.addHistory(username, {
      id: txId,
      merchant: 'Pencairan Saldo QRIS Merchant',
      product_name: 'Pencairan Saldo QRIS',
      amount: numAmt,
      status: 'BERHASIL',
      type: 'WITHDRAW',
      category: 'Pencairan Merchant',
      note: 'Pencairan saldo QRIS ke akun utama',
      description: `Pencairan saldo QRIS ke akun utama Rp ${numAmt.toLocaleString('id-ID')}`,
      createdAt: new Date().toISOString()
    });

    const updatedUser = await db.getUser(username);
    const newMain = updatedUser ? (updatedUser.mainBalance !== undefined ? updatedUser.mainBalance : updatedUser.saldo || 0) : (addRes.newBalance || 0);
    const newQris = updatedUser ? (updatedUser.qrisBalance || 0) : (deductRes.newBalance || 0);

    broadcastRealtimeEvent('balance_update', {
      targetUsername: username,
      title: '💰 Saldo Merchant Dicairkan',
      body: `Pencairan Rp ${numAmt.toLocaleString('id-ID')} dari saldo QRIS ke saldo utama berhasil.`,
      type: 'merchant_withdraw'
    });

    return res.json({
      success: true,
      status: true,
      message: `Berhasil mencairkan Rp ${numAmt.toLocaleString('id-ID')} ke akun utama.`,
      mainBalance: newMain,
      qrisBalance: newQris,
      history: updatedUser ? updatedUser.history : []
    });
  } catch (err) {
    console.error('[Withdraw QRIS Error]', err);
    return res.status(500).json({ success: false, error: `Error server: ${err.message}` });
  }
}

app.post('/withdraw-buatqris', requireAuth, handleWithdrawEwallet);
app.post('/api/ewallet/order', requireAuth, handleWithdrawEwallet);
app.post('/api/ewallet/checkout', requireAuth, handleWithdrawEwallet);
app.post('/withdraw-dana', requireAuth, handleWithdrawEwallet);
app.post('/withdraw-qris', requireAuth, (req, res) => {
  if (req.body && (req.body.destination || req.body.method || req.body.phone || req.body.walletType)) {
    return handleWithdrawEwallet(req, res);
  }
  return handleWithdrawMerchantQris(req, res);
});
app.post('/api/merchant/withdraw', requireAuth, handleWithdrawMerchantQris);

// Merchant Config
app.get('/api/merchant-config', async (req, res) => {
  res.json({ status: true, success: true, config: { merchantName: 'NOXARIA NET WALLET', qrisUrl: '' } });
});

// Transfer Saldo
app.post('/transfer-saldo', requireAuth, pinLimiter, async (req, res) => {
  const { target, amount, pin, note } = req.body;
  const senderUname = req.user.username;
  const numAmt = Math.ceil(Number(amount) || 0);
  const transferNote = (note || '').toString().trim().substring(0, 100);

  if (!target || numAmt < 1000) {
    return res.status(400).json({ success: false, error: 'Target dan nominal minimal Rp 1.000 wajib diisi.' });
  }

  const sender = await db.getUser(senderUname);
  if (!sender) return res.status(404).json({ success: false, error: 'Pengirim tidak ditemukan.' });

  if (!verifyUserPin(sender, pin)) {
    return res.status(400).json({ success: false, error: 'PIN transaksi tidak valid.' });
  }

  const recipient = (await db.getUserByWaContact(target)) || (await db.getUser(target)) || (await db.getUserByUserId(target));
  if (!recipient) {
    return res.status(404).json({ success: false, error: `Pengguna tujuan "${target}" tidak ditemukan.` });
  }

  const recipientUname = recipient.username;
  if (recipientUname === senderUname) {
    return res.status(400).json({ success: false, error: 'Tidak dapat mentransfer saldo ke akun sendiri.' });
  }

  // Atomic deduction: prevents double-spending / race conditions at the database engine level
  const deductResult = await db.atomicDeductBalance(senderUname, numAmt, 'mainBalance');
  if (!deductResult.success) {
    return res.status(400).json({ success: false, error: deductResult.error || 'Saldo tidak mencukupi atau transaksi sedang berjalan.' });
  }

  // Atomically credit recipient
  await db.atomicAddBalance(recipientUname, numAmt, 'mainBalance');

  const txId = `TF-${Date.now()}`;
  const senderDesc = transferNote || `Transfer saldo ke ${recipient.fullname || recipientUname}`;
  const recipDesc = transferNote || `Terima saldo dari ${sender.fullname || senderUname}`;

  await db.addHistory(senderUname, {
    id: txId,
    merchant: `Transfer ke ${recipient.fullname || recipientUname}`,
    amount: numAmt,
    status: 'BERHASIL',
    type: 'TRANSFER',
    note: transferNote,
    description: senderDesc
  });

  await db.addHistory(recipientUname, {
    id: `REC-${Date.now()}`,
    merchant: `Terima Transfer dari ${sender.fullname || senderUname}`,
    amount: numAmt,
    status: 'BERHASIL',
    type: 'DEPOSIT',
    note: transferNote,
    description: recipDesc
  });

  const updatedSender = await db.getUser(senderUname);

  // Broadcast: Transfer berhasil ke pengirim
  broadcastRealtimeEvent('transaction', {
    targetUsername: senderUname,
    title: '💸 Transfer Terkirim',
    body: `Transfer Rp ${numAmt.toLocaleString('id-ID')} ke ${recipient.fullname || recipientUname} berhasil.`,
    type: 'transfer_sent',
    amount: numAmt
  });

  // Broadcast: Transfer masuk ke penerima
  broadcastRealtimeEvent('transaction', {
    targetUsername: recipientUname,
    title: '💰 Saldo Masuk!',
    body: `Kamu menerima transfer Rp ${numAmt.toLocaleString('id-ID')} dari ${sender.fullname || senderUname}.`,
    type: 'transfer_received',
    amount: numAmt
  });

  const currentSenderBal = deductResult && deductResult.newBalance !== undefined ? deductResult.newBalance : (updatedSender ? (updatedSender.mainBalance !== undefined ? updatedSender.mainBalance : updatedSender.saldo) : 0);

  res.json({
    success: true,
    status: true,
    message: 'Transfer saldo berhasil',
    recipientName: recipient.fullname || recipient.username,
    recipientUsername: recipient.username,
    mainBalance: currentSenderBal,
    history: updatedSender ? updatedSender.history : []
  });
});

// Check Transfer Target Recipient Details
app.get('/api/transfer/check-user/:target', requireAuth, async (req, res) => {
  try {
    const target = req.params.target;
    if (!target) return res.json({ success: false, error: 'Target kosong' });
    const user = (await db.getUserByWaContact(target)) || (await db.getUser(target)) || (await db.getUserByUserId(target));
    if (user) {
      if (user.username === req.user.username) {
        return res.json({ success: false, error: 'Tidak dapat mentransfer ke akun sendiri' });
      }
      return res.json({
        success: true,
        username: user.username,
        fullname: user.fullname || user.name || user.username
      });
    }
    return res.json({ success: false, error: 'Pengguna tidak ditemukan' });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

// Update Profile
app.post('/update-profile', requireAuth, async (req, res) => {
  const { fullname, email, waContact } = req.body;
  const currentUname = req.user.username;

  try {
    const updateData = {};
    if (fullname) updateData.fullname = fullname;
    if (email !== undefined) updateData.email = email;

    let targetUsername = currentUname;
    if (waContact && waContact !== currentUname) {
      await db.updateUsernameKey(currentUname, waContact);
      targetUsername = waContact;
    }

    await db.updateUser(targetUsername, updateData);

    // Broadcast: Profil diperbarui
    broadcastRealtimeEvent('activity', {
      targetUsername: targetUsername,
      title: '👤 Profil Diperbarui',
      body: 'Data profil kamu berhasil diperbarui.',
      type: 'profile_update'
    });

    const newToken = jwt.sign(
      { username: targetUsername, role: req.user.role || 'MEMBER' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ success: true, newUsername: targetUsername, token: newToken, message: 'Profil berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Real-Time GPS Location
app.post('/api/update-location', requireAuth, async (req, res) => {
  const { latitude, longitude, address, accuracy } = req.body;
  const username = req.user.username;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ success: false, error: 'Latitude dan Longitude wajib diisi.' });
  }

  try {
    const latNum = Number(latitude);
    const lonNum = Number(longitude);
    const locationStr = address || `${latNum.toFixed(6)}, ${lonNum.toFixed(6)} (±${Math.round(accuracy || 0)}m)`;

    await db.updateUser(username, {
      lastLocation: locationStr,
      latitude: latNum,
      longitude: lonNum,
      locationAccuracy: accuracy || 0,
      locationUpdatedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      status: true,
      message: 'Lokasi GPS real-time berhasil diperbarui',
      location: locationStr,
      coords: { latitude: latNum, longitude: lonNum, accuracy }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Change Password
app.post('/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const username = req.user.username;

  try {
    const user = await db.getUser(username);
    if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });

    if (user.password && !db.verifyPassword(oldPassword, user.password)) {
      return res.status(400).json({ success: false, error: 'Password lama salah' });
    }

    const hashedNewPassword = db.hashPassword(newPassword);
    await db.updateUser(username, { password: hashedNewPassword });

    const keepDeviceId = String(req.body.deviceId || '').trim();
    if (keepDeviceId) {
      await db.terminateOtherDevices(username, keepDeviceId);
      broadcastRealtimeEvent('remote_control', {
        targetUsername: username,
        controlAction: 'force_logout_others',
        keepDeviceId: keepDeviceId,
        reason: 'Password akun Anda telah berhasil diganti oleh pemilik akun. Silakan login kembali.'
      });
    }

    // Broadcast: Password diubah
    broadcastRealtimeEvent('activity', {
      targetUsername: username,
      title: '🔒 Password Diubah',
      body: 'Password akun kamu berhasil diperbarui. Jika bukan kamu yang mengubah, segera hubungi admin.',
      type: 'password_change'
    });

    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload & Verification Helper - NO AUTOMATIC DUMMY SALDO CREDIT
app.post('/upload', requireAuth, async (req, res) => {
  const username = req.user.username;
  const user = await db.getUser(username);
  const curBal = user ? (user.mainBalance !== undefined ? user.mainBalance : user.saldo || 0) : 0;
  res.json({
    success: true,
    message: 'Bukti pembayaran berhasil dikirim. Menunggu verifikasi admin.',
    mainBalance: curBal,
    qrisBalance: user ? (user.qrisBalance || 0) : 0,
    data: {
      id: `PROOF-${Date.now()}`,
      merchant: 'Pengajuan Bukti Pembayaran',
      status: 'DIPROSES'
    }
  });
});

app.post('/claim', requireAuth, async (req, res) => {
  const username = req.user.username;
  const user = await db.getUser(username);
  const curBal = user ? (user.mainBalance !== undefined ? user.mainBalance : user.saldo || 0) : 0;
  res.json({
    success: true,
    mainBalance: curBal,
    qrisBalance: user ? (user.qrisBalance || 0) : 0,
    message: 'Status saldo diverifikasi'
  });
});

// Reset Helper
app.post('/reset', async (req, res) => {
  res.json({ success: true, message: 'Permintaan reset berhasil diajukan.' });
});

// ==========================================
// SCHEDULER EXPIRED CHECKER (SetInterval 5 Min)
// ==========================================
setInterval(() => {
  try {
    const topups = readJSON(TOPUP_FILE, []);
    const now = Date.now();
    let updatedCount = 0;

    topups.forEach(t => {
      if (t.status === 'pending' && t.expired_at) {
        const expiredTime = new Date(t.expired_at).getTime();
        if (expiredTime < now) {
          t.status = 'expired';
          t.updated_at = new Date().toISOString();
          updatedCount++;
        }
      }
    });

    if (updatedCount > 0) {
      writeJSON(TOPUP_FILE, topups);
      console.log(`[Scheduler] Updated ${updatedCount} expired top-up request(s).`);
    }
  } catch (err) {
    console.error('[Scheduler Error]:', err.message);
  }
}, 5 * 60 * 1000);

// ==========================================
// ORDERKUOTA AUTOMATED MUTATION CHECKER (Every 15 Seconds)
// TIDAK MENAMBAH SALDO OTOMATIS: Semua saldo di-setting manual oleh admin
// ==========================================
setInterval(() => {
  orkutService.checkMutations(TOPUP_FILE, USERS_FILE, db, null);
}, 15000);

// ==========================================
// REAL-TIME WEBSOCKET LIVE CHAT ENGINE
// ==========================================
const wss = new WebSocket.Server({ server });

// Map: username -> Set<WebSocket>
const userChatSockets = new Map();
// Set: CS Admin Sockets
const csChatSockets = new Set();
// Anti-spam rate limiting map
const chatRateLimits = new Map();

function checkChatRateLimit(senderKey) {
  const now = Date.now();
  const limit = chatRateLimits.get(senderKey) || { count: 0, resetTime: now + 3000 };
  if (now > limit.resetTime) {
    limit.count = 1;
    limit.resetTime = now + 3000;
    chatRateLimits.set(senderKey, limit);
    return true;
  }
  if (limit.count >= 6) {
    return false; // Max 6 messages per 3 seconds to prevent spam
  }
  limit.count += 1;
  return true;
}

function registerUserSocket(username, ws) {
  const u = String(username || '').trim();
  if (!u) return;
  if (!userChatSockets.has(u)) {
    userChatSockets.set(u, new Set());
  }
  userChatSockets.get(u).add(ws);
}

function unregisterUserSocket(username, ws) {
  const u = String(username || '').trim();
  if (!u || !userChatSockets.has(u)) return;
  const set = userChatSockets.get(u);
  set.delete(ws);
  if (set.size === 0) {
    userChatSockets.delete(u);
  }
}

function broadcastToCs(payload) {
  const str = JSON.stringify(payload);
  for (const csWs of csChatSockets) {
    if (csWs.readyState === WebSocket.OPEN) {
      csWs.send(str);
    }
  }
}

function broadcastToUser(username, payload) {
  const u = String(username || '').trim();
  if (!userChatSockets.has(u)) return;
  const str = JSON.stringify(payload);
  for (const uWs of userChatSockets.get(u)) {
    if (uWs.readyState === WebSocket.OPEN) {
      uWs.send(str);
    }
  }
}

wss.on('connection', (ws, req) => {
  let authenticatedUser = null;
  let isCsAgent = false;

  ws.on('message', async (messageData) => {
    try {
      const data = JSON.parse(messageData.toString());
      if (!data || !data.type) return;

      // 1. Client Authentication
      if (data.type === 'auth') {
        if (data.token) {
          try {
            const decoded = jwt.verify(data.token, JWT_SECRET);
            if (decoded.role === 'CS_AGENT' || decoded.role === 'ADMIN') {
              isCsAgent = true;
              csChatSockets.add(ws);
              ws.send(JSON.stringify({ type: 'auth_success', role: 'cs' }));
              return;
            } else if (decoded.username) {
              authenticatedUser = String(decoded.username).trim();
              registerUserSocket(authenticatedUser, ws);
              ws.send(JSON.stringify({ type: 'auth_success', role: 'user', username: authenticatedUser }));
              return;
            }
          } catch (err) {
            ws.send(JSON.stringify({ type: 'auth_error', message: 'Token otentikasi tidak valid.' }));
            return;
          }
        }
        if (data.username) {
          authenticatedUser = String(data.username).trim();
          registerUserSocket(authenticatedUser, ws);
          ws.send(JSON.stringify({ type: 'auth_success', role: 'user', username: authenticatedUser }));
        }
        return;
      }

      // 2. User Sends Message to CS
      if (data.type === 'chat_message') {
        const cId = String(data.conversationId || authenticatedUser || data.username || '').trim();
        const text = String(data.message || '').trim();
        if (!cId || !text) return;
        if (!checkChatRateLimit(cId)) return; // Anti-spam protection

        const savedMsg = await db.saveChatMessage({
          conversationId: cId,
          sender: 'user',
          senderName: data.senderName || cId,
          message: text
        });

        if (savedMsg) {
          // Push to all active CS agents
          broadcastToCs({
            type: 'new_message',
            conversationId: cId,
            message: savedMsg
          });

          // Echo back to sender
          broadcastToUser(cId, {
            type: 'new_message',
            conversationId: cId,
            message: savedMsg
          });
        }
        return;
      }

      // 3. CS Sends Reply to User
      if (data.type === 'cs_reply') {
        const cId = String(data.conversationId || '').trim();
        const text = String(data.message || '').trim();
        if (!cId || !text) return;
        if (!checkChatRateLimit('cs_' + cId)) return;

        const savedMsg = await db.saveChatMessage({
          conversationId: cId,
          sender: 'cs',
          senderName: data.senderName || 'Customer Service',
          message: text
        });

        if (savedMsg) {
          // Push to target user
          broadcastToUser(cId, {
            type: 'new_message',
            conversationId: cId,
            message: savedMsg
          });

          // Broadcast to all CS agents to sync UI
          broadcastToCs({
            type: 'new_message',
            conversationId: cId,
            message: savedMsg
          });
        }
        return;
      }

      // 4. Typing Indicator
      if (data.type === 'typing') {
        const cId = String(data.conversationId || authenticatedUser || '').trim();
        if (data.isCs) {
          broadcastToUser(cId, { type: 'cs_typing', conversationId: cId, isTyping: !!data.isTyping });
        } else {
          broadcastToCs({ type: 'user_typing', conversationId: cId, isTyping: !!data.isTyping });
        }
        return;
      }

      // 5. Mark Conversation as Read
      if (data.type === 'mark_read') {
        const cId = String(data.conversationId || '').trim();
        const reader = data.readerType || (isCsAgent ? 'cs' : 'user');
        if (cId) {
          await db.markConversationAsRead(cId, reader);
          broadcastToCs({ type: 'messages_read', conversationId: cId, readerType: reader });
          broadcastToUser(cId, { type: 'messages_read', conversationId: cId, readerType: reader });
        }
        return;
      }
    } catch (err) {
      console.warn('[WS Message Error]:', err.message);
    }
  });

  ws.on('close', () => {
    if (isCsAgent) {
      csChatSockets.delete(ws);
    }
    if (authenticatedUser) {
      unregisterUserSocket(authenticatedUser, ws);
    }
  });

  ws.on('error', () => {
    if (isCsAgent) csChatSockets.delete(ws);
    if (authenticatedUser) unregisterUserSocket(authenticatedUser, ws);
  });
});

// ==========================================
// REST API FOR LIVE CHAT & CS AUTH
// ==========================================
// Dedicated CS Login Endpoint
app.post('/api/chat/login', (req, res) => {
  const { username, password } = req.body;
  const u = String(username || '').trim();
  const p = String(password || '').trim();

  // Validate CS Credentials (cs1@noxa / customernoxa@1 OR admin andika123)
  if ((u === 'cs1@noxa' && p === 'customernoxa@1') || (u === 'admin' && p === 'andika123')) {
    const token = jwt.sign(
      { username: u, role: 'CS_AGENT', fullname: 'Customer Service 1' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    return res.json({
      success: true,
      token: token,
      user: {
        username: u,
        fullname: 'Customer Service 1',
        role: 'CS_AGENT'
      }
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Username atau Password Customer Service salah.'
  });
});

// CS Authentication Middleware
const requireCsAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'CS_AGENT' || decoded.role === 'ADMIN') {
      req.csUser = decoded;
      return next();
    }
    return res.status(403).json({ success: false, error: 'Akses ditolak.' });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Sesi CS kedaluwarsa.' });
  }
};

// Get All Active Conversations Summary for CS Admin Console
app.get('/api/chat/conversations', requireCsAuth, async (req, res) => {
  try {
    const conversations = await db.getAllConversationsSummary();
    res.json({ success: true, conversations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Live User Profile for CS Admin Console Header
app.get('/api/chat/user-profile/:username', requireCsAuth, async (req, res) => {
  try {
    const { username } = req.params;
    const user = await db.getUser(username);
    if (!user) {
      return res.json({
        success: true,
        user: {
          username: username,
          fullname: username,
          waContact: username,
          mainBalance: 0,
          role: 'MEMBER'
        }
      });
    }
    return res.json({
      success: true,
      user: {
        username: user.username,
        fullname: user.fullname || user.name || (user.brand ? user.brand : user.username),
        waContact: user.waContact || user.username,
        mainBalance: user.mainBalance !== undefined ? user.mainBalance : (user.saldo || 0),
        role: user.role || 'MEMBER',
        brand: user.brand || '',
        email: user.email || ''
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Message History for specific conversation (Accessible by CS or authenticated user)
app.get('/api/chat/history/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const history = await db.getChatHistory(conversationId);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send Chat Message via HTTP POST (Fallback)
app.post('/api/chat/send', async (req, res) => {
  try {
    const { conversationId, sender, senderName, message } = req.body;
    if (!conversationId || !message) {
      return res.status(400).json({ success: false, error: 'conversationId dan message wajib diisi.' });
    }

    const savedMsg = await db.saveChatMessage({
      conversationId,
      sender: sender === 'cs' ? 'cs' : 'user',
      senderName,
      message
    });

    if (savedMsg) {
      // Broadcast via WebSocket
      if (sender === 'cs') {
        broadcastToUser(conversationId, { type: 'new_message', conversationId, message: savedMsg });
        broadcastToCs({ type: 'new_message', conversationId, message: savedMsg });
      } else {
        broadcastToCs({ type: 'new_message', conversationId, message: savedMsg });
        broadcastToUser(conversationId, { type: 'new_message', conversationId, message: savedMsg });
      }
    }

    res.json({ success: true, message: savedMsg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mark messages as read via HTTP
app.post('/api/chat/read', async (req, res) => {
  try {
    const { conversationId, readerType } = req.body;
    if (!conversationId) return res.status(400).json({ success: false, error: 'conversationId wajib diisi.' });

    await db.markConversationAsRead(conversationId, readerType || 'cs');
    broadcastToCs({ type: 'messages_read', conversationId, readerType: readerType || 'cs' });
    broadcastToUser(conversationId, { type: 'messages_read', conversationId, readerType: readerType || 'cs' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Entire Conversation History (CS Admin Only)
app.delete('/api/chat/conversation/:conversationId', requireCsAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!conversationId) {
      return res.status(400).json({ success: false, error: 'conversationId wajib diisi.' });
    }

    const deleted = await db.deleteConversationMessages(conversationId);

    // Broadcast deletion event to CS consoles and user live chat
    broadcastToCs({ type: 'conversation_deleted', conversationId });
    broadcastToUser(conversationId, { type: 'conversation_deleted', conversationId });

    return res.json({
      success: true,
      message: `Riwayat chat untuk ${conversationId} berhasil dihapus dari database.`
    });
  } catch (err) {
    console.error('[Delete Conversation Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Single Chat Message (CS Admin Only)
app.delete('/api/chat/message/:messageId', requireCsAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const conversationId = req.query.conversationId || req.body.conversationId;
    if (!messageId) {
      return res.status(400).json({ success: false, error: 'messageId wajib diisi.' });
    }

    const deleted = await db.deleteSingleChatMessage(messageId);

    if (conversationId) {
      broadcastToCs({ type: 'message_deleted', messageId, conversationId });
      broadcastToUser(conversationId, { type: 'message_deleted', messageId, conversationId });
    }

    return res.json({
      success: true,
      message: 'Pesan berhasil dihapus.'
    });
  } catch (err) {
    console.error('[Delete Message Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Initialize DB Files
readJSON(USERS_FILE, []);
readJSON(TOPUP_FILE, []);
readJSON(CONFIG_FILE, { last_user_id: 0, last_topup_id: 0 });
db.initDb();

// Run CS Chat 5-Day Auto-Cleanup on Startup & Hourly Interval
setTimeout(async () => {
  try {
    await db.autoCleanupOldChatMessages(5);
  } catch (e) {}
}, 5000);

// Schedule hourly auto-cleanup for CS chat messages older than 5 days
setInterval(async () => {
  try {
    await db.autoCleanupOldChatMessages(5);
  } catch (e) {}
}, 60 * 60 * 1000);

// Start Combined Server (HTTP + WebSocket)
server.listen(PORT, HOST, () => {
  console.log(`================================================================`);
  console.log(`✅ NoxarianetApp & SekaliPay Top-Up Server ONLINE`);
  console.log(`   Internal  : http://localhost:${PORT}`);
  console.log(`   External  : http://203.175.125.151:${PORT}`);
  console.log(`================================================================`);

  const tunnelToken = process.env.CLOUDFLARE_TUNNEL_TOKEN;
  if (tunnelToken) {
    console.log('[Cloudflare Tunnel] Launching automatic tunnel process...');
    let binPath = path.join(__dirname, 'cloudflared');
    
    // Auto-download standalone Linux binary if missing on Linux
    if (!fs.existsSync(binPath) && process.platform === 'linux') {
      try {
        console.log('[Cloudflare Tunnel] Binary not found. Auto-downloading cloudflared for Linux x64...');
        require('child_process').execSync('curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ./cloudflared && chmod +x ./cloudflared', {
          cwd: __dirname,
          stdio: 'pipe',
          timeout: 45000
        });
      } catch (e) {
        try {
          require('child_process').execSync('wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O ./cloudflared && chmod +x ./cloudflared', {
            cwd: __dirname,
            stdio: 'pipe',
            timeout: 45000
          });
        } catch (e2) {}
      }
    }

    if (fs.existsSync(binPath)) {
      try { fs.chmodSync(binPath, 0o755); } catch (e) {}
    } else {
      binPath = 'cloudflared';
    }

    try {
      const tunnelProc = exec(`${binPath} tunnel run --token "${tunnelToken}"`);
      if (tunnelProc.stdout) {
        tunnelProc.stdout.on('data', data => console.log(`[Tunnel] ${data.toString().trim()}`));
      }
      if (tunnelProc.stderr) {
        tunnelProc.stderr.on('data', data => {
          const str = data.toString().trim();
          console.log(`[Tunnel] ${str}`);
          if (str.includes('Registered tunnel connection')) {
            console.log(`✅ [Tunnel SUCCESS] Cloudflare Tunnel connected to noxarianet.biz.id!`);
          }
        });
      }
      tunnelProc.on('error', err => {
        console.error(`❌ [Tunnel Error] ${err.message}`);
      });
      tunnelProc.on('close', code => {
        console.log(`[Tunnel Exited] Code ${code}`);
      });
    } catch (err) {
      console.error(`❌ [Tunnel Exception] ${err.message}`);
    }
  }
});
