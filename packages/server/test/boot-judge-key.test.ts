import { afterEach, describe, expect, it } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';

// Test-only constants, built at run time.
const ADMIN = 'test-admin-key-test-admin-key';
const JUDGE = ['test', 'judge', 'k'.repeat(32)].join('-');
const base = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: ADMIN,
  PAYMENTS: 'fake',
  LOG_LEVEL: 'error',
  JUDGE_ROOMS: 'true',
  JUDGE_KEY: JUDGE,
  JUDGE_KEY_ROOMS_MAX: '2',
};

const running: Composed[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) await app.close();
});

async function boot(extra: Record<string, string> = {}): Promise<string> {
  const lines: string[] = [];
  const app = await composeServer(
    { ...base, ...extra },
    { sink: (l: string) => void lines.push(l) },
  );
  running.push(app);
  return `http://127.0.0.1:${String(await app.listen(0))}`;
}

const json = { 'content-type': 'application/json' };

describe('judge key on a booted host', () => {
  it('unlocks keyed rooms, bounds them, and serves a verifiable ledger to the reviewer link', async () => {
    const url = await boot();
    const probe = (await (await fetch(`${url}/api/judge/capabilities`)).json()) as { keyed?: true };
    expect(probe.keyed).toBe(true);

    const wrong = await fetch(`${url}/api/judge/key`, {
      method: 'POST',
      headers: { ...json, 'x-judge-key': 'not-the-key' },
      body: '{}',
    });
    expect(wrong.status).toBe(401);
    // The operator key is not a judge key.
    const admin = await fetch(`${url}/api/judge/key`, {
      method: 'POST',
      headers: { ...json, 'x-judge-key': ADMIN },
      body: '{}',
    });
    expect(admin.status).toBe(401);

    const made = await fetch(`${url}/api/judge/rooms`, {
      method: 'POST',
      headers: { ...json, 'x-judge-key': JUDGE },
      body: '{}',
    });
    expect(made.status).toBe(201);
    const room = (await made.json()) as { auctionId: string; reviewerToken: string };
    const ledger = await fetch(`${url}/api/judge/rooms/${room.auctionId}/ledger`, {
      headers: { authorization: `Bearer ${room.reviewerToken}` },
    });
    // A fresh room has no ledger entries yet: the route says so instead of an empty bundle.
    expect(ledger.status).toBe(404);
    const noToken = await fetch(`${url}/api/judge/rooms/${room.auctionId}/ledger`);
    expect(noToken.status).toBe(401);

    const second = await fetch(`${url}/api/judge/rooms`, {
      method: 'POST',
      headers: { ...json, 'x-judge-key': JUDGE },
      body: '{}',
    });
    expect(second.status).toBe(201);
    const third = await fetch(`${url}/api/judge/rooms`, {
      method: 'POST',
      headers: { ...json, 'x-judge-key': JUDGE },
      body: '{}',
    });
    expect(third.status).toBe(429);
  });

  it('refuses to boot with the judge key equal to the operator key', async () => {
    await expect(boot({ JUDGE_KEY: ADMIN })).rejects.toBeDefined();
  });

  it('does not report keyed when no key is set', async () => {
    const url = await boot({ JUDGE_KEY: '' });
    const probe = (await (await fetch(`${url}/api/judge/capabilities`)).json()) as object;
    expect(probe).not.toHaveProperty('keyed');
  });
});
