'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./captcha-learner.js');

const labels = fs.readFileSync(path.join(__dirname, 'labels.txt'), 'utf8').trim().split('\n')
  .filter(Boolean).map(l => JSON.parse(l));

// group label chars per glyph for voting: build templates per held-out map
let glyphN = 0, glyphOk = 0, strN = 0, strOk = 0;
const charConfusion = {};
const perGlyphDetail = [];

for (let i = 0; i < labels.length; i++) {
  const testLabel = labels[i];
  const truth = testLabel.a;
  const others = labels.filter((_, j) => j !== i);
  const templates = [];
  for (const l of others) {
    if (l.conf < 0.6) continue;
    const fpath = l.f.includes('maps/') || l.f.includes('\\') || l.f.startsWith('maps') ? path.join(__dirname, l.f) : path.join(__dirname, 'maps', l.f);
    if (!fs.existsSync(fpath)) continue;
    let raw;
    try { raw = fs.readFileSync(fpath); } catch (_) { continue; }
    const glyphs = L.analyze(raw);
    if (!glyphs || glyphs.length !== l.a.length) continue;
    glyphs.forEach((g, k) => templates.push({ ch: l.a[k], grid: [...g.grid], aspect: g.aspect }));
  }
  const fpathT = testLabel.f.includes('maps/') || testLabel.f.includes('\\') || testLabel.f.startsWith('maps') ? path.join(__dirname, testLabel.f) : path.join(__dirname, 'maps', testLabel.f);
  const rawT = fs.readFileSync(fpathT);
  const res = L.classifyWithTemplates(rawT, templates);
  if (!res || !res.answer) { console.log('skip ' + testLabel.f); continue; }
  strN++;
  const ok = res.answer === truth;
  if (ok) strOk++;
  for (let k = 0; k < truth.length; k++) {
    if (k >= res.answer.length) break;
    glyphN++;
    if (res.answer[k] === truth[k]) glyphOk++;
  }
  if (!ok) {
    console.log((ok ? 'OK  ' : 'FAIL') + ' truth=' + truth + ' got=' + res.answer + ' conf=' + res.conf.toFixed(2) + ' ' + testLabel.f);
  }
}
console.log('--- CV RESULT over ' + strN + ' captchas ---');
console.log('string accuracy : ' + strOk + '/' + strN + ' = ' + (strOk / strN * 100).toFixed(1) + '%');
console.log('glyph  accuracy : ' + glyphOk + '/' + glyphN + ' = ' + (glyphOk / glyphN * 100).toFixed(1) + '%');
