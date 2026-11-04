import { describe, expect, it, vi } from 'vitest';
import { MAX_DRIFT_MS, createAudioSync, type MediaLike } from '../../src/screens/replay/AudioSync';

class StubMedia implements MediaLike {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  private errorFns: Array<() => void> = [];
  rejectPlay = false;

  play(): Promise<void> {
    this.paused = false;
    return this.rejectPlay ? Promise.reject(new Error('blocked')) : Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(_type: 'error', fn: () => void): void {
    this.errorFns.push(fn);
  }
  removeEventListener(_type: 'error', fn: () => void): void {
    this.errorFns = this.errorFns.filter((f) => f !== fn);
  }
  fail(): void {
    this.errorFns.forEach((f) => f());
  }
}

describe('AudioSync (T-WEB-046)', () => {
  it('re-aligns after a seek so drift is within 150 ms', () => {
    const media = new StubMedia();
    const sync = createAudioSync(media);
    sync.sync(42_000);
    expect(Math.abs(media.currentTime * 1000 - 42_000)).toBeLessThanOrEqual(MAX_DRIFT_MS);
    expect(sync.drift(42_000)).toBeLessThanOrEqual(MAX_DRIFT_MS);
  });

  it('leaves small drift alone and corrects large drift', () => {
    const media = new StubMedia();
    media.currentTime = 10;
    const sync = createAudioSync(media);
    sync.sync(10_100);
    expect(media.currentTime).toBe(10);
    sync.sync(11_000);
    expect(media.currentTime).toBe(11);
  });

  it('follows play, pause and speed', () => {
    const media = new StubMedia();
    const sync = createAudioSync(media);
    sync.setPlaying(true);
    expect(media.paused).toBe(false);
    sync.setSpeed(4);
    expect(media.playbackRate).toBe(4);
    sync.setPlaying(false);
    expect(media.paused).toBe(true);
  });

  it('falls back to captions only when audio fails to load', () => {
    const media = new StubMedia();
    const onStatus = vi.fn();
    const sync = createAudioSync(media, onStatus);
    media.fail();
    expect(sync.status()).toBe('captions-only');
    expect(onStatus).toHaveBeenCalledWith('captions-only');
    sync.sync(5000);
    expect(media.currentTime).toBe(0);
  });

  it('falls back to captions only when play is rejected', async () => {
    const media = new StubMedia();
    media.rejectPlay = true;
    const sync = createAudioSync(media);
    sync.setPlaying(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(sync.status()).toBe('captions-only');
  });
});
