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
  type FrameLike,
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
  /** Field kinds that never become visible. */
  missing?: readonly ('email' | 'password' | 'next' | 'confirm')[];
  /** Whether the password field is visible before Next is clicked (one-page layout). */
  onePage?: boolean;
  /** Whether the password field is still visible after login. */
  passwordStays?: boolean;
  styleFails?: boolean;
  shotFails?: boolean;
  noReturn?: boolean;
  /** The bot-check input becomes visible after Next instead of the password field. */
  captcha?: boolean;
  /** Put the email field in a second frame instead of the main one. */
  emailInFrame?: boolean;
  /** An overlay blocks normal clicks; only forced clicks go through. */
  intercepted?: boolean;
  /** Enter in the password field does not submit the form. */
  enterFails?: boolean;
  /** Both normal and forced clicks are blocked; only a dispatched event works. */
  forceFails?: boolean;
}

function launcher(script: Script, log: string[]): BrowserLauncher {
  let masked = false;
  let nextClicked = false;
  let loggedIn = false;
  const kind = (selector: string): string => {
    if (selector.includes('aptcha')) return 'captcha';
    if (selector.includes('email') && !selector.includes('password')) return 'email';
    if (selector.includes('password')) return 'password';
    if (selector.includes('btnNext') || selector.includes('next|continue')) return 'next';
    if (selector.includes('btnLogin') || selector.includes('log ?in')) return 'login';
    if (selector.includes('submit-button') || selector.includes('complete purchase'))
      return 'confirm';
    return 'other';
  };
  const miss = (k: string): boolean => (script.missing ?? []).some((m) => m === k);
  const frame = (main: boolean): FrameLike => ({
    locator: (selector) => {
      const k = kind(selector);
      const l: LocatorLike = {
        first: () => l,
        isVisible: () => {
          if (masked) return Promise.resolve(false);
          if (k === 'email')
            return Promise.resolve(!miss('email') && main !== (script.emailInFrame === true));
          if (!main) return Promise.resolve(false);
          if (k === 'captcha') return Promise.resolve(script.captcha === true && nextClicked);
          if (k === 'password') {
            if (script.captcha === true) return Promise.resolve(false);
            if (miss('password')) return Promise.resolve(false);
            if (loggedIn) return Promise.resolve(script.passwordStays === true);
            return Promise.resolve(script.onePage === true || nextClicked);
          }
          if (k === 'next') return Promise.resolve(!miss('next'));
          if (k === 'login') return Promise.resolve(true);
          if (k === 'confirm')
            return Promise.resolve(loggedIn && !miss('confirm') && script.passwordStays !== true);
          return Promise.resolve(false);
        },
        press: (key) => {
          log.push(`press ${k} ${key}`);
          if (script.enterFails === true) return Promise.reject(new Error('no enter'));
          if (k === 'password' && key === 'Enter') loggedIn = true;
          return Promise.resolve();
        },
        scrollIntoViewIfNeeded: () => {
          log.push(`scroll ${k}`);
          return Promise.resolve();
        },
        dispatchEvent: (type) => {
          log.push(`dispatch ${k} ${type}`);
          if (k === 'next') nextClicked = true;
          if (k === 'login' || k === 'confirm') loggedIn = true;
          return Promise.resolve();
        },
        click: (o) => {
          if (script.intercepted === true && o?.force !== true) {
            log.push(`blocked ${k}`);
            return Promise.reject(new Error('intercepts pointer events'));
          }
          if (script.forceFails === true && script.intercepted === true) {
            log.push(`blocked ${k}`);
            return Promise.reject(new Error('intercepts pointer events'));
          }
          log.push(`click ${k}`);
          if (k === 'next') nextClicked = true;
          if (k === 'login') loggedIn = true;
          return Promise.resolve();
        },
        fill: (value) => {
          log.push(`fill ${k} ${value === 'pw-secret' ? '<password>' : '<email>'}`);
          return Promise.resolve();
        },
        count: () => Promise.resolve(1),
        waitFor: async () => {
          if (!(await l.isVisible())) throw new Error('timeout');
        },
      };
      return l;
    },
    addStyleTag: ({ content }) => {
      masked = true;
      log.push(`style ${content.includes('transparent') ? 'hide' : 'other'}`);
      return script.styleFails === true ? Promise.reject(new Error('no style')) : Promise.resolve();
    },
    evaluate: (expression) => {
      if (expression.includes('.remove()')) {
        masked = false;
        log.push('unstyle');
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        inputs: [
          { tag: 'input', type: 'email', id: 'x', name: '', role: '', aria: '', visible: true },
        ],
        buttons: [],
        counts: { inputs: 1, buttons: 0, links: 2, iframes: 1 },
      });
    },
  });
  const main = frame(true);
  const child = frame(false);
  const page: PageLike = {
    ...main,
    goto: () => Promise.resolve(),
    frames: () => [main, child],
    waitForURL: () =>
      script.noReturn === true ? Promise.reject(new Error('timeout')) : Promise.resolve(),
    waitForTimeout: () => Promise.resolve(),
    waitForLoadState: () => Promise.resolve(),
    screenshot: ({ path }) => {
      log.push(`shot ${path.split('/').pop() ?? ''}`);
      return script.shotFails === true ? Promise.reject(new Error('shot')) : Promise.resolve();
    },
    url: () => 'https://www.sandbox.paypal.com/signin?token=SECRET&x=1',
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
    timeoutMs: 1,
  };
}

