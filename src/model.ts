export const COLORS = [
  '#66e1c2',
  '#a59aff',
  '#f3b969',
  '#65b7ef',
  '#ef8bab',
  '#ccd67d',
  '#d69de8',
  '#80cbd0',
];
export const GRIDS = [
  [4, 2],
  [4, 3],
  [4, 4],
  [6, 3],
  [6, 4],
  [8, 4],
] as const;
export type Mode = 'single' | 'mix' | 'playlist';
export interface Pad {
  id: string;
  name: string;
  file: string;
  color: string;
  volume: number;
  loop: boolean;
  fade: boolean;
  fadeIn: number | null;
  fadeOut: number | null;
  start: number;
  end: number | null;
  bpm: number | null;
  duration: number;
  peaks: number[];
  missing?: boolean;
}
export interface Bank {
  name: string;
  color: string;
  pads: (Pad | null)[];
}
export interface KeyBinding {
  key: string;
  scope: 'local' | 'global';
}
export interface MidiBinding {
  input: string;
  channel: number;
  type: 'note' | 'cc';
  number: number;
  continuous?: boolean;
}
export interface Settings {
  theme: 'dark' | 'light';
  grid: [number, number];
  mode: Mode;
  master: number;
  cueVolume: number;
  muted: boolean;
  mainDevice: string;
  cueDevice: string;
  fadeIn: number;
  fadeOut: number;
  panicFade: number;
  retrigger: 'restart' | 'stop' | 'ignore';
  restore: boolean;
  alwaysOnTop: boolean;
  hardwareAcceleration: boolean;
  library: string;
  copyToLibrary: boolean;
  midiMode: 'cell' | 'pad';
  midiFeedback: boolean;
  midiOutput: string;
  midiProfile: 'generic' | 'launchpad' | 'apc';
}
export interface Project {
  format: 'cueforge';
  version: 1;
  name: string;
  activeBank: number;
  banks: Bank[];
  settings: Settings;
  keys: Record<string, KeyBinding>;
  midi: Record<string, MidiBinding>;
}
export function freshProject(): Project {
  return {
    format: 'cueforge',
    version: 1,
    name: 'Новый сет',
    activeBank: 0,
    banks: COLORS.map((color, i) => ({
      name: String.fromCharCode(65 + i),
      color,
      pads: Array(32).fill(null),
    })),
    settings: {
      theme: 'dark',
      grid: [4, 3],
      mode: 'single',
      master: 0.8,
      cueVolume: 0.6,
      muted: false,
      mainDevice: '',
      cueDevice: '',
      fadeIn: 0.2,
      fadeOut: 1.5,
      panicFade: 0.5,
      retrigger: 'stop',
      restore: true,
      alwaysOnTop: false,
      hardwareAcceleration: true,
      library: '',
      copyToLibrary: false,
      midiMode: 'cell',
      midiFeedback: true,
      midiOutput: '',
      midiProfile: 'generic',
    },
    keys: {},
    midi: {},
  };
}
export function newPad(file: string, index = 0): Pad {
  return {
    id: crypto.randomUUID(),
    name: file
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]+$/, ''),
    file,
    color: COLORS[index % 8],
    volume: 1,
    loop: false,
    fade: false,
    fadeIn: null,
    fadeOut: null,
    start: 0,
    end: null,
    bpm: null,
    duration: 0,
    peaks: [],
  };
}
export const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const number = (x: unknown, d: number, min: number, max: number) =>
  typeof x === 'number' && Number.isFinite(x) ? clamp(x, min, max) : d;
const str = (x: unknown, d = '', max = 500) => (typeof x === 'string' ? x.slice(0, max) : d);
const color = (x: unknown, d: string) =>
  typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : d;
