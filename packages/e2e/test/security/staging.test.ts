import { describe, expect, it } from 'vitest';

// T-QA-075, T-QA-076 and T-QA-074 against a deployed host (#1602). Read-only or low impact: GETs,
// one preflight, one oversize webhook POST that the host refuses before it reads past the limit,
// and a few malformed frames on an unauthenticated socket. The suite is skipped unless STAGING_URL
// (or GAVEL_STAGING_URL, the name the other security files use) is set; deploy-staging sets it.

const base = process.env['STAGING_URL'] ?? process.env['GAVEL_STAGING_URL'];
const EVIL = 'https://evil.example';
const WEBHOOK_PATH = '/webhooks/paypal';
const OVERSIZE_BYTES = 300 * 1024;

const url = (path: string): string => `${base ?? ''}${path}`;

describe.skipIf(base === undefined)('deployed host (STAGING_URL)', () => {
  it('sends the baseline security headers on a health check', async () => {
    const res = await fetch(url('/healthz'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=\d+/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('permissions-policy')).toContain('microphone=()');
  });

  it('does not echo an evil origin on a request or a preflight', async () => {
    const get = await fetch(url('/healthz'), { headers: { Origin: EVIL } });
    expect(get.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await fetch(url('/api/auctions'), {
      method: 'OPTIONS',
      headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST' },
    });
    expect(pre.status).toBeGreaterThanOrEqual(400);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses an oversize webhook body without a server error', async () => {
    const res = await fetch(url(WEBHOOK_PATH), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(OVERSIZE_BYTES) }),
    });
    // 413 by the body limit; 429 if this source is already rate limited. Never accepted.
    expect([413, 429]).toContain(res.status);
  });

  it('survives malformed frames from an allowed origin', async (ctx) => {
    const wsUrl = url('/ws').replace(/^http/, 'ws');
    const origin = new URL(base ?? '').origin;
    if ((await open(wsUrl, origin)) === null) {
      console.info('no WebSocket gateway answers a same-origin upgrade on the target');
      ctx.skip();
      return;
    }
    const frames: Array<string | Uint8Array> = [
      '',
      '{',
      '[]',
      'null',
      '{"v":1}',
      '{"v":999,"t":"join"}',
      '{"v":1,"t":"bid","amountCents":-1}',
      new Uint8Array([0xff, 0xfe, 0x00, 0x01]),
      'x'.repeat(70 * 1024),
    ];
    for (const raw of frames) {
      const ws = await open(wsUrl, origin);
      if (ws === null) continue;
      ws.send(raw);
      await new Promise((r) => setTimeout(r, 50));
      ws.close();
    }
    const res = await fetch(url('/healthz'));
    expect(res.status).toBe(200);
  });
});

/** Opens a socket with the given Origin, or null when the upgrade is refused or times out. */
function open(wsUrl: string, origin: string): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    const Ctor = WebSocket as unknown as new (
      u: string,
      o: { headers: Record<string, string> },
    ) => WebSocket;
    const ws = new Ctor(wsUrl, { headers: { Origin: origin } });
    const timer = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 5000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}
