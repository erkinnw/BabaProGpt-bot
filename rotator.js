const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
process.chdir(ROOT);
const HOST = 'play.diyojennw.com.tr';
const PORT = 25565;
const SLOTS = Number(process.env.MC_SLOTS || 5);
const ROTATE_MS = Number(process.env.MC_ROTATE_MS || 10000);
const SESSION_MAX_MS = Number(process.env.MC_SESSION_MAX_MS || 120000);
const STATE_FILE = path.join(ROOT, 'rotator-state.json');
const LOG_FILE = path.join(ROOT, 'rotator.log');
const STOP_DIR = path.join(ROOT, '.account-stops');
const LOCK_FILE = path.join(ROOT, 'rotator.pid');

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg + '\n';
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
}

try {
  const old = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
  if (old && old !== process.pid) {
    try { process.kill(old, 0); log('already running as ' + old + ', exit'); process.exit(0); } catch (_) {}
  }
} catch (_) {}
fs.writeFileSync(LOCK_FILE, String(process.pid));

const names = fs.readFileSync(path.join(ROOT, 'names-500.txt'), 'utf8')
  .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const proxiesPath = path.join(ROOT, 'proxies-live.txt');
const proxies = fs.readFileSync(proxiesPath, 'utf8')
  .split(/\r?\n/).map(l => l.trim().split(/\s+/)[0])
  .filter(p => p && !p.startsWith('45.74.31.'));

let state = { cursor: 0, proxyCursor: 0, slotProxies: {} };
try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (_) {}
if (!state.slotProxies) state.slotProxies = {};
function save() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) {} }

function isStopped(name) {
  const key = [HOST.toLowerCase(), PORT, name.toLowerCase()].join(':');
  const id = crypto.createHash('sha256').update(key, 'utf8').digest('hex');
  return fs.existsSync(path.join(STOP_DIR, id + '.json'));
}

function nextName() {
  for (let i = 0; i < names.length; i++) {
    const n = names[(state.cursor + i) % names.length];
    if (!isStopped(n)) {
      state.cursor = (state.cursor + i + 1) % names.length;
      save();
      return n;
    }
  }
  return null;
}

function nextProxy() {
  if (!proxies.length) return null;
  const p = proxies[state.proxyCursor % proxies.length];
  state.proxyCursor = (state.proxyCursor + 1) % proxies.length;
  save();
  return p;
}

function proxyForSlot(slot, forceNew) {
  const cur = state.slotProxies[slot];
  if (!forceNew && cur) return cur;
  if (!proxies.length) return null;
  const p = proxies[state.proxyCursor % proxies.length];
  state.proxyCursor = (state.proxyCursor + 1) % proxies.length;
  state.slotProxies[slot] = p;
  save();
  return p;
}

function launch(slot) {
  const name = nextName();
  if (!name) { log('no names left (all stopped)'); return; }
  const proxy = proxyForSlot(slot, false);
  const env = Object.assign({}, process.env, {
    MC_PROXY: proxy || '',
    MC_PROXIES_FILE: 'proxies-live.txt',
    MC_CHATFILE: 'messages.txt',
    MC_CHAT_MS: '3000',
    MC_CHAT_WARMUP: '0',
    MC_ROTATE_MS: String(ROTATE_MS),
    MC_SESSION_MAX_MS: String(SESSION_MAX_MS)
  });
  log('slot ' + slot + ' -> ' + name + ' via ' + proxy);
  const child = spawn(process.execPath, ['--max-old-space-size=128', '--max-semi-space-size=4', 'bot.js', name], {
    cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore']
  });
  let done = false;
  const restart = (why) => {
    if (done) return;
    done = true;
    const banned = isStopped(name);
    if (banned) { proxyForSlot(slot, true); log('slot ' + slot + ' ban on ' + name + ' -> proxy rotated'); }
    log('slot ' + slot + ' x ' + name + ' (' + why + ')');
    setTimeout(() => launch(slot), 300);
  };
  child.on('exit', (code, signal) => restart('exit=' + code + (signal ? '/' + signal : '')));
  child.on('error', (e) => { log('spawn error: ' + e.message); restart('spawn-error'); });
}

process.on('uncaughtException', (e) => log('rotator error: ' + e.message));
process.on('SIGINT', () => process.exit(0));
log('rotator start: slots=' + SLOTS + ' rotate=' + ROTATE_MS + 'ms cap=' + SESSION_MAX_MS + 'ms names=' + names.length + ' proxies=' + proxies.length);
for (let s = 0; s < SLOTS; s++) setTimeout(() => launch(s), s * 300);
