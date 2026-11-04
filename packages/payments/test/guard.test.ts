import { describe, expect, it } from 'vitest';
import { PaymentsConfigError } from '../src/config.js';
import {
  assertApproveUrl,
  assertSandboxConfig,
  assertSandboxEnv,
  assertSandboxUrl,
} from '../src/guard.js';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof PaymentsConfigError) return e.code;
    throw e;
  }
  return undefined;
}

describe('T-PAY-003 sandbox guard', () => {
  it('refuses a live environment', () => {
    expect(code(() => assertSandboxEnv('live'))).toBe('payments_not_sandbox');
    expect(code(() => assertSandboxEnv(undefined))).toBe('payments_not_sandbox');
    expect(code(() => assertSandboxEnv('Sandbox'))).toBe('payments_not_sandbox');
    expect(code(() => assertSandboxEnv('sandbox'))).toBeUndefined();
  });

  it('refuses the live host and host suffix attacks', () => {
    const bad = [
      'https://api-m.paypal.com',
      'https://api.paypal.com',
      'https://api-m.sandbox.paypal.com.evil.test',
      'https://evil.test/api-m.sandbox.paypal.com',
      'https://evilapi-m.sandbox.paypal.com',
      'https://sandbox.paypal.com',
      'https://api-m.sandbox.paypal.com@evil.test',
      'https://api-m.sandbox.paypal.com:444',
      'https://user:pw@api-m.sandbox.paypal.com',
      'not a url',
      '',
    ];
    for (const url of bad) {
      expect(
        code(() => assertSandboxUrl(url, { fake: false })),
        url,
      ).toBe('payments_not_sandbox');
      expect(
        code(() => assertSandboxUrl(url, { fake: true })),
        url,
      ).toBe('payments_not_sandbox');
    }
  });

  it('refuses the http scheme on the sandbox host', () => {
    expect(code(() => assertSandboxUrl('http://api-m.sandbox.paypal.com', { fake: false }))).toBe(
      'payments_not_sandbox',
    );
    expect(code(() => assertSandboxUrl('http://api-m.sandbox.paypal.com', { fake: true }))).toBe(
      'payments_not_sandbox',
    );
  });

  it('accepts the sandbox host over https', () => {
    const u = assertSandboxUrl('https://api-m.sandbox.paypal.com', { fake: false });
    expect(u.hostname).toBe('api-m.sandbox.paypal.com');
    expect(
      code(() => assertSandboxUrl('https://api-m.sandbox.paypal.com:443/x', { fake: false })),
    ).toBeUndefined();
  });

  it('assertSandboxConfig checks env and url together', () => {
    const ok = { env: 'sandbox', baseUrl: 'https://api-m.sandbox.paypal.com', fake: false };
    expect(code(() => assertSandboxConfig(ok))).toBeUndefined();
    expect(code(() => assertSandboxConfig({ ...ok, env: 'live' }))).toBe('payments_not_sandbox');
    expect(code(() => assertSandboxConfig({ ...ok, baseUrl: 'https://api-m.paypal.com' }))).toBe(
      'payments_not_sandbox',
    );
  });
});

describe('T-PAY-004 loopback only in fake mode', () => {
  const loopback = ['http://127.0.0.1:4010', 'http://localhost:4010', 'http://[::1]:4010'];

  it('refuses loopback without fake mode', () => {
    for (const url of loopback) {
      expect(
        code(() => assertSandboxUrl(url, { fake: false })),
        url,
      ).toBe('payments_not_sandbox');
    }
  });

  it('allows loopback with fake mode', () => {
    for (const url of loopback) {
      expect(
        code(() => assertSandboxUrl(url, { fake: true })),
        url,
      ).toBeUndefined();
    }
  });

  it('does not treat lookalike loopback hosts as loopback', () => {
    for (const url of [
      'http://127.0.0.1.evil.test',
      'http://localhost.evil.test',
      'http://0.0.0.0',
    ]) {
      expect(
        code(() => assertSandboxUrl(url, { fake: true })),
        url,
      ).toBe('payments_not_sandbox');
    }
  });
});

describe('T-PAY-005 approve link host', () => {
  it('refuses a non-sandbox approve host', () => {
    const bad = [
      'https://www.paypal.com/checkoutnow?token=X',
      'https://www.sandbox.paypal.com.evil.test/checkoutnow',
      'http://www.sandbox.paypal.com/checkoutnow',
      'https://evil.test/www.sandbox.paypal.com',
      'garbage',
    ];
    for (const url of bad) {
      expect(
        code(() => assertApproveUrl(url, { fake: false })),
        url,
      ).toBe('payments_not_sandbox');
    }
  });

  it('accepts the sandbox checkout host and fake loopback', () => {
    expect(
      code(() =>
        assertApproveUrl('https://www.sandbox.paypal.com/checkoutnow?token=X', { fake: false }),
      ),
    ).toBeUndefined();
    expect(
      code(() => assertApproveUrl('http://127.0.0.1:4010/approve/O-1', { fake: true })),
    ).toBeUndefined();
    expect(code(() => assertApproveUrl('http://127.0.0.1:4010/approve/O-1', { fake: false }))).toBe(
      'payments_not_sandbox',
    );
  });
});
