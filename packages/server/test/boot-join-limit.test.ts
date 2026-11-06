import { afterEach, describe, expect, it } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';

const base = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: 'test-admin-key-test-admin-key',
  PAYMENTS: 'fake',
  LOG_LEVEL: 'error',
};
const GHOST = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V';
const running: Composed[] = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.close(200);
});

async function boot(env: Record<string, string>): Promise<string> {
  const app = await composeServer({ ...base, ...env }, { sink: () => undefined });
  running.push(app);
  return `http://127.0.0.1:${await app.listen(0)}`;
}

const join = async (url: string, xff: string): Promise<number> => {
  const res = await fetch(`${url}/api/auctions/${GHOST}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
    body: JSON.stringify({ invite: 'x' }),
  });
  await res.arrayBuffer();
  return res.status;
};

describe('POST /join limiter (issue 1866)', () => {
  it('honours RATE_JOIN_* and ignores a spoofed x-forwarded-for with no trusted proxy', async () => {
    const url = await boot({ RATE_JOIN_BURST: '2', RATE_JOIN_PER_MIN: '1' });
    const statuses = [];
    for (const xff of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) statuses.push(await join(url, xff));
    expect(statuses).toEqual([404, 404, 429]);
  });

  it('keys by the forwarded address once a trusted proxy hop is configured', async () => {
    const url = await boot({
      RATE_JOIN_BURST: '1',
      RATE_JOIN_PER_MIN: '1',
      TRUSTED_PROXY_HOPS: '1',
    });
    expect(await join(url, '1.1.1.1')).toBe(404);
    expect(await join(url, '1.1.1.1')).toBe(429);
    expect(await join(url, '2.2.2.2')).toBe(404);
  });
});
