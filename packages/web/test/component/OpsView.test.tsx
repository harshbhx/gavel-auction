import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fetchOpsSummary, OpsView } from '../../src/ops/OpsView';

describe('OpsView', () => {
  it('shows sagas, PayPal outcomes and log lines', () => {
    render(
      <OpsView
        summary={{
          logs: ['{"msg":"one"}', '{"msg":"two"}'],
          sagas: [{ auctionId: 'a1', lotId: 'l1', state: 'HOLD_PLACED' }],
          paypal: { ok: 4, duplicate: 1 },
        }}
      />,
    );
    expect(screen.getByText('a1 l1 HOLD_PLACED')).toBeTruthy();
    expect(screen.getByText('ok: 4')).toBeTruthy();
    expect(screen.getByText(/"msg":"two"/)).toBeTruthy();
  });

  it('shows an error and sends the key header', async () => {
    render(<OpsView summary={undefined} error="unauthorized" />);
    expect(screen.getByRole('alert').textContent).toBe('unauthorized');
    let seen: unknown;
    const fake = ((_u: string, init?: RequestInit) => {
      seen = init?.headers;
      return Promise.resolve(new Response('{"logs":[],"sagas":[],"paypal":{}}'));
    }) as unknown as typeof fetch;
    await fetchOpsSummary('http://x', 'k', fake);
    expect(seen).toEqual({ 'x-admin-key': 'k' });
  });
});