describe('approveInBrowser', () => {
  it('signs in, confirms and closes the browser', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({}, log));
    expect(log.filter((l) => l.startsWith('fill'))).toEqual([
      'fill email <email>',
      'fill password <password>',
    ]);
    expect(log).toContain('click next');
    expect(log.some((l) => l.includes('review'))).toBe(true);
    expect(log.some((l) => l.includes('returned'))).toBe(true);
    expect(log[log.length - 1]).toBe('closed');
  });

  it('submits the password with Enter before any click on Log In', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({}, log));
    expect(log).toContain('press password Enter');
    expect(log).not.toContain('click login');
  });

  it('clicks Log In with force when Enter does not submit and an overlay blocks the click', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({ enterFails: true, intercepted: true }, log));
    expect(log).toContain('blocked login');
    expect(log).toContain('scroll login');
    expect(log).toContain('click login');
    expect(log).toContain('blocked next');
    expect(log).toContain('click next');
  });

  it('falls back to a dispatched click when even forced clicks are blocked', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({ enterFails: true, intercepted: true, forceFails: true }, log));
    expect(log).toContain('dispatch login click');
    expect(log).toContain('dispatch next click');
  });

  it('skips Next on the one-page layout', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({ onePage: true }, log));
    expect(log).not.toContain('click next');
  });

  it('finds the email field inside a frame', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({ emailInFrame: true }, log));
    expect(log).toContain('fill email <email>');
  });

  it('hides all page text before every screenshot', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({}, log));
    const shots = log.filter((l) => l.startsWith('shot'));
    expect(shots.length).toBeGreaterThan(1);
    log.forEach((l, i) => {
      if (l.startsWith('shot')) expect(log[i - 1]).toBe('style hide');
    });
  });

  it('removes the hiding style after every screenshot so fields are visible again', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({}, log));
    log.forEach((l, i) => {
      if (l.startsWith('shot')) expect(log.slice(i + 1, i + 3)).toContain('unstyle');
    });
    expect(log).toContain('fill email <email>');
  });

  it('removes the hiding style even when the screenshot throws', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({ shotFails: true }, log));
    expect(log).toContain('unstyle');
    expect(log).toContain('fill email <email>');
  });

  it('takes no screenshot when the page cannot be hidden', async () => {
    const log: string[] = [];
    await approveInBrowser(opts({ styleFails: true }, log));
    expect(log.some((l) => l.startsWith('shot'))).toBe(false);
  });

  it.each([
    ['login form', { missing: ['email'] }, 'no email field'],
    ['password step', { missing: ['password'] }, 'SANDBOX_BUYER_EMAIL is a sandbox buyer'],
    ['login', { passwordStays: true }, 'SANDBOX_BUYER_PASSWORD'],
    ['password step', { captcha: true }, 'captcha shown'],
    ['review page', { missing: ['confirm'] }, 'no confirm button'],
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

  it('records layout-only diagnostics without the query string or secrets', async () => {
    const log: string[] = [];
    const err = (await approveInBrowser(opts({ missing: ['email'] }, log)).catch(
      (e: unknown) => e,
    )) as BuyerApprovalError;
    expect(err.diagnostics).toContain('https://www.sandbox.paypal.com/signin');
    expect(err.diagnostics).not.toContain('SECRET');
    expect(err.diagnostics).toContain('"counts"');
    expect(err.message).not.toContain('buyer@example.test');
    expect(log.some((l) => l.includes('no-login-form'))).toBe(true);
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
