const fs = require('fs');
const zlib = require('zlib');
const dns = require('dns');
const crypto = require('crypto');
const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const L = require('./captcha-learner.js');
const path = require('path');

const HOST = 'play.diyojennw.com.tr';
process.on('uncaughtException', e => status('uncaughtException: ' + e.message));
process.on('unhandledRejection', e => status('unhandledRejection: ' + (e && e.message ? e.message : e)));
const PORT = 25565;
const BOT_ID = process.argv[2] || 'BabaProGpt';
const USERNAME = BOT_ID;
const { isBanDisconnect, createAccountStop } = require('./account-stop');
const accountStop = createAccountStop(__dirname, HOST, PORT, USERNAME);
if (accountStop.isStopped()) process.exit(0);
let connectionStopped = false;
const VERSION = process.env.MC_VERSION || '1.21.11';
const PER_BOT = BOT_ID !== 'BabaProGpt';
const PASS_FILE = PER_BOT ? 'credentials-' + BOT_ID.toLowerCase() + '.txt' : 'credentials.txt';
const ANSWER_FILE = PER_BOT ? 'answer-' + BOT_ID.toLowerCase() + '.txt' : 'answer.txt';
const CAPTCHA_PNG = PER_BOT ? 'current-' + BOT_ID.toLowerCase() + '.png' : 'current-captcha.png';
const STATUS_FILE = PER_BOT ? 'bot-status-' + BOT_ID.toLowerCase() + '.log' : 'bot-status.log';
const MAPS_DIR = PER_BOT ? path.join('maps', BOT_ID.toLowerCase()) : 'maps';
const LASTMAP_FILE = PER_BOT ? 'last-map-' + BOT_ID.toLowerCase() + '.bin' : 'last-map-bytes.bin';
const MANUAL_FLAG = PER_BOT ? 'manual-mode-' + BOT_ID.toLowerCase() + '.on' : 'manual-mode.on';
const HASHDB = 'hashdb.json';
const WRONGDB = 'wrongdb.json';

