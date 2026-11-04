import { describe, expect, it } from 'vitest';

// T-QA-075 (SEC-09) and T-QA-076 (SEC-10). These run against a server given by
// GAVEL_STAGING_URL (for example the in-process server on a local port, or the deployed
// staging site). Without it the suite is skipped.

const base = process.env['GAVEL_STAGING_URL'];
const EVIL = 'https://evil.example';
const AUCTIONEER_PATH = process.env['GAVEL_AUCTIONEER_PATH'] ?? '/auctioneer';

describe.skipIf(base === undefined)('security headers (T-QA-076)', () => {
  it('sets the baseline headers on /', async () => {
    const res = await fetch(`${base ?? ''}/`);
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=\d+/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBeTruthy();
  });

  it("denies framing on the auctioneer view with frame-ancestors 'none'", async () => {
    const res = await fetch(`${base ?? ''}${AUCTIONEER_PATH}`);
    expect(res.headers.get('content-security-policy') ?? '').toContain("frame-ancestors 'none'");
  });
});

describe.skipIf(base === undefined)('evil origin (T-QA-075)', () => {
  it('rejects a cross-origin HTTP request', async () => {
    const res = await fetch(`${base ?? ''}/`, { headers: { Origin: EVIL } });
    const allow = res.headers.get('access-control-allow-origin');
    expect(allow).not.toBe(EVIL);
    expect(allow).not.toBe('*');
  });

  it('rejects a WebSocket upgrade from an evil origin', async () => {
    const root = base ?? '';
    const url = root.replace(/^http/, 'ws');
    const outcome = await new Promise<string>((resolve) => {
      // Node's global WebSocket accepts a headers option through its init object.
      const init: { headers: Record<string, string> } = { headers: { Origin: EVIL } };
      const Ctor = WebSocket as unknown as new (
        u: string,
        o: { headers: Record<string, string> },
      ) => WebSocket;
      const ws = new Ctor(url, init);
      ws.addEventListener('open', () => {
        ws.close();
        resolve('open');
      });
      ws.addEventListener('error', () => resolve('rejected'));
      ws.addEventListener('close', () => resolve('rejected'));
    });
    expect(outcome).toBe('rejected');
  });
});
