'use strict';
const fs = require('fs');
const { segGlyphs, glyphPixels, loadFont } = require('./captcha-graded.js');
const W = 128;
const file = process.argv[2] || 'maps/babaprogpt5/cap-2026-10-23T06-42-05.bin';
const slot = Number(process.argv[3] || 0);
const chars = (process.argv[4] || 'e,0,c,t,7,9').split(',');
const g = segGlyphs(fs.readFileSync(file));
console.log('groups:', g ? g.length : null);
if (!g) process.exit(0);
const font = loadFont();
const t = glyphPixels(g[slot]);
console.log('slot', slot, 'minx=' + g[slot].minx, 'miny=' + g[slot].miny, 'maxx=' + g[slot].maxx, 'maxy=' + g[slot].maxy, 'testPx=' + t.size);
for (const ch of chars) {
  const rec = font[ch];
  if (!rec) { console.log(ch, 'no bitmap'); continue; }
  const bset = new Set(rec.data.map(k => ((k >> 8) + g[slot].miny) * W + ((k & 0xff) + g[slot].minx)));
  let inter = 0;
  for (const p of t) if (bset.has(p)) inter++;
  console.log('ch', ch, 'bmpPx=' + rec.data.length, 'inter=' + inter, 'dice=' + (2 * inter / (t.size + rec.data.length)).toFixed(3), 'frac=' + (inter / t.size).toFixed(3));
}
const b0 = {};
for (const ch of chars) b0[ch] = new Set(font[ch] ? font[ch].data.map(k => ((k >> 8) + g[slot].miny) * W + ((k & 0xff) + g[slot].minx)) : []);
const x0 = Math.max(0, g[slot].minx - 6), x1 = Math.min(127, g[slot].maxx + 4);
const y0 = Math.max(0, g[slot].miny - 4), y1 = Math.min(127, g[slot].maxy + 3);
for (let y = y0; y <= y1; y++) {
  let s = '';
  for (let x = x0; x <= x1; x++) {
    const p = y * W + x;
    if (t.has(p)) {
      let hit = null;
      for (const ch of chars) if (b0[ch] && b0[ch].has(p)) { hit = ch; break; }
      s += hit || 'T';
    } else {
      let hit = null;
      for (const ch of chars) if (b0[ch] && b0[ch].has(p)) { hit = ch; break; }
      s += hit ? hit.toLowerCase() : '.';
    }
  }
  console.log(String(y).padStart(3) + ' ' + s);
}
