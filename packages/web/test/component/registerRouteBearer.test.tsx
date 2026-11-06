import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { saveSession } from '../../src/net/session';
import { resetApprovalMemory } from '../../src/payments/useApproval';

const API = { apiBase: 'http://api.test', payments: 'paypal', paypalClientId: 'client-x' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  resetApprovalMemory();
});

describe('register route sends the session bearer on the hold request', () => {
  it('posts the new hold with the stored session as a bearer', async () => {
    saveSession('room-9', { token: 'plainly-fake-session', bidderId: 'b-9' });
    const calls: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal('fetch', (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, authorization: init.headers['authorization'] ?? null });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ holdId: 'hold-ABC123', orderId: 'ord-1' }),
      });
    });

    render(<App initialPath="/r/room-9/register" api={API} />);
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    fireEvent.click(screen.getByLabelText('$250'));
    fireEvent.click(screen.getByRole('button', { name: t('reg.approve') }));

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toEqual({
      url: 'http://api.test/api/holds',
      authorization: 'Bearer plainly-fake-session',
    });
  });
});
