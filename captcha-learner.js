'use strict';
const fs = require('fs');
const path = require('path');

const G = 16;

function classifyBytes(raw) {
  const counts = new Map();
  for (const v of raw) {
    if (v === 0) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const entries = [...counts.entries()].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n);
  if (!entries.length) return null;
  const scribble = new Set(entries.filter(e => e.v === 207).map(e => e.v));
  const W = 128;
  const mask = new Uint8Array(W * W);
  let minx = W, maxx = -1, miny = W, maxy = -1, total = 0;
  for (let i = 0; i < W * W; i++) {
    const v = raw[i];
    if (v !== 0 && !scribble.has(v)) {
      mask[i] = 1;
      total++;
      const x = i % W, y = (i / W) | 0;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }
  if (!total) return null;

  const seen = new Uint8Array(W * W);
  const comps = [];
  for (let i = 0; i < W * W; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const px = [];
    minx = W; maxx = -1; miny = W; maxy = -1;
    while (stack.length) {
      const p = stack.pop();
      px.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
          const np = ny * W + nx;
          if (mask[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
        }
      }
    }
    if (px.length >= 25) comps.push({ px, minx, maxx, miny, maxy });
  }
  clusters(comps);
  return { comps, W };
}

function clusterX(comps) {
  const sorted = [...comps].sort((a, b) => a.minx - b.minx);
  const groups = [];
  for (const c of sorted) {
    const g = groups.find(g => c.minx <= g.maxx2 + 8 && c.maxx2 >= g.minx1 - 8);
    // not used
  }
  return groups;
}

function clusters(comps) {
  comps.sort((a, b) => a.minx - b.minx);
  const out = [];
  for (const c of comps) {
    const g = out.find(g => c.minx <= g.maxx + 4);
    if (g) {
      g.items.push(c);
      if (c.maxx > g.maxx) g.maxx = c.maxx;
      if (c.miny < g.miny) g.miny = c.miny;
      if (c.maxy > g.maxy) g.maxy = c.maxy;
      g.n += c.px.length;
    } else {
      out.push({ items: [c], minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy, n: c.px.length });
    }
  }
  comps.clusters = out;
  return out;
}

function glyphMask(cls) {
  const W = 128;
  const x0 = cls.minx, x1 = cls.maxx, y0 = cls.miny, y1 = cls.maxy;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const grid = new Uint8Array(G * G);
  const sx = w / G, sy = h / G;
  const filled = new Uint8Array(w * h);
  for (const c of cls.items) {
    for (const p of c.px) {
      const x = p % W - x0, y = ((p / W) | 0) - y0;
      filled[y * w + x] = 1;
    }
  }
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      let any = 0;
      const xs = Math.floor(gx * sx), xe = Math.min(w, Math.ceil((gx + 1) * sx));
      const ys = Math.floor(gy * sy), ye = Math.min(h, Math.ceil((gy + 1) * sy));
      for (let y = ys; y < ye && !any; y++) for (let x = xs; x < xe; x++) { if (filled[y * w + x]) { any = 1; break; } }
      grid[gy * G + gx] = any;
    }
  }
  return { grid, aspect: h / w, w, h };
}

function dist(a, b) {
  let d = 0;
  for (let i = 0; i < G * G; i++) if (a.grid[i] !== b.grid[i]) d++;
  d = d / (G * G);
  d += 0.25 * Math.abs(a.aspect - b.aspect);
  return d;
}

