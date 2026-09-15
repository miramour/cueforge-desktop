import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { app } from 'electron';
const binary = app.isPackaged
  ? path.join(process.resourcesPath, 'ffmpeg', 'bin', 'ffmpeg.exe')
  : path.join(app.getAppPath(), 'vendor', 'ffmpeg', 'bin', 'ffmpeg.exe');
const running = new Set<ReturnType<typeof spawn>>();
export function stopMediaJobs() {
  for (const child of running) child.kill();
}
function run(args: string[], onData?: (b: Buffer) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.add(proc);
    let error = '';
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Превышено время обработки аудио'));
    }, 300000);
    proc.stdout.on('data', (b: Buffer) => onData?.(b));
    proc.stderr.on('data', (b: Buffer) => {
      error = (error + b.toString()).slice(-4000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      clearTimeout(timeout);
      running.delete(proc);
      code === 0 ? resolve() : reject(new Error(error || `FFmpeg завершился с кодом ${code}`));
    });
  });
}
let analysisQueue: Promise<unknown> = Promise.resolve();
export function analyzeFile(
  file: string,
  duration: number,
): Promise<{ samples: Float32Array; peaks: number[]; rate: number }> {
  const task = async () => {
    const rate = 8000,
      limit = rate * 90,
      samples = new Float32Array(limit),
      peaks = Array(640).fill(0);
    let count = 0,
      remainder = Buffer.alloc(0);
    await run(
      [
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        file,
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(rate),
        '-f',
        'f32le',
        'pipe:1',
      ],
      (chunk) => {
        const data = Buffer.concat([remainder, chunk]);
        let i = 0;
        for (; i + 4 <= data.length; i += 4) {
          const value = data.readFloatLE(i);
          if (count < limit) samples[count] = value;
          const bin = Math.min(639, Math.floor((count / (rate * duration)) * 640));
          if (Number.isFinite(value))
            peaks[bin] = Math.max(peaks[bin], Math.min(1, Math.abs(value)));
          count++;
        }
        remainder = data.subarray(i);
      },
    );
    return { samples: samples.slice(0, Math.min(count, limit)), peaks, rate };
  };
  const result = analysisQueue.then(task, task);
  analysisQueue = result.catch(() => {});
  return result;
}
export async function exportClip(file: string, output: string, start: number, end: number | null) {
  const temp = path.join(
    path.dirname(output),
    `.cueforge-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`,
  );
  try {
    await run([
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      file,
      '-ss',
      String(start),
      ...(end !== null ? ['-t', String(end - start)] : []),
      '-map',
      '0:a:0',
      '-vn',
      '-c:a',
      'pcm_s16le',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-f',
      'wav',
      temp,
    ]);
    fs.renameSync(temp, output);
  } catch (e) {
    try {
      fs.unlinkSync(temp);
    } catch {}
    throw e;
  }
}
const conversions = new Map<string, Promise<string>>();
export async function prepareAudio(file: string) {
  const stat = fs.statSync(file),
    key = createHash('sha256').update(`${file}:${stat.size}:${stat.mtimeMs}`).digest('hex');
  const folder = path.join(app.getPath('userData'), 'audio-cache');
  fs.mkdirSync(folder, { recursive: true });
  const output = path.join(folder, key + '.flac');
  if (fs.existsSync(output)) return output;
  if (conversions.has(key)) return conversions.get(key)!;
  const work = (async () => {
    const temp = output + '.tmp';
    try {
      await run([
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        file,
        '-map',
        '0:a:0',
        '-vn',
        '-c:a',
        'flac',
        '-f',
        'flac',
        '-y',
        temp,
      ]);
      fs.renameSync(temp, output);
      return output;
    } finally {
      conversions.delete(key);
      try {
        fs.unlinkSync(temp);
      } catch {}
    }
  })();
  conversions.set(key, work);
  return work;
}
