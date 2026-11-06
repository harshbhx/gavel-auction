import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeServer } from '../src/boot/compose';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const base = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: 'test-admin-key-test-admin-key',
  PAYMENTS: 'fake',
  LOG_LEVEL: 'error',
  STORE: 'postgres',
};

describe('STORE=postgres at boot (#1733)', () => {
  it('tries the database instead of refusing the store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-pg-'));
    dirs.push(dir);
    const boot = composeServer(
      { ...base, DATA_DIR: dir, DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' },
      { sink: () => undefined },
    );
    const err = await boot.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('not available in this build');
  });

  const url = process.env.GAVEL_TEST_DATABASE_URL;
  (url === undefined ? it.skip : it)('boots on a real database and serves health', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-pg-'));
    dirs.push(dir);
    const app = await composeServer(
      { ...base, DATA_DIR: dir, DATABASE_URL: url ?? '' },
      { sink: () => undefined },
    );
    const port = await app.listen(0);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    await app.close();
  });
});
