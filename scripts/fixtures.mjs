import fs from 'node:fs';
import path from 'node:path';
export function readWav(buffer) {
  let rate = 0,
    channels = 0,
    bits = 0;
  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const kind = buffer.toString('ascii', offset, offset + 4),
      size = buffer.readUInt32LE(offset + 4);
    if (kind === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10);
      rate = buffer.readUInt32LE(offset + 12);
      bits = buffer.readUInt16LE(offset + 22);
    }
    if (kind === 'data')
      return {
        rate,
        channels,
        bits,
        bytes: size,
        offset: offset + 8,
        duration: size / ((rate * channels * bits) / 8),
      };
    offset += 8 + size + (size % 2);
  }
  throw new Error('Missing WAV data chunk');
}
export function makeWav(
  file,
  { seconds = 4, frequency = 330, bpm = 120, amplitude = 0.12, rate = 24000 } = {},
) {
  const frames = seconds * rate,
    buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const beat = t % (60 / bpm);
    const env = Math.exp(-beat * 20);
    const fade = Math.min(1, t * 100, (seconds - t) * 100);
    const sample = Math.round(
      (Math.sin(2 * Math.PI * frequency * t) * 0.3 + Math.sin(2 * Math.PI * 80 * t) * env) *
        amplitude *
        fade *
        32767,
    );
    buffer.writeInt16LE(sample, 44 + i * 4);
    buffer.writeInt16LE(sample, 46 + i * 4);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return file;
}
