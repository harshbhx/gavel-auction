import type { AudioBatch } from './frame.js';

const SAMPLE_RATE = 16000;
const THRESHOLD_DB_ABOVE_FLOOR = 45;
const HANGOVER_MS = 600;
const MAX_CHUNK_MS = 8000;
const MIN_CHUNK_MS = 400;
const PREROLL_MS = 200;

const HANGOVER_SAMPLES = (SAMPLE_RATE * HANGOVER_MS) / 1000;
const MAX_CHUNK_SAMPLES = (SAMPLE_RATE * MAX_CHUNK_MS) / 1000;
const MIN_CHUNK_SAMPLES = (SAMPLE_RATE * MIN_CHUNK_MS) / 1000;
const PREROLL_SAMPLES = (SAMPLE_RATE * PREROLL_MS) / 1000;
const FRAME_SIZE = 320;

export interface Chunk {
  readonly pcm: Int16Array;
}

function rmsDb(pcm: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i] ?? 0;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / pcm.length);
  return rms <= 0 ? -90 : 20 * Math.log10(rms / 32768);
}

export class Endpointer {
  private noiseFloorDb = -90;
  private noiseFrames = 0;
  private preroll: Int16Array[] = [];
  private prerollLen = 0;
  private speech: Int16Array[] = [];
  private speechLen = 0;
  private activeSpeechLen = 0;
  private inSpeech = false;
  private silenceCount = 0;

  push(batch: AudioBatch): Chunk[] {
    const chunks: Chunk[] = [];
    const pcm = batch.pcm;

    for (let i = 0; i < pcm.length; i += FRAME_SIZE) {
      const end = Math.min(i + FRAME_SIZE, pcm.length);
      const frame = pcm.slice(i, end);
      const db = rmsDb(frame);

      if (!this.inSpeech) {
        this.updateNoiseFloor(db);
      }

      const threshold = this.noiseFloorDb + THRESHOLD_DB_ABOVE_FLOOR;
      const isSpeech = db > threshold;

      if (!this.inSpeech) {
        this.preroll.push(frame);
        this.prerollLen += frame.length;
        while (this.prerollLen > PREROLL_SAMPLES && this.preroll.length > 1) {
          const dropped = this.preroll.shift();
          this.prerollLen -= dropped?.length ?? 0;
        }

        if (isSpeech) {
          this.inSpeech = true;
          this.silenceCount = 0;
          this.activeSpeechLen = 0;
          for (const p of this.preroll) {
            this.speech.push(p);
            this.speechLen += p.length;
          }
          this.preroll = [];
          this.prerollLen = 0;
        }
      } else {
        this.speech.push(frame);
        this.speechLen += frame.length;
        this.activeSpeechLen += frame.length;

        if (!isSpeech) {
          this.silenceCount += frame.length;
        } else {
          this.silenceCount = 0;
        }

        if (this.speechLen >= MAX_CHUNK_SAMPLES) {
          chunks.push({ pcm: this.concat(this.speech, this.speechLen) });
          this.speech = [];
          this.speechLen = 0;
          this.activeSpeechLen = 0;
          this.silenceCount = 0;
        } else if (this.silenceCount >= HANGOVER_SAMPLES) {
          const speechOnly = this.activeSpeechLen - this.silenceCount;
          if (speechOnly >= MIN_CHUNK_SAMPLES) {
            chunks.push({ pcm: this.concat(this.speech, this.speechLen) });
          }
          this.speech = [];
          this.speechLen = 0;
          this.activeSpeechLen = 0;
          this.inSpeech = false;
          this.silenceCount = 0;
        }
      }
    }

    return chunks;
  }

  private updateNoiseFloor(frameDb: number): void {
    this.noiseFrames++;
    const alpha = Math.min(0.95, 1 - 1 / this.noiseFrames);
    this.noiseFloorDb = alpha * this.noiseFloorDb + (1 - alpha) * frameDb;
  }

  private concat(parts: Int16Array[], total: number): Int16Array {
    const out = new Int16Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }
}
