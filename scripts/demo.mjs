import fs from 'node:fs';
import path from 'node:path';
import { makeWav } from './fixtures.mjs';
import { freshProject, newPad } from '../src/model.ts';
const root = path.resolve('demo'),
  p = freshProject();
p.name = 'Демонстрационный сет';
p.banks[0].name = 'Сцена';
p.banks[1].name = 'Подложки';
p.settings.master = 0.45;
const titles = [
  'Демо • Открытие',
  'Демо • Мягкий сигнал',
  'Демо • Отсчёт',
  'Демо • Короткая отбивка',
  'Демо • Пульс',
  'Демо • Перелив',
  'Демо • Переход',
  'Демо • Финал',
];
for (let i = 0; i < 8; i++) {
  const file = makeWav(path.join(root, 'audio', `${i + 1}.wav`), {
    seconds: 8,
    frequency: 220 + i * 55,
    bpm: 90 + i * 5,
    amplitude: 0.1,
  });
  p.banks[0].pads[i] = {
    ...newPad(path.relative(root, file), i),
    name: titles[i],
    bpm: 90 + i * 5,
    duration: 8,
  };
  p.keys[`cell:${i}`] = { key: `F${i + 1}`, scope: 'local' };
}
fs.writeFileSync(path.join(root, 'Демонстрационный сет.cueforge'), JSON.stringify(p, null, 2));
fs.writeFileSync(
  path.join(root, 'README.txt'),
  'Синтетические демонстрационные звуки CueForge, MIT. Откройте .cueforge через кнопку «Открыть». Файлы audio должны находиться рядом. Громкость зала: 45%.\n',
);
console.log(root);
