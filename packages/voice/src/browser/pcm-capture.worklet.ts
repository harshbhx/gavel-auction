/**
 * AudioWorklet module: collects mono float blocks (128 frames each) and posts them to the main
 * thread in larger chunks. Load it with audioWorklet.addModule; the processor name is
 * "pcm-capture". Resampling and framing happen on the main thread in the pure audio modules.
 */
interface WorkletPort {
  postMessage(message: unknown, transfer?: unknown[]): void;
}

declare class AudioWorkletProcessor {
  readonly port: WorkletPort;
}

declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const CHUNK_SAMPLES = 1024;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(CHUNK_SAMPLES);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    let i = 0;
    while (i < channel.length) {
      const take = Math.min(CHUNK_SAMPLES - this.filled, channel.length - i);
      this.buf.set(channel.subarray(i, i + take), this.filled);
      this.filled += take;
      i += take;
      if (this.filled === CHUNK_SAMPLES) {
        const out = this.buf;
        this.port.postMessage(out, [out.buffer]);
        this.buf = new Float32Array(CHUNK_SAMPLES);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);

export {};
