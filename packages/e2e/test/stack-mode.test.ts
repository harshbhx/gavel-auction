import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { startStack, type Stack } from '../src/runner/stack';

// T-QA-027 (R-QA-025, R-QA-027): the stack runner starts the real server, kills it with SIGKILL and
// starts it again on the same data folder; the server reads GAVEL_CHECKPOINT_KILL.

const running: Stack[] = [];
afterEach(async () => {
  for (const s of running.splice(0)) await s.stop();
});

async function healthy(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/healthz`)).ok;
  } catch {
    return false;
  }
}

describe('stack mode', () => {
  it('boots with a checkpoint armed, survives kill and restart on the same store, leaves nothing behind', async () => {
    const stack = await startStack({ checkpointKill: 'after_capture_recorded' });
    running.push(stack);
    expect(await healthy(stack.serverUrl)).toBe(true);
    expect(stack.alive()).toEqual(['server']);

    await stack.killServer();
    expect(await healthy(stack.serverUrl)).toBe(false);
    expect(stack.alive()).toEqual([]);

    await stack.restartServer();
    expect(await healthy(stack.serverUrl)).toBe(true);

    const dir = stack.dataDir;
    await stack.stop();
    expect(stack.alive()).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  }, 90_000);

  it('keeps the fake PayPal and its state alive when the server is killed', async () => {
    const stack = await startStack({ externalFake: true });
    running.push(stack);
    expect(stack.alive().sort()).toEqual(['fake-paypal', 'server']);
    const control = stack.fakeControlUrl ?? '';
    const armed = await fetch(`${control}/__fake/inject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'http_500', op: 'capture', times: 2 }),
    });
    expect(armed.status).toBe(200);
    const state = async (): Promise<{ pendingFaults: unknown[] }> =>
      (await (await fetch(`${control}/__fake/state`)).json()) as { pendingFaults: unknown[] };
    const before = await state();
    expect(before.pendingFaults).toHaveLength(1);

    await stack.killServer();
    expect(stack.alive()).toEqual(['fake-paypal']);
    expect(await state()).toEqual(before);

    await stack.restartServer();
    expect(await healthy(stack.serverUrl)).toBe(true);
    expect(await state()).toEqual(before);

    await stack.stop();
    expect(stack.alive()).toEqual([]);
  }, 90_000);

  it('refuses to boot on a checkpoint name it does not know', async () => {
    await expect(startStack({ env: { GAVEL_CHECKPOINT_KILL: 'after_lunch' } })).rejects.toThrow(
      /GAVEL_CHECKPOINT_KILL/,
    );
  }, 90_000);
});
