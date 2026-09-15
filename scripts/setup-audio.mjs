import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('This distribution targets Windows x64.');
const version = '9.0.1',
  sha256 = 'fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9';
const url = `https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${version}-essentials_build.zip`;
const vendor = path.resolve('vendor/ffmpeg');
if (fs.existsSync(path.join(vendor, 'bin/ffmpeg.exe'))) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(path.join(vendor, 'bin/ffmpeg.exe')))
    hash.update(chunk);
  if (hash.digest('hex') !== '72a489eccd008c2ec2c0a5856c5c75bc3d8bbfa90166c4566865c246445e6aa3')
    throw new Error(
      'Existing FFmpeg differs from the pinned binary. Restore vendor/ffmpeg using the documented archive.',
    );
  console.log('FFmpeg verified.');
  process.exit(0);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cueforge-ffmpeg-')),
  archive = path.join(temp, 'ffmpeg.zip');
console.log(`Downloading FFmpeg ${version} from gyan.dev…`);
const response = await fetch(url);
if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));
const hash = createHash('sha256');
for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
if (hash.digest('hex') !== sha256) throw new Error('FFmpeg SHA-256 mismatch; refusing to extract.');
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.resolve('scripts/expand-zip.ps1'),
    '-Archive',
    archive,
    '-Destination',
    path.join(temp, 'unpacked'),
  ],
  { stdio: 'inherit', windowsHide: true },
);
const source = path.join(temp, 'unpacked', `ffmpeg-${version}-essentials_build`);
fs.mkdirSync(path.join(vendor, 'bin'), { recursive: true });
for (const file of ['bin/ffmpeg.exe', 'LICENSE', 'README.txt'])
  fs.copyFileSync(path.join(source, file), path.join(vendor, file));
console.log('FFmpeg prepared; license and build/source information included.');
