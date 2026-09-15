import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { validateProject, type Project } from '../src/model';
import { fromHcpl, toHcpl } from '../src/hcpl';
export const audioExtensions = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.aac',
  '.m4a',
  '.opus',
  '.webm',
]);
export function audioPath(file: unknown): string {
  if (
    typeof file !== 'string' ||
    file.length > 32768 ||
    !path.isAbsolute(file) ||
    !/^[a-z]:[\\/]/i.test(file) ||
    !audioExtensions.has(path.extname(file).toLowerCase())
  )
    throw new Error('Недопустимый путь аудиофайла');
  return path.resolve(file);
}
export function atomicJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}
export function readProject(file: string): Project {
  const stat = fs.statSync(file);
  if (stat.size > 16 * 1024 * 1024) throw new Error('Файл сета слишком большой');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const p = raw.format === 'cueforge' ? validateProject(raw) : fromHcpl(raw);
  for (const bank of p.banks)
    for (const pad of bank.pads)
      if (pad) pad.file = audioPath(path.resolve(path.dirname(file), pad.file));
  return p;
}
export function exportSet(p: Project, file: string, portable: boolean) {
  const clean = validateProject(p);
  const directory = path.dirname(file);
  const mediaDir = path.join(directory, path.basename(file, path.extname(file)) + '-audio');
  const copies = new Map<string, string>();
  for (const bank of clean.banks)
    for (const pad of bank.pads)
      if (pad) {
        const source = audioPath(pad.file);
        if (portable) {
          if (!fs.existsSync(source)) throw new Error(`Файл не найден: ${path.basename(source)}`);
          let dest = copies.get(source);
          if (!dest) {
            fs.mkdirSync(mediaDir, { recursive: true });
            let n = copies.size + 1;
            dest = path.join(mediaDir, `${n.toString().padStart(3, '0')}-${path.basename(source)}`);
            while (fs.existsSync(dest))
              dest = path.join(mediaDir, `${++n}-${path.basename(source)}`);
            fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
            copies.set(source, dest);
          }
          pad.file = path.relative(directory, dest);
        } else pad.file = path.relative(directory, source);
        delete pad.missing;
      }
  atomicJson(file, path.extname(file).toLowerCase() === '.hcpl' ? toHcpl(clean) : clean);
}
export function wavHeader(bytes: number, rate: number) {
  const h = Buffer.alloc(44);
  h.write('RIFF');
  h.writeUInt32LE(bytes + 36, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}
export function pcm16(input: Float32Array) {
  const b = Buffer.allocUnsafe(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const f = Number.isFinite(input[i]) ? Math.max(-1, Math.min(1, input[i])) : 0;
    b.writeInt16LE(Math.round(f * (f < 0 ? 32768 : 32767)), i * 2);
  }
  return b;
}
export function audioResponse(file: string, request: Request): Response {
  if (!fs.existsSync(file)) return new Response(null, { status: 404 });
  const size = fs.statSync(file).size;
  let start = 0,
    end = size - 1;
  const range = request.headers.get('range');
  const mime: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.webm': 'audio/webm',
  };
  const headers: Record<string, string> = {
    'Content-Type': mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
  };
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    if (m[1]) {
      start = +m[1];
      if (m[2]) end = Math.min(+m[2], end);
    } else start = Math.max(0, size - Number(m[2]));
    if (start >= size || start > end)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  return new Response(
    request.method === 'HEAD' || size === 0
      ? null
      : (Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream),
    { status: range ? 206 : 200, headers },
  );
}