function jload(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function jmerge(f, o) {
  let ex = {};
  try { ex = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  Object.assign(ex, o);
  fs.writeFileSync(f, JSON.stringify(ex));
}

function status(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  fs.appendFileSync(STATUS_FILE, msg + '\n');
}

function loadPassword() {
  if (fs.existsSync(PASS_FILE)) return fs.readFileSync(PASS_FILE, 'utf8').trim();
  const p = 'Baba' + Math.random().toString(36).slice(2, 4).toUpperCase() + '#2026x';
  fs.writeFileSync(PASS_FILE, p);
  return p;
}
const PASSWORD = loadPassword();

const proxyList = fs.readFileSync(process.env.MC_PROXIES_FILE || 'proxies-working.txt', 'utf8')
  .split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  .map(l => l.split(' ')[0]);
// reliable ones first
const preferred = ['109.110.51.153:1080', '152.67.22.144:1080', '98.175.31.222:4145', '184.181.217.210:4145', '192.111.137.37:18762'],
      skipPrefixes = ['45.74.31.'];
const liveProxies = [];
for (const p of proxyList) { if (!skipPrefixes.some(s => p.startsWith(s))) liveProxies.push(p); }
const ordered = [...preferred.filter(p => proxyList.includes(p)), ...liveProxies.filter(p => !preferred.includes(p))];

let proxyIdx = (() => {
  let h = 0;
  for (const c of BOT_ID) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return h % 40;
})();
const deadProxies = new Set();
let lastProxyUsed = null;
const PIN_FILE = 'proxy-pin-' + BOT_ID.toLowerCase() + '.json';
function pinnedProxy() { const p = jload(PIN_FILE, null); return p && p.proxy; }
function pinProxy() {
  if (lastProxyUsed && !deadProxies.has(lastProxyUsed)) jmerge(PIN_FILE, { proxy: lastProxyUsed, t: Date.now() });
}
const FORCE_PROXY = process.env.MC_PROXY || null;
function nextLiveProxy() {
  if (FORCE_PROXY && !deadProxies.has(FORCE_PROXY)) {
    lastProxyUsed = FORCE_PROXY;
    status('connecting via FORCE proxy ' + FORCE_PROXY);
    return FORCE_PROXY;
  }
  const PINNED_PROXY = pinnedProxy();
  if (PINNED_PROXY && !deadProxies.has(PINNED_PROXY)) {
    lastProxyUsed = PINNED_PROXY;
    status('connecting via pinned proxy ' + PINNED_PROXY);
    return PINNED_PROXY;
  }
  if (deadProxies.size >= ordered.length) { deadProxies.clear(); status('all proxies dead — resetting'); }
  let proxy = null;
  for (let i = 0; i < ordered.length; i++) {
    const cand = ordered[proxyIdx % ordered.length];
    proxyIdx++;
    if (!deadProxies.has(cand)) { proxy = cand; break; }
  }
  if (!proxy) proxy = ordered[0];
  lastProxyUsed = proxy;
  status('connecting via proxy ' + proxy + ' (dead: ' + deadProxies.size + ')');
  return proxy;
}
function markDead() {
  if (lastProxyUsed) deadProxies.add(lastProxyUsed);
}
let bot = null;
let gaveAnswer = false;
let captchaWaiting = false;
let chatWarmupUntil = Infinity;
let pendingAnswer = null;
let currentMapHash = null;
let mapState = Buffer.alloc(128 * 128);

function crc32(buf) {
  let t = crc32.t;
  if (!t) { t = crc32.t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function renderMapPng() {
  const W = 128, H = 128;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const b = mapState[y * W + x];
      let r = 20, g = 20, b2 = 20;
      if (b === 204) { r = 0; g = 230; b2 = 0; }
      else if (b === 207) { r = 250; g = 250; b2 = 250; }
      else if (b !== 0) { r = g = b2 = 110; }
      raw[p++] = r; raw[p++] = g; raw[p++] = b2;
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(CAPTCHA_PNG, png);
}

function startBot() {
  if (connectionStopped || accountStop.isStopped()) return;
  const proxy = nextLiveProxy();
  const [phost, pport] = proxy.split(':');

  let ip = '213.146.165.219';
  // pre-resolve async is not needed; dns.lookup fallback below

  gaveAnswer = false;
  captchaWaiting = false;
  mapState = Buffer.alloc(128 * 128);

  bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username: USERNAME,
    auth: 'offline',
    version: VERSION,
    connect: (client) => {
      dns.lookup(HOST, { family: 4 }, (err, addr) => {
        const dest = { host: (err ? ip : addr), port: PORT };
        SocksClient.createConnection({
          proxy: { host: phost, port: Number(pport), type: 5 },
          command: 'connect',
          destination: dest,
          timeout: 20000
        }).then(({ socket }) => {
          socket.setNoDelay(true);
          status('tunnel established, attaching');
          setImmediate(() => { client.setSocket(socket); client.emit('connect'); });
        }).catch((e) => {
          status('SOCKS error: ' + e.message);
          markDead();
          setImmediate(() => client.emit('error', e));
        });
      });
    },
    checkTimeoutInterval: 45000,
    hideErrors: false
  });

  bot.on('login', () => status('LOGIN ok'));
  bot.on('spawn', () => { status('SPAWN — inside server'); pinProxy(); chatWarmupUntil = Date.now() + Number(process.env.MC_CHAT_WARMUP || 60000); });
  bot.on('end', (reason) => {
    status('end: ' + reason);
    scheduleReconnect();
  });
  bot.on('error', (e) => {
    const m = (e && e.message || String(e));
    status('error: ' + m);
    if (!/etickal|Captcha|Yasak|Giris|logging in/i.test(m)) {
      status('proxy dead — rotating');
      markDead();
      scheduleReconnect(3000);
    }
  });
  bot.on('kicked', (r) => {
    if (isBanDisconnect(r)) {
      connectionStopped = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { accountStop.stop(); }
      catch (_) { status('could not persist server restriction; stopping process'); }
      // Stop before the following end event can schedule a reconnect.
      try { if (bot) bot.quit(); }
      finally { process.exit(0); }
      return;
    }
    const s = JSON.stringify(r).slice(0, 900);
    status('kicked: ' + s);
  });

  bot.on('message', (msg) => {
    const text = msg.toString();
    status('chat: ' + text);
    handleChat(text);
  });
  bot.on('title', (text, type) => {
    const t = text && text.toString();
    status('title(' + type + '): ' + t);
    if (t) handleChat(t, true);
  });
  bot.on('actionBar', (m) => status('actionbar: ' + (m && m.toString())));

  bot._client.on('packet', (data, meta) => {
    const n = meta.name;
    if (n === 'map' && data.columns && data.rows) {
      const cols = data.columns, rows = data.rows;
      const buf = Buffer.isBuffer(data.data) ? data.data : Buffer.from(data.data);
      const x0 = data.x || 0, y0 = data.y || 0;
      if (cols === 128 && rows === 128 && (x0 === 0 && y0 === 0)) {
        buf.copy(mapState);
      } else {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const mv = (r * cols + c);
            if (mv < buf.length) mapState[(y0 + r) * 128 + (x0 + c)] = buf[mv];
          }
        }
      }
      renderMapPng();
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.mkdirSync(MAPS_DIR, { recursive: true });
      fs.copyFileSync(CAPTCHA_PNG, path.join(MAPS_DIR, 'cap-' + ts + '.png'));
      fs.writeFileSync(path.join(MAPS_DIR, 'cap-' + ts + '.bin'), Buffer.from(mapState));
      fs.writeFileSync('map-last-' + BOT_ID.toLowerCase() + '.json', JSON.stringify({ proxy, t: Date.now(), packet: { cols, rows, x: x0, y: y0 } }));
      fs.writeFileSync(LASTMAP_FILE, Buffer.from(mapState));
      fs.writeFileSync(ANSWER_FILE, '');
      captchaWaiting = true;
      gaveAnswer = false;
      currentMapHash = crypto.createHash('md5').update(mapState).digest('hex');
      pendingAnswer = null;
      status('new captcha map saved (' + path.join(MAPS_DIR, 'cap-' + ts) + ')');
      const hb = jload(HASHDB, {});
      const wb = jload(WRONGDB, {});
      const banned = new Set(wb[currentMapHash] || []);
      const pick = () => {
        if (!hb[currentMapHash]) return null;
        const a = String(hb[currentMapHash]).toLowerCase();
        return banned.has(a) ? null : hb[currentMapHash];
      };
      if (!fs.existsSync(MANUAL_FLAG)) {
        const hit = pick();
        if (hit) {
          status('hash-db HIT → ' + hit);
          gaveAnswer = true;
          pendingAnswer = { hash: currentMapHash, text: hit, ts: Date.now() };
          sendAnswer(hit);
        } else if (fs.existsSync('templates.json')) {
          setTimeout(() => {
            if (!bot || gaveAnswer || !fs.existsSync(LASTMAP_FILE)) return;
            try {
              const t0 = Date.now();
              const res = L.classifyFile(path.join(__dirname, LASTMAP_FILE));
              status('auto-answer: ' + JSON.stringify(res).slice(0, 160) + ' in ' + (Date.now() - t0) + 'ms');
              if (res.answer && res.conf >= 0.62) {
                let guess = res.answer;
                if (banned.size && res.candidates) {
                  const alt = res.candidates.find(c => !banned.has(String(c).toLowerCase()));
                  if (alt && alt !== guess) status('primary in wrongdb — using ' + alt);
                  if (alt) guess = alt;
                }
                gaveAnswer = true;
                pendingAnswer = { hash: currentMapHash, text: guess, ts: Date.now() };
                sendAnswer(guess);
              }
            } catch (e) { status('auto-answer error: ' + e.message); }
          }, 1200);
        }
      }
    }
  });
}

