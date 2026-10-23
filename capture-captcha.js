const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const dns = require('dns');
const fs = require('fs');

const proxyArg = process.argv[2];
const version = '26.1';
const username = 'BabaProGpt';
const HOST = 'play.diyojennw.com.tr';
const PORT = 25565;

const [phost, pport] = proxyArg.split(':');

async function resolveTarget() {
  try {
    const a = await dns.promises.lookup(HOST, { family: 4 });
    return { host: a.address, port: PORT };
  } catch (_) { return { host: '213.146.165.219', port: PORT }; }
}

(async () => {
  const dest = await resolveTarget();
  const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username,
    auth: 'offline',
    version,
    connect: (client) => {
      console.log('[connect] via', proxyArg);
      SocksClient.createConnection({
        proxy: { host: phost, port: Number(pport), type: 5 },
        command: 'connect',
        destination: { host: dest.host, port: dest.port },
        timeout: 20000
      }).then(({ socket }) => {
        socket.setNoDelay(true);
        setImmediate(() => { client.setSocket(socket); client.emit('connect'); });
      }).catch((err) => {
        console.error('[connect] SOCKS error:', err.message);
        setImmediate(() => client.emit('error', err));
      });
    },
    checkTimeoutInterval: 45000,
    hideErrors: false
  });

  bot.on('login', () => console.log('[event] login'));
  bot.on('spawn', () => console.log('[event] SPAWNED'));
  bot.on('kicked', (reason) => console.log('[event] KICKED', JSON.stringify(reason)));
  bot.on('end', (reason) => console.log('[event] end:', reason));
  bot.on('error', (err) => console.log('[event] error:', err && err.message));
  bot.on('message', (msg) => console.log('[chat-text]', msg.toString()));
  bot.on('title', (text, type) => console.log('[title]', type, text && text.toString()));
  bot.on('actionBar', (msg) => console.log('[actionbar]', msg && msg.toString()));

  bot._client.on('packet', (data, meta) => {
    const n = meta.name || '?';
    if (['map_create', 'map'].includes(n)) {
      fs.writeFileSync(`map-dump-${Date.now()}.json`, JSON.stringify(data));
      console.log('[map packet] dumped', n, JSON.stringify(data).slice(0, 200));
    } else if (!['position', 'entity_position', 'entity_velocity', 'update_time', 'keep_alive', 'ping', 'level_chunk_with_light', 'chunk_batch_start', 'chunk_batch_finished', 'login', 'declare_commands', 'commands', 'player_info_update', 'able_recipes', 'recipe', 'advancements', 'custom_payload'].includes(n)) {
      console.log('[pkt]', n, JSON.stringify(data).slice(0, 300));
    }
  });

  setTimeout(() => {
    console.log('[capture] done');
    try { bot.quit(); } catch (_) {}
    setTimeout(() => process.exit(0), 500);
  }, 40000);
})().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
