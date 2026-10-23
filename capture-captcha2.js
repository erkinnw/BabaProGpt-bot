const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const dns = require('dns');
const fs = require('fs');
const zlib = require('zlib');

const proxyArg = process.argv[2];
const prefix = process.argv[3] || 'cap';
const username = 'BabaProGpt';
const HOST = 'play.diyojennw.com.tr';
const PORT = 25565;
const [phost, pport] = proxyArg.split(':');

function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function writePng(file, W, H, get) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) { const [r, g, b] = get(x, y); raw[p++] = r; raw[p++] = g; raw[p++] = b; }
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))
  ]));
}

(async () => {
  let ip = '213.146.165.219';
  try { const l = await dns.promises.lookup(HOST, { family: 4 }); ip = l.address; } catch (_) {}
  const bot = mineflayer.createBot({
    host: HOST, port: PORT, username, auth: 'offline', version: '26.1',
    connect: (client) => {
      SocksClient.createConnection({
        proxy: { host: phost, port: Number(pport), type: 5 },
        command: 'connect',
        destination: { host: ip, port: PORT },
        timeout: 20000
      }).then(({ socket }) => {
        socket.setNoDelay(true);
        setImmediate(() => { client.setSocket(socket); client.emit('connect'); });
      }).catch((err) => {
        console.error('[socks-error]', err.message);
        setImmediate(() => client.emit('error', err));
      });
    },
    checkTimeoutInterval: 45000, hideErrors: false
  });

  let capIdx = 0;
  bot.on('message', (msg) => console.log('[chat]', msg.toString()));
  bot.on('kicked', (r) => console.log('[kicked]', (r && r.toString && r.toString()).slice(0, 200)));
  bot.on('end', (reason) => { console.log('[end]', reason); setTimeout(() => process.exit(0), 300); });
  bot.on('error', (e) => console.log('[error]', e && e.message));

  bot._client.on('packet', (data, meta) => {
    const n = meta.name;
    if (n === 'map') {
      const cols = data.columns, rows = data.rows;
      if (cols === 128 && rows === 128 && data.data) {
        const a = Buffer.isBuffer(data.data) ? data.data : Buffer.from(data.data);
        const file = `${prefix}-${++capIdx}.png`;
        writePng(file, cols, rows, (x, y) => {
          const b = a[y * 128 + x];
          if (b === 204) return [0, 220, 0];
          if (b === 207) return [255, 255, 255];
          if (b !== 0) return [100, 100, 100];
          return [15, 15, 15];
        });
        fs.writeFileSync(`${prefix}-${capIdx}.raw.json`, JSON.stringify(data.data.data));
        console.log('[map saved]', file);
      }
    }
  });
})().catch(e => { console.error('[fatal]', e.message); process.exit(1); });