function sendAnswer(text, retry) {
  retry = retry || 0;
  try {
    if (typeof bot._client.chat !== 'function') throw new Error('chat not ready');
    bot.chat(text);
    status('sending answer: ' + text);
  } catch (e) {
    if (retry < 4) {
      status('chat not ready (' + e.message + ') retry ' + (retry + 1));
      setTimeout(() => sendAnswer(text, retry + 1), 1500);
    } else {
      status('chat send failed finally: ' + text);
    }
  }
}

let lastAuth = 0;
function tryAuth(kind) {
  const now = Date.now();
  if (now - lastAuth < 22000) { status('auth throttle guard — skip, waiting cooldown'); return; }
  lastAuth = now;
  if (kind === 'register') { status('attempting /register'); bot.chat('/register ' + PASSWORD + ' ' + PASSWORD); }
  else { status('attempting /login'); bot.chat('/login ' + PASSWORD); }
}

function handleChat(text, silent) {
  const t = text.toLowerCase();

  if (t.includes('kayı') || t.includes('kayit') || t.includes('/register')) {
    tryAuth('register');
    return;
  }
  if (t.includes('giri') || t.includes('/login') || t.includes('giris') || t.includes('giriş')) {
    tryAuth('login');
    return;
  }

  if (t.includes('yanl') || t.includes('hatal') || t.includes('deneme hakk')) {
    if (pendingAnswer) {
      const wb = jload(WRONGDB, {});
      const arr = wb[pendingAnswer.hash] || [];
      const g = String(pendingAnswer.text).toLowerCase();
      if (!arr.includes(g)) arr.push(g);
      jmerge(WRONGDB, { [pendingAnswer.hash]: arr });
      status('wrongdb: ' + pendingAnswer.hash.slice(0, 8) + ' ✗ ' + g);
    }
    pendingAnswer = null;
    captchaWaiting = true;
    gaveAnswer = false;
    return;
  }
  if (t.includes('başarıyla geçt') || t.includes('basariyla gect') || t.includes('successfully passed')) {
    if (pendingAnswer) {
      const hb = jload(HASHDB, {});
      if (!hb[pendingAnswer.hash]) {
        jmerge(HASHDB, { [pendingAnswer.hash]: pendingAnswer.text });
        status('hashdb saved: ' + pendingAnswer.hash.slice(0, 8) + ' → ' + pendingAnswer.text);
        pinProxy();
      }
    }
    pendingAnswer = null;
    captchaWaiting = false;
    gaveAnswer = false;
    return;
  }
  if (t.includes('doğrulama') || t.includes('dogrulama') || t.includes('başar') || t.includes('basarili')) {
    status('captcha-related success hint');
  }
}

