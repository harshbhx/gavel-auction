// Boots the built host (packages/server/dist/main.js) on a loopback port with a throwaway
// configuration and checks GET /healthz. Also checks that a missing variable exits 78 and names
// the variable (R-QA-043). Secrets are generated here for this process only and never printed.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../packages/server/dist/main.js', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function run(env) {
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { text: '' };
  child.stdout.on('data', (d) => (out.text += d));
  child.stderr.on('data', (d) => (out.text += d));
  return { child, out };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkMissingVariable() {
  const { child, out } = run({ PATH: process.env.PATH ?? '' });
  const code = await new Promise((r) => child.once('exit', r));
  if (code !== 78) throw new Error(`expected exit 78 without configuration, got ${code}`);
  if (!out.text.includes('TOKEN_SECRET'))
    throw new Error('exit 78 message does not name TOKEN_SECRET');
  console.log('ok: missing configuration exits 78 and names the variable');
}

/**
 * Boots the bundle with `env` on a free port and waits for 200 on every path in `paths`; `after`
 * runs while the host is still up.
 */
async function boot(label, makeEnv, paths, after) {
  const port = await freePort();
  const { child, out } = run({
    PATH: process.env.PATH ?? '',
    PORT: String(port),
    ...makeEnv(port),
  });
  let exited = false;
  child.once('exit', () => (exited = true));
  try {
    for (const path of paths) {
      let ok = false;
      for (let i = 0; i < 100 && !exited && !ok; i += 1) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}${path}`);
          ok = res.status === 200;
        } catch {
          // not listening yet
        }
        if (!ok) await sleep(100);
      }
      if (!ok)
        throw new Error(
          `${label}: ${path} never answered 200; host output:\n${out.text.slice(-1500)}`,
        );
    }
    if (after) after();
    console.log(`ok: ${label} boots and ${paths.join(', ')} answer 200`);
  } finally {
    child.kill('SIGTERM');
  }
}

async function checkHealthz() {
  await boot(
    'dist (development, memory store)',
    (port) => ({
      NODE_ENV: 'development',
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      TOKEN_SECRET: randomBytes(32).toString('hex'),
      ADMIN_KEY: randomBytes(24).toString('hex'),
      PAYMENTS: 'fake',
      PAYPAL_ENV: 'sandbox',
      STORE: 'memory',
    }),
    ['/healthz'],
  );
}

/**
 * The Render configuration (render.yaml): production, file store on an absolute data directory,
 * sandbox payments with dummy PayPal values, one trusted proxy hop and an https public URL. No
 * payment call is made, so the dummy values never leave the process.
 */
async function checkProduction() {
  const dataDir = mkdtempSync(join(tmpdir(), 'gavel-smoke-'));
  try {
    await boot(
      'dist (production, file store, sandbox payments)',
      () => {
        const env = {
          NODE_ENV: 'production',
          PUBLIC_URL: 'https://gavel-smoke.invalid',
          TRUSTED_PROXY_HOPS: '1',
          STORE: 'file',
          DATA_DIR: dataDir,
          PAYMENTS: 'sandbox',
          PAYPAL_ENV: 'sandbox',
        };
        // Throwaway values for this process only; the names are listed apart from the values.
        for (const [name, bytes] of [
          ['PAYPAL_CLIENT_ID', 6],
          ['PAYPAL_CLIENT_SECRET', 24],
          ['PAYPAL_WEBHOOK_ID', 6],
          ['TOKEN_SECRET', 32],
          ['ADMIN_KEY', 24],
        ]) {
          env[name] = randomBytes(bytes).toString('hex');
        }
        return env;
      },
      ['/healthz', '/readyz'],
      () => {
        if (!existsSync(join(dataDir, 'gavel.lock')))
          throw new Error('the data directory lock file was not created');
      },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

await checkMissingVariable();
await checkHealthz();
await checkProduction();
