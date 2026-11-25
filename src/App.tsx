import {
  useEffect,
  useRef,
  useState,
  cloneElement,
  isValidElement,
  type ReactElement,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  AudioLines,
  Play,
  Pause,
  Square,
  SkipBack,
  Repeat2,
  Headphones,
  Volume2,
  VolumeX,
  Settings2,
  FolderOpen,
  Save,
  Plus,
  Search,
  PanelLeft,
  Sun,
  Moon,
  Pin,
  Radio,
  Scissors,
  X,
  MoreHorizontal,
  Music2,
  Upload,
  Download,
  Keyboard,
  SlidersHorizontal,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Check,
  AlertTriangle,
  Disc3,
  Link2,
} from 'lucide-react';
import { AudioEngine } from './audio';
import { MidiController, sameMidi } from './midi';
import {
  COLORS,
  GRIDS,
  BANK_SIZE,
  MAX_GRID_SIDE,
  PROJECT_CAPACITY,
  validGridSize,
  freshProject,
  newPad,
  time,
  keyFromEvent,
  clamp,
  type Project,
  type Pad,
  type Settings,
  type KeyBinding,
} from './model';

const ACTIONS = [
  ['play', 'Воспроизвести'],
  ['pause', 'Пауза'],
  ['stop', 'Стоп'],
  ['panic', 'Плавно остановить всё'],
  ['restart', 'В начало'],
  ['loop', 'Повтор'],
  ['prevBank', 'Предыдущий банк'],
  ['nextBank', 'Следующий банк'],
  ['contents', 'Содержимое'],
  ['volumeUp', 'Громче +5%'],
  ['volumeDown', 'Тише −5%'],
  ['mute', 'Без звука'],
  ['master', 'Громкость зала (CC)'],
  ['cue', 'Громкость наушников (CC)'],
];
function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Wave({
  peaks,
  color = '#66e1c2',
  progress = 0,
  onSeek,
  start = 0,
  end = 1,
  onSelect,
}: {
  peaks: number[];
  color?: string;
  progress?: number;
  onSeek?: (n: number) => void;
  start?: number;
  end?: number;
  onSelect?: (a: number, b: number) => void;
}) {
  const drag = useRef<number | null>(null);
  const ratio = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  };
  return (
    <svg
      className={`wave ${onSelect ? 'selectable' : ''}`}
      viewBox="0 0 1000 90"
      preserveAspectRatio="none"
      role="img"
      aria-label={onSelect ? 'Волна: перетащите для выбора фрагмента' : 'Форма звуковой волны'}
      onPointerDown={(e) => {
        drag.current = ratio(e);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        const n = ratio(e);
        if (onSelect && drag.current !== null) {
          const a = Math.min(drag.current, n),
            b = Math.max(drag.current, n);
          if (b - a > 0.002) onSelect(a, b);
        } else onSeek?.(n);
        drag.current = null;
      }}
    >
      <line x1="0" x2="1000" y1="45" y2="45" stroke="currentColor" opacity=".1" />
      {peaks.map((p, i) => {
        const x = ((i + 0.5) / peaks.length) * 1000,
          h = Math.max(1, p * 75);
        return (
          <line
            key={i}
            x1={x}
            x2={x}
            y1={45 - h / 2}
            y2={45 + h / 2}
            stroke={i / peaks.length < progress ? color : 'currentColor'}
            strokeOpacity={i / peaks.length < progress ? 1 : 0.22}
            strokeWidth={Math.max(1, 700 / peaks.length)}
          />
        );
      })}
      {onSelect && (
        <>
          <rect
            x={start * 1000}
            width={Math.max(0, end - start) * 1000}
            height="90"
            fill={color}
            opacity=".16"
          />
          <line x1={start * 1000} x2={start * 1000} y1="0" y2="90" stroke={color} strokeWidth="3" />
          <line x1={end * 1000} x2={end * 1000} y1="0" y2="90" stroke={color} strokeWidth="3" />
        </>
      )}
      {progress > 0 && (
        <line
          x1={progress * 1000}
          x2={progress * 1000}
          y1="0"
          y2="90"
          stroke={color}
          strokeWidth="2"
        />
      )}
    </svg>
  );
}
function Meter({ value }: { value: number }) {
  return (
    <div className="meter" aria-label="Уровень сигнала">
      <span style={{ width: Math.min(100, value * 100) + '%' }} />
    </div>
  );
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        close();
      }
      if (e.key === 'Tab') {
        const list = box.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, [tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', listener, true);
    return () => {
      window.removeEventListener('keydown', listener, true);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <span className="eyebrow">CUEFORGE / WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <IconButton label="Закрыть" onClick={close}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const control =
    isValidElement(children) && (children.type === 'input' || children.type === 'select')
      ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-label': label })
      : children;
  return (
    <label className="field">
      <span>{label}</span>
      {control}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="toggle-row">
      <div>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </div>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function CustomGrid({
  grid,
  apply,
}: {
  grid: [number, number];
  apply: (grid: [number, number]) => void;
}) {
  const [columns, setColumns] = useState(String(grid[0]));
  const [rows, setRows] = useState(String(grid[1]));
  const valid = validGridSize(Number(columns)) && validGridSize(Number(rows));
  return (
    <form
      className="custom-grid"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) apply([Number(columns), Number(rows)]);
      }}
    >
      <label>
        Столбцы
        <input
          type="number"
          min={1}
          max={MAX_GRID_SIDE}
          required
          value={columns}
          onChange={(e) => setColumns(e.target.value)}
        />
      </label>
      <label>
        Строки
        <input
          type="number"
          min={1}
          max={MAX_GRID_SIDE}
          required
          value={rows}
          onChange={(e) => setRows(e.target.value)}
        />
      </label>
      <button disabled={!valid} type="submit">
        Применить сетку
      </button>
      <small>От 1 до {MAX_GRID_SIDE} по каждой стороне</small>
    </form>
  );
}
export function App() {
  const [p, setP] = useState<Project>(freshProject),
    [ready, setReady] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [settings, setSettings] = useState(false),
    [tab, setTab] = useState('Интерфейс'),
    [editor, setEditor] = useState<{ bank: number; index: number } | null>(null),
    [bankEdit, setBankEdit] = useState<number | null>(null),
    [contents, setContents] = useState(false),
    [search, setSearch] = useState(''),
    [message, setMessage] = useState('Готов к работе'),
    [error, setError] = useState(''),
    [tick, setTick] = useState(0),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [keyLearn, setKeyLearn] = useState<string | null>(null),
    [midiLearn, setMidiLearn] = useState<string | null>(null),
    [midiLog, setMidiLog] = useState<string[]>([]),
    [confirmClear, setConfirmClear] = useState(false),
    [version, setVersion] = useState(''),
    [busy, setBusy] = useState(false),
    [update, setUpdate] = useState<string | null>(null);
  const engineRef = useRef<AudioEngine | null>(null),
    midiRef = useRef<MidiController | null>(null),
    current = useRef(p),
    actionRef = useRef<(target: string, value?: number) => void>(() => {}),
    restoreOnce = useRef(false);
  current.current = p;
  const engine = () => engineRef.current!;
  const notify = (s: string) => {
    setMessage(s);
    setError('');
  };
  const fail = (e: unknown) => setError(String(e).replace(/^Error: /, ''));
  const changeSettings = (patch: Partial<Settings>) =>
    setP((old) => ({ ...old, settings: { ...old.settings, ...patch } }));
  const changePad = (bank: number, index: number, patch: Partial<Pad>) =>
    setP((old) => ({
      ...old,
      banks: old.banks.map((b, i) =>
        i !== bank
          ? b
          : { ...b, pads: b.pads.map((a, j) => (j === index && a ? { ...a, ...patch } : a)) },
      ),
    }));
  const getSelected = () =>
    current.current.banks.flatMap((b) => b.pads).find((a) => a?.id === selected) ?? null;
  async function refreshDevices() {
    try {
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'),
      );
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    const a = new AudioEngine();
    engineRef.current = a;
    const m = new MidiController();
    midiRef.current = m;
    a.onChange = () => setTick((n) => n + 1);
    a.onError = fail;
    a.onTrackStart = setSelected;
    a.onAnalysis = (id, data) =>
      setP((old) => ({
        ...old,
        banks: old.banks.map((b) => ({
          ...b,
          pads: b.pads.map((p) => (p?.id === id ? { ...p, ...data, bpm: p.bpm ?? data.bpm } : p)),
        })),
      }));
    m.onError = fail;
    m.onLog = (line) => setMidiLog((old) => [line, ...old].slice(0, 16));
    m.onChange = () => setTick((n) => n + 1);
    m.onAction = (target, value) => {
      if (
        (target.startsWith('cell:') && current.current.settings.midiMode !== 'cell') ||
        (target.startsWith('pad:') && current.current.settings.midiMode !== 'pad')
      )
        return;
      actionRef.current(target, value);
    };
    m.onLearn = (target, binding) => {
      setP((old) => {
        const midi = { ...old.midi };
        for (const [t, b] of Object.entries(midi)) {
          const separateLayouts =
            (target.startsWith('cell:') && t.startsWith('pad:')) ||
            (target.startsWith('pad:') && t.startsWith('cell:'));
          if (sameMidi(binding, b) && !separateLayouts) delete midi[t];
        }
        midi[target] = binding;
        return { ...old, midi };
      });
      setMidiLearn(null);
      notify('MIDI назначение сохранено');
    };
    void window.cue
      .load()
      .then(async (saved) => {
        if (saved) {
          const loaded = saved.settings.restore
            ? saved
            : { ...freshProject(), settings: saved.settings, keys: saved.keys, midi: saved.midi };
          const files = await a.register(
            loaded.banks.flatMap((b) => b.pads.filter(Boolean).map((x) => x!.file)),
          );
          const missing = new Set(files.filter((f) => f.missing).map((f) => f.file));
          for (const b of loaded.banks)
            for (const pad of b.pads) if (pad) pad.missing = missing.has(pad.file);
          setP(loaded);
          if (missing.size)
            fail(
              `Не найдены файлы: ${missing.size}. Используйте «Указать файл» в настройках пэда.`,
            );
        }
        setReady(true);
      })
      .catch((e) => {
        fail(e);
        setReady(true);
      });
    void window.cue.version().then(setVersion);
    void refreshDevices();
    const handleDeviceChange = () => {
      a.stopCue();
      void refreshDevices();
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    const timer = setInterval(() => setTick((n) => n + 1), 80);
    return () => {
      clearInterval(timer);
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      a.destroy();
      m.resetFeedback();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    void engine().configure(p);
    midiRef.current!.project = p;
    void window.cue.setTop(p.settings.alwaysOnTop);
    void window.cue.save(p).catch(fail);
    if (!restoreOnce.current) {
      restoreOnce.current = true;
      void engine().warm(p.banks[p.activeBank].pads.filter((x): x is Pad => !!x && !x.missing));
    }
  }, [p, ready]);
  useEffect(() => {
    if (ready)
      void window.cue
        .setKeys(p.keys)
        .then((errors) => {
          if (errors.length) fail('Горячие клавиши заняты другой программой: ' + errors.join(', '));
        })
        .catch(fail);
  }, [p.keys, ready]);
  useEffect(
    () =>
      window.cue.onAction((t) => {
        if (!document.querySelector('[role="dialog"]')) actionRef.current(t);
      }),
    [],
  );
  useEffect(
    () =>
      window.cue.onClose(() => {
        void engine()
          .stopRecording()
          .then(() => window.cue.confirmClose())
          .catch(fail);
      }),
    [],
  );
  const play = async (pad: Pad, cue = false) => {
    if (midiLearn) {
      midiRef.current!.learn =
        p.settings.midiMode === 'cell'
          ? `cell:${p.banks[p.activeBank].pads.findIndex((a) => a?.id === pad.id)}`
          : `pad:${pad.id}`;
      setMidiLearn(midiRef.current!.learn);
      return;
    }
    if (!cue) setSelected(pad.id);
    await engine().trigger(pad, cue);
  };
  actionRef.current = (target, value) => {
    const state = current.current;
    if (target.startsWith('bank:')) {
      setP((old) => ({ ...old, activeBank: +target.slice(5) }));
      return;
    }
    if (target.startsWith('cell:')) {
      const pad = state.banks[state.activeBank].pads[+target.slice(5)];
      if (pad) void play(pad);
      return;
    }
    if (target.startsWith('pad:')) {
      const pad = state.banks.flatMap((b) => b.pads).find((a) => a?.id === target.slice(4));
      if (pad) void play(pad);
      return;
    }
    const a = target.slice(7);
    if (a === 'play') {
      if ([...engine().voices.values()].some((v) => v.paused)) void engine().resume();
      else {
        const pad = getSelected();
        if (pad) void play(pad);
      }
    }
    if (a === 'pause') engine().pause();
    if (a === 'stop') engine().stopAll();
    if (a === 'panic') engine().panic();
    if (a === 'restart') {
      const pad = getSelected();
      if (pad) {
        engine().stop(pad.id);
        void play(pad);
      }
    }
    if (a === 'loop') {
      const pad = getSelected();
      if (pad)
        setP((old) => ({
          ...old,
          banks: old.banks.map((b) => ({
            ...b,
            pads: b.pads.map((x) => (x?.id === pad.id ? { ...x, loop: !x.loop } : x)),
          })),
        }));
    }
    if (a === 'prevBank' || a === 'nextBank')
      setP((old) => ({ ...old, activeBank: (old.activeBank + (a === 'nextBank' ? 1 : 7)) % 8 }));
    if (a === 'contents') setContents((v) => !v);
    if (a === 'mute') changeSettings({ muted: !state.settings.muted });
    if (a === 'volumeUp' || a === 'volumeDown') {
      const master = clamp(state.settings.master + (a === 'volumeUp' ? 0.05 : -0.05), 0, 1);
      changeSettings({ master });
      notify(`Громкость зала: ${Math.round(master * 100)}%`);
    }
    if (a === 'master' && value !== undefined) changeSettings({ master: value });
    if (a === 'cue' && value !== undefined) changeSettings({ cueVolume: value });
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (keyLearn) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          setKeyLearn(null);
          return;
        }
        if (e.key === 'Backspace') {
          setP((old) => {
            const keys = { ...old.keys };
            delete keys[keyLearn];
            return { ...old, keys };
          });
          setKeyLearn(null);
          return;
        }
        const key = keyFromEvent(e);
        if (!key) return;
        setP((old) => {
          const keys = { ...old.keys };
          for (const [t, b] of Object.entries(keys)) if (b.key === key) delete keys[t];
          keys[keyLearn] = { key, scope: keys[keyLearn]?.scope ?? 'local' };
          return { ...old, keys };
        });
        setKeyLearn(null);
        return;
      }
      if (
        document.querySelector('[role="dialog"]') ||
        (e.target instanceof HTMLElement &&
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))
      )
        return;
      if (e.key === 'Escape') {
        e.preventDefault();
        engine().panic();
        return;
      }
      const key = keyFromEvent(e);
      for (const [target, b] of Object.entries(current.current.keys))
        if (b.scope === 'local' && b.key === key) {
          e.preventDefault();
          if (!e.repeat || target === 'action:volumeUp' || target === 'action:volumeDown')
            actionRef.current(target);
          break;
        }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [keyLearn, selected]);
  useEffect(() => {
    if (ready)
      midiRef.current!.feedback(
        new Set([...engine().voices.values()].filter((v) => !v.paused).map((v) => v.pad.id)),
      );
  }, [tick, ready]);
  async function addFiles(paths?: string[], startIndex?: number) {
    if (busy) return;
    setBusy(true);
    try {
      let files = paths ?? (await window.cue.pickAudio());
      if (!files.length) return;
      files = (await engine().register(files)).map((f) => f.file);
      if (p.settings.copyToLibrary && p.settings.library)
        files = await window.cue.copyLibrary(files, p.settings.library);
      await engine().register(files);
      const bank = current.current.activeBank;
      const pads: Pad[] = [];
      let used = 0;
      const banks = current.current.banks.map((b) => ({ ...b, pads: [...b.pads] }));
      let index = startIndex ?? banks[bank].pads.findIndex((a) => !a);
      for (const file of files) {
        while (
          index < BANK_SIZE &&
          banks[bank].pads[index] &&
          !(used === 0 && startIndex !== undefined)
        )
          index++;
        if (index < 0 || index >= BANK_SIZE) break;
        const prev = banks[bank].pads[index];
        if (prev) engine().stop(prev.id);
        const pad = newPad(file, index);
        pads.push(pad);
        banks[bank].pads[index] = pad;
        index++;
        used++;
      }
      setP((old) => ({ ...old, banks }));
      void engine().warm(pads);
      notify(
        `Добавлено файлов: ${used}${used < files.length ? ' — остальные не поместились в банк' : ''}. Перетащите пэды для перестановки.`,
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function openSet() {
    try {
      const next = await window.cue.openProject();
      if (!next) return;
      engine().stopAll();
      const files = await engine().register(
        next.banks.flatMap((b) => b.pads.filter(Boolean).map((a) => a!.file)),
      );
      const missing = new Set(files.filter((f) => f.missing).map((f) => f.file));
      for (const b of next.banks) for (const a of b.pads) if (a) a.missing = missing.has(a.file);
      setP(next);
      setSelected(null);
      notify(`Открыт сет «${next.name}»`);
      void engine().warm(
        next.banks[next.activeBank].pads.filter((x): x is Pad => !!x && !x.missing),
      );
    } catch (e) {
      fail(e);
    }
  }
  async function saveSet(portable = false) {
    try {
      const path = await window.cue.exportProject(p, portable);
      if (path) notify(`Сет сохранён: ${path}`);
    } catch (e) {
      fail(e);
    }
  }
  async function relink(pad: Pad) {
    try {
      const r = await window.cue.relink(pad.file);
      if (!r) return;
      const candidates = p.banks
        .flatMap((b) => b.pads)
        .filter(
          (a): a is Pad =>
            !!a && (a.id === pad.id || a.file.substring(0, a.file.lastIndexOf('\\')) === r.oldDir),
        );
      const mapping = new Map(
        candidates.map((a) => [
          a.id,
          a.id === pad.id ? r.selected : r.newDir + '\\' + a.file.split(/[\\/]/).pop(),
        ]),
      );
      const results = await engine().register([...mapping.values()]);
      const valid = new Set(results.filter((f) => !f.missing).map((f) => f.file));
      setP((old) => ({
        ...old,
        banks: old.banks.map((b) => ({
          ...b,
          pads: b.pads.map((a) =>
            a && mapping.has(a.id) && valid.has(mapping.get(a.id)!)
              ? { ...a, file: mapping.get(a.id)!, missing: false }
              : a,
          ),
        })),
      }));
      notify(`Восстановлено файлов: ${valid.size}`);
    } catch (e) {
      fail(e);
    }
  }
  async function record() {
    if (busy) return;
    setBusy(true);
    try {
      if (engine().recording) {
        const file = await engine().stopRecording();
        notify(`Запись сохранена: ${file}`);
      } else if (await engine().startRecording()) notify('Идёт запись выхода зала в WAV');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const sel = p.banks.flatMap((b) => b.pads).find((a) => a?.id === selected) ?? null,
    voice = ready && selected ? engine().voices.get(selected) : null;
  const position = voice ? engine().position(voice) : (sel?.start ?? 0);
  const allPads = p.banks
    .flatMap((b, bank) => b.pads.map((pad, index) => ({ pad, bank, index })))
    .filter((x) => x.pad);
  const found = allPads.filter((x) => x.pad!.name.toLowerCase().includes(search.toLowerCase()));
  const learnMidi = (target: string) => {
    midiRef.current!.learn = target;
    setMidiLearn(target);
    notify('Нажмите кнопку или поверните регулятор MIDI-контроллера');
  };
  const bindingRow = (target: string, label: string) => {
    const key = p.keys[target],
      midi = p.midi[target];
    return (
      <div className="binding-row" key={target}>
        <span>{label}</span>
        <button
          className={keyLearn === target ? 'learning' : ''}
          onClick={() => setKeyLearn(target)}
        >
          {keyLearn === target ? 'Нажмите клавишу…' : (key?.key ?? 'Назначить клавишу')}
        </button>
        <select
          aria-label={'Область ' + label}
          value={key?.scope ?? 'local'}
          disabled={!key}
          onChange={(e) =>
            setP((old) => ({
              ...old,
              keys: {
                ...old.keys,
                [target]: { ...old.keys[target], scope: e.target.value as KeyBinding['scope'] },
              },
            }))
          }
        >
          <option value="local">В окне</option>
          <option value="global">Всегда</option>
        </select>
        <button
          className={midiLearn === target ? 'learning' : ''}
          onClick={() => learnMidi(target)}
        >
          {midiLearn === target
            ? 'Жду MIDI…'
            : midi
              ? `${midi.type.toUpperCase()} ${midi.number} / ${midi.channel + 1}`
              : 'MIDI learn'}
        </button>
        <IconButton
          label={'Сбросить ' + label}
          onClick={() =>
            setP((old) => {
              const keys = { ...old.keys },
                midi = { ...old.midi };
              delete keys[target];
              delete midi[target];
              return { ...old, keys, midi };
            })
          }
        >
          <X size={14} />
        </IconButton>
      </div>
    );
  };
  if (!ready)
    return (
      <div className="loading">
        <AudioLines size={40} />
        <h2>CueForge</h2>
        <p>Подготовка рабочего пространства…</p>
      </div>
    );
  return (
    <div className={`app ${p.settings.theme}`}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">
            <AudioLines size={25} />
          </div>
          <strong>
            CueForge<span>DESKTOP</span>
          </strong>
          <span className="edition">OPEN SOURCE</span>
        </div>
        <div className="header-actions">
          <span className="clock">{new Date().toLocaleTimeString('ru-RU')}</span>
          <button
            className={midiRef.current?.access ? 'connected' : ''}
            onClick={() => {
              setSettings(true);
              setTab('MIDI');
              if (!midiRef.current?.access) void midiRef.current!.connect();
            }}
          >
            <Radio size={15} />
            <span>MIDI</span>
            <i className={midiRef.current?.access?.inputs.size ? 'dot online' : 'dot'} />
          </button>
          <button
            className={engine().recording ? 'record recording' : 'record'}
            onClick={() => void record()}
            disabled={busy}
          >
            <span className="record-dot" />
            {engine().recording ? time((Date.now() - engine().recordedAt) / 1000) : 'Запись'}
          </button>
          <div className="divider" />
          <IconButton
            label="Сменить тему"
            onClick={() =>
              changeSettings({ theme: p.settings.theme === 'dark' ? 'light' : 'dark' })
            }
          >
            {p.settings.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </IconButton>
          <IconButton
            label="Поверх окон"
            active={p.settings.alwaysOnTop}
            onClick={() => changeSettings({ alwaysOnTop: !p.settings.alwaysOnTop })}
          >
            <Pin size={18} />
          </IconButton>
          <IconButton label="Настройки" onClick={() => setSettings(true)}>
            <Settings2 size={19} />
          </IconButton>
        </div>
      </header>
      <section className="set-bar">
        <div>
          <span className="eyebrow">РАБОЧИЙ СЕТ</span>
          <input
            className="set-name"
            aria-label="Название сета"
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
          />
        </div>
        <div className="set-tools">
          <button onClick={() => void openSet()}>
            <FolderOpen size={16} />
            Открыть
          </button>
          <button onClick={() => void saveSet()}>
            <Save size={16} />
            Сохранить
          </button>
          <button
            title="Скопировать сет вместе со всеми аудиофайлами"
            onClick={() => void saveSet(true)}
          >
            <Upload size={16} />С файлами
          </button>
          <button className="primary" onClick={() => void addFiles()} disabled={busy}>
            <Plus size={17} />
            {busy ? 'Загрузка…' : 'Добавить аудио'}
          </button>
        </div>
      </section>
      <nav className="bank-bar" aria-label="Банки">
        <div className="banks">
          {p.banks.map((b, i) => (
            <button
              key={i}
              className={`bank ${p.activeBank === i ? 'selected' : ''}`}
              style={{ '--bank': b.color } as CSSProperties}
              onClick={() => setP({ ...p, activeBank: i })}
              onContextMenu={(e) => {
                e.preventDefault();
                setBankEdit(i);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={() => {
                if (p.activeBank !== i) setP((old) => ({ ...old, activeBank: i }));
              }}
            >
              <span>{String.fromCharCode(65 + i)}</span>
              {b.name !== String.fromCharCode(65 + i) && <strong>{b.name}</strong>}
              <small>{b.pads.filter(Boolean).length.toString().padStart(2, '0')}</small>
            </button>
          ))}
        </div>
        <div className="grid-controls">
          <span>
            {p.settings.grid[0]} × {p.settings.grid[1]}
          </span>
          <IconButton
            label="Содержимое и поиск"
            active={contents}
            onClick={() => setContents(!contents)}
          >
            <PanelLeft size={18} />
          </IconButton>
        </div>
      </nav>
      <main className="workspace">
        {contents && (
          <aside className="contents">
            <div className="section-label">
              БИБЛИОТЕКА СЕТА <span>{allPads.length}</span>
            </div>
            <div className="search">
              <Search size={15} />
              <input
                placeholder="Найти звук…"
                aria-label="Поиск треков"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {found.length ? (
              found.map(({ pad, bank, index }) => (
                <button
                  key={pad!.id}
                  className={selected === pad!.id ? 'track selected' : 'track'}
                  onClick={() => {
                    setP({ ...p, activeBank: bank });
                    setSelected(pad!.id);
                  }}
                  onDoubleClick={() => void play(pad!)}
                >
                  <span className="track-color" style={{ background: pad!.color }} />
                  <span>
                    <strong>{pad!.name}</strong>
                    <small>
                      {p.banks[bank].name} · {String(index + 1).padStart(2, '0')} ·{' '}
                      {time(pad!.duration)}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="empty-copy">Добавьте аудио в сет — здесь появятся все треки.</p>
            )}
          </aside>
        )}
        <div className="pad-area">
          <div className="grid-label">
            <span>
              <i className="dot online" style={{ background: p.banks[p.activeBank].color }} />
              Банк {p.banks[p.activeBank].name}
            </span>
            <small>Клик — запуск · Alt + клик — CUE · ПКМ — настройки</small>
          </div>
          <div
            className="pad-grid"
            style={{
              gridTemplateColumns: `repeat(${p.settings.grid[0]}, minmax(95px, 1fr))`,
              gridTemplateRows: `repeat(${p.settings.grid[1]}, minmax(105px, 1fr))`,
            }}
          >
            {p.banks[p.activeBank].pads
              .slice(0, p.settings.grid[0] * p.settings.grid[1])
              .map((pad, index) => {
                const v = pad ? engine().voices.get(pad.id) : null,
                  playing = !!v && !v.paused && !v.stopping,
                  cue = pad && engine().cueVoice?.pad.id === pad.id;
                const target =
                  p.settings.midiMode === 'cell'
                    ? `cell:${index}`
                    : pad
                      ? `pad:${pad.id}`
                      : `cell:${index}`;
                return (
                  <div
                    key={index}
                    role="button"
                    tabIndex={0}
                    aria-label={pad ? `Пэд ${index + 1}: ${pad.name}` : `Пустой пэд ${index + 1}`}
                    draggable={!!pad}
                    className={`pad ${pad ? 'loaded' : 'empty'} ${playing ? 'playing' : ''} ${selected === pad?.id ? 'focused' : ''} ${midiLearn === target ? 'learning' : ''}`}
                    style={{ '--pad': pad?.color ?? COLORS[index % 8] } as CSSProperties}
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        'application/x-cueforge-pad',
                        JSON.stringify({ bank: p.activeBank, index }),
                      )
                    }
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('drag-over');
                    }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('drag-over');
                      const internal = e.dataTransfer.getData('application/x-cueforge-pad');
                      if (internal) {
                        try {
                          const from = JSON.parse(internal);
                          if (
                            !Number.isInteger(from.bank) ||
                            !Number.isInteger(from.index) ||
                            from.bank < 0 ||
                            from.bank > 7 ||
                            from.index < 0 ||
                            from.index >= BANK_SIZE
                          )
                            return;
                          setP((old) => {
                            const banks = old.banks.map((b) => ({ ...b, pads: [...b.pads] }));
                            [banks[from.bank].pads[from.index], banks[old.activeBank].pads[index]] =
                              [
                                banks[old.activeBank].pads[index],
                                banks[from.bank].pads[from.index],
                              ];
                            return { ...old, banks };
                          });
                        } catch {}
                      } else {
                        const files = Array.from(e.dataTransfer.files)
                          .map((f) => window.cue.filePath(f))
                          .filter(Boolean);
                        if (files.length) void addFiles(files, index);
                        else {
                          const uri =
                            e.dataTransfer.getData('text/uri-list') ||
                            e.dataTransfer.getData('text/plain');
                          const paths = uri
                            .split(/[\r\n]+/)
                            .filter((s) => s.startsWith('file:///'))
                            .map((s) =>
                              decodeURIComponent(new URL(s).pathname).replace(
                                /^\/([A-Za-z]:)/,
                                '$1',
                              ),
                            );
                          if (paths.length) void addFiles(paths, index);
                        }
                      }
                    }}
                    onClick={(e) => {
                      if (midiLearn) {
                        learnMidi(target);
                        return;
                      }
                      if (pad) {
                        if (pad.missing) {
                          setEditor({ bank: p.activeBank, index });
                          return;
                        }
                        void play(pad, e.altKey);
                      } else void addFiles(undefined, index);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pad ? void play(pad, e.altKey) : void addFiles(undefined, index);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setEditor({ bank: p.activeBank, index });
                    }}
                  >
                    <div className="pad-top">
                      <span className="pad-number">{String(index + 1).padStart(2, '0')}</span>
                      {pad && (
                        <span className="pad-state">
                          {pad.missing ? (
                            <>
                              <AlertTriangle size={11} />
                              Нет файла
                            </>
                          ) : playing ? (
                            <>
                              <AudioLines size={12} />
                              Играет
                            </>
                          ) : v?.paused ? (
                            'Пауза'
                          ) : cue ? (
                            'CUE'
                          ) : (
                            time((pad.end ?? pad.duration) - pad.start)
                          )}
                        </span>
                      )}
                    </div>
                    {pad ? (
                      <>
                        <div className="pad-title">
                          <h3>{pad.name}</h3>
                          <span>
                            {pad.bpm ? `${pad.bpm} BPM` : 'BPM —'}
                            <i /> {Math.round(pad.volume * 100)}%
                          </span>
                        </div>
                        <div className="pad-bottom">
                          <span className="keycap">{p.keys[`cell:${index}`]?.key ?? '—'}</span>
                          <div>
                            <button
                              title="Повтор"
                              className={pad.loop ? 'enabled' : ''}
                              onClick={(e) => {
                                e.stopPropagation();
                                changePad(p.activeBank, index, { loop: !pad.loop });
                              }}
                            >
                              <Repeat2 size={13} />
                            </button>
                            <button
                              title="Фейд"
                              className={pad.fade ? 'enabled' : ''}
                              onClick={(e) => {
                                e.stopPropagation();
                                changePad(p.activeBank, index, { fade: !pad.fade });
                              }}
                            >
                              <AudioLines size={13} />
                            </button>
                            <button
                              title="Прослушать в наушниках"
                              className={cue ? 'enabled' : ''}
                              onClick={(e) => {
                                e.stopPropagation();
                                void play(pad, true);
                              }}
                            >
                              <Headphones size={13} />
                            </button>
                            <button
                              title="Настроить пэд"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditor({ bank: p.activeBank, index });
                              }}
                            >
                              <MoreHorizontal size={15} />
                            </button>
                          </div>
                        </div>
                        {v && (
                          <div
                            className="pad-progress"
                            style={{
                              width:
                                clamp(
                                  ((engine().position(v) - pad.start) /
                                    ((pad.end ?? pad.duration) - pad.start)) *
                                    100,
                                  0,
                                  100,
                                ) + '%',
                            }}
                          />
                        )}
                      </>
                    ) : (
                      <div className="empty-pad">
                        <Plus size={21} />
                        <span>Добавить звук</span>
                        <small>или перетащить файл</small>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
          {p.banks[p.activeBank].pads
            .slice(p.settings.grid[0] * p.settings.grid[1])
            .some(Boolean) && (
            <div className="hidden-hint">
              В банке есть пэды за пределами сетки. Увеличьте размер сетки в настройках.
            </div>
          )}
        </div>
      </main>
      <section className="player">
        <div className="now-playing">
          <div className="now-icon" style={{ color: sel?.color }}>
            <Disc3 size={21} />
          </div>
          <div>
            <span className="eyebrow">
              {voice && !voice.paused ? 'СЕЙЧАС ИГРАЕТ' : sel ? 'ВЫБРАННЫЙ ТРЕК' : 'НА СТАРТЕ'}
            </span>
            <strong>{sel?.name ?? 'Каждый звук — в свой момент'}</strong>
          </div>
          <span className="play-time">
            {time(position)} <span>/ {time(sel?.end ?? sel?.duration ?? 0)}</span>
          </span>
          {sel && (
            <button
              className="mark-start"
              disabled={!voice}
              title="Установить начало пэда в текущей позиции воспроизведения"
              onClick={() => {
                const live = engine().voices.get(sel.id);
                if (!live) return;
                const start = Math.floor(engine().position(live) * 1000) / 1000;
                if (!Number.isFinite(start) || start < 0 || start >= live.end - 0.01)
                  return notify('Слишком близко к концу трека');
                setP((old) => ({
                  ...old,
                  banks: old.banks.map((b) => ({
                    ...b,
                    pads: b.pads.map((pad) => (pad?.id === sel.id ? { ...pad, start } : pad)),
                  })),
                }));
                notify(`Начало пэда: ${start.toFixed(3)} с`);
              }}
            >
              Начало отсюда
            </button>
          )}
          {sel && (
            <IconButton
              label="Редактировать выбранный трек"
              onClick={() => {
                for (let bank = 0; bank < 8; bank++) {
                  const index = p.banks[bank].pads.findIndex((a) => a?.id === sel.id);
                  if (index >= 0) {
                    setEditor({ bank, index });
                    break;
                  }
                }
              }}
            >
              <Scissors size={17} />
            </IconButton>
          )}
        </div>
        <Wave
          peaks={sel?.peaks ?? []}
          color={sel?.color}
          progress={sel?.duration ? position / sel.duration : 0}
          onSeek={(n) => {
            if (sel && voice) void engine().seek(sel.id, n * sel.duration);
          }}
        />
        <div className="transport">
          <div className="transport-left">
            <IconButton label="В начало" onClick={() => actionRef.current('action:restart')}>
              <SkipBack size={18} />
            </IconButton>
            <IconButton label="Стоп" onClick={() => engine().stopAll()}>
              <Square size={16} />
            </IconButton>
            <IconButton label="Пауза" onClick={() => engine().pause()}>
              <Pause size={19} />
            </IconButton>
            <button
              className="play-button"
              aria-label="Воспроизвести"
              onClick={() => actionRef.current('action:play')}
            >
              <Play size={19} fill="currentColor" />
            </button>
            <div className="mode-switch">
              {[
                ['single', 'Сингл'],
                ['playlist', 'Плейлист'],
                ['mix', 'Микс'],
              ].map(([mode, name]) => (
                <button
                  className={p.settings.mode === mode ? 'active' : ''}
                  key={mode}
                  onClick={() => changeSettings({ mode: mode as Settings['mode'] })}
                >
                  {name}
                </button>
              ))}
            </div>
            <IconButton
              label="Повтор выбранного трека"
              active={sel?.loop}
              onClick={() => actionRef.current('action:loop')}
            >
              <Repeat2 size={18} />
            </IconButton>
          </div>
          <div className="outputs">
            <div className="output">
              <IconButton
                label="Выключить / включить звук"
                active={p.settings.muted}
                onClick={() => changeSettings({ muted: !p.settings.muted })}
              >
                {p.settings.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </IconButton>
              <div>
                <label>
                  ЗАЛ <span>{Math.round(p.settings.master * 100)}%</span>
                </label>
                <input
                  type="range"
                  aria-label="Громкость зала"
                  min="0"
                  max="1"
                  step=".01"
                  value={p.settings.master}
                  onChange={(e) => changeSettings({ master: +e.target.value })}
                  onWheel={(e) =>
                    changeSettings({
                      master: clamp(p.settings.master - Math.sign(e.deltaY) * 0.05, 0, 1),
                    })
                  }
                />
                <Meter value={engine().level()} />
              </div>
            </div>
            <div className="output cue">
              <IconButton
                label="Остановить CUE"
                active={!!engine().cueVoice}
                onClick={() => engine().stopCue()}
              >
                <Headphones size={18} />
              </IconButton>
              <div>
                <label>
                  CUE <span>{Math.round(p.settings.cueVolume * 100)}%</span>
                </label>
                <input
                  type="range"
                  aria-label="Громкость наушников"
                  min="0"
                  max="1"
                  step=".01"
                  value={p.settings.cueVolume}
                  onChange={(e) => changeSettings({ cueVolume: +e.target.value })}
                  onWheel={(e) =>
                    changeSettings({
                      cueVolume: clamp(p.settings.cueVolume - Math.sign(e.deltaY) * 0.05, 0, 1),
                    })
                  }
                />
                <Meter value={engine().level(true)} />
              </div>
            </div>
          </div>
        </div>
      </section>
      <footer className="status-bar">
        <span className={error ? 'error' : ''} role={error ? 'alert' : 'status'}>
          {error ? <AlertTriangle size={12} /> : <i className="dot online" />}
          {error || message}
        </span>
        <span>
          {engine().voices.size} активных · {allPads.length}/{PROJECT_CAPACITY} пэдов <b>ESC</b>{' '}
          Стоп всё
        </span>
      </footer>
      {settings && (
        <Modal
          title="Настройки"
          wide
          close={() => {
            setSettings(false);
            setKeyLearn(null);
            setMidiLearn(null);
            midiRef.current!.learn = null;
          }}
        >
          <div className="settings-layout">
            <nav>
              {['Интерфейс', 'Аудио', 'Библиотека', 'Управление', 'MIDI', 'О программе'].map(
                (t) => (
                  <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ),
              )}
            </nav>
            <section className="settings-content">
              {tab === 'Интерфейс' && (
                <>
                  <h3>Рабочая поверхность</h3>
                  <Field label="Размер сетки">
                    <div className="grid-options">
                      {GRIDS.map((g) => (
                        <button
                          key={g.join('x')}
                          className={p.settings.grid.join() === g.join() ? 'active' : ''}
                          onClick={() => changeSettings({ grid: [g[0], g[1]] })}
                        >
                          {g.join(' × ')}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <CustomGrid
                    key={p.settings.grid.join('x')}
                    grid={p.settings.grid}
                    apply={(grid) => changeSettings({ grid })}
                  />
                  <Toggle
                    label="Светлая тема"
                    value={p.settings.theme === 'light'}
                    onChange={(v) => changeSettings({ theme: v ? 'light' : 'dark' })}
                  />
                  <Toggle
                    label="Восстанавливать последний сет"
                    value={p.settings.restore}
                    onChange={(restore) => changeSettings({ restore })}
                  />
                  <Toggle
                    label="Поверх других окон"
                    value={p.settings.alwaysOnTop}
                    onChange={(alwaysOnTop) => changeSettings({ alwaysOnTop })}
                  />
                  <Toggle
                    label="Аппаратное ускорение"
                    hint="Изменение вступит в силу после перезапуска. Также доступен запуск с --safe-mode."
                    value={p.settings.hardwareAcceleration}
                    onChange={(hardwareAcceleration) => changeSettings({ hardwareAcceleration })}
                  />
                  <button className="danger" onClick={() => setConfirmClear(true)}>
                    <Trash2 size={15} />
                    Новый пустой сет
                  </button>
                </>
              )}
              {tab === 'Аудио' && (
                <>
                  <h3>Маршрутизация звука</h3>
                  <p className="muted">
                    Зал и CUE используют независимые аудиовыходы. Запись содержит только выход зала.
                  </p>
                  <Field label="Выход зала">
                    <select
                      value={p.settings.mainDevice}
                      onChange={(e) => changeSettings({ mainDevice: e.target.value })}
                    >
                      <option value="">Системное устройство по умолчанию</option>
                      {devices
                        .filter((d) => d.deviceId !== 'default')
                        .map((d, i) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || `Аудиовыход ${i + 1}`}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Отдельный выход наушников (CUE)">
                    <select
                      value={p.settings.cueDevice}
                      onChange={(e) => {
                        engine().stopCue();
                        changeSettings({ cueDevice: e.target.value });
                      }}
                    >
                      <option value="">Не выбран — CUE отключён</option>
                      {devices
                        .filter((d) => d.deviceId !== 'default')
                        .map((d, i) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || `Аудиовыход ${i + 1}`}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <button onClick={() => void refreshDevices()}>Обновить устройства</button>
                  <h3>Переходы и управление</h3>
                  <div className="form-grid">
                    <Field label="Появление, сек">
                      <input
                        type="number"
                        min="0"
                        max="120"
                        step=".1"
                        value={p.settings.fadeIn}
                        onChange={(e) => changeSettings({ fadeIn: clamp(+e.target.value, 0, 120) })}
                      />
                    </Field>
                    <Field label="Затухание, сек">
                      <input
                        type="number"
                        min="0"
                        max="120"
                        step=".1"
                        value={p.settings.fadeOut}
                        onChange={(e) =>
                          changeSettings({ fadeOut: clamp(+e.target.value, 0, 120) })
                        }
                      />
                    </Field>
                  </div>
                  <Field
                    label="Аварийное затухание по Esc, сек"
                    hint="Повторное нажатие во время затухания немедленно выключает звук."
                  >
                    <input
                      type="number"
                      min="0"
                      max="120"
                      step=".1"
                      value={p.settings.panicFade}
                      onChange={(e) =>
                        changeSettings({ panicFade: clamp(+e.target.value, 0, 120) })
                      }
                    />
                  </Field>
                  <Field label="Повторное нажатие на играющий пэд">
                    <select
                      value={p.settings.retrigger}
                      onChange={(e) =>
                        changeSettings({ retrigger: e.target.value as Settings['retrigger'] })
                      }
                    >
                      <option value="stop">Остановить (с фейдом, если включён)</option>
                      <option value="restart">Перезапустить</option>
                      <option value="ignore">Игнорировать</option>
                    </select>
                  </Field>
                </>
              )}
              {tab === 'Библиотека' && (
                <>
                  <h3>Аудиофайлы под рукой</h3>
                  <p className="muted">
                    Копируйте импортируемые треки в постоянную папку, чтобы сет продолжал работать
                    после отключения флешки.
                  </p>
                  <Field label="Папка библиотеки">
                    <input readOnly value={p.settings.library} placeholder="Выберите папку" />
                  </Field>
                  <button
                    onClick={() =>
                      void window.cue
                        .chooseLibrary()
                        .then((library) => {
                          if (library) changeSettings({ library });
                        })
                        .catch(fail)
                    }
                  >
                    <FolderOpen size={16} />
                    Выбрать папку
                  </button>
                  <Toggle
                    label="Копировать новые файлы в библиотеку"
                    value={p.settings.copyToLibrary}
                    onChange={(copyToLibrary) => changeSettings({ copyToLibrary })}
                    hint="Применяется к добавлению через диалог и перетаскивание."
                  />
                  <h3>Перенос на другой компьютер</h3>
                  <p className="muted">
                    «С файлами» сохраняет сет и папку аудио рядом. Перенесите их вместе. Потерянный
                    файл можно восстановить в настройках пэда; остальные файлы той же папки будут
                    найдены автоматически.
                  </p>
                  <button onClick={() => void saveSet(true)}>
                    <Upload size={16} />
                    Сохранить сет с аудио
                  </button>
                </>
              )}
              {tab === 'Управление' && (
                <>
                  <h3>Клавиши и MIDI</h3>
                  <p className="muted">
                    Назначения ячеек работают во всех банках. «Всегда» регистрирует клавишу в
                    Windows. Backspace удаляет назначение, Esc отменяет ввод.
                  </p>
                  <div
                    className="mapping-grid"
                    style={{ gridTemplateColumns: `repeat(${p.settings.grid[0]},1fr)` }}
                  >
                    {p.banks[p.activeBank].pads
                      .slice(0, p.settings.grid[0] * p.settings.grid[1])
                      .map((pad, i) => (
                        <button
                          key={i}
                          className={keyLearn === `cell:${i}` ? 'learning' : ''}
                          onClick={() => setKeyLearn(`cell:${i}`)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            learnMidi(
                              p.settings.midiMode === 'pad' && pad ? `pad:${pad.id}` : `cell:${i}`,
                            );
                          }}
                        >
                          <small>{String(i + 1).padStart(2, '0')}</small>
                          <strong>{p.keys[`cell:${i}`]?.key ?? '—'}</strong>
                          <span>{p.midi[`cell:${i}`] ? 'MIDI' : ' '}</span>
                        </button>
                      ))}
                  </div>
                  {Array.from({ length: p.settings.grid[0] * p.settings.grid[1] }, (_, i) =>
                    bindingRow(`cell:${i}`, `Ячейка ${i + 1}`),
                  )}
                  <h3>Банки</h3>
                  {p.banks.map((b, i) => bindingRow(`bank:${i}`, b.name))}
                  <h3>Плеер</h3>
                  {ACTIONS.map(([a, label]) => bindingRow(`action:${a}`, label))}
                </>
              )}
              {tab === 'MIDI' && (
                <>
                  <h3>Контроллеры</h3>
                  <button className="primary" onClick={() => void midiRef.current!.connect()}>
                    <Radio size={16} />
                    {midiRef.current!.access ? 'Обновить MIDI' : 'Подключить MIDI'}
                  </button>
                  <div className="device-list">
                    {[...(midiRef.current!.access?.inputs.values() ?? [])].map((d) => (
                      <div key={d.id}>
                        <i className="dot online" />
                        {d.name}
                        <small>{d.manufacturer}</small>
                      </div>
                    ))}
                    {!midiRef.current!.access?.inputs.size && (
                      <p className="muted">
                        MIDI-входы не найдены. Подключите контроллер к компьютеру.
                      </p>
                    )}
                  </div>
                  <Field label="Привязка MIDI">
                    <select
                      value={p.settings.midiMode}
                      onChange={(e) =>
                        changeSettings({ midiMode: e.target.value as Settings['midiMode'] })
                      }
                    >
                      <option value="cell">К ячейке — одна раскладка на все банки</option>
                      <option value="pad">К конкретному пэду</option>
                    </select>
                  </Field>
                  <Toggle
                    label="Подсветка контроллера"
                    value={p.settings.midiFeedback}
                    onChange={(midiFeedback) => {
                      midiRef.current!.resetFeedback();
                      changeSettings({ midiFeedback });
                    }}
                  />
                  <Field label="MIDI-выход">
                    <select
                      value={p.settings.midiOutput}
                      onChange={(e) => {
                        midiRef.current!.resetFeedback();
                        changeSettings({ midiOutput: e.target.value });
                      }}
                    >
                      <option value="">Все доступные выходы</option>
                      {[...(midiRef.current!.access?.outputs.values() ?? [])].map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Профиль подсветки">
                    <select
                      value={p.settings.midiProfile}
                      onChange={(e) => {
                        midiRef.current!.resetFeedback();
                        changeSettings({ midiProfile: e.target.value as Settings['midiProfile'] });
                      }}
                    >
                      <option value="generic">Стандартный MIDI (velocity)</option>
                      <option value="launchpad">Novation Launchpad — палитра</option>
                      <option value="apc">Akai APC — базовые цвета</option>
                    </select>
                  </Field>
                  <p className="muted">
                    Выберите назначение во вкладке «Управление» или настройках пэда, затем нажмите
                    кнопку контроллера. Для Launchpad включите Programmer/User mode на устройстве.
                    Совместимость профиля зависит от модели.
                  </p>
                  {midiLearn && (
                    <div className="learn-banner">
                      Ожидание MIDI: {midiLearn}
                      <button
                        onClick={() => {
                          setMidiLearn(null);
                          midiRef.current!.learn = null;
                        }}
                      >
                        Отмена
                      </button>
                    </div>
                  )}
                  <h3>Входящие сообщения</h3>
                  <pre className="midi-log">{midiLog.join('\n') || 'Ожидание сообщений…'}</pre>
                  <button
                    className="danger"
                    onClick={() => {
                      midiRef.current!.resetFeedback();
                      setP({ ...p, midi: {} });
                    }}
                  >
                    Сбросить MIDI-маппинг
                  </button>
                </>
              )}
              {tab === 'О программе' && (
                <>
                  <div className="about-logo">
                    <AudioLines size={42} />
                    <h2>CueForge Desktop</h2>
                    <p>Версия {version} · MIT License</p>
                  </div>
                  <p>
                    Открытый триггер-плеер для ведущих, DJ, театров и живых мероприятий. Все функции
                    доступны без подписки и активации.
                  </p>
                  <p className="muted">
                    Самостоятельная реализация по публичному описанию HypeCue. Проект не связан с
                    разработчиком HypeCue. Полная эквивалентность Pro ещё не подтверждена
                    аппаратными испытаниями.
                  </p>
                  <button
                    onClick={() =>
                      void window.cue
                        .checkUpdate()
                        .then((r) => {
                          setUpdate(r?.version ?? null);
                          notify(
                            r ? `Последний релиз: ${r.version}` : 'Публичный релиз пока недоступен',
                          );
                        })
                        .catch(fail)
                    }
                  >
                    <Download size={16} />
                    Проверить обновления
                  </button>
                  {update && (
                    <button onClick={() => void window.cue.openRelease()}>
                      Открыть релиз {update}
                    </button>
                  )}
                  <p className="muted">
                    Проверка обновлений выполняется только по нажатию и обращается к GitHub.
                    Автоматической загрузки нет.
                  </p>
                </>
              )}
            </section>
          </div>
          <div className="modal-footer">
            <span>Изменения сохраняются автоматически</span>
            <button
              className="primary"
              onClick={() => {
                setSettings(false);
                setKeyLearn(null);
                setMidiLearn(null);
                midiRef.current!.learn = null;
              }}
            >
              <Check size={16} />
              Готово
            </button>
          </div>
        </Modal>
      )}
      {editor && (
        <Modal
          title={
            p.banks[editor.bank].pads[editor.index] ? 'Настройка пэда' : 'Настройка пустой ячейки'
          }
          wide
          close={() => {
            setEditor(null);
            setKeyLearn(null);
            setMidiLearn(null);
            midiRef.current!.learn = null;
          }}
        >
          <div className="pad-editor">
            <div className="section-label">
              БАНК {p.banks[editor.bank].name} / ПЭД {editor.index + 1}
            </div>
            {p.banks[editor.bank].pads[editor.index] && (
              <PadEditor
                pad={p.banks[editor.bank].pads[editor.index]!}
                update={(patch) => changePad(editor.bank, editor.index, patch)}
                exportClip={() =>
                  void engine()
                    .exportTrim(p.banks[editor.bank].pads[editor.index]!)
                    .then((path) => {
                      if (path) notify('Клип сохранён: ' + path);
                    })
                    .catch(fail)
                }
                preview={() => void play(p.banks[editor.bank].pads[editor.index]!, true)}
                relink={() => void relink(p.banks[editor.bank].pads[editor.index]!)}
              />
            )}
            <h3>Управление ячейкой</h3>
            {bindingRow(`cell:${editor.index}`, `Ячейка ${editor.index + 1}`)}
            {p.settings.midiMode === 'pad' &&
              p.banks[editor.bank].pads[editor.index] &&
              bindingRow(`pad:${p.banks[editor.bank].pads[editor.index]!.id}`, 'Конкретный пэд')}
            <div className="modal-footer">
              <button
                className="danger"
                onClick={() => {
                  const pad = p.banks[editor.bank].pads[editor.index];
                  if (pad) engine().stop(pad.id);
                  setP((old) => ({
                    ...old,
                    banks: old.banks.map((b, i) =>
                      i === editor.bank
                        ? { ...b, pads: b.pads.map((a, j) => (j === editor.index ? null : a)) }
                        : b,
                    ),
                  }));
                  setEditor(null);
                }}
              >
                <Trash2 size={15} />
                Очистить пэд
              </button>
              <button className="primary" onClick={() => setEditor(null)}>
                <Check size={16} />
                Готово
              </button>
            </div>
          </div>
        </Modal>
      )}
      {bankEdit !== null && (
        <Modal
          title={`Банк ${String.fromCharCode(65 + bankEdit)}`}
          close={() => {
            setBankEdit(null);
            setKeyLearn(null);
          }}
        >
          <div className="pad-editor">
            <Field label="Название">
              <input
                value={p.banks[bankEdit].name}
                maxLength={60}
                onChange={(e) =>
                  setP({
                    ...p,
                    banks: p.banks.map((b, i) =>
                      i === bankEdit ? { ...b, name: e.target.value } : b,
                    ),
                  })
                }
              />
            </Field>
            <Field label="Цвет">
              <input
                type="color"
                value={p.banks[bankEdit].color}
                onChange={(e) =>
                  setP({
                    ...p,
                    banks: p.banks.map((b, i) =>
                      i === bankEdit ? { ...b, color: e.target.value } : b,
                    ),
                  })
                }
              />
            </Field>
            {bindingRow(`bank:${bankEdit}`, 'Переключить банк')}
          </div>
        </Modal>
      )}
      {confirmClear && (
        <Modal title="Создать пустой сет?" close={() => setConfirmClear(false)}>
          <div className="pad-editor">
            <p>
              Пэды и названия банков будут очищены. Аудиофайлы останутся на диске. Сохраните текущий
              сет, если он ещё понадобится.
            </p>
            <div className="modal-footer">
              <button onClick={() => void saveSet()}>Сохранить текущий</button>
              <button
                className="danger"
                onClick={() => {
                  engine().stopAll();
                  setP({ ...freshProject(), settings: p.settings, keys: p.keys, midi: p.midi });
                  setSelected(null);
                  setConfirmClear(false);
                  setSettings(false);
                }}
              >
                Создать пустой сет
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function PadEditor({
  pad,
  update,
  exportClip,
  preview,
  relink,
}: {
  pad: Pad;
  update: (patch: Partial<Pad>) => void;
  exportClip: () => void;
  preview: () => void;
  relink: () => void;
}) {
  return (
    <>
      <Field label="Название звука">
        <input value={pad.name} onChange={(e) => update({ name: e.target.value })} />
      </Field>
      <div className="file-path" title={pad.file}>
        <Music2 size={14} />
        <span>{pad.file}</span>
        <button onClick={relink}>
          <Link2 size={14} />
          {pad.missing ? 'Указать файл…' : 'Заменить'}
        </button>
      </div>
      <div className="form-grid">
        <Field label="Цвет пэда">
          <div className="colors">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Цвет ${c}`}
                style={{ background: c }}
                className={pad.color === c ? 'chosen' : ''}
                onClick={() => update({ color: c })}
              />
            ))}
            <input
              aria-label="Другой цвет"
              type="color"
              value={pad.color}
              onChange={(e) => update({ color: e.target.value })}
            />
          </div>
        </Field>
        <Field label={`Громкость: ${Math.round(pad.volume * 100)}%`}>
          <input
            type="range"
            min="0"
            max="1"
            step=".01"
            value={pad.volume}
            onChange={(e) => update({ volume: +e.target.value })}
          />
        </Field>
      </div>
      <div className="form-grid">
        <Toggle label="Повторять по кругу" value={pad.loop} onChange={(loop) => update({ loop })} />
        <Toggle
          label="Плавное появление / затухание"
          value={pad.fade}
          onChange={(fade) => update({ fade })}
        />
      </div>
      <div className="form-grid">
        <Field label="Появление, сек" hint="Пусто — из общих настроек">
          <input
            type="number"
            min="0"
            max="120"
            step=".1"
            value={pad.fadeIn ?? ''}
            onChange={(e) =>
              update({ fadeIn: e.target.value === '' ? null : clamp(+e.target.value, 0, 120) })
            }
          />
        </Field>
        <Field label="Затухание, сек" hint="Пусто — из общих настроек">
          <input
            type="number"
            min="0"
            max="120"
            step=".1"
            value={pad.fadeOut ?? ''}
            onChange={(e) =>
              update({ fadeOut: e.target.value === '' ? null : clamp(+e.target.value, 0, 120) })
            }
          />
        </Field>
      </div>
      <div className="trim-header">
        <h3>
          <Scissors size={17} />
          Обрезка трека
        </h3>
        <span>{time(pad.duration)}</span>
      </div>
      <Wave
        peaks={pad.peaks}
        color={pad.color}
        start={pad.duration ? pad.start / pad.duration : 0}
        end={pad.duration ? (pad.end ?? pad.duration) / pad.duration : 1}
        onSelect={(a, b) => {
          if (pad.duration) update({ start: a * pad.duration, end: b * pad.duration });
        }}
      />
      <p className="muted">
        Протяните по волне или задайте время. Изменения применяются при следующем запуске пэда;
        исходный файл сохраняется.
      </p>
      <div className="form-grid three">
        <Field label="Начало, сек">
          <input
            type="number"
            min="0"
            step=".01"
            max={pad.end ?? pad.duration}
            value={Math.round(pad.start * 100) / 100}
            onChange={(e) =>
              update({
                start: clamp(+e.target.value, 0, Math.max(0, (pad.end ?? pad.duration) - 0.01)),
              })
            }
          />
        </Field>
        <Field label="Конец, сек">
          <input
            type="number"
            min={pad.start + 0.01}
            max={pad.duration}
            step=".01"
            value={pad.end === null ? '' : Math.round(pad.end * 100) / 100}
            placeholder={pad.duration.toFixed(2)}
            onChange={(e) =>
              update({
                end:
                  e.target.value === ''
                    ? null
                    : clamp(+e.target.value, pad.start + 0.01, pad.duration),
              })
            }
          />
        </Field>
        <Field label="BPM (можно уточнить)">
          <input
            type="number"
            min="20"
            max="400"
            step=".1"
            value={pad.bpm ?? ''}
            onChange={(e) =>
              update({ bpm: e.target.value === '' ? null : clamp(+e.target.value, 20, 400) })
            }
          />
        </Field>
      </div>
      <div className="editor-actions">
        <button onClick={() => update({ start: 0, end: null })}>Сбросить обрезку</button>
        <button onClick={preview}>
          <Headphones size={15} />
          Прослушать CUE
        </button>
        <button onClick={exportClip}>
          <Download size={15} />
          Экспорт клипа WAV
        </button>
      </div>
    </>
  );
}
