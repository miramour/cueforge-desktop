import { _electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeWav, readWav } from './fixtures.mjs';
import { freshProject, newPad } from '../src/model.ts';
const root = path.resolve('test-results'),
  profile = fs.mkdtempSync(path.join(root, 'controls-')),
  file = makeWav(path.join(profile, 'tone.wav'), { seconds: 5 });
const p = freshProject();
p.settings.mode = 'playlist';
p.banks[0].pads[0] = { ...newPad(file), name: 'First', duration: 5, start: 0.2, end: 1.2 };
p.banks[0].pads[1] = { ...newPad(file), name: 'Second', duration: 5, start: 0.2, end: 1.2 };
p.banks[1].pads[0] = { ...newPad(file), name: 'Bank B', duration: 5, loop: true };
fs.writeFileSync(path.join(profile, 'session.json'), JSON.stringify(p));
const app = await _electron.launch({
    args: ['.', '--safe-mode'],
    env: { ...process.env, CUEFORGE_DATA: profile },
    timeout: 30000,
  }),
  results = [];
let page;
const pass = (s) => {
  results.push(s);
  console.log('PASS', s);
};
try {
  page = await app.firstWindow();
  await page.getByRole('button', { name: 'Пэд 1: First', exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.pad-title')[1]?.textContent.includes('BPM') &&
      !document.querySelectorAll('.pad-title')[1]?.textContent.includes('BPM —'),
  );
  pass('Repeated source file gets independent pad metadata');
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    path.join(profile, 'playlist.wav'),
  );
  await page.getByRole('button', { name: 'Запись', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('.recording'));
  await page.getByRole('button', { name: 'Пэд 1: First', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('.pad')[1].classList.contains('playing'),
  );
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Стоп', exact: true }).click();
  await page.locator('.recording').click();
  await page.waitForFunction(() => !document.querySelector('.recording'));
  await page.waitForTimeout(150);
  const rec = fs.readFileSync(path.join(profile, 'playlist.wav')),
    wav = readWav(rec);
  const values = Array.from({ length: wav.bytes / 4 }, (_, i) =>
    Math.abs(rec.readInt16LE(wav.offset + i * 4)),
  );
  const first = values.findIndex((v) => v > 60),
    last = values.findLastIndex((v) => v > 60);
  let longest = 0,
    run = 0;
  for (let i = first; i <= last; i++) {
    run = values[i] < 10 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  assert(longest < 128, `Unexpected silence of ${longest} frames`);
  pass('Buffered playlist transition: no silence longer than 128 frames');
  await page.getByRole('button', { name: 'Сингл', exact: true }).click();
  await page.evaluate(() => {
    const native = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => [
      ...(await native()),
      {
        kind: 'audiooutput',
        deviceId: 'test-cue',
        groupId: 'test-separate-group',
        label: 'Virtual cue (test only)',
      },
    ];
    const sink = AudioContext.prototype.setSinkId;
    AudioContext.prototype.setSinkId = function (id) {
      return id === 'test-cue' ? Promise.resolve() : sink.call(this, id);
    };
  });
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Аудио', exact: true }).click();
  await page.getByRole('button', { name: 'Обновить устройства', exact: true }).click();
  await page
    .getByLabel('Отдельный выход наушников (CUE)', { exact: true })
    .selectOption('test-cue');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    path.join(profile, 'cue-isolation.wav'),
  );
  await page.getByRole('button', { name: 'Запись', exact: true }).click();
  await page.locator('.pad').first().getByTitle('Прослушать в наушниках', { exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.output.cue .meter span').style.width !== '0%',
  );
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Остановить CUE', exact: true }).click();
  await page.locator('.recording').click();
  await page.waitForFunction(() =>
    document.querySelector('[role=status]')?.textContent?.includes('Запись сохранена'),
  );
  const cue = fs.readFileSync(path.join(profile, 'cue-isolation.wav'));
  assert(cue.subarray(44).every((v) => v === 0));
  pass('Cue bus has signal while recorded master stays digitally silent (virtual device)');
  await page.evaluate(() => {
    const input = {
      id: 'test-controller',
      name: 'Test Controller',
      manufacturer: 'CueForge tests',
      onmidimessage: null,
    };
    const sent = [];
    const output = { id: 'test-output', name: 'Test LEDs', send: (bytes) => sent.push([...bytes]) };
    window.__midiTest = { input, sent };
    navigator.requestMIDIAccess = async () => ({
      inputs: new Map([[input.id, input]]),
      outputs: new Map([[output.id, output]]),
      onstatechange: null,
    });
  });
  await page.getByRole('button', { name: 'MIDI', exact: true }).first().click();
  await page.getByRole('button', { name: 'Управление', exact: true }).click();
  await page
    .locator('.binding-row')
    .first()
    .getByRole('button', { name: 'MIDI learn', exact: true })
    .click();
  await page.evaluate(() =>
    window.__midiTest.input.onmidimessage({ data: new Uint8Array([0x90, 60, 100]) }),
  );
  await page.waitForFunction(() =>
    document.querySelector('.binding-row')?.textContent?.includes('NOTE 60'),
  );
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.__midiTest.input.onmidimessage({ data: new Uint8Array([0x90, 60, 100]) });
    window.__midiTest.input.onmidimessage({ data: new Uint8Array([0x90, 60, 100]) });
  });
  await page.waitForFunction(() => document.querySelectorAll('.pad.playing').length === 1);
  assert((await page.evaluate(() => window.__midiTest.sent)).length > 0);
  pass('MIDI learn, repeated Note On deduplication and LED feedback (simulated controller)');
  await page.getByRole('button', { name: 'Стоп', exact: true }).click();
  await page.locator('.banks .bank').nth(1).click();
  await page.waitForTimeout(100);
  await page.evaluate(() =>
    window.__midiTest.input.onmidimessage({ data: new Uint8Array([0x90, 60, 100]) }),
  );
  await page.waitForFunction(() =>
    document.querySelector('.pad.playing')?.textContent?.includes('Bank B'),
  );
  pass('MIDI cell mapping follows the active bank');
  await page.getByRole('button', { name: 'Стоп', exact: true }).click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Управление', exact: true }).click();
  await page
    .locator('.binding-row')
    .filter({ hasText: 'Громкость зала (CC)' })
    .getByRole('button', { name: 'MIDI learn', exact: true })
    .click();
  await page.evaluate(() =>
    window.__midiTest.input.onmidimessage({ data: new Uint8Array([0xb0, 7, 100]) }),
  );
  await page.waitForTimeout(100);
  await page.evaluate(() =>
    window.__midiTest.input.onmidimessage({ data: new Uint8Array([0xb0, 7, 64]) }),
  );
  await page.waitForTimeout(100);
  const state = await page.evaluate(() => window.cue.load());
  assert(Math.abs(state.settings.master - 64 / 127) < 0.0001);
  pass('Continuous MIDI CC controls master volume');
} catch (e) {
  if (page) {
    console.log(await page.locator('body').innerText());
    await page.screenshot({ path: path.join(root, 'controls-failure.png') });
  }
  throw e;
} finally {
  fs.writeFileSync(
    path.join(root, 'controls-results.json'),
    JSON.stringify({ results, profile }, null, 2),
  );
  await app.close();
}