function loadTemplates() {
  const p = path.join(__dirname, 'templates.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function train() {
  const labels = fs.readFileSync(path.join(__dirname, 'labels.txt'), 'utf8').trim().split('\n')
    .filter(Boolean).map(l => JSON.parse(l)).filter(l => l.conf >= 0.6);
  const templates = [];
  for (const l of labels) {
    const fpath = l.f.includes('maps/') || l.f.includes('\\') || l.f.startsWith('maps') ? path.join(__dirname, l.f) : path.join(__dirname, 'maps', l.f);
    const raw = fs.readFileSync(fpath);
    const r = analyze(raw);
    if (!r || r.length !== l.a.length) {
      console.log('SKIP (cluster mismatch)', l.f, 'clusters=', r && r.length, 'label=', l.a);
      continue;
    }
    r.forEach((g, i) => templates.push({ ch: l.a[i], grid: [...g.grid], aspect: g.aspect, from: l.f }));
  }
  fs.writeFileSync(path.join(__dirname, 'templates.json'), JSON.stringify(templates));
  console.log('templates:', templates.length, 'per char:', [...new Set(templates.map(t => t.ch))].join(''));
}

function analyze(raw) {
  const r = classifyBytes(raw);
  if (!r) return null;
  if (!r.comps.clusters) return null;
  let cls = r.comps.clusters.filter(c => c.n >= 80);
  cls.sort((a, b) => b.n - a.n);
  if (cls.length >= 3) {
    cls = cls.slice(0, 3);
    cls.sort((a, b) => a.minx - b.minx);
    return cls.map(glyphMask);
  }
  if (!cls.length) return null;
  const W = 128;
  const mask = new Uint8Array(W * W);
  let minx = W, maxx = -1, miny = W, maxy = -1, tot = 0;
  for (const g of r.comps.clusters) {
    for (const c of g.items) {
      for (const p of c.px) {
        const x = p % W, y = (p / W) | 0;
        mask[y * W + x] = 1;
        tot++;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (!tot) return null;
  const prof = new Array(W).fill(0);
  for (let x = minx; x <= maxx; x++) {
    let s = 0;
    for (let y = miny; y <= maxy; y++) s += mask[y * W + x];
    prof[x] = s;
  }
  function valleyCut(a, b) {
    let best = 1e9, bx = -1;
    for (let x = Math.floor(a); x <= Math.ceil(b); x++) {
      if (prof[x] < best) { best = prof[x]; bx = x; }
    }
    return bx;
  }
  const span = maxx - minx;
  let cut1 = valleyCut(minx + span * 0.22, minx + span * 0.45);
  let cut2 = valleyCut(minx + span * 0.55, minx + span * 0.78);
  if (cut2 <= cut1) { cut1 = Math.round(minx + span / 3); cut2 = Math.round(minx + 2 * span / 3); }
  const slices = [[minx, cut1], [cut1 + 1, cut2], [cut2 + 1, maxx]];
  return slices.map(([x0, x1]) => {
    const px = [];
    for (let y = miny; y <= maxy; y++) {
      for (let x = x0; x <= x1; x++) {
        if (mask[y * W + x]) px.push(y * W + x);
      }
    }
    return glyphMask({ minx: x0, maxx: x1, miny, maxy, items: [{ px }] });
  });
}

function classifyAnswer(glyphs, T) {
  if (!glyphs || !T || !T.length) return { answer: null, conf: 0, candidates: [] };
  const perGlyph = [];
  for (const g of glyphs) {
    const scored = T.map(t => ({ ch: t.ch, d: dist(g, t) })).sort((a, b) => a.d - b.d);
    const top = scored.slice(0, Math.min(3, scored.length));
    const votes = {};
    for (const s of top) votes[s.ch] = (votes[s.ch] || 0) + (1 - s.d);
    const list = Object.entries(votes).sort((a, b) => b[1] - a[1]).map(x => ({ ch: x[0], v: x[1] }));
    perGlyph.push(list);
  }
  if (!perGlyph.length) return { answer: null, conf: 0, candidates: [] };
  const answer = perGlyph.map(l => l[0].ch).join('');
  const confSum = perGlyph.reduce((s, l) => {
    const total = l.reduce((a, x) => a + x.v, 0);
    return s + (total ? l[0].v / total : 0);
  }, 0);
  let cands = [{ s: '', v: 0 }];
  for (const l of perGlyph) {
    const next = [];
    for (const c of cands) for (const e of l.slice(0, 3)) next.push({ s: c.s + e.ch, v: c.v - Math.log(e.v + 1e-6) });
    next.sort((a, b) => a.v - b.v);
    cands = next.slice(0, 5);
  }
  const seen = new Set();
  const candidates = [];
  const push = (s) => { if (!seen.has(s)) { seen.add(s); candidates.push(s); } };
  push(answer);
  for (const c of cands) push(c.s);
  return { answer, conf: confSum / perGlyph.length, candidates };
}

function classifyWithTemplates(raw, T) {
  const glyphs = analyze(raw);
  return classifyAnswer(glyphs, T);
}

function classifyFile(f) {
  const raw = fs.readFileSync(f);
  const glyphs = analyze(raw);
  return classifyAnswer(glyphs, loadTemplates());
}

const cmd = process.argv[2];
if (cmd === 'train') train();
else if (cmd === 'test') {
  console.log(JSON.stringify(classifyFile(process.argv[3]), null, 1));
} else {
  console.log('usage: node captcha-learner.js train | test <file.bin>');
}

module.exports = { classifyFile, analyze, classifyWithTemplates, glyphMask, dist };
