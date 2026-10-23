'use strict';
// leave-one-out CV for captcha-graded.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const labels = fs.readFileSync(path.join(__dirname, 'labels.txt'), 'utf8').trim().split('\n')
  .filter(Boolean).map(JSON.parse).filter(l => l.conf >= 0.6);
let ok = 0, glyphOk = 0, tot = 0, glyphTot = 0, noSeg = 0;
for (const l of labels) {
  const f = path.isAbsolute(l.f) || l.f.toLowerCase().includes('maps')
    ? path.join(__dirname, l.f) : path.join(__dirname, 'maps', l.f);
  if (!fs.existsSync(f)) continue;
  execSync(`node captcha-graded.js train --exclude "${l.f}"`, { cwd: __dirname, stdio: 'pipe' });
  const r = JSON.parse(execSync(`node captcha-graded.js test "${path.relative(__dirname, f).replace(/\\/g, '/')}"`, { cwd: __dirname, stdio: 'pipe' }).toString());
  if (!r.answer) { console.log('NOSEG', l.a, path.basename(l.f)); noSeg++; continue; }
  tot++; glyphTot += 3;
  let hits = 0;
  for (let k = 0; k < 3; k++) if (r.answer[k] === l.a[k]) hits++;
  glyphOk += hits;
  if (r.answer === l.a) { ok++; }
  else console.log('FAIL', l.a, '→', r.answer, 'conf=' + r.conf.toFixed(2), 'glyphs=' + hits + '/3', path.basename(l.f));
}
console.log('LOO CV over', tot, 'segmented captchas (', noSeg, 'unsegmentable)');
console.log('string accuracy:', ok + '/' + tot, '→ ' + (100 * ok / tot).toFixed(1) + '%');
console.log('glyph accuracy :', glyphOk + '/' + glyphTot, '→ ' + (100 * glyphOk / glyphTot).toFixed(1) + '%');
