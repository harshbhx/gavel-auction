import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { RoomGate } from '../../src/screens/states/RoomGate';
import { TokenGate } from '../../src/screens/states/TokenGate';

const ROOM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function gate(onlyNotFound: boolean) {
  return render(
    <RoomGate
      apiBase="https://api.example.test"
      roomId={ROOM}
      onNavigate={() => undefined}
      onlyNotFound={onlyNotFound}
    >
      <TokenGate role="auctioneer" token={null} roomId={ROOM}>
        {null}
      </TokenGate>
    </RoomGate>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a console or screen link without a token', () => {
  it('says the link needs its token when the room lookup cannot reach the server', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network down')));
    gate(true);
    expect(await screen.findByText(t('err.tokenMissing'))).toBeTruthy();
    expect(screen.queryByText(t('join.offlineTitle'))).toBeNull();
  });

  it('says the link needs its token when the lookup is rate limited', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 429, headers: new Headers({ 'retry-after': '3' }) }),
    );
    gate(true);
    expect(await screen.findByText(t('err.tokenMissing'))).toBeTruthy();
  });

  it('still shows the not-found screen when the server says the room is gone', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 404, headers: new Headers() }),
    );
    gate(true);
    await waitFor(() => expect(document.querySelector('[data-route="notFound"]')).not.toBeNull());
    expect(screen.queryByText(t('err.tokenMissing'))).toBeNull();
  });

  it('keeps the unreachable message for pages that need the room itself', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network down')));
    gate(false);
    expect(await screen.findByText(t('join.offlineTitle'))).toBeTruthy();
  });
});
