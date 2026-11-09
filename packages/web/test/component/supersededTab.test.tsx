import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { roomStore } from '../../src/store/roomStore';
import { clearAuctioneerToken } from '../../src/store/session';

const ROOM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev?: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 1;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(): void {}
  close(): void {}
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.history.pushState(null, '', `/r/${ROOM}/screen#token=screen-token-1`);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearAuctioneerToken();
  roomStore.enter('');
  window.sessionStorage.clear();
  window.history.pushState(null, '', '/');
});

describe('a tab closed as superseded (#2231)', () => {
  it('stays closed, says why, and takes over only when asked', () => {
    render(<App initialPath={`/r/${ROOM}/screen`} liveBase="ws://localhost:1" />);
    act(() => FakeSocket.all[0]?.onopen?.());
    act(() => FakeSocket.all[0]?.onclose?.({ code: 4011 }));
    expect(screen.getByRole('heading', { name: t('err.superseded.title') })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(FakeSocket.all).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: t('err.superseded.use') }));
    expect(FakeSocket.all).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: t('err.superseded.title') })).toBeNull();
  });

  it('an ordinary close still reconnects by itself', () => {
    render(<App initialPath={`/r/${ROOM}/screen`} liveBase="ws://localhost:1" />);
    act(() => FakeSocket.all[0]?.onopen?.());
    act(() => FakeSocket.all[0]?.onclose?.({ code: 1006 }));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(FakeSocket.all.length).toBeGreaterThan(1);
  });
});
