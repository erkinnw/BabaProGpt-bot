const fs = require('fs');
const { SocksClient } = require('socks');

const INPUT = process.argv[2] || 'proxies-all.txt';
const OUTPUT = process.argv[3] || 'proxies-working.txt';
const CONCURRENCY = Number(process.argv[4] || 300);
const TIMEOUT = Number(process.argv[5] || 8000);

const HOST_IP = '213.146.165.219';
const HOST_NAME = 'play.diyojennw.com.tr';
const PORT = 25565;
const PROTOCOL = 775;

function varInt(n) {
  const out = [];
  while (true) {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
    if (!n) break;
  }
  return Buffer.from(out);
}

function str(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varInt(b.length), b]);
}

function handshakePacket() {
  const body = Buffer.concat([
    varInt(0x00),
    varInt(PROTOCOL),
    str(HOST_NAME),
    Buffer.from([(PORT >> 8) & 0xff, PORT & 0xff]),
    varInt(1)
  ]);
  return Buffer.concat([varInt(body.length), body]);
}

function statusRequest() {
  return Buffer.from([0x01, 0x00]);
}

function testProxy(entry) {
  return new Promise((resolve) => {
    const [host, portStr] = entry.split(':');
    const port = Number(portStr);
    let socket = null;
    let done = false;
    const started = Date.now();
    const finish = (ok, info) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (socket) try { socket.destroy(); } catch (_) {}
      resolve(ok ? { ok: true, proxy: entry, latency: Date.now() - started, info } : { ok: false, proxy: entry });
    };
    const timer = setTimeout(() => finish(false), TIMEOUT);

    SocksClient.createConnection({
      proxy: { host, port, type: 5 },
      command: 'connect',
      destination: { host: HOST_IP, port: PORT },
      timeout: TIMEOUT
    }).then(({ socket: s }) => {
      socket = s;
      s.on('error', () => finish(false));
      s.on('close', () => finish(false));
      let buf = Buffer.alloc(0);
      let sent = false;
      s.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (!sent && buf.length >= 1) {
          sent = true;
          s.write(handshakePacket());
          s.write(statusRequest());
        }
        const parsed = tryParsePacket(buf);
        if (parsed) {
          try {
            const text = parsed.toString('utf8');
            JSON.parse(text);
            finish(true, parsed.length);
          } catch (_) {
            finish(false);
          }
        }
      });
      s.write(handshakePacket());
      s.write(statusRequest());
      sent = true;
    }).catch(() => finish(false));
  });
}

function readVarInt(buf, offset) {
  let value = 0, shift = 0, pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, pos };
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

function tryParsePacket(buf) {
  const len = readVarInt(buf, 0);
  if (!len) return null;
  if (buf.length < len.pos + len.value) return null;
  let pos = len.pos;
  const pid = readVarInt(buf, pos);
  if (!pid) return null;
  pos = pid.pos;
  const slen = readVarInt(buf, pos);
  if (!slen) return null;
  pos = slen.pos;
  if (buf.length < pos + slen.value) return null;
  return buf.slice(pos, pos + slen.value);
}

(async () => {
  const list = fs.readFileSync(INPUT, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  console.log('Testing', list.length, 'proxies with concurrency', CONCURRENCY);
  const results = [];
  let index = 0, completed = 0;
  let out = fs.createWriteStream(OUTPUT, { flags: 'a' });
  out.write('');
  out.end();

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= list.length) return;
      const r = await testProxy(list[i]);
      completed++;
      if (r.ok) {
        results.push(r);
        fs.appendFileSync(OUTPUT, `${r.proxy} ${r.latency}\n`);
        console.log('WORKING', r.proxy, r.latency + 'ms', '| found:', results.length);
      }
      if (completed % 250 === 0) console.log('progress', completed + '/' + list.length, 'working:', results.length);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, worker);
  await Promise.all(workers);
  results.sort((a, b) => a.latency - b.latency);
  fs.writeFileSync('proxies-working.json', JSON.stringify(results, null, 2));
  console.log('DONE. working:', results.length);
  if (results.length) console.log('BEST:', results[0].proxy, results[0].latency + 'ms');
})();