const obj = (x: unknown): Record<string, any> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, any>) : {};
export function validateProject(raw: unknown): Project {
  const r = obj(raw);
  if (r.format !== 'cueforge' || r.version !== 1 || !Array.isArray(r.banks) || r.banks.length !== 8)
    throw new Error('Неподдерживаемый или повреждённый сет CueForge.');
  const p = freshProject();
  p.name = str(r.name, p.name);
  p.activeBank = Math.trunc(number(r.activeBank, 0, 0, 7));
  const ids = new Set<string>();
  p.banks = r.banks.map((b: unknown, i: number) => {
    const bank = obj(b);
    return {
      name: str(bank.name, p.banks[i].name, 60),
      color: color(bank.color, COLORS[i]),
      pads: Array.from({ length: 32 }, (_, j) => {
        const a = Array.isArray(bank.pads) ? bank.pads[j] : null;
        if (!a) return null;
        const q = obj(a);
        if (typeof q.file !== 'string' || q.file.length > 32768) return null;
        let id = str(q.id, '', 100);
        if (!id || ids.has(id)) id = crypto.randomUUID();
        ids.add(id);
        const duration = number(q.duration, 0, 0, 604800);
        const start = number(q.start, 0, 0, duration || 604800);
        return {
          id,
          name: str(q.name, 'Без названия'),
          file: q.file,
          color: color(q.color, COLORS[j % 8]),
          volume: number(q.volume, 1, 0, 1),
          loop: q.loop === true,
          fade: q.fade === true,
          fadeIn: q.fadeIn == null ? null : number(q.fadeIn, 0, 0, 120),
          fadeOut: q.fadeOut == null ? null : number(q.fadeOut, 0, 0, 120),
          start,
          end: q.end == null ? null : number(q.end, duration, start + 0.001, duration || 604800),
          bpm: q.bpm == null ? null : number(q.bpm, 120, 20, 400),
          duration,
          peaks: Array.isArray(q.peaks)
            ? q.peaks.slice(0, 1024).map((x: unknown) => number(x, 0, 0, 1))
            : [],
        };
      }),
    };
  });
  const s = obj(r.settings);
  for (const k of [
    'muted',
    'restore',
    'alwaysOnTop',
    'hardwareAcceleration',
    'copyToLibrary',
    'midiFeedback',
  ] as const)
    if (typeof s[k] === 'boolean') p.settings[k] = s[k];
  for (const k of ['mainDevice', 'cueDevice', 'library', 'midiOutput'] as const)
    p.settings[k] = str(s[k], '', 32768);
  for (const k of ['master', 'cueVolume'] as const)
    p.settings[k] = number(s[k], p.settings[k], 0, 1);
  for (const k of ['fadeIn', 'fadeOut', 'panicFade'] as const)
    p.settings[k] = number(s[k], p.settings[k], 0, 120);
  if (s.theme === 'light') p.settings.theme = 'light';
  if (['single', 'mix', 'playlist'].includes(s.mode)) p.settings.mode = s.mode;
  if (s.retrigger === 'restart' || s.retrigger === 'ignore') p.settings.retrigger = s.retrigger;
  if (s.midiMode === 'pad') p.settings.midiMode = 'pad';
  if (['generic', 'launchpad', 'apc'].includes(s.midiProfile))
    p.settings.midiProfile = s.midiProfile;
  if (Array.isArray(s.grid) && GRIDS.some((g) => g[0] === s.grid[0] && g[1] === s.grid[1]))
    p.settings.grid = [s.grid[0], s.grid[1]];
  const validTarget = (t: string) =>
    /^(cell:\d{1,2}|pad:[\w-]+|bank:[0-7]|action:(play|pause|stop|panic|restart|loop|prevBank|nextBank|contents|volumeUp|volumeDown|mute|master|cue))$/.test(
      t,
    );
  for (const [t, x] of Object.entries(obj(r.keys)).slice(0, 512)) {
    const k = obj(x);
    if (validTarget(t) && typeof k.key === 'string' && k.key.length < 100 && k.key !== 'Escape')
      p.keys[t] = { key: k.key, scope: k.scope === 'global' ? 'global' : 'local' };
  }
  for (const [t, x] of Object.entries(obj(r.midi)).slice(0, 1024)) {
    const m = obj(x);
    if (validTarget(t) && (m.type === 'note' || m.type === 'cc'))
      p.midi[t] = {
        input: str(m.input, '', 500),
        channel: Math.trunc(number(m.channel, 0, 0, 15)),
        type: m.type,
        number: Math.trunc(number(m.number, 0, 0, 127)),
        continuous: m.continuous === true,
      };
  }
  return p;
}
export function nextPad(p: Project, id: string): Pad | null {
  const all = p.banks.flatMap((b) => b.pads).filter((a): a is Pad => !!a && !a.missing);
  const idx = all.findIndex((a) => a.id === id);
  return idx < 0 ? null : (all[idx + 1] ?? null);
}
export function time(seconds: number) {
  if (!Number.isFinite(seconds)) return '—';
  const n = Math.max(0, seconds);
  return `${Math.floor(n / 60)}:${Math.floor(n % 60)
    .toString()
    .padStart(2, '0')}`;
}
export function keyFromEvent(e: KeyboardEvent): string {
  const map: Record<string, string> = {
    Space: 'Space',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    Escape: 'Escape',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  if (['Control', 'Alt', 'Shift', 'Meta'].some((k) => e.key === k)) return '';
  let key =
    map[e.code] ??
    (e.code.startsWith('Key')
      ? e.code.slice(3)
      : e.code.startsWith('Digit')
        ? e.code.slice(5)
        : e.code.startsWith('Numpad')
          ? 'num' +
            ({ Add: 'add', Subtract: 'sub', Multiply: 'mult', Divide: 'div', Decimal: 'dec' }[
              e.code.slice(6)
            ] ?? e.code.slice(6))
          : e.code);
  return [
    ...(e.ctrlKey ? ['Control'] : []),
    ...(e.altKey ? ['Alt'] : []),
    ...(e.shiftKey ? ['Shift'] : []),
    ...(e.metaKey ? ['Super'] : []),
    key,
  ].join('+');
}
