import { SystemClock } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { startStack } from '../src/runner/stack';
import { CEILING_CENTS, LIVE_STACK_ENV } from '../src/voice/live-socket';

// The live /audio socket run registers its bidders through the test-only /__e2e/enrol route. The
// first dispatch failed there with a 500 because the ceiling was above the server's cap. This runs
// the same setup calls against the real server process and the fake PayPal, with the same stack
// environment and ceiling the run uses, so the setup cannot regress unnoticed.

const TIMEOUT_MS = 120_000;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok)
    throw new Error(`${new URL(res.url).pathname} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

describe('live socket run setup', () => {
  it(
    'enrols a bidder with the run ceiling and registers it in the room',
    async () => {
      const stack = await startStack({ externalFake: true, env: { ...LIVE_STACK_ENV } });
      try {
        const base = stack.serverUrl;
        const admin = { 'content-type': 'application/json', 'x-admin-key': stack.adminKey };
        const created = await json<{ auctionId: string; auctioneerLink: string }>(
          await fetch(`${base}/api/auctions`, {
            method: 'POST',
            headers: admin,
            body: JSON.stringify({
              title: 'enrol check',
              config: {
                mode: 'english',
                currency: 'USD',
                reserve: 5000,
                minIncrement: 500,
                endTs: new SystemClock().now() + 600_000,
                softCloseWindowMs: 30_000,
                softCloseExtensionMs: 30_000,
                maxExtensions: 5,
                ceilingPresets: [CEILING_CENTS],
                confirmConfidenceThreshold: 0.85,
              },
            }),
          }),
        );
        const token = created.auctioneerLink.split('#token=')[1] ?? '';
        const { invites } = await json<{ invites: Array<{ link: string }> }>(
          await fetch(`${base}/api/auctions/${created.auctionId}/invites`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ count: 1 }),
          }),
        );
        const joined = await json<{ bidderId: string }>(
          await fetch(`${base}/api/auctions/${created.auctionId}/join`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ invite: invites[0]?.link.split('#token=')[1] ?? '' }),
          }),
        );
        const enrolled = await json<{ holdId: string; authId: string | null }>(
          await fetch(`${base}/__e2e/enrol`, {
            method: 'POST',
            headers: admin,
            body: JSON.stringify({
              auctionId: created.auctionId,
              bidderId: joined.bidderId,
              name: 'bidder 1',
              ceilingCents: CEILING_CENTS,
              presetsCents: [CEILING_CENTS],
            }),
          }),
        );
        expect(enrolled.holdId).toMatch(/^HOLD-/);
        expect(enrolled.authId).not.toBeNull();
      } finally {
        await stack.stop();
      }
    },
    TIMEOUT_MS,
  );

  it('keeps the run ceiling above the default cap, which is why the cap is raised', () => {
    expect(CEILING_CENTS).toBeGreaterThan(100_000);
    expect(LIVE_STACK_ENV['GAVEL_MAX_CEILING_CENTS']).toBe(String(CEILING_CENTS));
  });
});
