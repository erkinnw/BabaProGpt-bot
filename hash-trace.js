'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const v = [
  ['c7fde121', 'czu'],
  ['b302c426', 'zu3'],
  ['ee694289', 'ccg'],
  ['0acce916', '031'],
  ['3716649c', 'grg'],
  ['05a166a0', '06k'],
  ['679414fb', 'skg'],
  ['8790518a', 'bvb']
];
function walk(d) {
  let o = [];
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) o = o.concat(walk(p));
    else if (f.name.endsWith('.bin')) o.push(p);
  }
  return o;
}
const hf = {};
for (const f of walk('maps')) {
  const m = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
  (hf[m] = hf[m] || []).push(f);
}
for (const [pre, ans] of v) {
  const full = Object.keys(hf).find(k => k.startsWith(pre));
  console.log(pre, '=', ans, '<-', full ? hf[full].join(' ; ') : 'no .bin on disk');
}
