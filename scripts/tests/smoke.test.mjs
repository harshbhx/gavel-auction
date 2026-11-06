import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';

/** Starts a stub host. `routes` maps "METHOD path" to a status; anything else answers 404. */
function startStub(routes) {
  const server = createServer((req, res) => {
    res.statusCode = routes[`${req.method} ${req.url}`] ?? 404;
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runSmoke(url, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['scripts/smoke.sh', url], {
      env: { PATH: process.env.PATH, SMOKE_RETRIES: '1', SMOKE_TIMEOUT: '5', ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (status) => resolve({ status, out }));
  });
}

const HEALTHY = {
  'GET /healthz': 200,
  'GET /warmup': 200,
  'POST /webhooks/paypal': 400,
  'POST /api/auctions': 401,
};

function without(routes, key) {
  return Object.fromEntries(Object.entries(routes).filter(([k]) => k !== key));
}

describe('smoke.sh', () => {
  const servers = [];
  const host = async (routes) => {
    const s = await startStub(routes);
    servers.push(s);
    return `http://127.0.0.1:${s.address().port}`;
  };
  after(() => servers.forEach((s) => s.close()));

  it('passes against a host that serves every required route', async () => {
    const r = await runSmoke(await host(HEALTHY));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /smoke passed/);
  });

  it('fails when POST /api/auctions answers 404', async () => {
    const routes = without(HEALTHY, 'POST /api/auctions');
    const r = await runSmoke(await host(routes));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /SMOKE FAIL: POST \/api\/auctions answered 404/);
    assert.doesNotMatch(r.out, /smoke passed/);
  });

  it('fails when GET /warmup answers 404', async () => {
    const routes = without(HEALTHY, 'GET /warmup');
    const r = await runSmoke(await host(routes));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /SMOKE FAIL: GET \/warmup answered 404/);
  });

  it('skips missing routes only with the explicit local opt-in', async () => {
    const url = await host({ 'GET /healthz': 200, 'POST /webhooks/paypal': 400 });
    const r = await runSmoke(url, { SMOKE_ALLOW_MISSING_ROUTES: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /skip GET \/warmup 404/);
    assert.match(r.out, /skip POST \/api\/auctions 404/);
  });
});
