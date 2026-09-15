import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshProject, newPad, validateProject, nextPad, keyFromEvent } from '../src/model';
import { fromHcpl, toHcpl } from '../src/hcpl';
import { midiMessage, sameMidi, ledVelocity } from '../src/midi';
import { estimateBpm } from '../src/analysis';
import {
  audioPath,
  audioResponse,
  exportSet,
  readProject,
  pcm16,
  wavHeader,
} from '../electron/files';
describe('Сеты', () => {
  it('хранит 256 независимых ячеек', () => {
    const p = freshProject();
    expect(p.banks.flatMap((b) => b.pads)).toHaveLength(256);
    p.banks[0].pads[0] = newPad('C:\\music\\a.wav');
    expect(p.banks[1].pads[0]).toBeNull();
  });
  it('плейлист проходит через пустые ячейки и банки и заканчивается', () => {
    const p = freshProject();
    const a = newPad('C:\\a.wav'),
      b = newPad('C:\\b.wav'),
      c = newPad('C:\\c.wav');
    c.missing = true;
    p.banks[0].pads[0] = a;
    p.banks[0].pads[2] = c;
    p.banks[2].pads[12] = b;
    expect(nextPad(p, a.id)).toBe(b);
    expect(nextPad(p, b.id)).toBeNull();
  });
  it('ограничивает данные недоверенного сета', () => {
    const p = freshProject();
    p.settings.master = Infinity;
    p.banks[0].pads[0] = {
      ...newPad('C:\\a.wav'),
      volume: 999,
      color: 'url(http://evil)',
      peaks: Array(5000).fill(NaN),
    };
    const clean = validateProject(p);
    expect(clean.settings.master).toBe(0.8);
    expect(clean.banks[0].pads[0]!.volume).toBe(1);
    expect(clean.banks[0].pads[0]!.color).toMatch(/^#/);
    expect(clean.banks[0].pads[0]!.peaks).toHaveLength(1024);
  });
  it('отклоняет неверную схему', () => {
    expect(() => validateProject({})).toThrow();
    expect(() => fromHcpl({ version: 999, pads: [] })).toThrow();
  });
  it('переносит HCPL без потери содержимого пэдов', () => {
    const p = freshProject();
    p.banks[7].name = 'Финал';
    p.banks[7].pads[31] = {
      ...newPad('C:\\a.wav'),
      name: 'Трек',
      loop: true,
      fade: true,
      fadeIn: 2,
      fadeOut: 3,
      start: 1.2,
      end: 4.5,
      bpm: 123,
    };
    p.keys['cell:31'] = { key: 'Control+F12', scope: 'local' };
    const copy = fromHcpl(toHcpl(p));
    expect(copy.banks[7].name).toBe('Финал');
    expect(copy.banks[7].pads[31]).toMatchObject({
      name: 'Трек',
      loop: true,
      fade: true,
      fadeIn: 2,
      fadeOut: 3,
      start: 1.2,
      end: 4.5,
      bpm: 123,
    });
    expect(copy.keys['cell:31'].key).toBe('Control+F12');
  });
  it('сохраняет переносимый сет с относительными путями и восстанавливает их', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cueforge-test-'));
    const file = path.join(root, 'source.wav');
    fs.writeFileSync(file, Buffer.concat([wavHeader(4, 48000), Buffer.alloc(4)]));
    const p = freshProject();
    p.banks[0].pads[0] = newPad(file);
    p.banks[0].pads[1] = newPad(file);
    const output = path.join(root, 'show.cueforge');
    exportSet(p, output, true);
    const raw = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(path.isAbsolute(raw.banks[0].pads[0].file)).toBe(false);
    const restored = readProject(output);
    expect(fs.existsSync(restored.banks[0].pads[0]!.file)).toBe(true);
    expect(restored.banks[0].pads[1]!.file).toBe(restored.banks[0].pads[0]!.file);
  });
  it('разрешает только аудиофайлы', () => {
    expect(() => audioPath('C:\\Windows\\system.ini')).toThrow();
    expect(() => audioPath('../a.wav')).toThrow();
    expect(() => audioPath('\\\\server\\share\\a.wav')).toThrow();
  });
  it('отдаёт точные диапазоны байтов для потокового декодера', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cueforge-range-')),
      file = path.join(root, 'range.wav');
    fs.writeFileSync(file, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
    const response = audioResponse(
      file,
      new Request('https://test/audio', { headers: { Range: 'bytes=2-5' } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/8');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4, 5]);
    expect(
      audioResponse(file, new Request('https://test/audio', { headers: { Range: 'bytes=999-' } }))
        .status,
    ).toBe(416);
  });
});
describe('Аудио и команды', () => {
  it('WAV имеет правильную длину и частоту', () => {
    const h = wavHeader(96000 * 4, 48000);
    expect(h.toString('ascii', 0, 4)).toBe('RIFF');
    expect(h.readUInt32LE(4)).toBe(384036);
    expect(h.readUInt16LE(22)).toBe(2);
    expect(h.readUInt32LE(24)).toBe(48000);
  });
  it('PCM ограничивает клиппинг и нечисловые значения', () => {
    const pcm = pcm16(new Float32Array([-2, -1, 0, 1, 2, NaN]));
    expect(Array.from({ length: 6 }, (_, i) => pcm.readInt16LE(i * 2))).toEqual([
      -32768, -32768, 0, 32767, 32767, 0,
    ]);
  });
  it('распознаёт 120 BPM на синтетическом импульсном треке', () => {
    const rate = 8000,
      a = new Float32Array(rate * 20);
    for (let i = 0; i < a.length; i += rate / 2)
      for (let j = 0; j < 400; j++) a[i + j] = Math.exp(-j / 60) * Math.sin(j);
    expect(estimateBpm(a, rate)).toBeCloseTo(120, 0);
    expect(estimateBpm(new Float32Array(rate * 5), rate)).toBeNull();
    const tone = Float32Array.from(
      { length: rate * 10 },
      (_, i) => 0.1 * Math.sin((2 * Math.PI * 220 * i) / rate),
    );
    expect(estimateBpm(tone, rate)).toBeNull();
  });
  it('игнорирует MIDI clock и Note Off, принимает CC', () => {
    expect(midiMessage(new Uint8Array([0xf8]))).toBeNull();
    expect(midiMessage(new Uint8Array([0x80, 12, 127]))).toBeNull();
    expect(midiMessage(new Uint8Array([0xb2, 8, 127]))).toEqual({
      type: 'cc',
      channel: 2,
      number: 8,
      value: 127,
    });
  });
  it('различает порты и каналы MIDI', () => {
    const a = { input: 'a', type: 'note' as const, channel: 0, number: 36 };
    expect(sameMidi(a, { ...a, input: 'b' })).toBe(false);
    expect(sameMidi(a, { ...a, channel: 1 })).toBe(false);
    expect(ledVelocity('#ff0000', 'launchpad', true)).toBe(5);
  });
  it('клавиши используют физический код при русской раскладке', () => {
    const e = { code: 'KeyF', key: 'а', altKey: true } as KeyboardEvent;
    expect(keyFromEvent(e)).toBe('Alt+F');
    expect(keyFromEvent({ code: 'NumpadAdd', key: '+', ctrlKey: true } as KeyboardEvent)).toBe(
      'Control+numadd',
    );
  });
});
