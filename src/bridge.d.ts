import type { Project, KeyBinding } from './model';
export interface AudioFile {
  file: string;
  url: string;
  size: number;
  missing: boolean;
}
export interface Bridge {
  onClose(fn: () => void): () => void;
  confirmClose(): Promise<void>;
  prepareAudio(file: string): Promise<AudioFile>;
  analyze(
    file: string,
    duration: number,
  ): Promise<{ samples: Float32Array; peaks: number[]; rate: number }>;
  exportClip(file: string, start: number, end: number | null, name: string): Promise<string | null>;
  load(): Promise<Project | null>;
  save(p: Project): Promise<void>;
  pickAudio(): Promise<string[]>;
  authorize(paths: string[]): Promise<AudioFile[]>;
  filePath(f: File): string;
  openProject(): Promise<Project | null>;
  exportProject(p: Project, portable: boolean): Promise<string | null>;
  chooseLibrary(): Promise<string | null>;
  copyLibrary(paths: string[], library: string): Promise<string[]>;
  relink(file: string): Promise<{ oldDir: string; newDir: string; selected: string } | null>;
  setTop(value: boolean): Promise<void>;
  setKeys(keys: Record<string, KeyBinding>): Promise<string[]>;
  onAction(fn: (target: string) => void): () => void;
  recordStart(rate: number): Promise<string | null>;
  recordChunk(chunk: Float32Array): Promise<void>;
  recordStop(): Promise<string | null>;
  exportWav(samples: Float32Array, rate: number, name: string): Promise<string | null>;
  version(): Promise<string>;
  checkUpdate(): Promise<{ version: string; url: string } | null>;
  openRelease(): Promise<void>;
}
declare global {
  interface Window {
    cue: Bridge;
  }
  interface AudioContext {
    setSinkId(id: string): Promise<void>;
  }
}
