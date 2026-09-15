import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeWav, readWav } from './fixtures.mjs';
const root = path.resolve('test-results');
fs.mkdirSync(root, { recursive: true });
const profile = fs.mkdtempSync(path.join(root, 'e2e-'));
const audioA = makeWav(path.join(profile, 'Opening.wav'), { seconds: 8 });
const audioB = makeWav(path.join(profile, 'Applause.wav'), { seconds: 8, frequency: 440 });
const results = [],
  errors = [];
const app = await _electron.launch({
  args: ['.', '--safe-mode'],
  env: { ...process.env, CUEFORGE_DATA: profile },
  timeout: 30000,
});
const check = (name) => {
  results.push(name);
  console.log('PASS', name);
};
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text());
  });
  await page.getByRole('button', { name: 'Добавить аудио', exact: true }).waitFor();
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
    },
    [audioA, audioB],
  );
  await page.getByRole('button', { name: 'Добавить аудио', exact: true }).click();
  await page.getByRole('button', { name: 'Пэд 1: Opening', exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.pad-title')[0]?.textContent?.includes('BPM') &&
      !document.querySelectorAll('.pad-title')[0]?.textContent?.includes('BPM —'),
  );
  check('Импорт двух WAV и анализ BPM');
  await page.getByRole('button', { name: 'Пэд 1: Opening', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pad.playing').length === 1);
  await page.waitForTimeout(350);
  const meter = await page.locator('.output .meter span').first().getAttribute('style');
  assert(!meter.includes('width: 0%;'));
  check('Реальное воспроизведение: ненулевой измеренный уровень');
  await page.getByRole('button', { name: 'Микс', exact: true }).click();
  await page.getByRole('button', { name: 'Пэд 2: Applause', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pad.playing').length === 2);
  check('Режим микса: два одновременно играющих пэда');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pad.playing').length === 0);
  await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pad.playing').length === 2);
  check('Пауза и продолжение микса');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role=dialog]').count(), 0);
  assert.equal(await page.locator('.pad.playing').count(), 2);
  check('Esc в диалоге закрывает диалог и сохраняет воспроизведение');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('.pad.playing').length === 0);
  check('Двойной Esc немедленно останавливает звук');
  await page
    .getByRole('button', { name: 'Пэд 1: Opening', exact: true })
    .click({ button: 'right' });
  await page.getByLabel('Начало, сек', { exact: true }).fill('1');
  await page.getByLabel('Конец, сек', { exact: true }).fill('2.5');
  await page.getByLabel('Название звука', { exact: true }).fill('Opening trimmed');
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    path.join(profile, 'clip.wav'),
  );
  await page.getByRole('button', { name: 'Экспорт клипа WAV', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[role=status]')?.textContent?.includes('Клип сохранён'),
  );
  const clip = fs.readFileSync(path.join(profile, 'clip.wav'));
  assert.equal(readWav(clip).duration, 1.5);
  check('Обрезка и экспорт PCM WAV точной длительности');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByRole('button', { name: 'Сингл', exact: true }).click();
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    path.join(profile, 'recording.wav'),
  );
  await page.getByRole('button', { name: 'Запись', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('.recording'));
  await page.getByRole('button', { name: 'Пэд 2: Applause', exact: true }).click();
  await page.waitForTimeout(1300);
  await page.locator('.recording').click();
  await page.waitForFunction(() =>
    document.querySelector('[role=status]')?.textContent?.includes('Запись сохранена'),
  );
  const rec = fs.readFileSync(path.join(profile, 'recording.wav'));
  assert(rec.length > 48000);
  assert.equal(rec.readUInt32LE(40), rec.length - 44);
  let max = 0;
  for (let i = 44; i < rec.length; i += 2) max = Math.max(max, Math.abs(rec.readInt16LE(i)));
  assert(max > 100);
  check('Запись live-микса: корректный WAV с ненулевым аудио');
  await page.getByRole('button', { name: 'Стоп', exact: true }).click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Управление', exact: true }).click();
  await page
    .locator('.binding-row')
    .first()
    .getByRole('button', { name: 'Назначить клавишу', exact: true })
    .click();
  await page.keyboard.press('Control+F8');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.keyboard.press('Control+F8');
  await page.waitForFunction(() => document.querySelectorAll('.pad.playing').length === 1);
  check('Назначение и выполнение клавиатурной команды');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    path.join(profile, 'bundle.cueforge'),
  );
  await page.getByRole('button', { name: 'С файлами', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[role=status]')?.textContent?.includes('Сет сохранён'),
  );
  assert.equal(fs.readdirSync(path.join(profile, 'bundle-audio')).length, 2);
  check('Экспорт переносимого сета с аудиофайлами');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Интерфейс', exact: true }).click();
  await page.getByRole('button', { name: '8 × 4', exact: true }).click();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  assert.equal(await page.locator('.pad').count(), 32);
  check('Сетка 8×4');
  await page.getByRole('button', { name: 'Сменить тему', exact: true }).click();
  await page.screenshot({ path: path.join(root, 'light.png') });
  await page.getByRole('button', { name: 'Сменить тему', exact: true }).click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: '4 × 3', exact: true }).click();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.screenshot({ path: path.join(root, 'main.png') });
  const session = JSON.parse(fs.readFileSync(path.join(profile, 'session.json'), 'utf8'));
  assert.equal(session.banks[0].pads[0].name, 'Opening trimmed');
  assert.equal(session.keys['cell:0'].key, 'Control+F8');
  check('Автосохранение редактирования и клавиш');
  assert.deepEqual(errors, []);
  check('Отсутствие ошибок JavaScript');
} catch (e) {
  const page = await app.firstWindow();
  console.log('FAIL BODY', await page.locator('body').innerText());
  await page.screenshot({ path: path.join(root, 'failure.png') });
  throw e;
} finally {
  fs.writeFileSync(
    path.join(root, 'e2e-results.json'),
    JSON.stringify({ results, errors, profile }, null, 2),
  );
  await app.close();
}
console.log(`Passed ${results.length} end-to-end checks. Profile: ${profile}`);
