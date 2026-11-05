import type { AudioBatch } from './frame.js';

const SAMPLE_RATE = 16000;
/** Speech must be this far above the tracked noise floor (R7-07; was 45, which no room reaches). */
const THRESHOLD_DB_ABOVE_FLOOR = 12;
/** Never trigger below this absolute level, so digital silence plus dither is not speech. */
const MIN_THRESHOLD_DB = -55;
/** Floor assumed before any audio is seen: a quiet room, so speech at stream start still counts. */
const INITIAL_FLOOR_DB = -60;
/** The floor never rises above this, so a loud room cannot lift the threshold past speech. */
const MAX_FLOOR_DB = -45;
const FLOOR_RISE = 0.02;
const FLOOR_FALL = 0.5;
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
  private noiseFloorDb = INITIAL_FLOOR_DB;
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

      const threshold = Math.max(
        MIN_THRESHOLD_DB,
        this.noiseFloorDb + THRESHOLD_DB_ABOVE_FLOOR,
      );
      const isSpeech = db > threshold;
      if (!isSpeech && !this.inSpeech) this.updateNoiseFloor(db);

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

  /**
   * Emit the speech held at the end of a stream or before a gap in the audio (R7-06, R7-11).
   * Returns nothing when the held speech is shorter than the minimum chunk.
   */
  flush(): Chunk[] {
    const chunks: Chunk[] = [];
    if (this.inSpeech) {
      const speechOnly = this.activeSpeechLen - this.silenceCount;
      if (speechOnly >= MIN_CHUNK_SAMPLES) {
        chunks.push({ pcm: this.concat(this.speech, this.speechLen) });
      }
    }
    this.speech = [];
    this.speechLen = 0;
    this.activeSpeechLen = 0;
    this.inSpeech = false;
    this.silenceCount = 0;
    this.preroll = [];
    this.prerollLen = 0;
    return chunks;
  }

  /** Fast to follow a quieter room, slow to follow a louder one; clamped. */
  private updateNoiseFloor(frameDb: number): void {
    const alpha = frameDb < this.noiseFloorDb ? FLOOR_FALL : FLOOR_RISE;
    const next = this.noiseFloorDb + alpha * (frameDb - this.noiseFloorDb);
    this.noiseFloorDb = Math.min(MAX_FLOOR_DB, Math.max(-90, next));
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
