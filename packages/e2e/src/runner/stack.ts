import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Checkpoint } from '../dsl/types';
import { ManagedProcess, ProcessGroup, freePort, waitForHttp } from './process';

/**
 * Stack mode: the real server (fake payments, file store) and optionally the web dev server as
 * child processes on free ports. The server can be killed with SIGKILL and started again on the
 * same data folder. `checkpointKill` is passed to the server as GAVEL_CHECKPOINT_KILL; the server
 * must read that variable to die at a named checkpoint.
 */

export interface StackOptions {
  withWeb?: boolean;
  checkpointKill?: Checkpoint;
  /** Reuse a data folder to restart on the same store; a fresh temp folder otherwise. */
  dataDir?: string;
  env?: Record<string, string>;
}

export interface Stack {
  readonly serverUrl: string;
  readonly webUrl: string | undefined;
  readonly dataDir: string;
  /** SIGKILL the server process and wait for it to exit. */
  killServer(): Promise<void>;
  /** Start the server again on the same data folder and port, without the checkpoint kill. */
  restartServer(): Promise<void>;
  /** Kill everything this stack started and remove the temp data folder it created. */
  stop(): Promise<void>;
  alive(): string[];
}

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

  const serverEnv = (checkpoint: Checkpoint | undefined): NodeJS.ProcessEnv => ({
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(serverPort),
    PUBLIC_URL: serverUrl,
    TOKEN_SECRET: SECRET,
    ADMIN_KEY: ADMIN,
    STORE: 'file',
    DATA_DIR: dataDir,
    PAYMENTS: 'fake',
    ...opts.env,
    ...(checkpoint === undefined ? {} : { GAVEL_CHECKPOINT_KILL: checkpoint }),
  });
  const makeServer = (checkpoint: Checkpoint | undefined): ManagedProcess =>
    new ManagedProcess({
      name: 'server',
      command: process.execPath,
      args: [bin(serverDir, 'vite-node/vite-node.mjs'), 'src/main.ts'],
      cwd: serverDir,
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
            bin(webDir, 'vite/bin/vite.js'),
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
