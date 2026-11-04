import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SANDBOX_APPROVE_HOST } from '../src/guard.js';

/**
 * Headless buyer approval for the sandbox gates (SPEC R-PAY-143, R-PAY-144).
 *
 * Opens the approval link of an order in a browser, signs in as the sandbox buyer
 * and confirms the payment, until the browser lands on the return URL. The browser
 * library is loaded only when needed (the workflow installs it on the runner), so
 * unit tests and --fake runs never touch it.
 *
 * Credentials are used only to fill the form. They are never logged, never put in an
 * error message and never written to evidence. Screenshots hide all text, images and input
 * fields first, so the buyer name, email, address and balance never appear in an artifact.
 */

export interface BuyerCredentials {
  email: string;
  password: string;
}

/** The slice of a Playwright locator that the flow needs. */
export interface LocatorLike {
  first(): LocatorLike;
  isVisible(): Promise<boolean>;
  click(): Promise<void>;
  waitFor(opts: { timeout: number }): Promise<void>;
}

/** The slice of a Playwright page that the flow needs. */
export interface PageLike {
  goto(url: string, opts: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  locator(selector: string): LocatorLike;
  fill(selector: string, value: string): Promise<void>;
  waitForSelector(selector: string, opts: { timeout: number }): Promise<unknown>;
  waitForURL(pattern: RegExp, opts: { timeout: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state: 'domcontentloaded'): Promise<void>;
  addStyleTag(opts: { content: string }): Promise<unknown>;
  screenshot(opts: { path: string; mask?: LocatorLike[] }): Promise<unknown>;
  url(): string;
}

export interface BrowserLike {
  newPage(opts: { viewport: { width: number; height: number } }): Promise<PageLike>;
  close(): Promise<void>;
}

export interface BrowserLauncher {
  launch(): Promise<BrowserLike>;
}

export class BuyerApprovalError extends Error {
  constructor(
    readonly stage: string,
    message: string,
  ) {
    super(`buyer approval failed at ${stage}: ${message}`);
    this.name = 'BuyerApprovalError';
  }
}

const EMAIL_FIELD = '#email, input[name=login_email]';
const PASSWORD_FIELD = '#password, input[name=login_password]';
const NEXT_BUTTON = '#btnNext, button:has-text("Next")';
const LOGIN_BUTTON = '#btnLogin, button:has-text("Log In")';
const CONFIRM_BUTTON = [
  '#payment-submit-btn',
  'button[data-testid="submit-button-initial"]',
  'button:has-text("Complete Purchase")',
  'button:has-text("Pay Now")',
  'button:has-text("Continue")',
  'button:has-text("Agree")',
].join(', ');

/** Names of the secrets that are missing, for the failure message. Values are never read here. */
export function missingBuyerSecrets(env: Record<string, string | undefined>): string[] {
  return ['SANDBOX_BUYER_EMAIL', 'SANDBOX_BUYER_PASSWORD'].filter(
    (k) => (env[k] ?? '').trim() === '',
  );
}

/** True when the approval link points at the sandbox (or, for --fake, a loopback host). */
export function isSandboxApproveUrl(url: string, fake: boolean): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:' && u.hostname === SANDBOX_APPROVE_HOST) return true;
  return fake && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
}

/**
 * Compares the payer reported by the order with the configured buyer. Returns
 * "match", "mismatch" or "unknown" (PayPal did not report an email). The caller
 * records only this word, never an address.
 */
export function comparePayer(
  payerEmail: string | undefined,
  buyerEmail: string,
): 'match' | 'mismatch' | 'unknown' {
  if (payerEmail === undefined || payerEmail.trim() === '') return 'unknown';
  return payerEmail.trim().toLowerCase() === buyerEmail.trim().toLowerCase() ? 'match' : 'mismatch';
}

export interface ApproveOptions {
  approveUrl: string;
  credentials: BuyerCredentials;
  /** Approval ends when the browser reaches a URL matching this pattern. */
  returnPattern: RegExp;
  /** Directory for screenshots; created when missing. */
  shotDir: string;
  /** File name prefix of the screenshots. */
  shotPrefix: string;
  launcher: BrowserLauncher;
  /** Defaults to 60 seconds per navigation. */
  timeoutMs?: number;
}

/** Makes the page layout-only: no text, image, canvas or field value is drawn. */
export const HIDE_PAGE_CONTENT_CSS =
  '* { color: transparent !important; text-shadow: none !important; ' +
  '-webkit-text-fill-color: transparent !important; } ' +
  'img, svg, video, canvas, input, textarea, select { visibility: hidden !important; }';

async function visible(l: LocatorLike): Promise<boolean> {
  try {
    return await l.isVisible();
  } catch {
    return false;
  }
}

/** Signs in as the buyer and confirms the order. Resolves when the return URL is reached. */
export async function approveInBrowser(opts: ApproveOptions): Promise<void> {
  const timeout = opts.timeoutMs ?? 60_000;
  mkdirSync(opts.shotDir, { recursive: true });
  const browser = await opts.launcher.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    let shots = 0;
    const snap = async (name: string): Promise<void> => {
      shots += 1;
      const file = join(
        opts.shotDir,
        `${opts.shotPrefix}-${String(shots).padStart(2, '0')}-${name}.png`,
      );
      // The review page shows the buyer name, email, address and balance as plain text, so all
      // content is hidden before the shot; if that fails no screenshot is taken at all.
      try {
        await page.addStyleTag({ content: HIDE_PAGE_CONTENT_CSS });
      } catch {
        return;
      }
      await page.screenshot({ path: file, mask: [page.locator('input')] }).catch(() => undefined);
    };

    try {
      await page.goto(opts.approveUrl, { waitUntil: 'domcontentloaded', timeout });
    } catch {
      throw new BuyerApprovalError('open', 'the approval page did not load');
    }
    await snap('landing');

    try {
      await page.waitForSelector(EMAIL_FIELD, { timeout });
    } catch {
      await snap('no-login-form');
      throw new BuyerApprovalError(
        'login form',
        'no email field appeared (PayPal may have changed the page or shown a bot check)',
      );
    }
    await page.fill(EMAIL_FIELD, opts.credentials.email);
    const next = page.locator(NEXT_BUTTON).first();
    if (await visible(next)) await next.click();

    try {
      await page.waitForSelector(PASSWORD_FIELD, { timeout: 30_000 });
    } catch {
      await snap('no-password-field');
      throw new BuyerApprovalError(
        'password step',
        'no password field appeared; check that SANDBOX_BUYER_EMAIL is a sandbox buyer account',
      );
    }
    await page.fill(PASSWORD_FIELD, opts.credentials.password);
    await page.locator(LOGIN_BUTTON).first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(6000);

    if (await visible(page.locator('#password').first())) {
      await snap('login-rejected');
      throw new BuyerApprovalError(
        'login',
        'PayPal showed the password field again; check SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD',
      );
    }
    await snap('after-login');

    const confirm = page.locator(CONFIRM_BUTTON).first();
    try {
      await confirm.waitFor({ timeout: 30_000 });
    } catch {
      await snap('no-confirm-button');
      throw new BuyerApprovalError('review page', 'no confirm button appeared after sign-in');
    }
    await snap('review');
    await confirm.click();
    try {
      await page.waitForURL(opts.returnPattern, { timeout });
    } catch {
      await snap('no-return');
      throw new BuyerApprovalError(
        'confirm',
        'the browser never reached the return URL after confirming',
      );
    }
    await snap('returned');
  } finally {
    await browser.close();
  }
}

/**
 * Loads Playwright (installed by the workflow, not a repository dependency). The workflow
 * installs it outside the repository and points PLAYWRIGHT_MODULE at the entry file.
 */
export async function loadPlaywrightLauncher(
  env: Record<string, string | undefined> = process.env,
): Promise<BrowserLauncher> {
  const name = env['PLAYWRIGHT_MODULE'] ?? 'playwright';
  let mod: { chromium?: BrowserLauncher };
  try {
    mod = (await import(/* @vite-ignore */ name)) as { chromium?: BrowserLauncher };
  } catch {
    throw new Error(
      'playwright is not installed: run "npm install --prefix <dir> playwright@1.49.1", ' +
        '"npx playwright install chromium" and set PLAYWRIGHT_MODULE to its entry file',
    );
  }
  if (mod.chromium === undefined) throw new Error('playwright did not export chromium');
  return mod.chromium;
}
