import { freshProject, newPad, validateProject, type Project } from './model';
// Interoperability adapter. Field names are those serialized by the free 0.5.8 application.
// No activation information or implementation code is imported.
export function fromHcpl(raw: unknown): Project {
  const r = raw as any;
  if (!r || ![1, 2].includes(r.version) || !Array.isArray(r.pads) || r.pads.length > 256)
    throw new Error('Неподдерживаемый формат HCPL');
  const p = freshProject();
  p.name = 'Импорт HypeCue';
  for (const a of r.pads) {
    if (
      !a ||
      !Number.isInteger(a.bank ?? 0) ||
      !Number.isInteger(a.slot) ||
      a.bank < 0 ||
      a.bank > 7 ||
      a.slot < 0 ||
      a.slot > 31 ||
      typeof a.filePath !== 'string'
    )
      throw new Error('Некорректная ячейка HCPL');
    const bank = a.bank ?? 0;
    if (p.banks[bank].pads[a.slot]) throw new Error('Повторяющаяся ячейка HCPL');
    const pad = {
      ...newPad(a.filePath, a.slot),
      name: a.label ?? 'Без названия',
      color: a.color,
      volume: a.volume,
      start: a.trimStart ?? 0,
      end: a.trimEnd ?? null,
      loop: !!a.loop,
      fade: !!a.fade,
      fadeIn: a.fadeInSec ?? null,
      fadeOut: a.fadeOutSec ?? null,
      bpm: a.bpm ?? null,
    };
    p.banks[bank].pads[a.slot] = pad;
    if (typeof a.hotkey === 'string' && a.hotkey)
      p.keys[`cell:${a.slot}`] = { key: a.hotkey, scope: 'local' };
  }
  if (Array.isArray(r.bankNames))
    r.bankNames.slice(0, 8).forEach((n: any, i: number) => {
      if (typeof n === 'string') p.banks[i].name = n;
    });
  if (Array.isArray(r.bankColors))
    r.bankColors.slice(0, 8).forEach((n: any, i: number) => {
      if (typeof n === 'string') p.banks[i].color = n;
    });
  return validateProject(p);
}
export function assertHcplCapacity(p: Project) {
  if (p.banks.some((bank) => bank.pads.slice(32).some(Boolean)))
    throw new Error('Формат HCPL поддерживает 32 пэда на банк. Для этого сета выберите .cueforge.');
}
export function toHcpl(p: Project) {
  assertHcplCapacity(p);
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    bankNames: p.banks.map((b) => b.name),
    bankColors: p.banks.map((b) => b.color),
    pads: p.banks.flatMap((b, bank) =>
      b.pads.flatMap((pad, slot) =>
        pad
          ? [
              {
                label: pad.name,
                filePath: pad.file,
                color: pad.color,
                hotkey: p.keys[`cell:${slot}`]?.key ?? null,
                volume: pad.volume,
                trimStart: pad.start,
                trimEnd: pad.end,
                loop: pad.loop ? 1 : 0,
                fade: pad.fade ? 1 : 0,
                fadeInSec: pad.fadeIn,
                fadeOutSec: pad.fadeOut,
                bank,
                slot,
                bpm: pad.bpm,
                midiKey: null,
              },
            ]
          : [],
      ),
    ),
  };
}
