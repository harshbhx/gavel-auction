/** Worklet source that turns microphone input into 16 kHz mono 16 bit PCM chunks. */

export const TARGET_RATE = 16000;
export const WORKLET_NAME = 'gavel-pcm';

/** Converts float samples to 16 bit PCM. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.min(1, Math.max(-1, input[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

/** Linear resample from `fromRate` to 16 kHz. Same rate returns the input. */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE || input.length === 0) return input;
  const ratio = fromRate / TARGET_RATE;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const pos = i * ratio;
    const base = Math.floor(pos);
    const a = input[base] ?? 0;
    const b = input[base + 1] ?? a;
    out[i] = a + (b - a) * (pos - base);
  }
  return out;
}

/** Runs inside the audio worklet scope: posts each block of channel 0. */
const WORKLET_SOURCE = `
class GavelPcm extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length > 0) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', GavelPcm);
`;

/** A blob URL for the worklet module. Caller revokes it after addModule. */
export function workletModuleUrl(): string {
  return URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
}
