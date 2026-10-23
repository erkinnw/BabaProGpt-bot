'use strict';
const fs = require('fs');
const path = require('path');

const labels = fs.readFileSync(path.join(__dirname, 'labels.txt'), 'utf8').trim().split('\n')
  .filter(Boolean).map(JSON.parse).filter(l => l.conf >= 0.6);
const W = 128;

function rects(raw) {
  const counts = new Map();
  for (const v of raw) if (v !== 0) counts.set(v, (counts.get(v) || 0) + 1);
  const scribble = new Set([...counts.values() || []] && [...counts.entries()].filter(e => e[0] === 207).map(e => e[0]));
  const mask = new Uint8Array(W * W);
  let total = 0;
  for (let i = 0; i < W * W; i++) {
    const v = raw[i];
    if (v !== 0 && !scribble.has(v)) { mask[i] = 1; total++; }
  }
  if (!total) return null;
  const seen = new Uint8Array(W * W);
  const comps = [];
  for (let i = 0; i < W * W; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i]; seen[i] = 1;
    const px = [];
    let minx = W, maxx = -1, miny = W, maxy = -1;
    while (stack.length) {
      const p = stack.pop(); px.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        const np = ny * W + nx;
        if (mask[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
      }
    }
    if (px.length >= 25) comps.push({ n: px.length, minx, maxx, miny, maxy });
  }
  comps.sort((a, b) => a.minx - b.minx);
  const groups = [];
  for (const c of comps) {
    const g = groups.find(g => c.minx <= g.maxx + 4);
    if (g) { g.items.push(c); if (c.maxx > g.maxx) g.maxx = c.maxx; if (c.miny < g.miny) g.miny = c.miny; if (c.maxy > g.maxy) g.maxy = c.maxy; g.n += c.n; }
    else groups.push({ items: [c], minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy, n: c.n });
  }
  return groups;
}

for (const l of labels) {
  const p = path.isAbsolute(l.f) || l.f.toLowerCase().includes('maps')
    ? path.join(__dirname, l.f) : path.join(__dirname, 'maps', l.f);
  if (!fs.existsSync(p)) { console.log('MISSING', l.f, l.a); continue; }
  const g = rects(fs.readFileSync(p));
  if (!g) { console.log('NULL', l.f, l.a); continue; }
  const info = g.map(x => `x${x.minx}-${x.maxx} y${x.miny}-${x.maxy} n${x.n}(c${x.items.length})`);
  console.log(l.a.padEnd(4), g.length + 'grp', info.join(' | '));
}
