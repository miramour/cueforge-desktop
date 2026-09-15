import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeWav, readWav } from './fixtures.mjs';
const root = path.resolve('test-results'),
  profile = fs.mkdtempSync(path.join(root, 'formats-')),
  ffmpeg = path.resolve('vendor/ffmpeg/bin/ffmpeg.exe'),
  files = [];
const source = makeWav(path.join(profile, 'original.wav'), { seconds: 3 });
for (const [ext, codec] of [
  ['mp3', 'libmp3lame'],
  ['flac', 'flac'],
  ['ogg', 'libvorbis'],
  ['aac', 'aac'],
  ['m4a', 'aac'],
  ['opus', 'libopus'],
  ['webm', 'libopus'],
]) {
  const file = path.join(profile, 'sample.' + ext);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source, '-c:a', codec, file], {
    windowsHide: true,
  });
  files.push(file);
}
const long = path.join(profile, 'long-65-minutes.flac');
execFileSync(
  ffmpeg,
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:sample_rate=8000:duration=3900',
    '-af',
    'volume=0.2',
    '-c:a',
    'flac',
    long,
  ],
  { windowsHide: true },
);
files.push(long);
const app = await _electron.launch({
  args: ['.', '--safe-mode'],
  env: { ...process.env, CUEFORGE_DATA: profile },
  timeout: 30000,
});
const results = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.getByRole('button', { name: 'Добавить аудио', exact: true }).waitFor();
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, files);
  await page.getByRole('button', { name: 'Добавить аудио', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 8);
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.pad.loaded .pad-state')).every(
        (e) => !['0:00', '—'].includes(e.textContent),
      ),
    null,
    { timeout: 90000 },
  );
  for (let i = 0; i < files.length; i++) {
    await page.locator('.pad.loaded').nth(i).click();
    await page.waitForFunction(
      (index) => document.querySelectorAll('.pad.loaded')[index].classList.contains('playing'),
      i,
    );
    await page.waitForTimeout(200);
    assert(
      !(await page.locator('.output .meter span').first().getAttribute('style')).includes(
        'width: 0%;',
      ),
    );
    results.push('Playback ' + path.extname(files[i]) + (i === 7 ? ' 65 minutes' : ''));
    await page.getByRole('button', { name: 'Стоп', exact: true }).click();
  }
  const info = await page.evaluate((file) => window.cue.analyze(file, 3900), long);
  assert.equal(info.peaks.length, 640);
  assert(info.samples.length <= 720000);
  assert(info.peaks.some((n) => n > 0));
  results.push('Bounded analysis of a 65-minute file');
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    path.join(profile, 'long-clip.wav'),
  );
  await page.evaluate((file) => window.cue.exportClip(file, 3600, 3601.25, 'long'), long);
  assert.equal(readWav(fs.readFileSync(path.join(profile, 'long-clip.wav'))).duration, 1.25);
  results.push('Accurate WAV extraction at minute 60');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Управление', exact: true }).click();
  await page
    .locator('.binding-row')
    .first()
    .getByRole('button', { name: 'Назначить клавишу', exact: true })
    .click();
  await page.keyboard.press('Control+Shift+F9');
  await page.getByLabel('Область Ячейка 1', { exact: true }).selectOption('global');
  assert(
    await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Shift+F9')),
  );
  results.push('Windows global shortcut registration');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.screenshot({ path: path.join(root, 'formats.png') });
  console.log(results.join('\n'));
  fs.writeFileSync(
    path.join(root, 'formats-results.json'),
    JSON.stringify({ results, profile }, null, 2),
  );
} catch (e) {
  const page = await app.firstWindow();
  console.log(await page.locator('body').innerText());
  throw e;
} finally {
  await app.close();
}
