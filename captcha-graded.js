'use strict';
// captcha-graded.js — static-bitmap font matcher
// Build canonical glyph bitmaps from labeled captchas (same-phase samples),
// classify new captchas by containment-IoU of pixel masks.
const fs = require('fs');
const path = require('path');

const FONT_FILE = path.join(__dirname, 'font.json');
const W = 128;

function segGlyphs(raw) {
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
    if (px.length >= 25) comps.push({ px, minx, maxx, miny, maxy, n: px.length });
  }
  comps.sort((a, b) => a.minx - b.minx);
  const groups = [];
  for (const c of comps) {
    const g = groups.find(g => c.minx <= g.maxx + 4);
    if (g) { g.items.push(c); if (c.maxx > g.maxx) g.maxx = c.maxx; if (c.miny < g.miny) g.miny = c.miny; if (c.maxy > g.maxy) g.maxy = c.maxy; g.n += c.n; }
    else groups.push({ items: [c], minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy, n: c.n });
  }
  let g = groups.filter(gr => gr.n >= 80);
  if (g.length > 3) { g.sort((a, b) => b.n - a.n); g = g.slice(0, 3); }
  if (g.length === 3) { g.sort((a, b) => a.minx - b.minx); return g; }
  if (g.length === 2) {
    // split at widest meridian valley of the merged span; keep smaller group as letter1
    const a = g[0], b = g[1];
    const lo = Math.min(a.minx, b.minx), hi = Math.max(a.maxx, b.maxx);
    const prof = new Int16Array(hi + 1).fill(-1);
    for (const gr of g) for (const it of gr.items) for (const p of it.px) {
      const x = p % W; if (prof[x] < 0) prof[x] = 0; prof[x]++;
    }
    let c1 = -1, best = 1e9;
    for (let x = lo + 8; x <= hi - 8; x++) { if (prof[x] >= 0 && prof[x] < best) { best = prof[x]; c1 = x; } }
    if (c1 < 0) return null;
    g = [a.minx <= lo ? [Math.min(a.minx, lo), c1] : null, null];
    const part1 = cropGroups(groups, lo, c1);
    const part2 = cropGroups(groups, c1 + 1, hi);
    if (part1 && part2) return [part1, part2];
    return null;
  }
  if (g.length === 1) {
    const a = g[0];
    const span = a.maxx - a.minx;
    let c1 = Math.round(a.minx + span * 0.34), best = 1e9;
    const prof = new Int16Array(a.maxx + 1).fill(-1);
    for (const it of a.items) for (const p of it.px) { const x = p % W; prof[x] = (prof[x] < 0 ? 0 : prof[x]) + 1; }
    for (let x = a.minx + Math.round(span * 0.22); x <= a.minx + Math.round(span * 0.45); x++) if (prof[x] < best) { best = prof[x]; c1 = x; }
    let c2 = Math.round(a.minx + span * 0.66); best = 1e9;
    for (let x = a.minx + Math.round(span * 0.55); x <= a.minx + Math.round(span * 0.8); x++) if (prof[x] < best) { best = prof[x]; c2 = x; }
    if (c2 <= c1) return null;
    const p1 = cropGroups([a], a.minx, c1), p2 = cropGroups([a], c1 + 1, c2), p3 = cropGroups([a], c2 + 1, a.maxx);
    if (p1 && p2 && p3) return [p1, p2, p3];
    return null;
  }
  return null;
}

