import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Checkpoint } from '../dsl/types';
import { ManagedProcess, ProcessGroup, freePort, waitForHttp } from './process';

/**
 * Stack mode: the real server (fake payments, file store) and optionally the web dev server as
 * child processes on free ports. The server can be killed with SIGKILL and started again on the
 * same data folder. `checkpointKill` is passed to the server as GAVEL_CHECKPOINT_KILL; the server
 * must read that variable to die at a named checkpoint.
 *
 * With `externalFake` the fake PayPal runs as its own process, so a SIGKILL of the server leaves
 * the fake and everything it holds (orders, authorizations, captures, idempotency keys) alive.
 * The server then starts through `server-entry.ts`, which points the fake PayPal adapter at that
 * process and adds the test-only enrol route.
 */

export interface StackOptions {
  withWeb?: boolean;
  checkpointKill?: Checkpoint;
  /** Reuse a data folder to restart on the same store; a fresh temp folder otherwise. */
  dataDir?: string;
  env?: Record<string, string>;
  /** Run the fake PayPal in a process of its own, outside the server process. */
  externalFake?: boolean;
  /**
   * Real PayPal sandbox payments (PAYMENTS=sandbox). The server starts through
   * `server-entry-sandbox.ts`; PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID
   * come from the environment of this process. Not combined with `externalFake`.
   */
  sandbox?: boolean;
}

export interface Stack {
  readonly serverUrl: string;
  readonly webUrl: string | undefined;
  readonly dataDir: string;
  /** Admin key the server was started with. */
  readonly adminKey: string;
  /** Base URL of the fake PayPal control and snapshot routes; set with `externalFake`. */
  readonly fakeControlUrl: string | undefined;
  /** Process id of the server process that runs now; changes after a restart. */
  serverPid(): number | undefined;
  /** Resolves when the current server process has exited, for a checkpoint kill. */
  serverExited(): Promise<number | null>;
  /** SIGKILL the server process and wait for it to exit. */
  killServer(): Promise<void>;
  /** Start the server again on the same data folder and port, without the checkpoint kill. */
  restartServer(): Promise<void>;
  /** Kill everything this stack started and remove the temp data folder it created. */
  stop(): Promise<void>;
  alive(): string[];
}

const E2E_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const SECRET = 'e2e-token-secret-0123456789-abcdefghij';
const ADMIN = 'e2e-admin-key-0123456789-abcdef';

function bin(pkgDir: string, spec: string): string {
  return createRequire(join(pkgDir, 'package.json')).resolve(spec);
}

export async function startStack(opts: StackOptions = {}): Promise<Stack> {
  const group = new ProcessGroup();
  const ownsData = opts.dataDir === undefined;
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'gavel-stack-'));
  const serverPort = await freePort();
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const serverDir = join(ROOT, 'packages', 'server');

  const viteNode = bin(serverDir, 'vite-node/vite-node.mjs');
  const external = opts.externalFake === true;
  const sandbox = opts.sandbox === true;
  if (sandbox && external) throw new Error('sandbox and externalFake cannot be combined');
  const fakePort = external ? await freePort() : 0;
  const controlPort = external ? await freePort() : 0;
  const fakeUrl = external ? `http://127.0.0.1:${fakePort}` : undefined;
  const fakeControlUrl = external ? `http://127.0.0.1:${controlPort}` : undefined;

  // The buyer logins are for the harness browser only; the server process never gets them.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !(sandbox && /^SANDBOX_/.test(k))),
  );
  const serverEnv = (checkpoint: Checkpoint | undefined): NodeJS.ProcessEnv => ({
    ...inherited,
    NODE_ENV: 'test',
    PORT: String(serverPort),
    PUBLIC_URL: serverUrl,
    TOKEN_SECRET: SECRET,
    ADMIN_KEY: ADMIN,
    STORE: 'file',
    DATA_DIR: dataDir,
    PAYMENTS: sandbox ? 'sandbox' : 'fake',
    PAYPAL_ENV: 'sandbox',
    ...(external && fakeUrl !== undefined && fakeControlUrl !== undefined
      ? { GAVEL_E2E_FAKE_URL: fakeUrl, GAVEL_E2E_FAKE_CONTROL_URL: fakeControlUrl }
      : {}),
    ...opts.env,
    ...(checkpoint === undefined ? {} : { GAVEL_CHECKPOINT_KILL: checkpoint }),
  });
  const makeServer = (checkpoint: Checkpoint | undefined): ManagedProcess =>
    new ManagedProcess({
      name: 'server',
      command: process.execPath,
      args: sandbox
        ? [viteNode, join(E2E_DIR, 'src', 'runner', 'server-entry-sandbox.ts')]
        : external
          ? [viteNode, join(E2E_DIR, 'src', 'runner', 'server-entry.ts')]
          : [viteNode, 'src/main.ts'],
      cwd: external || sandbox ? E2E_DIR : serverDir,
      env: serverEnv(checkpoint),
    });

  let server = group.add(makeServer(opts.checkpointKill));
  let webUrl: string | undefined;
  const fail = async (e: unknown): Promise<never> => {
    await group.killAll();
    if (ownsData) rmSync(dataDir, { recursive: true, force: true });
    throw e;
  };

  try {
    if (external) {
      const fake = group.add(
        new ManagedProcess({
          name: 'fake-paypal',
          command: process.execPath,
          args: [viteNode, join(E2E_DIR, 'src', 'runner', 'fake-process.ts')],
          cwd: E2E_DIR,
          env: {
            ...process.env,
            GAVEL_E2E_FAKE_PORT: String(fakePort),
            GAVEL_E2E_CONTROL_PORT: String(controlPort),
          },
        }),
      );
      fake.start();
      await waitForHttp(`${fakeControlUrl ?? ''}/__fake/state`, fake);
    }
    server.start();
    await waitForHttp(`${serverUrl}/healthz`, server);
    if (opts.withWeb === true) {
      const webDir = join(ROOT, 'packages', 'web');
      const webPort = await freePort();
      webUrl = `http://127.0.0.1:${webPort}`;
      const web = group.add(
        new ManagedProcess({
          name: 'web',
          command: process.execPath,
          args: [
            join(dirname(bin(webDir, 'vite/package.json')), 'bin', 'vite.js'),
            '--host',
            '127.0.0.1',
            '--port',
            String(webPort),
            '--strictPort',
          ],
          cwd: webDir,
          env: { ...process.env, VITE_API_URL: serverUrl },
        }),
      );
      web.start();
      await waitForHttp(webUrl, web);
    }
  } catch (e) {
    return fail(e);
  }

  return {
    serverUrl,
    webUrl,
    dataDir,
    adminKey: ADMIN,
    fakeControlUrl,
    serverPid: () => server.pid,
    serverExited: () => server.exited(),
    killServer: () => server.kill(),
    restartServer: async () => {
      await server.kill();
      server = group.add(makeServer(undefined));
      server.start();
      await waitForHttp(`${serverUrl}/healthz`, server);
    },
    stop: async () => {
      await group.killAll();
      if (ownsData) rmSync(dataDir, { recursive: true, force: true });
    },
    alive: () => group.alive.map((p) => p.name),
  };
}
