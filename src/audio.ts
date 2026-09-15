import type { AudioFile } from './bridge';
import type { Pad, Project } from './model';
import { clamp, nextPad } from './model';
interface Voice {
  pad: Pad;
  gain: GainNode;
  source: AudioBufferSourceNode | MediaElementAudioSourceNode;
  media?: HTMLAudioElement;
  started: number;
  offset: number;
  end: number;
  stopping: boolean;
  paused: boolean;
  stopAt?: number;
  cue: boolean;
}
export class AudioEngine {
  context = new AudioContext({ latencyHint: 'interactive' });
  cueContext = new AudioContext({ latencyHint: 'interactive' });
  master = this.context.createGain();
  cueMaster = this.cueContext.createGain();
  meter = this.context.createAnalyser();
  cueMeter = this.cueContext.createAnalyser();
  limiter = this.context.createDynamicsCompressor();
  voices = new Map<string, Voice>();
  cueVoice: Voice | null = null;
  private scheduled: { voice: Voice; afterId: string } | null = null;
  private scheduleGeneration = 0;
  files = new Map<string, AudioFile>();
  cache = new Map<string, AudioBuffer>();
  inflight = new Map<string, Promise<AudioBuffer | null>>();
  cacheBytes = 0;
  project!: Project;
  onChange = () => {};
  onTrackStart = (_id: string) => {};
  onError = (s: string) => console.error(s);
  onAnalysis = (id: string, data: { duration: number; bpm: number | null; peaks: number[] }) => {};
  private worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  private analysisId = 0;
  private requests = new Map<number, (d: any) => void>();
  private analyzed = new Set<string>();
  private revision = 0;
  private epoch = 0;
  private pending = new Map<string, number>();
  private cueRevision = 0;
  private cueReady = false;
  private configuredMain: string | null = null;
  private configuredCue: string | null = null;
  private timer: ReturnType<typeof setInterval>;
  private recorder: AudioWorkletNode | null = null;
  private writeQueue = Promise.resolve();
  private queuedBytes = 0;
  private recordError = false;
  private onFlushed: (() => void) | null = null;
  recording = false;
  recordedAt = 0;
  panicAt = 0;
  constructor() {
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.limiter.connect(this.master);
    this.master.connect(this.meter);
    this.meter.connect(this.context.destination);
    this.cueMaster.connect(this.cueMeter);
    this.cueMeter.connect(this.cueContext.destination);
    this.worker.onmessage = (e) => {
      this.requests.get(e.data.id)?.(e.data);
      this.requests.delete(e.data.id);
    };
    this.timer = setInterval(() => this.tick(), 30);
  }
  async configure(p: Project) {
    if (this.project && this.project.settings.mode !== p.settings.mode) this.cancelScheduled();
    this.project = p;
    this.master.gain.setTargetAtTime(
      p.settings.muted ? 0 : p.settings.master,
      this.context.currentTime,
      0.015,
    );
    this.cueMaster.gain.setTargetAtTime(p.settings.cueVolume, this.cueContext.currentTime, 0.015);
    try {
      if (this.configuredMain !== p.settings.mainDevice) {
        this.stopCue();
        await this.context.setSinkId(p.settings.mainDevice);
        this.configuredMain = p.settings.mainDevice;
      }
      if (this.configuredCue !== p.settings.cueDevice) {
        this.cueReady = false;
        await this.cueContext.setSinkId(p.settings.cueDevice);
        this.configuredCue = p.settings.cueDevice;
        this.cueReady = !!p.settings.cueDevice;
      }
    } catch (e) {
      this.cueReady = false;
      this.configuredCue = null;
      this.stopCue();
      this.onError('Аудиовыход недоступен. Выберите подключённое устройство. ' + String(e));
    }
  }
  async register(paths: string[]) {
    const files = await window.cue.authorize([...new Set(paths)]);
    for (const f of files) this.files.set(f.file, f);
    return files;
  }
  async metadata(file: AudioFile): Promise<number> {
    return new Promise((resolve, reject) => {
      const media = new Audio();
      const timeout = setTimeout(() => finish(new Error('Время загрузки аудио истекло')), 15000);
      function finish(err?: Error) {
        clearTimeout(timeout);
        const d = media.duration;
        media.onloadedmetadata = null;
        media.onerror = null;
        media.removeAttribute('src');
        media.load();
        if (err) reject(err);
        else if (!Number.isFinite(d) || d <= 0) reject(new Error('Неизвестная длительность аудио'));
        else resolve(d);
      }
      media.preload = 'metadata';
      media.onloadedmetadata = () => finish();
      media.onerror = () => finish(new Error('Формат аудио не удалось прочитать'));
      media.src = file.url;
    });
  }
  async buffer(pad: Pad): Promise<AudioBuffer | null> {
    const cached = this.cache.get(pad.file);
    if (cached) {
      this.cache.delete(pad.file);
      this.cache.set(pad.file, cached);
      this.analyzeBuffer(pad, cached);
      return cached;
    }
    if (this.inflight.has(pad.file)) {
      const buffer = await this.inflight.get(pad.file)!;
      if (buffer) this.analyzeBuffer(pad, buffer);
      return buffer;
    }
    const promise = (async () => {
      let info = this.files.get(pad.file) ?? (await this.register([pad.file]))[0];
      if (info.missing) throw new Error(`Файл не найден: ${pad.name}`);
      let duration = pad.duration;
      try {
        duration ||= await this.metadata(info);
      } catch {
        info = await window.cue.prepareAudio(pad.file);
        this.files.set(pad.file, info);
        duration = await this.metadata(info);
      }
      if (duration > 600 || info.size > 50 * 1024 * 1024) {
        if (!pad.duration) this.onAnalysis(pad.id, { duration, bpm: pad.bpm, peaks: pad.peaks });
        if (!this.analyzed.has(pad.id)) {
          this.analyzed.add(pad.id);
          void window.cue
            .analyze(pad.file, duration)
            .then((data) => {
              const id = ++this.analysisId;
              this.requests.set(id, (result) =>
                this.onAnalysis(pad.id, { duration, bpm: result.bpm, peaks: data.peaks }),
              );
              this.worker.postMessage({ id, samples: data.samples, rate: data.rate }, [
                data.samples.buffer,
              ]);
            })
            .catch((e) => {
              this.analyzed.delete(pad.id);
              this.onError(String(e));
            });
        }
        return null;
      }
      const response = await fetch(info.url);
      if (!response.ok) throw new Error('Не удалось загрузить аудиофайл');
      let buffer: AudioBuffer;
      try {
        buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      } catch {
        info = await window.cue.prepareAudio(pad.file);
        this.files.set(pad.file, info);
        const decoded = await fetch(info.url);
        buffer = await this.context.decodeAudioData(await decoded.arrayBuffer());
      }
      const bytes = buffer.length * buffer.numberOfChannels * 4;
      while (this.cacheBytes + bytes > 256 * 1024 * 1024 && this.cache.size) {
        const [key, b] = this.cache.entries().next().value!;
        this.cache.delete(key);
        this.cacheBytes -= b.length * b.numberOfChannels * 4;
      }
      if (bytes <= 256 * 1024 * 1024) {
        this.cache.set(pad.file, buffer);
        this.cacheBytes += bytes;
      }
      this.analyzeBuffer(pad, buffer);
      return buffer;
    })();
    this.inflight.set(pad.file, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(pad.file);
    }
  }
  private analyzeBuffer(pad: Pad, buffer: AudioBuffer) {
    if (this.analyzed.has(pad.id)) return;
    this.analyzed.add(pad.id);
    const id = ++this.analysisId;
    const mono = buffer.getChannelData(0).slice();
    this.requests.set(id, (data) =>
      this.onAnalysis(pad.id, { duration: buffer.duration, bpm: data.bpm, peaks: data.peaks }),
    );
    this.worker.postMessage({ id, samples: mono, rate: buffer.sampleRate }, [mono.buffer]);
  }
  async warm(pads: Pad[]) {
    for (const p of pads) {
      try {
        await this.buffer(p);
      } catch (e) {
        this.onError(String(e));
      }
    }
  }
  async trigger(pad: Pad, cue = false) {
    if (cue) return this.preview(pad);
    this.cancelScheduled();
    const existing = this.voices.get(pad.id);
    if (existing && !existing.paused && this.project.settings.retrigger === 'ignore') return;
    if (existing && !existing.paused && this.project.settings.retrigger === 'stop') {
      this.stop(pad.id, pad.fade ? (pad.fadeOut ?? this.project.settings.fadeOut) : 0);
      return;
    }
    const revision = ++this.revision,
      epoch = this.epoch;
    this.pending.set(pad.id, revision);
    await this.context.resume();
    let buffer: AudioBuffer | null;
    try {
      buffer = await this.buffer(pad);
    } catch (e) {
      this.onError(String(e));
      return;
    }
    if (
      epoch !== this.epoch ||
      this.pending.get(pad.id) !== revision ||
      (revision !== this.revision && this.project.settings.mode !== 'mix')
    )
      return;
    this.pending.delete(pad.id);
    if (this.project.settings.mode !== 'mix')
      for (const v of this.voices.values())
        this.stop(v.pad.id, v.pad.fade ? (v.pad.fadeOut ?? this.project.settings.fadeOut) : 0);
    else this.stop(pad.id, 0);
    await this.startVoice(pad, buffer, false, pad.start);
    this.onChange();
  }
  private async startVoice(
    pad: Pad,
    buffer: AudioBuffer | null,
    cue: boolean,
    offset: number,
    when = 0,
    afterId?: string,
  ) {
    const context = cue ? this.cueContext : this.context;
    const epoch = this.epoch;
    await context.resume();
    if (epoch !== this.epoch) return;
    const startAt = Math.max(when, context.currentTime);
    const gain = context.createGain();
    gain.connect(cue ? this.cueMaster : this.limiter);
    const start = Math.max(pad.start, offset),
      end = Math.max(
        start + 0.01,
        Math.min(pad.end ?? Infinity, buffer?.duration ?? (pad.duration || Infinity)),
      );
    let source: Voice['source'], media: HTMLAudioElement | undefined;
    if (buffer) {
      const b = context.createBufferSource();
      b.buffer = buffer;
      b.loop = pad.loop;
      b.loopStart = pad.start;
      b.loopEnd = end;
      source = b;
    } else {
      media = new Audio();
      media.crossOrigin = 'anonymous';
      media.src = this.files.get(pad.file)!.url;
      media.preload = 'auto';
      media.currentTime = start;
      source = context.createMediaElementSource(media);
    }
    const voice: Voice = {
      pad: { ...pad },
      gain,
      source,
      media,
      started: startAt,
      offset: start,
      end,
      stopping: false,
      paused: false,
      cue,
    };
    source.connect(gain);
    const fi = pad.fade ? (pad.fadeIn ?? this.project.settings.fadeIn) : 0;
    gain.gain.setValueAtTime(fi > 0 ? 0 : pad.volume, startAt);
    if (fi > 0) gain.gain.linearRampToValueAtTime(pad.volume, startAt + Math.min(fi, end - start));
    const duration = end - start;
    if (pad.fade && !pad.loop && Number.isFinite(duration)) {
      const fo = Math.min(pad.fadeOut ?? this.project.settings.fadeOut, duration);
      if (fo > 0) {
        gain.gain.setValueAtTime(
          pad.volume,
          startAt + Math.min(duration, Math.max(Math.min(fi, duration), duration - fo)),
        );
        gain.gain.linearRampToValueAtTime(0, startAt + duration);
      }
    }
    if (cue) this.cueVoice = voice;
    else if (afterId) this.scheduled = { voice, afterId };
    else {
      this.voices.set(pad.id, voice);
      this.onTrackStart(pad.id);
    }
    const ended = () => this.ended(voice);
    try {
      if (media) {
        media.onended = () => {
          if (voice.pad.loop && !voice.stopping) {
            media!.currentTime = voice.pad.start;
            void media!.play().catch((e) => this.onError(String(e)));
          } else ended();
        };
        media.onerror = () => {
          this.onError(`Не удалось воспроизвести ${pad.name}`);
          this.dispose(voice);
        };
        await media.play();
      } else {
        (source as AudioBufferSourceNode).onended = ended;
        if (pad.loop) (source as AudioBufferSourceNode).start(startAt, start);
        else (source as AudioBufferSourceNode).start(startAt, start, duration);
      }
      if (!cue && !afterId) void this.prepareNext(voice);
    } catch (e) {
      this.dispose(voice);
      this.onError(String(e));
    }
  }
  private ended(v: Voice) {
    if (v.stopping || v.paused) return;
    this.dispose(v);
    if (!v.cue && this.project.settings.mode === 'playlist' && !v.pad.loop) {
      if (this.scheduled?.afterId === v.pad.id) {
        const next = this.scheduled.voice;
        this.scheduled = null;
        this.voices.set(next.pad.id, next);
        this.onTrackStart(next.pad.id);
        void this.prepareNext(next);
        this.onChange();
        return;
      }
      const next = nextPad(this.project, v.pad.id);
      if (next) void this.trigger(next);
    }
    this.onChange();
  }
  private async prepareNext(voice: Voice) {
    if (
      voice.cue ||
      voice.media ||
      voice.paused ||
      voice.stopping ||
      voice.pad.loop ||
      this.project.settings.mode !== 'playlist'
    )
      return;
    const next = nextPad(this.project, voice.pad.id);
    if (!next) return;
    const generation = ++this.scheduleGeneration;
    try {
      const buffer = await this.buffer(next);
      const when = voice.started + voice.end - voice.offset;
      if (
        !buffer ||
        generation !== this.scheduleGeneration ||
        voice.stopping ||
        voice.paused ||
        this.project.settings.mode !== 'playlist' ||
        this.voices.get(voice.pad.id) !== voice ||
        when <= this.context.currentTime + 0.02
      )
        return;
      await this.startVoice(next, buffer, false, next.start, when, voice.pad.id);
    } catch (e) {
      this.onError(String(e));
    }
  }
  private cancelScheduled() {
    this.scheduleGeneration++;
    const queued = this.scheduled;
    this.scheduled = null;
    if (queued) this.dispose(queued.voice);
  }
  position(v: Voice) {
    if (v.media) return v.media.currentTime;
    if (v.paused) return v.offset;
    let pos = v.offset + (v.cue ? this.cueContext : this.context).currentTime - v.started;
    if (v.pad.loop && Number.isFinite(v.end))
      pos = v.pad.start + ((pos - v.pad.start) % (v.end - v.pad.start));
    return Math.min(v.end, pos);
  }
  private tick() {
    for (const v of [...this.voices.values(), ...(this.cueVoice ? [this.cueVoice] : [])]) {
      if (v.paused) continue;
      const context = v.cue ? this.cueContext : this.context;
      if (v.stopAt !== undefined && context.currentTime >= v.stopAt) {
        this.dispose(v);
        continue;
      }
      if (v.media && this.position(v) >= v.end) {
        if (v.pad.loop) {
          v.media.currentTime = v.pad.start;
          void v.media.play().catch((e) => this.onError(String(e)));
        } else {
          v.media.pause();
          this.ended(v);
        }
      }
    }
  }
  private dispose(v: Voice) {
    v.stopping = true;
    if (v.media) {
      v.media.pause();
      v.media.onended = null;
      v.media.removeAttribute('src');
      v.media.load();
    } else {
      try {
        (v.source as AudioBufferSourceNode).stop();
      } catch {}
    }
    v.source.disconnect();
    v.gain.disconnect();
    if (v.cue) {
      if (this.cueVoice === v) this.cueVoice = null;
    } else if (this.voices.get(v.pad.id) === v) this.voices.delete(v.pad.id);
    this.onChange();
  }
  stop(id: string, fade = 0) {
    if (this.scheduled?.afterId === id || this.scheduled?.voice.pad.id === id)
      this.cancelScheduled();
    this.pending.delete(id);
    const v = this.voices.get(id);
    if (!v) return;
    if (!fade || v.paused || v.stopping) {
      this.dispose(v);
      return;
    }
    v.stopping = true;
    const now = this.context.currentTime;
    v.gain.gain.cancelAndHoldAtTime(now);
    v.gain.gain.linearRampToValueAtTime(0, now + fade);
    v.stopAt = now + fade;
    this.onChange();
  }
  stopAll(fade = 0) {
    this.cancelScheduled();
    this.epoch++;
    this.pending.clear();
    this.revision++;
    for (const id of this.voices.keys()) this.stop(id, fade);
    this.stopCue();
  }
  panic() {
    const now = performance.now();
    const fading = this.panicAt > now;
    this.stopAll(fading ? 0 : this.project.settings.panicFade);
    this.panicAt = fading ? 0 : now + this.project.settings.panicFade * 1000;
  }
  pause() {
    this.cancelScheduled();
    this.epoch++;
    this.pending.clear();
    this.revision++;
    for (const v of this.voices.values())
      if (!v.paused) {
        v.offset = this.position(v);
        v.paused = true;
        if (v.media) v.media.pause();
        else {
          (v.source as AudioBufferSourceNode).onended = null;
          try {
            (v.source as AudioBufferSourceNode).stop();
          } catch {}
        }
      }
    this.onChange();
  }
  async resume() {
    for (const v of [...this.voices.values()])
      if (v.paused) {
        const { pad, offset } = v;
        this.dispose(v);
        await this.startVoice(pad, await this.buffer(pad), false, offset);
      }
    this.onChange();
  }
  async seek(id: string, position: number) {
    this.cancelScheduled();
    const v = this.voices.get(id);
    if (!v) return;
    const p = v.pad;
    const pos = clamp(position, p.start, v.end - 0.01);
    this.dispose(v);
    await this.startVoice(p, await this.buffer(p), false, pos);
    this.onChange();
  }
  async preview(pad: Pad) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const main = devices.find(
        (d) => d.deviceId === (this.project.settings.mainDevice || 'default'),
      ),
      cue = devices.find((d) => d.deviceId === this.project.settings.cueDevice);
    if (
      !this.cueReady ||
      !cue ||
      cue.deviceId === main?.deviceId ||
      (cue.groupId && cue.groupId === main?.groupId)
    ) {
      this.onError('Для CUE выберите отдельный физический выход наушников в настройках аудио.');
      return;
    }
    if (this.cueVoice?.pad.id === pad.id) {
      this.stopCue();
      return;
    }
    this.stopCue();
    const revision = ++this.cueRevision;
    try {
      const buffer = await this.buffer(pad);
      if (revision !== this.cueRevision || !this.cueReady) return;
      await this.startVoice(pad, buffer, true, pad.start);
    } catch (e) {
      this.onError(String(e));
    }
    this.onChange();
  }
  stopCue() {
    this.cueRevision++;
    if (this.cueVoice) this.dispose(this.cueVoice);
  }
  level(cue = false) {
    const a = cue ? this.cueMeter : this.meter;
    const data = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(data);
    let peak = 0;
    for (const n of data) peak = Math.max(peak, Math.abs(n));
    return peak;
  }
  async startRecording() {
    await this.context.resume();
    if (!this.recorder) {
      await this.context.audioWorklet.addModule(new URL('recorder.js', document.baseURI).href);
      this.recorder = new AudioWorkletNode(this.context, 'cue-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.master.connect(this.recorder);
      const silence = this.context.createGain();
      silence.gain.value = 0;
      this.recorder.connect(silence);
      silence.connect(this.context.destination);
      this.recorder.port.onmessage = (e) => {
        if (e.data === 'stopped') {
          this.onFlushed?.();
          this.onFlushed = null;
          return;
        }
        if (this.recordError) return;
        const chunk = e.data as Float32Array;
        this.queuedBytes += chunk.byteLength;
        if (this.queuedBytes > 16 * 1024 * 1024) {
          this.recordError = true;
          this.onError('Диск не успевает за записью. Запись остановлена.');
          void this.stopRecording();
          return;
        }
        this.writeQueue = this.writeQueue
          .then(() => window.cue.recordChunk(chunk))
          .catch((err) => {
            this.recordError = true;
            this.onError('Ошибка записи: ' + String(err));
            void this.stopRecording();
          })
          .finally(() => {
            this.queuedBytes -= chunk.byteLength;
          });
      };
    }
    const file = await window.cue.recordStart(this.context.sampleRate);
    if (!file) return false;
    this.recordError = false;
    this.queuedBytes = 0;
    this.recordedAt = Date.now();
    this.recording = true;
    this.recorder.port.postMessage('start');
    return true;
  }
  async stopRecording() {
    if (!this.recording) return null;
    this.recording = false;
    await new Promise<void>((resolve) => {
      this.onFlushed = resolve;
      this.recorder!.port.postMessage('stop');
    });
    await this.writeQueue;
    return window.cue.recordStop();
  }
  async exportTrim(pad: Pad) {
    return window.cue.exportClip(pad.file, pad.start, pad.end, pad.name);
  }
  destroy() {
    clearInterval(this.timer);
    this.stopAll();
    this.worker.terminate();
    void this.context.close();
    void this.cueContext.close();
  }
}
