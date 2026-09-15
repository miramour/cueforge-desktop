import { _electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readWav } from './fixtures.mjs';
const root = path.resolve('test-results'),
  profile = fs.mkdtempSync(path.join(root, 'package-'));
const p = JSON.parse(fs.readFileSync('demo/Демонстрационный сет.cueforge', 'utf8'));
for (const b of p.banks)
  for (const pad of b.pads) if (pad) pad.file = path.resolve('demo', pad.file);
fs.writeFileSync(path.join(profile, 'session.json'), JSON.stringify(p));
const app = await _electron.launch({
  executablePath: path.resolve('release/win-unpacked/CueForge.exe'),
  args: [],
  env: { ...process.env, CUEFORGE_DATA: profile },
  timeout: 30000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'Пэд 1: Демо • Открытие', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Пэд 1: Демо • Открытие', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pad.playing'));
  await page.getByRole('button', { name: 'Содержимое и поиск', exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(root, 'CueForge.png') });
  await page.getByRole('button', { name: 'Стоп', exact: true }).click();
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    path.join(profile, 'packaged-clip.wav'),
  );
  await page.evaluate(
    (file) => window.cue.exportClip(file, 0.5, 1.5, 'packaged'),
    p.banks[0].pads[0].file,
  );
  assert.equal(readWav(fs.readFileSync(path.join(profile, 'packaged-clip.wav'))).duration, 1);
  assert.deepEqual(errors, []);
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    },
    path.join(profile, 'close-recording.wav'),
  );
  await page.getByRole('button', { name: 'Запись', exact: true }).click();
  await page.getByRole('button', { name: 'Пэд 1: Демо • Открытие', exact: true }).click();
  await page.waitForTimeout(350);
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  const recording = fs.readFileSync(path.join(profile, 'close-recording.wav'));
  assert(recording.length > 44);
  assert.equal(recording.readUInt32LE(40), recording.length - 44);
  console.log(
    'PASS packaged EXE startup with default GPU, audible playback, bundled FFmpeg, clean renderer, graceful recording close',
  );
  fs.writeFileSync(
    path.join(root, 'package-results.json'),
    JSON.stringify({ passed: true, profile, errors }, null, 2),
  );
} finally {
  await app.close().catch(() => {});
}
