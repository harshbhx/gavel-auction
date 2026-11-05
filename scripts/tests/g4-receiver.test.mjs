// R6-E01 and R6-E02: the G4 receiver stores only PayPal-shaped deliveries, caps the log and
// answers GET and DELETE with bounded work.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import worker from '../../tools/g4-receiver/worker.js';

const TOKEN = 't'.repeat(40);

function fakeKv() {
  const store = new Map();
  const calls = { list: 0, get: 0, put: 0, delete: 0 };
  return {
    store,
    calls,
    async list({ prefix, limit }) {
      calls.list += 1;
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const page = names.slice(0, limit ?? 1000);
      return { keys: page.map((name) => ({ name })), list_complete: page.length === names.length };
    },
    async get(key) {
      calls.get += 1;
      return store.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      calls.put += 1;
      store.set(key, { value, options });
    },
    async delete(key) {
      calls.delete += 1;
      store.delete(key);
    },
  };
}

const paypalHeaders = {
  'content-type': 'application/json',
  'paypal-transmission-id': 'tid-1',
  'paypal-transmission-time': '2026-11-05T00:00:00Z',
  'paypal-transmission-sig': 'sig',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
  'paypal-auth-algo': 'SHA256withRSA',
};
const goodBody = JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' });

function post(env, body, headers = paypalHeaders) {
  return worker.fetch(new Request('https://r.test/hook', { method: 'POST', headers, body }), env);
}

describe('g4 receiver', () => {
  it('stores a PayPal-shaped delivery with metadata and without client address headers', async () => {
    const env = { LOG: fakeKv(), LOG_TOKEN: TOKEN };
    const res = await post(env, goodBody, {
      ...paypalHeaders,
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '203.0.113.9',
    });
    assert.equal(res.status, 200);
    const [{ value, options }] = [...env.LOG.store.values()];
    const entry = JSON.parse(value);
    assert.equal(entry.headers['cf-connecting-ip'], undefined);
    assert.equal(entry.headers['x-forwarded-for'], undefined);
    assert.equal(entry.headers['paypal-transmission-id'], 'tid-1');
    assert.equal(options.metadata.transmissionId, 'tid-1');
    assert.ok(options.expirationTtl <= 7 * 24 * 3600);
  });

  it('does not store junk posts', async () => {
    const env = { LOG: fakeKv(), LOG_TOKEN: TOKEN };
    const junk = [
      post(env, '{}', { 'content-type': 'application/json' }),
      post(env, goodBody, { 'content-type': 'application/json' }),
      post(env, goodBody, { ...paypalHeaders, 'content-type': 'text/plain' }),
      post(env, '{}', paypalHeaders),
      post(env, 'not json', paypalHeaders),
      post(env, '[1]', paypalHeaders),
    ];
    for (const res of await Promise.all(junk)) assert.equal(res.status, 400);
    assert.equal(env.LOG.store.size, 0);
  });

  it('refuses new deliveries once the log is full', async () => {
    const env = { LOG: fakeKv(), LOG_TOKEN: TOKEN };
    let last = 200;
    for (let i = 0; i < 60; i += 1) last = (await post(env, goodBody)).status;
    assert.equal(last, 429);
    assert.equal(env.LOG.store.size, 40);
  });

  it('serves and clears the log with a bounded number of KV calls', async () => {
    const env = { LOG: fakeKv(), LOG_TOKEN: TOKEN };
    for (let i = 0; i < 100; i += 1) {
      env.LOG.store.set(`d:2026-11-05T00:00:${String(i).padStart(2, '0')}:x`, {
        value: JSON.stringify({ headers: {}, rawBody: 'x' }),
      });
    }
    const get = await worker.fetch(new Request(`https://r.test/log?token=${TOKEN}`), env);
    assert.equal(get.status, 200);
    assert.equal((await get.text()).trim().split('\n').length, 40);
    assert.ok(env.LOG.calls.get <= 40);
    const del = await worker.fetch(
      new Request(`https://r.test/log?token=${TOKEN}`, { method: 'DELETE' }),
      env,
    );
    assert.equal(await del.text(), 'cleared 40 more 1');
    assert.equal(env.LOG.store.size, 60);
    assert.ok(env.LOG.calls.delete <= 40);
  });

  it('rejects a wrong token', async () => {
    const env = { LOG: fakeKv(), LOG_TOKEN: TOKEN };
    const res = await worker.fetch(new Request('https://r.test/log?token=nope'), env);
    assert.equal(res.status, 401);
  });
});
