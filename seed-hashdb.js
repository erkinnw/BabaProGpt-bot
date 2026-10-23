'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const labels = fs.readFileSync(path.join(__dirname, 'labels.txt'), 'utf8').trim().split('\n')
  .filter(Boolean).map(JSON.parse).filter(l => l.verified || l.conf >= 0.8);
const out = {};
for (const l of labels) {
  const p = path.isAbsolute(l.f) || l.f.toLowerCase().includes('maps')
    ? path.join(__dirname, l.f)
    : path.join(__dirname, 'maps', l.f);
  if (!fs.existsSync(p)) { console.log('missing', l.f); continue; }
  const h = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
  out[h] = l.a;
  console.log('seed:', h.slice(0, 10), '→', l.a, '(' + l.f + ')');
}
let ex = {};
try { ex = JSON.parse(fs.readFileSync(path.join(__dirname, 'hashdb.json'), 'utf8')); } catch (e) {}
Object.assign(ex, out);
fs.writeFileSync(path.join(__dirname, 'hashdb.json'), JSON.stringify(ex, null, 1));
console.log('hashdb now has', Object.keys(ex).length, 'entries');
