// Bounded onset autocorrelation. BPM is an estimate, with the usual half/double-tempo ambiguity.
export function estimateBpm(samples: Float32Array, rate: number): number | null {
  const hop = Math.max(1, Math.round(rate / 200)),
    frame = hop * 10,
    count = Math.floor((samples.length - frame) / hop);
  if (count < 400) return null;
  const env = new Float32Array(count);
  let prev = 0,
    total = 0,
    sumRms = 0,
    energy = 0;
  for (let j = 0; j < frame; j++) energy += samples[j] ** 2;
  for (let i = 0; i < count; i++) {
    if (i > 0)
      for (let j = 0; j < hop; j++) {
        energy -= samples[(i - 1) * hop + j] ** 2;
        energy += samples[(i - 1) * hop + frame + j] ** 2;
      }
    const rms = Math.sqrt(Math.max(0, energy) / frame);
    env[i] = Math.max(0, rms - prev);
    prev = rms;
    total += env[i];
    sumRms += rms;
  }
  if (total < 0.005 || total < sumRms * 0.004) return null;
  const hz = rate / hop;
  let best = 0,
    bpm = 0;
  for (let tempo = 60; tempo <= 200; tempo += 0.25) {
    const lag = (60 * hz) / tempo;
    let score = 0;
    for (let i = Math.ceil(lag * 2); i < count; i++) {
      const j = i - lag,
        base = Math.floor(j),
        f = j - base;
      score += env[i] * (env[base] * (1 - f) + env[base + 1] * f);
    }
    if (score > best) {
      best = score;
      bpm = tempo;
    }
  }
  return best > 0 ? Math.round(bpm * 10) / 10 : null;
}
export function waveform(samples: Float32Array, bins = 640): number[] {
  const size = Math.max(1, Math.floor(samples.length / bins));
  return Array.from({ length: Math.min(bins, samples.length) }, (_, i) => {
    let peak = 0;
    for (let j = i * size; j < Math.min(samples.length, (i + 1) * size); j++)
      peak = Math.max(peak, Math.abs(samples[j]));
    return peak;
  });
}
