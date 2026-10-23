'use strict';
// learn-font.js: extract glyph rects from labeled captchas, align same-char
// occurrences across captchas, measure pixel identity (static-bitmap hypothesis)
const fs = require('fs');
const path = require('path');

const labels = fs.readFileSync(path.join(__dirname, 'labels.txt'), 'utf8').trim().split('\n')
  .filter(Boolean).map(JSON.parse).filter(l => l.conf >= 0.6);
const W = 128;

function segments(raw) {
  const scribble = new Set([207]);
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
    if (px.length >= 25) {
      // per-component colprof within bbox
      const w = maxx - minx + 1;
      const colprof = new Uint16Array(w);
      const bits = new Uint8Array(px.length);
      const mk = new Uint8Array(w * (maxy - miny + 1));
      for (const p of px) {
        const x = p % W - minx, y = ((p / W) | 0) - miny;
        mk[y * w + x] = 1;
        colprof[x]++;
      }
      comps.push({ n: px.length, minx, maxx, miny, maxy, colprof, mk, w, h: maxy - miny + 1 });
    }
  }
  comps.sort((a, b) => a.minx - b.minx);
  const groups = [];
  for (const c of comps) {
    const g = groups.find(g => c.minx <= g.maxx + 4);
    if (g) { g.items.push(c); if (c.maxx > g.maxx) g.maxx = c.maxx; if (c.miny < g.miny) g.miny = c.miny; if (c.maxy > g.maxy) g.maxy = c.maxy; g.n += c.n; }
    else groups.push({ items: [c], minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy, n: c.n });
  }
  return { groups, mask };
}

const occ = []; const F = null; // occurrences
for (const l of labels) {
  const p = path.isAbsolute(l.f) || l.f.toLowerCase().includes('maps')
    ? path.join(__dirname, l.f) : path.join(__dirname, 'maps', l.f);
  if (!fs.existsSync(p)) continue;
  const raw = fs.readFileSync(p);
  const seg = segments(raw);
  if (!seg) continue;
  let g = seg.groups.filter(gr => gr.n >= 80);
  if (g.length === 3) {
    g.sort((a, b) => a.minx - b.minx);
    for (let k = 0; k < 3; k++) {
      const gr = g[k];
      occ.push({ f: l.f, ch: l.a[k], slot: k, minx: gr.minx, maxx: gr.maxx, miny: gr.miny, maxy: gr.maxy, w: gr.maxx - gr.minx + 1, h: gr.maxy - gr.miny + 1, n: gr.n, items: gr.items.map(c => ({ minx: c.minx, miny: c.miny, w: c.w, h: c.h, mk: c.mk })) });
    }
  } else if (g.length === 2) {
    // try valley cut on merged group using colprof of all items merged
    // crude: split at the largest valley in the merged bbox between letters
    // (fallback: even thirds) — only used to still count occurrences
    const whole = g.sort((a, b) => a.minx - b.minx);
    const [a, b] = whole;
    if (a.n / (a.n + b.n) < 0.33) {
      // first grp = letter1, b = rest
      const o1 = mkOcc(l, 0, a); o1.f = l.f;
      occ.push(o1);
      const c2 = Math.round((a.minx + b.maxx) / 2);
      occ.push({ f: l.f, ch: l.a[1], slot: 1, minx: b.minx, maxx: Math.max(a.maxx, b.maxx), miny: Math.min(a.miny, b.miny), maxy: Math.max(a.maxy, b.maxy), estimated: true, items: [] });
    }
    // skip other merges for now
  } else continue;
}
function mkOcc(l, slot, gr) {
  return { ch: l.a[slot], slot, minx: gr.minx, maxx: gr.maxx, miny: gr.miny, maxy: gr.maxy, w: gr.maxx - gr.minx + 1, h: gr.maxy - gr.miny + 1, n: gr.n, items: gr.items };
}

// group by char
const byChar = {};
for (const o of occ) (byChar[o.ch] = byChar[o.ch] || []).push(o);

function iouOf(a, b) {
  return a.n === 0 ? 0 : a.n / (a.n + b.n - a.n);
}
function compare(o1, o2) {
  function pix(o) {
    const set = new Set();
    for (const it of o.items || []) {
      for (let y = 0; y < it.h; y++) for (let x = 0; x < it.w; x++) {
        if (it.mk[y * it.w + x]) set.add((it.miny + y) * W + (it.minx + x));
      }
    }
    return set;
  }
  const A = pix(o1), B = pix(o2);
  let best = { iou: 0, frac: 0, dx: 0, dy: 0 };
  for (let dy = -6; dy <= 6; dy++) for (let dx = -10; dx <= 10; dx++) {
    let inter = 0;
    for (const p of A) {
      const x = (p % W) + dx, y = ((p / W) | 0) + dy;
      if (B.has(y * W + x)) inter++;
    }
    const un = A.size + B.size - inter;
    const iou = un ? inter / un : 0;
    const frac = Math.min(A.size, B.size) ? inter / Math.min(A.size, B.size) : 0;
    if (iou > best.iou) best = { iou, frac, dx, dy };
  }
  return best;
}

function diffDump(o1, o2, shift) {
  function pix(o, dx, dy) {
    const set = new Set();
    for (const it of o.items || []) {
      for (let y = 0; y < it.h; y++) for (let x = 0; x < it.w; x++) {
        if (it.mk[y * it.w + x]) set.add((it.miny + dy + y) * W + (it.minx + dx + x));
      }
    }
    return set;
  }
  const A = pix(o1, 0, 0), B = pix(o2, shift.dx, shift.dy);
  const x0 = Math.min(...[...A, ...B].map(p => p % W)), x1 = Math.max(...[...A, ...B].map(p => p % W));
  const y0 = Math.min(...[...A, ...B].map(p => (p / W) | 0)), y1 = Math.max(...[...A, ...B].map(p => (p / W) | 0));
  const lines = [];
  for (let y = y0; y <= y1; y++) {
    let s = '';
    for (let x = x0; x <= x1; x++) s += A.has(y * W + x) && B.has(y * W + x) ? '#' : A.has(y * W + x) ? 'A' : B.has(y * W + x) ? 'B' : '.';
    lines.push(s);
  }
  return lines.join('\n');
}

console.log('occurrences total:', occ.length, 'chars seen:', Object.keys(byChar).sort().join(''));
for (const ch of Object.keys(byChar).sort()) {
  const list = byChar[ch];
  if (list.length < 2) { console.log(ch, 'x' + list.length + ' (single)'); continue; }
  const res = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const b = compare(list[i], list[j]);
    res.push(`f=${list[i].f}@${list[i].minx} vs ${list[j].f}@${list[j].minx} ${ch}→iou=${b.iou.toFixed(3)} frac=${b.frac.toFixed(3)} d(${b.dx},${b.dy})`);
  }
  console.log(res.join('\n  '));
}

// dump diff for the two same-slot 'f' occurrences
const fs_ = byChar['f'].filter(o => !o.estimated);
const pair = [fs_[0], fs_[1]];
console.log('=== DIFF ' + pair[0].f + '@' + pair[0].minx + ',' + pair[0].miny + ' vs ' + pair[1].f + '@' + pair[1].minx + ',' + pair[1].miny + ' →', JSON.stringify(compare(pair[0], pair[1])));
console.log(diffDump(pair[0], pair[1], compare(pair[0], pair[1])));

