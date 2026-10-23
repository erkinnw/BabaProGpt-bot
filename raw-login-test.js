const crypto = require('crypto');
const { SocksClient } = require('socks');
const dns = require('dns');

const proxyArg = process.argv[2] || '45.74.31.41:8294';
const protocolVersion = Number(process.argv[3] || 775);
const username = process.argv[4] || 'BabaProGpt';

const [phost, pport] = proxyArg.split(':');

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
function offlineUUID(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  return h;
}

async function resolveIP() {
  try {
    const a = await dns.promises.lookup('play.diyojennw.com.tr', { family: 4 });
    return a.address;
  } catch (_) { return '213.146.165.219'; }
}

(async () => {
  const ip = await resolveIP();
  console.log('testing', proxyArg, 'proto', protocolVersion, '->', ip + ':25565');
  const { socket } = await SocksClient.createConnection({
    proxy: { host: phost, port: Number(pport), type: 5 },
    command: 'connect',
    destination: { host: ip, port: 25565 },
    timeout: 15000
  });
  socket.setNoDelay(true);
  console.log('tunnel up');

  const handshakeBody = Buffer.concat([
    varInt(0x00),
    varInt(protocolVersion),
    str('play.diyojennw.com.tr'),
    Buffer.from([0x63, 0xdd]),
    varInt(2)
  ]);
  socket.write(Buffer.concat([varInt(handshakeBody.length), handshakeBody]));

  const loginStart = Buffer.concat([
    varInt(0x00),
    str(username),
    offlineUUID(username)
  ]);
  socket.write(Buffer.concat([varInt(loginStart.length), loginStart]));

  let buf = Buffer.alloc(0);
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    console.log('GOT', d.length, 'bytes:', d.toString('hex').slice(0, 400));
    if (buf.length > 2000) process.exit(0);
  });
  socket.on('close', () => console.log('socket closed'));
  socket.on('error', (e) => console.log('socket error', e.message));
  setTimeout(() => { console.log('timeout, no more data'); process.exit(0); }, 12000);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
