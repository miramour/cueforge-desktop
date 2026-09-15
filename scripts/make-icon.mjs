import fs from 'node:fs';
import { deflateSync } from 'node:zlib';
const size = 256,
  raw = Buffer.alloc((size * 4 + 1) * size);
const bars = [62, 110, 156, 98, 130],
  centers = [66, 97, 128, 159, 190];
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const rounded =
      (x < 30 && y < 30 && (x - 30) ** 2 + (y - 30) ** 2 > 900) ||
      (x > 225 && y < 30 && (x - 225) ** 2 + (y - 30) ** 2 > 900) ||
      (x < 30 && y > 225 && (x - 30) ** 2 + (y - 225) ** 2 > 900) ||
      (x > 225 && y > 225 && (x - 225) ** 2 + (y - 225) ** 2 > 900);
    let bar = false;
    for (let i = 0; i < 5; i++) {
      const dx = Math.abs(x - centers[i]),
        dy = Math.max(0, Math.abs(y - 128) - bars[i] / 2 + 8);
      if (dx * dx + dy * dy <= 64) bar = true;
    }
    raw[offset] = bar ? 116 : 20;
    raw[offset + 1] = bar ? 223 : 32;
    raw[offset + 2] = bar ? 189 : 30;
    raw[offset + 3] = rounded ? 0 : 255;
  }
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', png);
fs.writeFileSync('build/icon.ico', Buffer.concat([ico, png]));
