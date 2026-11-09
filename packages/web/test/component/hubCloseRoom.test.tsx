import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { JudgeHub } from '../../src/screens/hub/JudgeHub';
import { NO_KEYS } from '../../src/screens/hub/hubKeys';
import { RoomClosedNote } from '../../src/screens/hub/RoomClosedNote';

interface Call {
  readonly url: string;
  readonly method: string;
}

function stubServer(closeStatus = 200): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const ok = !url.endsWith('/close') || closeStatus === 200;
    return Promise.resolve({
      ok,
      status: ok ? 200 : closeStatus,
      json: () => Promise.resolve({ joinCode: 'EMY48N', title: null, closed: true, invites: [] }),
      headers: { get: () => null },
    });
  });
  return calls;
}

const closeCalls = (calls: Call[]): Call[] => calls.filter((c) => c.url.endsWith('/close'));

function renderHub(navigate = vi.fn()) {
  render(
    <JudgeHub
      roomId="room-77"
      keys={{ ...NO_KEYS, auctioneer: 'tok', screen: null }}
      apiBase="http://api.test"
      origin="https://gavel.test"
      navigate={navigate}
    />,
  );
  return navigate;
}

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // none
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('hub: close room', () => {
  it('cancel leaves the room open and sends nothing', () => {
    const calls = stubServer();
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.button') }));
    expect(screen.getByRole('dialog', { name: t('hub.close.title') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('common.cancel') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(closeCalls(calls)).toHaveLength(0);
    expect(screen.queryByTestId('hub-ended')).toBeNull();
  });

  it('confirm closes the room with the console token and shows the closed state', async () => {
    const calls = stubServer();
    const navigate = renderHub();
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.button') }));
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.confirm') }));
    await waitFor(() => expect(screen.getByTestId('hub-ended')).toBeTruthy());
    expect(closeCalls(calls)).toEqual([
      { url: 'http://api.test/api/judge/rooms/room-77/close', method: 'POST' },
    ]);
    expect(screen.getByText(t('hub.close.done'))).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    // The close buttons are gone; a plain Home link remains.
    expect(screen.queryByRole('button', { name: t('hub.close.button') })).toBeNull();
    expect(screen.getByTestId('hub-home').getAttribute('href')).toBe('/');
  });

  it('keeps the dialog and says so when the server refuses', async () => {
    stubServer(503);
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.button') }));
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.confirm') }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t('hub.close.failed')));
    expect(screen.queryByTestId('hub-ended')).toBeNull();
  });

  it('close and go home confirms, closes, then navigates to the landing page', async () => {
    const calls = stubServer();
    const navigate = renderHub();
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.home') }));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.confirm') }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(closeCalls(calls)).toHaveLength(1);
    // The landing page then shows the note once.
    render(<RoomClosedNote />);
    expect(screen.getByTestId('room-closed-note').textContent).toBe(t('hub.close.noted'));
    cleanup();
    render(<RoomClosedNote />);
    expect(screen.queryByTestId('room-closed-note')).toBeNull();
  });

  it('close and go home cancelled does not close or navigate', () => {
    const calls = stubServer();
    const navigate = renderHub();
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.home') }));
    fireEvent.click(screen.getByRole('button', { name: t('common.cancel') }));
    expect(navigate).not.toHaveBeenCalled();
    expect(closeCalls(calls)).toHaveLength(0);
  });

  it('offers no close button without the console token', () => {
    stubServer();
    render(
      <JudgeHub
        roomId="room-77"
        keys={NO_KEYS}
        apiBase="http://api.test"
        origin="https://gavel.test"
      />,
    );
    expect(screen.queryByRole('button', { name: t('hub.close.button') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('hub.close.home') })).toBeNull();
  });

  it('a closed room is closed again without a second request', async () => {
    const calls = stubServer();
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.button') }));
    fireEvent.click(screen.getByRole('button', { name: t('hub.close.confirm') }));
    await waitFor(() => expect(screen.getByTestId('hub-ended')).toBeTruthy());
    expect(screen.queryByRole('button', { name: t('hub.close.home') })).toBeNull();
    expect(closeCalls(calls)).toHaveLength(1);
  });
});
