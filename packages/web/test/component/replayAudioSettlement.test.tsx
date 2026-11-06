import { EpochMs } from '@gavel/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import type { MediaLike } from '../../src/screens/replay/AudioSync';
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

function serve(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
  );
}

beforeEach(() => {
  FakeMedia.last = null;
  FakeMedia.failPlay = false;
  vi.stubGlobal('Audio', FakeMedia);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// The first render lazy-loads the replay screen, which is slow on a busy runner. Waits on it get
// a generous bound; they return as soon as the condition holds, so it costs nothing when fast.
const LOAD = { timeout: 10_000 };

describe('replay route with audio and settlement', { timeout: 20_000 }, () => {
  it('creates the audio sync, corrects drift above 150 ms and shows the settlement panel', async () => {
    serve(bundle(true, '/recordings/rec1/audio.webm'));
    // Only the replay clock is faked, so the waits below keep using real timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    render(<App initialPath="/replay/rec1" />);
    expect(await screen.findByText('Walnut sideboard', {}, LOAD)).toBeTruthy();
    expect(FakeMedia.last?.url).toBe('/recordings/rec1/audio.webm');
    expect(FakeMedia.last?.plays).toBe(1);
    expect(screen.queryByTestId('settlement-panel')).toBeNull();
    // The replay clock advances 100 ms per tick; step it past the 400 ms settlement event.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(await screen.findByTestId('settlement-panel', {}, LOAD)).toBeTruthy();
    // The audio sat at 0 ms while the clock reached 400 ms: the gap is over the limit.
    expect(FakeMedia.last?.currentTime).toBeCloseTo(0.4, 3);
    expect(screen.queryByText(t('replay.captionsOnly'))).toBeNull();
  });

  it('shows the captions-only state when the audio cannot play', async () => {
    serve(bundle(true, '/recordings/rec1/audio.webm'));
    FakeMedia.failPlay = true;
    render(<App initialPath="/replay/rec1" />);
    expect(await screen.findByText(t('replay.captionsOnly'), {}, LOAD)).toBeTruthy();
  });

  it('creates no audio and no panel for a recording without them', async () => {
    serve(bundle(false, null));
    render(<App initialPath="/replay/rec1" />);
    expect(await screen.findByText('Walnut sideboard', {}, LOAD)).toBeTruthy();
    expect(FakeMedia.last).toBeNull();
    expect(screen.queryByTestId('settlement-panel')).toBeNull();
  });
});