let reconnectTimer = null;
function scheduleReconnect(delay = 6000) {
  if (connectionStopped || accountStop.isStopped()) return;
  if (reconnectTimer) { status('reconnect already pending — skip'); return; }
  if (bot) { try { bot.quit(); } catch (_) {} bot = null; }
  status('reconnecting in ' + delay + 'ms');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    try { startBot(); }
    catch (err) {
      status('startBot crashed: ' + (err && err.message));
      setTimeout(() => scheduleReconnect(15000), 15000);
    }
  }, delay);
}

setInterval(() => {
  if (bot && captchaWaiting && !gaveAnswer && fs.existsSync(ANSWER_FILE)) {
    const a = fs.readFileSync(ANSWER_FILE, 'utf8').trim();
    if (a) {
      fs.writeFileSync(ANSWER_FILE, '');
      gaveAnswer = true;
      pendingAnswer = { hash: currentMapHash, text: a, ts: Date.now() };
      sendAnswer(a);
    }
  }
}, 400);

setInterval(() => {
  if (bot && bot.entity && bot.game && bot.game.gameMode !== undefined) {
    // gentle anti-AFK
    if (Math.random() < 0.15) {
      const yaw = bot.entity.yaw + Math.PI / (8 + Math.random() * 8);
      bot.look(yaw, 0, false).catch(() => {});
    }
  }
}, 30000);

// command spam every N ms (env MC_CHATFILE / MC_CHATMSGS / MC_CHATMSG + MC_CHAT_MS)
const CHAT_LIST = (() => {
  if (process.env.MC_CHATFILE && fs.existsSync(process.env.MC_CHATFILE)) {
    return fs.readFileSync(process.env.MC_CHATFILE, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  if (process.env.MC_CHATMSGS) return process.env.MC_CHATMSGS.split('|').map(s => s.trim()).filter(Boolean);
  if (process.env.MC_CHATMSG) return [process.env.MC_CHATMSG];
  return [];
})();
const CHAT_MS = Number(process.env.MC_CHAT_MS || 3000);
if (CHAT_LIST.length) {
  let chatIdx = 0;
  setInterval(() => {
    if (bot && bot._client && !captchaWaiting && Date.now() > chatWarmupUntil) {
      try { bot.chat(CHAT_LIST[chatIdx % CHAT_LIST.length]); chatIdx++; } catch (_) {}
    }
  }, CHAT_MS);
}

fs.writeFileSync(ANSWER_FILE, '');
startBot();
