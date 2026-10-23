const fs = require('fs');
const zlib = require('zlib');

const j = JSON.parse(fs.readFileSync(process.argv[2]));
const a = Buffer.from(j.data.data);
const W = j.columns, H = j.rows;

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const b = a[idx];
      let r = 30, g = 30, b2 = 30;
      if (b === 204) { r = 0; g = 255; b2 = 0; }
      else if (b === 207) { r = 255; g = 255; b2 = 255; }
      else if (b !== 0) {
        const base = Math.floor(b / 4), shade = b % 4;
        const lum = 80 + shade * 40 + base * 3;
        r = g = b2 = lum;
      }
      raw[p++] = r; raw[p++] = g; raw[p++] = b2;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
fs.writeFileSync(process.argv[3], png(W, H));
console.log('written', process.argv[3], W + 'x' + H);
