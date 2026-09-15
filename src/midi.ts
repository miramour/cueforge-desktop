import type { MidiBinding, Project } from './model';
export function midiMessage(
  bytes: Uint8Array,
): { type: 'note' | 'cc'; channel: number; number: number; value: number } | null {
  if (bytes.length < 3) return null;
  const status = bytes[0] & 0xf0;
  if (status !== 0x90 && status !== 0xb0) return null;
  return {
    type: status === 0x90 ? 'note' : 'cc',
    channel: bytes[0] & 15,
    number: bytes[1],
    value: bytes[2],
  };
}
export function sameMidi(a: MidiBinding, b: MidiBinding) {
  return (
    a.input === b.input && a.channel === b.channel && a.type === b.type && a.number === b.number
  );
}
export function ledVelocity(hex: string, profile: string, playing: boolean) {
  if (profile === 'apc') return playing ? 1 : 5;
  if (profile !== 'launchpad') return playing ? 127 : 40;
  const palette = [
    ['#ff0000', 5],
    ['#ff8800', 9],
    ['#ffff00', 13],
    ['#00ff00', 21],
    ['#00ffff', 37],
    ['#0088ff', 41],
    ['#0000ff', 45],
    ['#aa00ff', 49],
    ['#ff00aa', 53],
    ['#ffffff', 3],
  ] as const;
  const rgb = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const target = rgb(hex);
  let best = 3,
    dist = Infinity;
  for (const [c, n] of palette) {
    const d = rgb(c).reduce((sum, v, i) => sum + (v - target[i]) ** 2, 0);
    if (d < dist) {
      dist = d;
      best = n;
    }
  }
  return playing ? best : best === 3 ? 1 : best + 2;
}
export class MidiController {
  access: MIDIAccess | null = null;
  learn: string | null = null;
  project!: Project;
  onAction: (t: string, value?: number) => void = () => {};
  onLearn: (target: string, b: MidiBinding) => void = () => {};
  onChange = () => {};
  onLog: (line: string) => void = () => {};
  onError: (message: string) => void = () => {};
  private last = new Map<string, { value: number; time: number }>();
  private sent = new Map<string, number>();
  async connect() {
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.bind();
      this.access.onstatechange = () => {
        this.bind();
        this.sent.clear();
        this.onChange();
      };
      this.onChange();
    } catch (e) {
      this.onError('MIDI недоступен: ' + String(e));
    }
  }
  private bind() {
    for (const input of this.access?.inputs.values() ?? [])
      input.onmidimessage = (e) => {
        const m = e.data ? midiMessage(e.data) : null;
        if (!m) return;
        this.onLog(`${input.name} · ch ${m.channel + 1} · ${m.type} ${m.number} = ${m.value}`);
        const binding: MidiBinding = {
          input: input.id,
          type: m.type,
          channel: m.channel,
          number: m.number,
        };
        const key = `${input.id}/${m.channel}/${m.type}/${m.number}`,
          now = performance.now(),
          prior = this.last.get(key);
        this.last.set(key, { value: m.value, time: now });
        if (this.learn && m.value > 0) {
          if (prior && now - prior.time < 90) return;
          const target = this.learn;
          this.learn = null;
          binding.continuous = target === 'action:master' || target === 'action:cue';
          this.onLearn(target, binding);
          return;
        }
        for (const [target, b] of Object.entries(this.project?.midi ?? {}))
          if (sameMidi(b, binding)) {
            if (b.continuous) {
              this.onAction(target, m.value / 127);
              continue;
            }
            if (m.value === 0 || (prior && now - prior.time < 70)) continue;
            this.onAction(target);
          }
      };
  }
  feedback(playing: Set<string>) {
    if (!this.project?.settings.midiFeedback) return;
    const outputs = [...(this.access?.outputs.values() ?? [])].filter(
      (o) => !this.project.settings.midiOutput || o.id === this.project.settings.midiOutput,
    );
    for (const [target, b] of Object.entries(this.project.midi)) {
      if (b.type !== 'note') continue;
      let color = '#ffffff',
        active = false,
        assigned = false;
      if (target.startsWith('cell:')) {
        if (this.project.settings.midiMode !== 'cell') continue;
        const p = this.project.banks[this.project.activeBank].pads[+target.slice(5)];
        if (p) {
          color = p.color;
          active = playing.has(p.id);
          assigned = true;
        }
      } else if (target.startsWith('pad:')) {
        if (this.project.settings.midiMode !== 'pad') continue;
        const p = this.project.banks.flatMap((b) => b.pads).find((p) => p?.id === target.slice(4));
        if (p) {
          color = p.color;
          active = playing.has(p.id);
          assigned = true;
        }
      } else if (target.startsWith('bank:')) {
        const i = +target.slice(5);
        color = this.project.banks[i].color;
        active = i === this.project.activeBank;
        assigned = true;
      } else assigned = true;
      const velocity = assigned ? ledVelocity(color, this.project.settings.midiProfile, active) : 0;
      for (const output of outputs) {
        const key = `${output.id}/${b.channel}/${b.number}`;
        if (this.sent.get(key) !== velocity) {
          try {
            output.send([0x90 + b.channel, b.number, velocity]);
            this.sent.set(key, velocity);
          } catch (e) {
            this.onError(String(e));
          }
        }
      }
    }
  }
  resetFeedback() {
    for (const output of this.access?.outputs.values() ?? [])
      for (let n = 0; n < 128; n++)
        try {
          output.send([0x90, n, 0]);
        } catch {}
    this.sent.clear();
  }
}
