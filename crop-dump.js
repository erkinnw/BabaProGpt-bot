'use strict';
const fs = require('fs');
const { segGlyphs, glyphPixels } = require('./captcha-graded.js');
const W = 128;
const file = process.argv[2];
const slot = Number(process.argv[3] || 0);
const g = segGlyphs(fs.readFileSync(file));
if (!g || !g[slot]) { console.log('seg failed'); process.exit(0); }
const t = glyphPixels(g[slot]);
console.log('bbox', g[slot].minx + '-' + g[slot].maxx, g[slot].miny + '-' + g[slot].maxy, 'n=' + t.size);
for (let y = g[slot].miny - 2; y <= g[slot].maxy + 2; y++) {
  let s = '';
  for (let x = g[slot].minx - 3; x <= g[slot].maxx + 3; x++) s += t.has(y * W + x) ? '#' : '.';
  console.log(String(y).padStart(3) + ' ' + s);
}
