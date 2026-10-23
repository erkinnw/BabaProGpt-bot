const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const dns = require('dns');

const proxyArg = process.argv[2] || '109.110.51.153:1080';
const version = process.argv[3] || '1.21.4';
const username = process.argv[4] || 'BabaProGpt';
const HOST = 'play.diyojennw.com.tr';
const PORT = 25565;

const [phost, pport] = proxyArg.split(':');

async function resolveTarget() {
  try {
    const srv = await dns.promises.resolveSrv('_minecraft._tcp.' + HOST);
    if (srv && srv.length) return { host: srv[0].name, port: srv[0].port };
  } catch (_) {}
  try {
    const a = await dns.promises.lookup(HOST, { family: 4 });
    return { host: a.address, port: PORT };
  } catch (_) {
    return { host: '213.146.165.219', port: PORT };
  }
}

(async () => {
  const dest = await resolveTarget();
  console.log('target resolved:', dest);

  function makeConnect(conn) {
    return (client) => {
      console.log('[connect] via SOCKS5', proxyArg);
      SocksClient.createConnection({
        proxy: { host: phost, port: Number(pport), type: 5 },
        command: 'connect',
        destination: { host: dest.host, port: dest.port },
        timeout: 20000
      }).then(({ socket }) => {
        socket.setNoDelay(true);
        console.log('[connect] tunnel up, attaching socket');
        setImmediate(() => { client.setSocket(socket); client.emit('connect'); });
      }).catch((err) => {
        console.error('[connect] SOCKS error:', err.message);
        setImmediate(() => client.emit('error', err));
      });
    };
  }

  const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username,
    auth: 'offline',
    version,
    connect: makeConnect(dest),
    checkTimeoutInterval: 45000,
    hideErrors: false
  });

  bot.on('login', () => console.log('[event] login'));
  bot.on('spawn', () => {
    console.log('[event] SPAWNED at', bot.entity && JSON.stringify(bot.entity.position), 'dimension', bot.game && bot.game.dimension);
  });
  bot.on('kicked', (reason, loggedIn) => {
    console.log('[event] KICKED loggedIn=' + loggedIn, JSON.stringify(reason));
  });
  bot.on('end', (reason) => console.log('[event] end:', reason));
  bot.on('error', (err) => console.log('[event] error:', err && err.message));
  bot.on('message', (msg) => {
    console.log('[chat-text]', msg.toString());
  });
  bot.on('title', (text, type) => console.log('[title]', type, text && text.toString()));
  bot.on('actionBar', (msg) => console.log('[actionbar]', msg && msg.toString()));

  setTimeout(() => {
    console.log('[probe] done, quitting');
    try { bot.quit(); } catch (_) {}
    setTimeout(() => process.exit(0), 1000);
  }, 30000);
})().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
