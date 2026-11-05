import { test as base } from '@playwright/test';
import { ManagedProcess, freePort, waitForHttp } from '../runner/process';
import { startStack, type Stack } from '../runner/stack';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

/**
 * Base fixtures for the browser specs (R-QA-033, T-QA-045). A worker-scoped `stack` starts the real
 * server with fake payments, then the web dev server pointed at it, and stops both when the worker
 * ends. `mode` reads GAVEL_MODE: "fake" (default) or "sandbox".
 */

export type PaymentsMode = 'fake' | 'sandbox';

export interface BrowserStack {
  readonly serverUrl: string;
  readonly webUrl: string;
}

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

export function modeFromEnv(value: string | undefined): PaymentsMode {
  return value === 'sandbox' ? 'sandbox' : 'fake';
}

async function startBrowserStack(): Promise<{ stack: BrowserStack; stop: () => Promise<void> }> {
  const server: Stack = await startStack();
  const webDir = join(ROOT, 'packages', 'web');
  const port = await freePort();
  const webUrl = `http://127.0.0.1:${port}`;
  const wsUrl = server.serverUrl.replace(/^http/, 'ws');
  const viteBin = createRequire(join(webDir, 'package.json')).resolve('vite/bin/vite.js');
  const web = new ManagedProcess({
    name: 'web',
    command: process.execPath,
    args: [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    cwd: webDir,
    env: {
      ...process.env,
      VITE_API_BASE: server.serverUrl,
      VITE_WS_BASE: wsUrl,
      VITE_PAYPAL_CLIENT_ID: 'sandbox-client',
      VITE_SANDBOX: 'true',
      VITE_PAYMENTS: 'fake',
    },
  });
  try {
    web.start();
    await waitForHttp(webUrl, web);
  } catch (e) {
    await server.stop();
    throw e;
  }
  return {
    stack: { serverUrl: server.serverUrl, webUrl },
    stop: async () => {
      await web.kill();
      await server.stop();
    },
  };
}

interface WorkerFixtures {
  stack: BrowserStack;
  mode: PaymentsMode;
}

export const test = base.extend<object, WorkerFixtures>({
  mode: [modeFromEnv(process.env['GAVEL_MODE']), { scope: 'worker' }],
  stack: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const started = await startBrowserStack();
      await use(started.stack);
      await started.stop();
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
