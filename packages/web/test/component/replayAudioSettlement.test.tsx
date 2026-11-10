import { EpochMs } from '@gavel/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import type { MediaLike } from '../../src/screens/replay/AudioSync';
import ReplayScreen from '../../src/screens/replay/ReplayScreen';
import { BASE_TIME, openSnapshot, roster, stateMsg } from '../../src/testing/builders';

class FakeMedia implements MediaLike {
  static last: FakeMedia | null = null;
  static failPlay = false;
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  plays = 0;
  constructor(readonly url: string) {
    FakeMedia.last = this;
  }
  play(): Promise<void> {
    this.plays += 1;
    return FakeMedia.failPlay ? Promise.reject(new Error('blocked')) : Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(_type: 'error', _fn: () => void): void {
    // The tests fail playback through play().
  }
  removeEventListener(_type: 'error', _fn: () => void): void {
    // Nothing was kept.
  }
}

const hold = { verifiedBy: [], idSuffix: 'abc123' };

function bundle(withSettlement: boolean, audioUrl: string | null): unknown {
  const state = stateMsg(1, openSnapshot(roster([7, 'Eve'])), BASE_TIME);
  const settlement = {
    v: 1,
    t: 'settlement_update',
    seq: 2,
    ts: EpochMs(BASE_TIME + 400),
    rev: 1,
    auctionState: 'SETTLED',
    winnerPaddle: 7,
    holds: [{ ...hold, paddle: 7, state: 'CAPTURED', capturedCents: 25_000, releasedCents: 0 }],
  };
  return {
    version: 1,
    title: 'Walnut sideboard',
    ...(audioUrl === null ? {} : { audioUrl }),
    events: [{ t: 0, msg: state }, ...(withSettlement ? [{ t: 400, msg: settlement }] : [])],
  };
}

/** Hands the screen the recording and a fake audio element directly: no global fetch or Audio. */
function renderReplay(body: unknown, autoplay = true): void {
  render(
    <ReplayScreen
      recordingId="rec1"
      autoplay={autoplay}
      loadBundle={() => Promise.resolve(body)}
      createMedia={(url) => new FakeMedia(url)}
    />,
  );
}

beforeEach(() => {
  FakeMedia.last = null;
  FakeMedia.failPlay = false;
});
afterEach(() => {
  vi.useRealTimers();
});

// Waits get a generous bound for a busy runner; they return as soon as the condition holds, so it
// costs nothing when fast.
const LOAD = { timeout: 10_000 };

describe('replay screen with audio and settlement', { timeout: 20_000 }, () => {
  it('creates the audio sync, corrects drift above 150 ms and shows the settlement panel', async () => {
    // Load with the clock stopped and real timers: testing-library polls with setInterval, which
    // a fake clock would freeze, so every wait happens before the clock is faked.
    renderReplay(bundle(true, '/recordings/rec1/audio.webm'), false);
    const resume = await screen.findByRole('button', { name: t('console.resume') }, LOAD);
    expect(FakeMedia.last?.url).toBe('/recordings/rec1/audio.webm');
    expect(screen.queryByTestId('settlement-panel')).toBeNull();
    // Only the replay clock is faked, and only now, so the interval started by play is the fake one.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    fireEvent.click(resume);
    expect(FakeMedia.last?.plays).toBe(1);
    // The replay clock advances 100 ms per tick; step it past the 400 ms settlement event.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('settlement-panel')).toBeTruthy();
    // The audio sat at 0 ms while the clock reached 400 ms: the gap is over the limit.
    expect(FakeMedia.last?.currentTime).toBeCloseTo(0.4, 3);
    expect(screen.queryByText(t('replay.captionsOnly'))).toBeNull();
  });

  it('shows the captions-only state when the audio cannot play', async () => {
    FakeMedia.failPlay = true;
    renderReplay(bundle(true, '/recordings/rec1/audio.webm'));
    expect(await screen.findByText(t('replay.captionsOnly'), {}, LOAD)).toBeTruthy();
  });

  it('creates no audio and no panel for a recording without them', async () => {
    renderReplay(bundle(false, null));
    expect(await screen.findByText('Walnut sideboard', {}, LOAD)).toBeTruthy();
    expect(FakeMedia.last).toBeNull();
    expect(screen.queryByTestId('settlement-panel')).toBeNull();
  });
});
