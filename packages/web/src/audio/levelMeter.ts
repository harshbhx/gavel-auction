/** Input level 0..1 from PCM, published at most 20 times a second. */

export const LEVEL_HZ = 20;
const MIN_GAP_MS = 1000 / LEVEL_HZ;

/** Root mean square of the samples, clamped to 0..1. Empty input is 0. */
export function rmsLevel(samples: Float32Array | Int16Array): number {
  if (samples.length === 0) return 0;
  const scale = samples instanceof Int16Array ? 32768 : 1;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = (samples[i] ?? 0) / scale;
    sum += v * v;
  }
  return Math.min(1, Math.max(0, Math.sqrt(sum / samples.length)));
}

export interface LevelMeter {
  /** Feed a chunk. The callback fires when 50 ms have passed since the last one. */
  push(samples: Float32Array | Int16Array, nowMs: number): void;
}

export function createLevelMeter(onLevel: (level: number) => void): LevelMeter {
  let last = Number.NEGATIVE_INFINITY;
  let peak = 0;
  return {
    push(samples, nowMs) {
      peak = Math.max(peak, rmsLevel(samples));
      if (nowMs - last < MIN_GAP_MS) return;
      last = nowMs;
      onLevel(peak);
      peak = 0;
    },
  };
}
