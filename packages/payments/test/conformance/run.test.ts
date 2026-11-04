import { appendFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { FakePayPalServer } from '../../src/fake/server.js';
import { PayPalGateway } from '../../src/gateway.js';
import { TokenManager } from '../../src/oauth.js';
import { Transport } from '../../src/transport.js';
import {
  ASSERTIONS,
  formatDifferences,
  runConformance,
  type ConformanceTarget,
  type Difference,
} from './suite.js';

const noSleep = async (): Promise<void> => undefined;
let payer = 0;

/** The fake core behind the port, no HTTP. */
async function fakeDirect(): Promise<ConformanceTarget> {
  const core = new FakePayPalCore({ clock: new FakeClock(1_800_000_000_000) });
  return {
    label: 'fake (direct)',
    gateway: new FakeGateway(core),
    newAuthorization: async (cents) => ({
      holdId: `hold-${(payer += 1)}`,
      authId: core.createAuthorization(`payer-${payer}`, cents).id,
    }),
  };
}

/** The real gateway code over HTTP against the fake server. */
async function fakeHttp(): Promise<ConformanceTarget> {
  const server = new FakePayPalServer({ timers: { sleep: noSleep } });
  await server.start();
  const transport = new Transport({ sleep: noSleep });
  const auth = new TokenManager({
    transport,
    baseUrl: server.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  return {
    label: 'fake (http)',
    gateway: new PayPalGateway({ auth, fake: true }),
    newAuthorization: async (cents) => ({
      holdId: `hold-${(payer += 1)}`,
      authId: server.core.createAuthorization(`payer-${payer}`, cents).id,
    }),
    close: () => server.stop(),
  };
}

runConformance('fake (direct)', fakeDirect);
runConformance('fake (http)', fakeHttp);

/**
 * Sandbox run (manual workflow only, UNVERIFIED until the first run). It needs
 * sandbox credentials and one approved, unused authorization id per assertion
 * in CONFORMANCE_AUTH_IDS (comma separated, each for CONFORMANCE_AUTH_CENTS).
 * Differences are appended to src/fake/ASSUMPTIONS.md when CONFORMANCE_ASSUMPTIONS
 * names that file. The unit-test network guard (test/setup.ts) must allow the
 * sandbox host for this run.
 */
const env = process.env;
const sandboxReady =
  env['PAYPAL_ENV'] === 'sandbox' &&
  env['CONFORMANCE_MANUAL'] === '1' &&
  (env['PAYPAL_CLIENT_ID'] ?? '') !== '' &&
  (env['PAYPAL_CLIENT_SECRET'] ?? '') !== '' &&
  (env['CONFORMANCE_AUTH_IDS'] ?? '') !== '';

if (sandboxReady) {
  const differences: Difference[] = [];
  const queue = (env['CONFORMANCE_AUTH_IDS'] ?? '').split(',').filter((s) => s !== '');
  const cents = Number(env['CONFORMANCE_AUTH_CENTS'] ?? '30000');
  runConformance(
    'sandbox',
    async () => ({
      label: 'sandbox',
      gateway: new PayPalGateway({
        auth: new TokenManager({
          transport: new Transport(),
          baseUrl: env['PAYPAL_BASE_URL'] ?? 'https://api-m.sandbox.paypal.com',
          clientId: env['PAYPAL_CLIENT_ID'] ?? '',
          clientSecret: env['PAYPAL_CLIENT_SECRET'] ?? '',
        }),
        fake: false,
      }),
      newAuthorization: async (amount) => {
        const authId = queue.shift();
        if (authId === undefined) throw new Error('no unused authorization id left');
        if (amount !== cents) throw new Error(`sandbox authorizations are for ${cents} cents`);
        return { holdId: `conf-${authId}`, authId };
      },
    }),
    { onDifference: (d) => differences.push(d) },
  );
  afterAll(() => {
    const file = env['CONFORMANCE_ASSUMPTIONS'];
    if (file !== undefined && file !== '' && differences.length > 0) {
      appendFileSync(file, formatDifferences('sandbox', differences));
    }
  });
}

describe('conformance suite itself', () => {
  it('T-PAY-081 has a stable, unique set of assertions', () => {
    const ids = ASSERTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(7);
  });

  it('formats differences as sorted table rows and nothing when there are none', () => {
    expect(formatDifferences('sandbox', [])).toBe('');
    const md = formatDifferences('sandbox', [
      { id: 'C03', title: 't3', message: 'a | b\nc' },
      { id: 'C01', title: 't1', message: 'x' },
    ]);
    expect(md.indexOf('C01')).toBeLessThan(md.indexOf('C03'));
    expect(md).toContain('a / b c');
  });

  it('a failing assertion fails the run unless differences are being recorded', async () => {
    const broken = await fakeDirect();
    const wrong: ConformanceTarget = {
      ...broken,
      gateway: {
        createOrder: (i) => broken.gateway.createOrder(i),
        getOrder: (id) => broken.gateway.getOrder(id),
        authorizeOrder: (id, r) => broken.gateway.authorizeOrder(id, r),
        getHoldTruth: async (h) => ({
          ...(await broken.gateway.getHoldTruth(h)),
          status: 'DENIED',
        }),
        capture: (a, i) => broken.gateway.capture(a, i),
        voidAuthorization: (a, r) => broken.gateway.voidAuthorization(a, r),
        reauthorize: (a, i) => broken.gateway.reauthorize(a, i),
      },
    };
    const first = ASSERTIONS[0];
    if (first === undefined) throw new Error('no assertions');
    await expect(first.run(wrong)).rejects.toThrow();
  });
});
