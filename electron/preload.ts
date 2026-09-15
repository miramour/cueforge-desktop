import { contextBridge, ipcRenderer, webUtils } from 'electron';
contextBridge.exposeInMainWorld('cue', {
  onClose: (fn: () => void) => {
    const listener = () => fn();
    ipcRenderer.on('finish-recording-and-close', listener);
    return () => ipcRenderer.removeListener('finish-recording-and-close', listener);
  },
  confirmClose: () => ipcRenderer.invoke('confirm-close'),
  prepareAudio: (file: string) => ipcRenderer.invoke('prepare-audio', file),
  load: () => ipcRenderer.invoke('load'),
  save: (p: unknown) => ipcRenderer.invoke('save', p),
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  authorize: (paths: string[]) => ipcRenderer.invoke('authorize', paths),
  filePath: (f: File) => webUtils.getPathForFile(f),
  analyze: (file: string, duration: number) => ipcRenderer.invoke('analyze', file, duration),
  exportClip: (file: string, start: number, end: number | null, name: string) =>
    ipcRenderer.invoke('export-clip', file, start, end, name),
  openProject: () => ipcRenderer.invoke('open-project'),
  exportProject: (p: unknown, portable: boolean) =>
    ipcRenderer.invoke('export-project', p, portable),
  chooseLibrary: () => ipcRenderer.invoke('library'),
  copyLibrary: (paths: string[], library: string) =>
    ipcRenderer.invoke('copy-library', paths, library),
  relink: (file: string) => ipcRenderer.invoke('relink', file),
  setTop: (value: boolean) => ipcRenderer.invoke('top', value),
  setKeys: (keys: unknown) => ipcRenderer.invoke('keys', keys),
  onAction: (fn: (s: string) => void) => {
    const listener = (_: unknown, s: string) => fn(s);
    ipcRenderer.on('action', listener);
    return () => ipcRenderer.removeListener('action', listener);
  },
  recordStart: (rate: number) => ipcRenderer.invoke('record-start', rate),
  recordChunk: (chunk: Float32Array) => ipcRenderer.invoke('record-chunk', chunk),
  recordStop: () => ipcRenderer.invoke('record-stop'),
  exportWav: (samples: Float32Array, rate: number, name: string) =>
    ipcRenderer.invoke('export-wav', samples, rate, name),
  version: () => ipcRenderer.invoke('version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  openRelease: () => ipcRenderer.invoke('open-release'),
});
