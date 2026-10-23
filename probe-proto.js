'use strict';
const { SocksClient } = require('socks');
const nmp = require('minecraft-protocol');

const HOST = '213.146.165.219';
const PORT = 25565;
const PROTO = Number(process.argv[2] || 774);

SocksClient.createConnection({
  proxy: { host: '152.67.22.144', port: 1080, type: 5 },
  command: 'connect',
  destination: { host: HOST, port: PORT },
  timeout: 25000
}).then(({ socket }) => {
  socket.setNoDelay(true);
  const client = nmp.createClient({
    version: '1.21.11',
    protocolVersion: PROTO,
    stream: socket,
    username: 'BabaProGpt',
    keepAlive: false,
    checkTimeoutInterval: 30000,
    hideErrors: false
  });
  client.on('connect', () => console.log('connect emitted, proto', PROTO));
  client.on('state', (s) => console.log('state ->', s));
  client.on('packet', (d, meta) => console.log('PKT', meta.name));
  client.on('login', () => console.log('login event'));
  client.on('set_compression', () => console.log('set_compression'));
  client.on('success', () => console.log('success'));
  client.on('kick_disconnect', (r) => console.log('kick_disconnect', JSON.stringify(r).slice(0, 300)));
  client.on('disconnect', (r) => console.log('disconnect', JSON.stringify(r).slice(0, 300)));
  client.on('error', (e) => console.log('error', e && e.message));
  client.on('end', (r) => { console.log('end: ' + r); process.exit(0); });
  setTimeout(() => { console.log('TIMEOUT 30s'); process.exit(0); }, 30000);
}).catch(e => { console.log('socks fail', e.message); process.exit(1); });
