import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { clearAuctioneerToken } from '../../src/store/session';

const ROOM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

class QuietSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 0;
  send(): void {
    // Nothing is delivered in this test.
  }
  close(): void {
    // Nothing to release.
  }
}

describe('live console route', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', QuietSocket);
    window.location.hash = '#token=pelican';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAuctioneerToken();
    window.sessionStorage.clear();
    window.location.hash = '';
  });

  it('mounts the lot controls, manual entry, confirm queue and stop switch', () => {
    render(<App initialPath={`/r/${ROOM}/console`} liveBase="ws://localhost:1" />);
    expect(screen.getByRole('button', { name: t('console.hammer') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('console.open') })).toBeTruthy();
    expect(screen.getByRole('form', { name: t('console.manual') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('kill.button') })).toBeTruthy();
    expect(screen.getByText(t('console.noConfirm'))).toBeTruthy();
  });

  it('mounts the bid stream and a voice area that says it is checking until the voice chunk loads', () => {
    render(<App initialPath={`/r/${ROOM}/console`} liveBase="ws://localhost:1" />);
    expect(screen.getByRole('region', { name: t('console.stream') })).toBeTruthy();
    // The microphone code is a lazy chunk: until it loads, the area says what it is waiting for.
    // The voice states themselves are covered in voiceMic.test.tsx.
    expect(screen.getByText(t('console.mic.reason.checking'))).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });
});
