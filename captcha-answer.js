const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const dns = require('dns');
const fs = require('fs');
const zlib = require('zlib');

const proxyArg = process.argv[2] || '109.110.51.153:1080';
const username = 'BabaProGpt';
const HOST = 'play.diyojennw.com.tr';
const PORT = 25565;
const [phost, pport] = proxyArg.split(':');

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
function writePngFromBytes(file, bytes, sc) {
  const W = 128 * sc, H = 128 * sc;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const b = bytes[((y / sc) | 0) * 128 + ((x / sc) | 0)];
      let r = 20, g = 20, bl = 20;
      if (b !== 0) {
        r = 40 + (b % 256) * 0.5; g = 120 + (b % 256) * 0.3; bl = 40 + (b % 128);
      }
      raw[p++] = r; raw[p++] = g; raw[p++] = bl;
    }
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))
  ]));
}

(async () => {
  let ip = '213.146.165.219';
  try { const l = await dns.promises.lookup(HOST, { family: 4 }); ip = l.address; } catch (_) {}

  fs.writeFileSync('answer.txt', '');
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
        console.log('tunnel up');
        setImmediate(() => { client.setSocket(socket); client.emit('connect'); });
      }).catch((err) => {
        console.error('SOCKS error:', err.message);
        setImmediate(() => client.emit('error', err));
      });
    },
    checkTimeoutInterval: 45000, hideErrors: false
  });

  let mapBytes = null;
  bot.on('message', (msg) => console.log('[chat]', msg.toString()));
  bot.on('kicked', (r) => console.log('[kicked]', (r && r.toString && r.toString()).slice(0, 400)));
  bot.on('end', (reason) => { console.log('[end]', reason); setTimeout(() => process.exit(0), 300); });
  bot.on('error', (e) => console.log('[error]', e && e.message));

  bot._client.on('packet', (data, meta) => {
    if (meta.name === 'map' && data.columns && data.rows) {
      const buf = Buffer.isBuffer(data.data) ? data.data : Buffer.from(data.data);
      const cols = data.columns, rows = data.rows, x0 = data.x || 0, y0 = data.y || 0;
      if (!mapBytes || (cols === 128 && rows === 128)) {
        mapBytes = new Array(128 * 128).fill(0);
      }
      if (buf.length === cols * rows) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const b = buf[r * cols + c];
            const idx = (y0 + r) * 128 + (x0 + c);
            if (idx >= 0 && idx < 128 * 128) mapBytes[idx] = b;
          }
        }
      }
      // render by byte value classes
      writePngFromBytes('live-captcha.png', mapBytes, 3);
      writePngFromBytes('live-captcha-big.png', mapBytes, 4);
      console.log('[map updated]', cols + 'x' + rows, 'at', x0 + ',' + y0);
    }
  });

  const poll = setInterval(() => {
    try {
      const a = fs.readFileSync('answer.txt', 'utf8').trim();
      if (a) {
        fs.writeFileSync('answer.txt', '');
        console.log('[sending answer]', a);
        bot.chat(a);
      }
    } catch (_) {}
  }, 300);

  setTimeout(() => { console.log('[timeout] leaving'); try { bot.quit(); } catch (_) {} setTimeout(() => process.exit(0), 500); }, 120000);
})().catch(e => { console.error('[fatal]', e.message); process.exit(1); });
