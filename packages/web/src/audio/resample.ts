/** Streaming resampler to 16 kHz for microphone blocks (linear interpolation, phase carried across blocks). */

export const TARGET_RATE = 16000;
export const MIN_RATE = 8000;
export const MAX_RATE = 96000;

export interface Resampler {
  /** Resamples one block. Same rate returns the input. Blocks of any length, in order. */
  process(block: Float32Array): Float32Array;
}

/**
 * Block-wise resampling that keeps the fractional read position and the last sample between
 * calls, so no sample is dropped or repeated at block edges (a block of 128 at 44.1 kHz is not a
 * whole number of output samples). Rates outside 8 to 96 kHz are refused.
 */
export function createResampler(rateIn: number): Resampler {
  if (!Number.isFinite(rateIn) || rateIn < MIN_RATE || rateIn > MAX_RATE) {
    throw new RangeError(`unsupported sample rate ${String(rateIn)}`);
  }
  if (rateIn === TARGET_RATE) return { process: (block) => block };
  const step = rateIn / TARGET_RATE;
  // Position of the next output sample, in input samples from the start of the next block.
  // -1 up to 0 reads between the last sample of the previous block and the first of this one.
  let pos = 0;
  let prev = 0;
  let primed = false;
  return {
    process(block) {
      if (block.length === 0) return new Float32Array(0);
      if (!primed) {
        prev = block[0] ?? 0;
        primed = true;
      }
      const out: number[] = [];
      for (;;) {
        const i = Math.floor(pos);
        if (i + 1 > block.length - 1) break;
        const a = i < 0 ? prev : (block[i] ?? 0);
        const b = block[i + 1] ?? a;
        out.push(a + (b - a) * (pos - i));
        pos += step;
      }
      pos -= block.length;
      prev = block[block.length - 1] ?? prev;
      return Float32Array.from(out);
    },
  };
}
