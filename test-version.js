'use strict';
const fs = require('fs');
const dns = require('dns');
const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');

const HOST = 'play.diyojennw.com.tr';
const PORT = 25565;
const USERNAME = 'BabaProGpt';
const VERSION = process.argv[2];

dns.lookup(HOST, { family: 4 }, (err, ip) => {
  const dest = { host: (err ? ip : ip) || HOST, port: PORT };
  dns.lookup('152.67.22.144' === 'x' ? HOST : HOST, { family: 4 }, () => {});
  SocksClient.createConnection({
    proxy: { host: '152.67.22.144', port: 1080, type: 5 },
    command: 'connect',
    destination: { host: err ? HOST : ip, port: PORT },
    timeout: 20000
  }).then(({ socket }) => {
    socket.setNoDelay(true);
    const bot = mineflayer.createBot({
      username: USERNAME,
      version: VERSION,
      connect: (client) => {
        setImmediate(() => { client.setSocket(socket); client.emit('connect'); });
      }
    });
    let done = false;
    bot.on('login', () => { log('login ok'); });
    bot.on('message', (m) => { log('chat: ' + m.toString()); });
    bot.on('kicked', (r) => { log('kicked: ' + JSON.stringify(r).slice(0, 200)); });
    bot.on('end', (r) => { log('end: ' + r); process.exit(0); });
    bot.on('error', (e) => { log('error: ' + (e && e.message)); });
    setTimeout(() => { log('TIMEOUT scanning'); process.exit(0); }, 35000);
  }).catch(e => { log('socks fail: ' + e.message); process.exit(1); });
});

function log(s) {
  const line = '[' + new Date().toISOString().slice(11, 19) + ' ' + VERSION + '] ' + s;
  console.log(line);
  console.log(line);
}
