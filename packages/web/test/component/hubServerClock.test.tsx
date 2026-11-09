import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { JudgeHub, offsetFromDate } from '../../src/screens/hub/JudgeHub';
import { NO_KEYS } from '../../src/screens/hub/hubKeys';

// Whole seconds: an HTTP Date header has no milliseconds.
const SERVER_NOW = 1_800_000_000_000;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('offsetFromDate (#2230)', () => {
  it('is the server time minus the device time', () => {
    const header = new Date(SERVER_NOW).toUTCString();
    expect(offsetFromDate(header, SERVER_NOW + 600_000)).toBe(-600_000);
    expect(offsetFromDate(header, SERVER_NOW - 600_000)).toBe(600_000);
  });

  it('is null when the header is missing or not a date', () => {
    expect(offsetFromDate(null, 1)).toBeNull();
    expect(offsetFromDate('soon', 1)).toBeNull();
  });
});

describe('hub countdown uses the server clock (#2230)', () => {
  it('does not claim the room expired when the device clock runs ten minutes fast', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SERVER_NOW + 600_000);
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ joinCode: 'EMY48N', title: null }),
        headers: {
          get: (name: string) => (name === 'date' ? new Date(SERVER_NOW).toUTCString() : null),
        },
      }),
    );
    render(
      <JudgeHub
        roomId="room-77"
        keys={{ ...NO_KEYS, expiresAt: SERVER_NOW + 300_000 }}
        apiBase="http://api.test"
        origin="https://gavel.test"
      />,
    );
    // Read off the device clock alone the room looks over; the server says five minutes remain.
    await waitFor(() => expect(screen.queryByText(t('hub.expired'))).toBeNull());
    expect(screen.getByText(/Room closes in/)).toBeTruthy();
  });
});
