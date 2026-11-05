// Boots the built host (packages/server/dist/main.js) on a loopback port with a throwaway
// configuration and checks GET /healthz. Also checks that a missing variable exits 78 and names
// the variable (R-QA-043). Secrets are generated here for this process only and never printed.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
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

async function checkHealthz() {
  const port = await freePort();
  const { child, out } = run({
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'development',
    PORT: String(port),
    PUBLIC_URL: `http://127.0.0.1:${port}`,
    TOKEN_SECRET: randomBytes(32).toString('hex'),
    ADMIN_KEY: randomBytes(24).toString('hex'),
    PAYMENTS: 'fake',
    PAYPAL_ENV: 'sandbox',
    STORE: 'memory',
  });
  let exited = false;
  child.once('exit', () => (exited = true));
  try {
    for (let i = 0; i < 100 && !exited; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (res.status === 200) {
          console.log('ok: dist boots and /healthz is 200');
          return;
        }
      } catch {
        // not listening yet
      }
      await sleep(100);
    }
    throw new Error(`/healthz never answered 200; host output:\n${out.text.slice(-1500)}`);
  } finally {
    child.kill('SIGTERM');
  }
}

await checkMissingVariable();
await checkHealthz();
