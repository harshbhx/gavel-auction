import { describe, expect, it } from 'vitest';

// T-QA-075 (SEC-09) and T-QA-076 (SEC-10). These run against a server given by
// GAVEL_STAGING_URL (for example the in-process server on a local port, or the deployed
// staging site). Without it the suite is skipped, unless GAVEL_REQUIRE_STAGING=1 is set (a
// pipeline that has a target must set it), in which case a missing URL fails the run instead of
// passing with zero assertions. The server sets the headers through securityHeaders (packages/server/src/http); deploy-staging
// runs this suite with GAVEL_REQUIRE_STAGING=1. The evil-origin WebSocket test skips with a reason
// while no gateway accepts a same-origin upgrade.

const base = process.env['GAVEL_STAGING_URL'];
const EVIL = 'https://evil.example';
const AUCTIONEER_PATH = process.env['GAVEL_AUCTIONEER_PATH'] ?? '/auctioneer';

describe('staging target', () => {
  it.skipIf(process.env['GAVEL_REQUIRE_STAGING'] !== '1')(
    'is configured when the pipeline requires it',
    () => {
      expect(base).toBeTruthy();
    },
  );
});

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

  it('rejects a WebSocket upgrade from an evil origin', async (ctx) => {
    const url = (base ?? '').replace(/^http/, 'ws');
    // A refusal only means something when a same-origin upgrade opens first.
    if ((await upgrade(url, new URL(base ?? '').origin)) !== 'open') {
      ctx.skip('no WebSocket gateway answers a same-origin upgrade on the target');
      return;
    }
    expect(await upgrade(url, EVIL)).toBe('rejected');
  });
});

/** Opens a WebSocket with the given Origin and reports whether it opened or was refused. */
function upgrade(url: string, origin: string): Promise<'open' | 'rejected'> {
  return new Promise((resolve) => {
    // Node's global WebSocket accepts a headers option through its init object.
    const Ctor = WebSocket as unknown as new (
      u: string,
      o: { headers: Record<string, string> },
    ) => WebSocket;
    const ws = new Ctor(url, { headers: { Origin: origin } });
    const timer = setTimeout(() => {
      ws.close();
      resolve('rejected');
    }, 5000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve('open');
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve('rejected');
    });
  });
}
