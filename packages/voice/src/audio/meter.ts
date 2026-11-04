export interface LevelReading {
  readonly rmsDbfs: number;
  readonly normalized: number;
  readonly clipping: boolean;
}

const SAMPLE_RATE = 16000;
const WINDOW_MS = 100;
const WINDOW_SAMPLES = (SAMPLE_RATE * WINDOW_MS) / 1000;
const FLOOR_DBFS = -90;
const CLIP_THRESHOLD = 32700;
const CLIP_COUNT = 3;

export class LevelMeter {
  private sumSq = 0;
  private count = 0;
  private consecutiveClip = 0;
  private clipping = false;

  push(pcm: Int16Array): LevelReading | null {
    for (let i = 0; i < pcm.length; i++) {
      const sample = pcm[i] ?? 0;
      this.sumSq += sample * sample;
      this.count++;

      if (Math.abs(sample) >= CLIP_THRESHOLD) {
        this.consecutiveClip++;
        if (this.consecutiveClip >= CLIP_COUNT) {
          this.clipping = true;
        }
      } else {
        this.consecutiveClip = 0;
      }

      if (this.count >= WINDOW_SAMPLES) {
        const reading = this.flush();
        return reading;
      }
    }
    return null;
  }

  private flush(): LevelReading {
    const rms = Math.sqrt(this.sumSq / this.count);
    const rmsDbfs = rms <= 0 ? FLOOR_DBFS : Math.max(FLOOR_DBFS, 20 * Math.log10(rms / 32768));
    const normalized = Math.max(0, Math.min(1, (rmsDbfs - FLOOR_DBFS) / (0 - FLOOR_DBFS)));
    const clipping = this.clipping;
    this.sumSq = 0;
    this.count = 0;
    this.consecutiveClip = 0;
    this.clipping = false;
    return { rmsDbfs, normalized, clipping };
  }
}
