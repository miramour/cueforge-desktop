import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  audioPath,
  audioResponse,
  atomicJson,
  exportSet,
  pcm16,
  readProject,
  wavHeader,
} from './files';
import { validateProject, type KeyBinding } from '../src/model';
import { analyzeFile, exportClip, stopMediaJobs, prepareAudio } from './media';
if (process.env.CUEFORGE_DATA) app.setPath('userData', path.resolve(process.env.CUEFORGE_DATA));
const stateFile = path.join(app.getPath('userData'), 'session.json');
let saved: any = null;
try {
  saved = readProject(stateFile);
} catch {
  try {
    saved = readProject(stateFile + '.bak');
  } catch {}
}
if (process.argv.includes('--safe-mode') || saved?.settings.hardwareAcceleration === false)
  app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cue-audio',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
const owned = app.requestSingleInstanceLock();
let win: BrowserWindow;
if (!owned) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  const grants = new Map<string, string>(),
    tokens = new Map<string, string>();
  function authorize(file: string) {
    file = audioPath(file);
    let token = tokens.get(file);
    if (!token) {
      token = randomUUID();
      tokens.set(file, token);
      grants.set(token, file);
    }
    const exists = fs.existsSync(file);
    return {
      file,
      url: `cue-audio://media/${token}`,
      size: exists ? fs.statSync(file).size : 0,
      missing: !exists,
    };
  }
  function requireGrant(file: string) {
    const full = audioPath(file);
    if (!tokens.has(full)) throw new Error('Сначала выберите аудиофайл');
    return full;
  }
  function grantProject(p: any) {
    for (const b of p.banks) for (const a of b.pads) if (a) authorize(a.file);
    return p;
  }
  function handle(name: string, fn: (...args: any[]) => any) {
    ipcMain.handle(name, (e, ...args) => {
      if (e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame)
        throw new Error('Недоверенный отправитель');
      return fn(...args);
    });
  }
  const filters = [
    { name: 'Аудио', extensions: ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'opus', 'webm'] },
  ];
  let recording: { fd: number; bytes: number; rate: number; file: string } | null = null;
  function stopRecording() {
    if (!recording) return null;
    const r = recording;
    recording = null;
    try {
      fs.writeSync(r.fd, wavHeader(r.bytes, r.rate), 0, 44, 0);
      fs.fsyncSync(r.fd);
    } finally {
      fs.closeSync(r.fd);
    }
    return r.file;
  }
  app.whenReady().then(async () => {
    protocol.handle('cue-audio', (request) => {
      const token = new URL(request.url).pathname.slice(1);
      const file = grants.get(token);
      if (!file) return new Response('Not found', { status: 404 });
      return audioResponse(file, request);
    });
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) =>
      cb(
        wc === win?.webContents && ['midi', 'midiSysex', 'speaker-selection'].includes(permission),
      ),
    );
    session.defaultSession.setPermissionCheckHandler(
      (wc, permission) =>
        wc === win?.webContents && ['midi', 'midiSysex', 'speaker-selection'].includes(permission),
    );
    handle('load', () => (saved ? grantProject(saved) : null));
    handle('save', (raw) => {
      const p = validateProject(raw);
      for (const b of p.banks) for (const a of b.pads) if (a) requireGrant(a.file);
      if (fs.existsSync(stateFile)) fs.copyFileSync(stateFile, stateFile + '.bak');
      atomicJson(stateFile, p);
      saved = p;
    });
    handle('pick-audio', async () => {
      const r = await dialog.showOpenDialog(win, {
        filters,
        properties: ['openFile', 'multiSelections'],
      });
      if (r.canceled) return [];
      r.filePaths.forEach(authorize);
      return r.filePaths;
    });
    handle('authorize', (paths: unknown) => {
      if (!Array.isArray(paths) || paths.length > 256) throw new Error('Слишком много файлов');
      return paths.map((p) => authorize(audioPath(p)));
    });
    handle('open-project', async () => {
      const r = await dialog.showOpenDialog(win, {
        filters: [{ name: 'CueForge set', extensions: ['cueforge', 'hcpl', 'json'] }],
        properties: ['openFile'],
      });
      return r.canceled ? null : grantProject(readProject(r.filePaths[0]));
    });
    handle('export-project', async (raw, portable) => {
      const p = validateProject(raw);
      for (const b of p.banks) for (const a of b.pads) if (a) requireGrant(a.file);
      const r = await dialog.showSaveDialog(win, {
        defaultPath: p.name.replace(/[<>:"/\\|?*]/g, '_') + '.cueforge',
        filters: [
          { name: 'CueForge set', extensions: ['cueforge'] },
          { name: 'HypeCue playlist', extensions: ['hcpl'] },
        ],
      });
      if (r.canceled || !r.filePath) return null;
      exportSet(p, r.filePath, portable === true);
      return r.filePath;
    });
    handle('library', async () => {
      const r = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
      });
      return r.canceled ? null : r.filePaths[0];
    });
    handle('copy-library', (files: string[], library: string) => {
      if (
        !Array.isArray(files) ||
        files.length > 256 ||
        typeof library !== 'string' ||
        !path.isAbsolute(library) ||
        !/^[a-z]:[\\/]/i.test(library)
      )
        throw new Error('Недопустимая библиотека');
      fs.mkdirSync(library, { recursive: true });
      return files.map((file) => {
        const src = requireGrant(file);
        let dest = path.join(library, path.basename(src));
        if (path.resolve(dest) === src) return src;
        if (fs.existsSync(dest))
          dest = path.join(library, `${randomUUID().slice(0, 8)}-${path.basename(src)}`);
        fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        authorize(dest);
        return dest;
      });
    });
    handle('relink', async (file: string) => {
      requireGrant(file);
      const r = await dialog.showOpenDialog(win, {
        title: 'Укажите новое расположение файла',
        filters,
        properties: ['openFile'],
      });
      if (r.canceled) return null;
      authorize(r.filePaths[0]);
      return {
        oldDir: path.dirname(file),
        newDir: path.dirname(r.filePaths[0]),
        selected: r.filePaths[0],
      };
    });
    handle('top', (v: boolean) => win.setAlwaysOnTop(v === true));
    handle('keys', (keys: Record<string, KeyBinding>) => {
      globalShortcut.unregisterAll();
      const errors: string[] = [];
      for (const [target, b] of Object.entries(keys).slice(0, 512))
        if (b.scope === 'global' && b.key !== 'Escape') {
          try {
            if (!globalShortcut.register(b.key, () => win.webContents.send('action', target)))
              errors.push(b.key);
          } catch {
            errors.push(b.key);
          }
        }
      return errors;
    });
    handle('record-start', async (rate: number) => {
      if (recording) throw new Error('Запись уже идёт');
      if (!Number.isInteger(rate) || rate < 8000 || rate > 192000)
        throw new Error('Неверная частота');
      const r = await dialog.showSaveDialog(win, {
        defaultPath: `CueForge-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`,
        filters: [{ name: 'WAV', extensions: ['wav'] }],
      });
      if (r.canceled || !r.filePath) return null;
      const fd = fs.openSync(r.filePath, 'w');
      fs.writeSync(fd, wavHeader(0, rate));
      recording = { fd, bytes: 0, rate, file: r.filePath };
      return r.filePath;
    });
    handle('record-chunk', (input: Float32Array) => {
      if (!recording) throw new Error('Запись не запущена');
      if (!(input instanceof Float32Array) || input.length > 262144 || input.length % 2 !== 0)
        throw new Error('Неверный блок записи');
      if (recording.bytes + input.length * 2 > 0xfffffff0 - 44) {
        stopRecording();
        throw new Error('Достигнут предел WAV 4 ГБ. Запись сохранена.');
      }
      const b = pcm16(input);
      fs.writeSync(recording.fd, b);
      recording.bytes += b.length;
      fs.writeSync(recording.fd, wavHeader(recording.bytes, recording.rate), 0, 44, 0);
    });
    handle('record-stop', () => stopRecording());
    handle('export-wav', async (samples: Float32Array, rate: number, name: string) => {
      if (
        !(samples instanceof Float32Array) ||
        samples.length > 100_000_000 ||
        samples.length % 2 ||
        !Number.isInteger(rate) ||
        rate < 8000 ||
        rate > 192000
      )
        throw new Error('Недопустимое аудио');
      const r = await dialog.showSaveDialog(win, {
        defaultPath: String(name).replace(/[<>:"/\\|?*]/g, '_') + '.wav',
        filters: [{ name: 'WAV', extensions: ['wav'] }],
      });
      if (r.canceled || !r.filePath) return null;
      const fd = fs.openSync(r.filePath, 'w');
      try {
        fs.writeSync(fd, wavHeader(samples.length * 2, rate));
        for (let i = 0; i < samples.length; i += 262144)
          fs.writeSync(fd, pcm16(samples.subarray(i, i + 262144)));
      } finally {
        fs.closeSync(fd);
      }
      authorize(r.filePath);
      return r.filePath;
    });
    handle('version', () => app.getVersion());
    handle('prepare-audio', async (file: string) => {
      requireGrant(file);
      const decoded = await prepareAudio(file);
      return { ...authorize(decoded), file };
    });
    handle('analyze', async (file: string, duration: number) => {
      requireGrant(file);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 604800)
        throw new Error('Некорректная длительность');
      return analyzeFile(file, duration);
    });
    handle('export-clip', async (file: string, start: number, end: number | null, name: string) => {
      requireGrant(file);
      if (
        !Number.isFinite(start) ||
        start < 0 ||
        start > 604800 ||
        (end !== null && (!Number.isFinite(end) || end <= start || end > 604800))
      )
        throw new Error('Некорректный фрагмент');
      const r = await dialog.showSaveDialog(win, {
        defaultPath: String(name).replace(/[<>:"/\\|?*]/g, '_') + '-clip.wav',
        filters: [{ name: 'WAV', extensions: ['wav'] }],
      });
      if (r.canceled || !r.filePath) return null;
      if (path.resolve(r.filePath) === path.resolve(file))
        throw new Error('Сохраните клип под другим именем, чтобы сохранить оригинал');
      await exportClip(file, r.filePath, start, end);
      authorize(r.filePath);
      return r.filePath;
    });
    handle('check-update', async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await net.fetch(
          'https://api.github.com/repos/miramour/cueforge-desktop/releases/latest',
          { signal: controller.signal },
        );
        if (!response.ok) return null;
        const r = await response.json();
        return typeof r.tag_name === 'string'
          ? {
              version: r.tag_name.replace(/^v/, ''),
              url: 'https://github.com/miramour/cueforge-desktop/releases/latest',
            }
          : null;
      } finally {
        clearTimeout(timer);
      }
    });
    handle('open-release', () =>
      shell.openExternal('https://github.com/miramour/cueforge-desktop/releases/latest'),
    );
    win = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 980,
      minHeight: 700,
      backgroundColor: '#101415',
      title: 'CueForge',
      icon: path.join(__dirname, '../build/icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    let closeApproved = false,
      closePrompt = false;
    handle('confirm-close', () => {
      if (recording) throw new Error('Сначала завершите запись');
      closeApproved = true;
      win.close();
    });
    win.on('close', (e) => {
      if (recording && !closeApproved) {
        e.preventDefault();
        if (closePrompt) return;
        closePrompt = true;
        void dialog
          .showMessageBox(win, {
            type: 'question',
            message: 'Остановить запись и закрыть CueForge?',
            buttons: ['Продолжить работу', 'Сохранить запись и выйти'],
            defaultId: 0,
            cancelId: 0,
          })
          .then(({ response }) => {
            closePrompt = false;
            if (response === 1) win.webContents.send('finish-recording-and-close');
          })
          .catch(() => {
            closePrompt = false;
          });
      }
    });
    if (process.env.CUEFORGE_DEV === '1') await win.loadURL('http://127.0.0.1:5173');
    else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopRecording();
    stopMediaJobs();
  });
  app.on('window-all-closed', () => app.quit());
}
