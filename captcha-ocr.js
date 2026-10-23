const fs = require('fs');
const { createWorker } = require('tesseract.js');
const { strokeCount } = require('./strokes.js');

const CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';

class Ocr {
  constructor() {
    this.worker = null;
  }

  async init() {
    this.worker = await createWorker('eng');
    await this.worker.setParameters({
      tessedit_pageseg_mode: '10',
      tessedit_char_whitelist: CHARSET
    });
  }

  // encode an RGBA pixel array into PNG buffer (simple, no deps)
  encodePng(w, h, rgba) {
    /* reuse minimal chunk writer from caller file? implement standalone */
    const crcTable = Ocr.crcTable || (Ocr.crcTable = (() => {
      const t = [];
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
      return t;
    })());
    const crc32 = buf => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    function chunk(type, data) {
      const t = Buffer.from(type, 'ascii');
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
      return Buffer.concat([len, t, data, crc]);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // RGBA
    const stride = w * 4 + 1;
    const raw = Buffer.alloc(stride * h);
    let p = 0;
    for (let y = 0; y < h; y++) {
      raw[p++] = 0;
      rgba.copy(raw, p, y * w * 4, (y + 1) * w * 4);
      p += w * 4;
    }
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', require('zlib').deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0))
    ]);
  }

  // bytes: Uint8Array of 128*128 raw map bytes. The plugin draws the 3 glyphs in one
  // palette color and the noise scribble curves in another color (e.g. glyphs=232/234
  // on one map, scribble=207; on another map glyphs=204, scribble=207).
  // The scribble is a single continuous thin curve -> it is the value with the LOWEST
  // pixel count that still spans a big bbox. Strategy: pick the byte value whose pixel
  // count forms the *biggest* total (glyphs have many pixels), but guard: if a byte has
  // very few pixels (<200) treat as scribble and drop; if unclear (ratios close),
  // prefer non-207 when both 204 and others exist (scribble was always 207 twice).
  renderMask(bytes) {
    const counts = {};
    for (const v of bytes) { if (v !== 0) counts[v] = (counts[v] || 0) + 1; }
    const entries = Object.entries(counts).map(([k, n]) => ({ byte: Number(k), n })).sort((a, b) => b.n - a.n);

    let glyphBytes;
    if (entries.length === 1) {
      glyphBytes = [entries[0].byte];
    } else {
      const scribble = entries.filter(e => e.n < Math.max(0.72 * entries[0].n, 150)).map(e => e.byte);
      glyphBytes = entries.filter(e => !scribble.includes(e.byte)).map(e => e.byte);
      if (glyphBytes.length === 0) glyphBytes = [entries[0].byte];
    }
    const set = new Set(glyphBytes);
    const mask = new Uint8Array(128 * 128);
    for (let i = 0; i < mask.length; i++) mask[i] = set.has(bytes[i]) ? 1 : 0;
    return mask;
  }

  components(mask) {
    // 8-connectivity labeling of kept pixels
    const W = 128, H = 128;
    const seen = new Uint8Array(W * H);
    const comps = [];
    for (let s = 0; s < W * H; s++) {
      if (!mask[s] || seen[s]) continue;
      const stack = [s];
      seen[s] = 1;
      const px = [];
      while (stack.length) {
        const idx = stack.pop();
        const x = idx % W, y = (idx / W) | 0;
        px.push(idx);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const nIdx = yy * W + xx;
            if (mask[nIdx] && !seen[nIdx]) { seen[nIdx] = 1; stack.push(nIdx); }
          }
        }
      }
      if (px.length < 60) continue; // noise blobs
      let minX = 128, maxX = -1, minY = 128, maxY = -1;
      for (const i of px) {
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      comps.push({ px, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, strokes: strokeCount(px, mask) });
    }
    comps.sort((a, b) => a.minX - b.minX);
    return comps;
  }

  cropPng(comp, mask, pad = 10) {
    const w = Math.min(128, comp.w + pad * 2);
    const h = Math.min(128, comp.h + pad * 2);
    const x0 = Math.max(0, comp.minX - pad), y0 = Math.max(0, comp.minY - pad);
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const off = (y * w + x) * 4;
        const inComp = (() => {
          const yy = y0 + y, xx = x0 + x;
          if (xx < 0 || yy < 0 || xx >= 128 || yy >= 128) return 0;
          return mask[yy * 128 + xx] ? 255 : 0;
        })();
        rgba[off] = 0; rgba[off + 1] = 0; rgba[off + 2] = 0; rgba[off + 3] = 255 - inComp;
        if (inComp) { rgba[off] = 255; rgba[off + 3] = 255; }
      }
    }
    return this.encodePng(w, h, rgba);
  }

  async readChar(comp, mask) {
    const buf = this.cropPng(comp, mask);
    await this.worker.setParameters({ tessedit_pageseg_mode: '10' });
    const { data } = await this.worker.recognize(buf);
    let out = '';
    let conf = 0;
    if (data.words) {
      for (const w of data.words) {
        if (!w.symbols) continue;
        for (const s of w.symbols) {
          if (s.confidence > conf && CHARSET.includes(s.text.toLowerCase())) {
            conf = s.confidence; out = s.text.toLowerCase();
          }
        }
      }
    }
    if (!out && data.text) {
      const t = data.text.replace(/[^a-z0-9]/gi, '');
      if (t) { out = t[0].toLowerCase(); conf = 50; }
    }
    return { char: out, conf, comp };
  }

  async solveMapBytes(bytes) {
    if (!this.worker) await this.init();
    const mask = this.renderMask(bytes);
    const comps = this.components(mask);
    const results = [];
    for (const c of comps) {
      const r = await this.readChar(c, mask);
      results.push(r);
    }
    return results; // [{char, conf, comp:{minX...}}]
  }
}

module.exports = { Ocr, CHARSET };

// CLI: node captcha-ocr.js last-map-bytes.bin
if (require.main === module) {
  (async () => {
    const raw = fs.readFileSync(process.argv[2] || 'last-map-bytes.bin');
    const ocr = new Ocr();
    const res = await ocr.solveMapBytes(raw);
    for (const r of res) {
      console.log(`char guess: '${r.char}' conf=${r.conf.toFixed(1)} x=${r.comp.minX}-${r.comp.maxX} y=${r.comp.minY}-${r.comp.maxY} size=${r.comp.w}x${r.comp.h} px=${r.comp.px.length}`);
    }
    console.log('COMPOSED:', res.map(r => r.char).join(''));
    process.exit(0);
  })().catch(e => { console.error(e); process.exit(1); });
}