function cropGroups(groups, xlo, xhi) {
  const items = [];
  for (const gr of groups) for (const it of gr.items) {
    if ((it.minx % W) <= xhi && (it.maxx % W) >= xlo) {
      const px = [];
      let minx = W, maxx = -1, miny = W, maxy = -1;
      for (const p of it.px) {
        const x = p % W, y = (p / W) | 0;
        if (x < xlo || x > xhi) continue;
        px.push(y * W + x);
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
      if (px.length >= 20) items.push({ px, minx, maxx, miny, maxy, n: px.length });
    }
  }
  if (!items.length) return null;
  let minx = W, maxx = -1, miny = W, maxy = -1, n = 0;
  for (const it of items) { if (it.minx < minx) minx = it.minx; if (it.maxx > maxx) maxx = it.maxx; if (it.miny < miny) miny = it.miny; if (it.maxy > maxy) maxy = it.maxy; n += it.n; }
  return { items, minx, maxx, miny, maxy, n };
}

function glyphPixels(gr) {
  const set = new Set();
  for (const it of gr.items) for (const p of it.px) set.add(p);
  return set;
}

function train() {
  const exclude = process.argv[3] === '--exclude' ? process.argv[4] : null;
  const labels = fs.readFileSync(path.join(__dirname, 'labels.txt'), 'utf8').trim().split('\n')
    .filter(Boolean).map(JSON.parse).filter(l => l.conf >= 0.6)
    .filter(l => !exclude || !l.f.includes(exclude));
  const tmpls = []; // {ch, px:Set(abs)}
  let usedCaptcha = 0;
  for (const l of labels) {
    const f = path.isAbsolute(l.f) || l.f.toLowerCase().includes('maps')
      ? path.join(__dirname, l.f) : path.join(__dirname, 'maps', l.f);
    if (!fs.existsSync(f)) continue;
    const g = segGlyphs(fs.readFileSync(f));
    if (!g || g.length !== l.a.length) continue;
    usedCaptcha++;
    for (let k = 0; k < g.length; k++) {
      tmpls.push({ ch: l.a[k], f: l.f, px: [...glyphPixels(g[k])], src: { minx: g[k].minx, miny: g[k].miny } });
    }
  }
  fs.writeFileSync(FONT_FILE, JSON.stringify(tmpls));
  console.log('occurrence templates:', tmpls.length, 'from', usedCaptcha, 'captchas → chars:', [...new Set(tmpls.map(t => t.ch))].sort().join(''));
}

let FONT = null;
function loadFont() {
  if (!FONT) {
    try { FONT = JSON.parse(fs.readFileSync(FONT_FILE, 'utf8')); } catch (e) { FONT = []; }
  }
  return FONT;
}

function scoreGlyph(gr, ch) {
  let best = 0;
  for (const t of loadFont()) {
    if (t.ch !== ch) continue;
    const bmap = new Set(t.px);
    let b = 0;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      let inter = 0;
      for (const p of grPx) {
        const x = (p % W) + dx, y = ((p / W) | 0) + dy;
        if (bmap.has(y * W + x)) inter++;
      }
      const d = (2 * inter) / (grPx.size + bmap.size);
      if (d > b) b = d;
    }
    if (b > best) best = b;
  }
  return best;
}

const grPx = new Set(); // set by classifyFile before scoring
function classifyFile(f) {
  const g = segGlyphs(fs.readFileSync(f));
  if (!g || g.length !== 3) return { answer: null, conf: 0, candidates: [] };
  const font = loadFont();
  let answer = '';
  let confSum = 0;
  const topk = [];
  for (let k = 0; k < 3; k++) {
    grPx.clear();
    for (const p of glyphPixels(g[k])) grPx.add(p);
    const scored = [];
    for (const c of [...new Set(font.map(t => t.ch))].sort()) scored.push({ ch: c, v: scoreGlyph(g[k], c) });
    scored.sort((a, b) => b.v - a.v);
    topk.push(scored.slice(0, 3).map(x => x.ch));
    answer += scored[0].ch;
    confSum += scored[0].v;
  }
  let cands = [{ s: '' }];
  for (let k = 0; k < 3; k++) {
    const next = [];
    for (const c of cands) for (const ch of topk[k]) next.push({ s: c.s + ch });
    cands = next.slice(0, 5);
  }
  const seen = new Set([answer]);
  const candidates = [answer];
  for (const c of cands) if (!seen.has(c.s)) { seen.add(c.s); candidates.push(c.s); }
  return { answer, conf: confSum / 3, candidates };
}

const cmd = process.argv[2];
if (cmd === 'train') train();
else if (cmd === 'test') console.log(JSON.stringify(classifyFile(process.argv[3])));
else console.log('usage: node captcha-graded.js train | test <file.bin>');

module.exports = { classifyFile, segGlyphs, glyphPixels, loadFont, scoreGlyph };
