/** Pure DSP helpers: resample to 16 kHz and convert float32 to int16. */

export const TARGET_RATE = 16000;
export const MIN_RATE = 8000;
export const MAX_RATE = 96000;

export interface Resampler {
  readonly rateIn: number;
  /** Resample one block. The returned view is reused by the next call; copy it to keep it. */
  process(input: Float32Array): Float32Array;
  reset(): void;
}

const LOBES = 16; // window half-width in zero crossings of the cutoff
const PHASES = 256; // fractional offsets in the polyphase table

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/**
 * Streaming windowed-sinc (Blackman) resampler to 16 kHz. State carries across calls.
 * The cutoff is min(rateIn, 16000) / 2, so downsampling is anti-aliased.
 * Buffers grow during warm-up only; steady-state calls allocate nothing.
 */
export function resampleTo16k(rateIn: number): Resampler {
  if (!Number.isFinite(rateIn) || rateIn < MIN_RATE || rateIn > MAX_RATE) {
    throw new RangeError(`unsupported sample rate ${rateIn}`);
  }
  const step = rateIn / TARGET_RATE; // input samples per output sample
  const cutoff = Math.min(1, TARGET_RATE / rateIn); // fraction of input Nyquist
  const half = Math.ceil(LOBES / cutoff); // input samples on each side of the centre

  // Polyphase table: kernel taps for PHASES + 1 fractional offsets, so a tap costs two
  // multiply-adds instead of a sin and two cos. Rows are linearly interpolated.
  const taps = 2 * half;
  const table = new Float64Array((PHASES + 1) * taps);
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    for (let j = 0; j < taps; j++) {
      const d = j - half + 1 - frac; // input offset from the read position
      const t = (d + half) / (2 * half);
      const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
      table[p * taps + j] = cutoff * sinc(d * cutoff) * w;
    }
  }

  // History before the first sample is `half` slots, filled with the first input sample
  // after a reset so the opening outputs keep the steady-state gain.
  let work = new Float32Array(half); // retained history followed by new input
  let len = half; // valid samples in work
  let pos = half; // fractional read position within work
  let fresh = true; // history still to be filled from the first input sample
  let out = new Float32Array(0);

  return {
    rateIn,
    process(input: Float32Array): Float32Array {
      if (input.length === 0) return out.subarray(0, 0);
      if (fresh) {
        work.fill(input[0] as number, 0, half);
        fresh = false;
      }
      if (work.length < len + input.length) {
        const grown = new Float32Array((len + input.length) * 2);
        grown.set(work.subarray(0, len));
        work = grown;
      }
      work.set(input, len);
      len += input.length;

      const maxOut = Math.ceil(input.length / step) + 2;
      if (out.length < maxOut) out = new Float32Array(maxOut * 2);

      let n = 0;
      while (pos + half < len) {
        const centre = Math.floor(pos);
        const scaled = (pos - centre) * PHASES;
        const row = Math.min(PHASES - 1, Math.floor(scaled));
        const mix = scaled - row;
        const base0 = row * taps;
        const base1 = base0 + taps;
        const first = centre - half + 1;
        let acc = 0;
        for (let j = 0; j < taps; j++) {
          const c0 = table[base0 + j] as number;
          acc += (work[first + j] as number) * (c0 + mix * ((table[base1 + j] as number) - c0));
        }
        out[n++] = acc;
        pos += step;
      }

      // Drop samples no future output can reach.
      const keepFrom = Math.max(0, Math.floor(pos) - half + 1);
      if (keepFrom > 0) {
        work.copyWithin(0, keepFrom, len);
        len -= keepFrom;
        pos -= keepFrom;
      }
      return out.subarray(0, n);
    },
    reset(): void {
      len = half;
      pos = half;
      fresh = true;
    },
  };
}

/** Clamp float32 [-1, 1] to int16; NaN becomes 0. Pass `dest` to avoid allocating. */
export function floatToInt16(input: Float32Array, dest?: Int16Array): Int16Array {
  const out =
    dest && dest.length >= input.length
      ? dest.subarray(0, input.length)
      : new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = input[i] as number;
    if (v !== v) out[i] = 0;
    else if (v >= 1) out[i] = 32767;
    else if (v <= -1) out[i] = -32768;
    else out[i] = Math.round(v * 32768);
  }
  return out;
}
