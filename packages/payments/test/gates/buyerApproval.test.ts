import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  approveInBrowser,
  BuyerApprovalError,
  comparePayer,
  isSandboxApproveUrl,
  missingBuyerSecrets,
  type BrowserLauncher,
  type LocatorLike,
  type PageLike,
} from '../../gates/buyerApproval.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gavel-buyer-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Script {
  /** Selectors for which waitForSelector rejects. */
  missing?: readonly string[];
  /** Whether #password is still visible after login. */
  passwordStays?: boolean;
  confirmMissing?: boolean;
  noReturn?: boolean;
}

function launcher(script: Script, log: string[]): BrowserLauncher {
  const locator = (selector: string): LocatorLike => {
    const l: LocatorLike = {
      first: () => l,
      isVisible: () =>
        Promise.resolve(selector === '#password' ? script.passwordStays === true : true),
      click: () => {
        log.push(`click ${selector.slice(0, 12)}`);
        return Promise.resolve();
      },
      waitFor: () =>
        selector.includes('Complete Purchase') && script.confirmMissing === true
          ? Promise.reject(new Error('timeout'))
          : Promise.resolve(),
    };
    return l;
  };
  const page: PageLike = {
    goto: () => Promise.resolve(),
    locator,
    fill: (selector, value) => {
      log.push(
        `fill ${selector.slice(0, 8).trim()} ${value === 'pw-secret' ? '<password>' : '<email>'}`,
      );
      return Promise.resolve();
    },
    waitForSelector: (selector) =>
      (script.missing ?? []).some((m) => selector.includes(m))
        ? Promise.reject(new Error('timeout'))
        : Promise.resolve(),
    waitForURL: () =>
      script.noReturn === true ? Promise.reject(new Error('timeout')) : Promise.resolve(),
    waitForTimeout: () => Promise.resolve(),
    waitForLoadState: () => Promise.resolve(),
    screenshot: ({ path }) => {
      log.push(`shot ${path.split('/').pop() ?? ''}`);
      return Promise.resolve();
    },
    url: () => 'https://example.com/return',
  };
  return {
    launch: () =>
      Promise.resolve({
        newPage: () => Promise.resolve(page),
        close: () => {
          log.push('closed');
          return Promise.resolve();
        },
      }),
  };
}

function opts(script: Script, log: string[]) {
  return {
    approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=T',
    credentials: { email: 'buyer@example.test', password: 'pw-secret' },
    returnPattern: /example\.com/,
    shotDir: dir,
    shotPrefix: 'run-wallet',
    launcher: launcher(script, log),
    timeoutMs: 1000,
  };
}

describe('approveInBrowser', () => {
  it('signs in, confirms and closes the browser', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({}, log));
    expect(log.filter((l) => l.startsWith('fill'))).toEqual([
      'fill #email, <email>',
      'fill #passwor <password>',
    ]);
    expect(log.some((l) => l.includes('review'))).toBe(true);
    expect(log.some((l) => l.includes('returned'))).toBe(true);
    expect(log[log.length - 1]).toBe('closed');
  });

  it.each([
    ['login form', { missing: ['#email'] }, 'no email field'],
    ['password step', { missing: ['#password'] }, 'SANDBOX_BUYER_EMAIL is a sandbox buyer'],
    ['login', { passwordStays: true }, 'SANDBOX_BUYER_PASSWORD'],
    ['review page', { confirmMissing: true }, 'no confirm button'],
    ['confirm', { noReturn: true }, 'never reached the return URL'],
  ] as const)('fails at %s with a clear message and still closes', async (stage, script, text) => {
    const log: string[] = [];
    const err = await approveInBrowser(opts(script, log)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BuyerApprovalError);
    expect((err as BuyerApprovalError).stage).toBe(stage);
    expect((err as Error).message).toContain(text);
    expect((err as Error).message).not.toContain('pw-secret');
    expect(log[log.length - 1]).toBe('closed');
  });
});

describe('helpers', () => {
  it('lists the missing secret names only', () => {
    expect(missingBuyerSecrets({ SANDBOX_BUYER_EMAIL: 'x@y.z' })).toEqual([
      'SANDBOX_BUYER_PASSWORD',
    ]);
    expect(missingBuyerSecrets({})).toEqual(['SANDBOX_BUYER_EMAIL', 'SANDBOX_BUYER_PASSWORD']);
  });
  it('compares the payer with the buyer', () => {
    expect(comparePayer('A@x.test', 'a@X.test')).toBe('match');
    expect(comparePayer('seller@x.test', 'buyer@x.test')).toBe('mismatch');
    expect(comparePayer(undefined, 'buyer@x.test')).toBe('unknown');
  });
  it('accepts only the sandbox approval host, and loopback for --fake', () => {
    expect(isSandboxApproveUrl('https://www.sandbox.paypal.com/checkoutnow?token=T', false)).toBe(
      true,
    );
    expect(isSandboxApproveUrl('https://www.paypal.com/checkoutnow', false)).toBe(false);
    expect(isSandboxApproveUrl('http://127.0.0.1:9/x', false)).toBe(false);
    expect(isSandboxApproveUrl('http://127.0.0.1:9/x', true)).toBe(true);
  });
});
