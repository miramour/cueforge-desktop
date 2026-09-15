import { estimateBpm, waveform } from './analysis';
self.onmessage = (e: MessageEvent<{ id: number; samples: Float32Array; rate: number }>) => {
  const { id, samples, rate } = e.data;
  self.postMessage({
    id,
    bpm: estimateBpm(samples.subarray(0, rate * 90), rate),
    peaks: waveform(samples),
  });
};
