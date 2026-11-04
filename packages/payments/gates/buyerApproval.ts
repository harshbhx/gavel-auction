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
  click(opts?: { timeout: number }): Promise<void>;
  fill(value: string, opts?: { timeout: number }): Promise<void>;
  count(): Promise<number>;
  /** Resolves when the element is visible, rejects after the timeout. */
  waitFor(opts: { state: 'visible'; timeout: number }): Promise<void>;
}

/** The slice of a Playwright frame (the page itself is also a frame-like) that the flow needs. */
export interface FrameLike {
  locator(selector: string): LocatorLike;
  addStyleTag(opts: { content: string }): Promise<unknown>;
  /** Evaluates a JavaScript expression string in the frame. */
  evaluate(expression: string): Promise<unknown>;
}

/** The slice of a Playwright page that the flow needs. */
export interface PageLike extends FrameLike {
  goto(url: string, opts: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  frames(): FrameLike[];
  waitForURL(pattern: RegExp, opts: { timeout: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(
    state: 'domcontentloaded' | 'networkidle',
    opts?: { timeout: number },
  ): Promise<void>;
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
    /** Layout-only debugging data: page URL without query, control counts, DOM summary. */
    readonly diagnostics?: string,
  ) {
    super(
      `buyer approval failed at ${stage}: ${message}` +
        (diagnostics === undefined ? '' : ` | diagnostics: ${diagnostics}`),
    );
    this.name = 'BuyerApprovalError';
  }
}

const EMAIL_FIELDS = [
  '#email',
  'input[name=login_email]',
  'input[type=email]',
  '#login_emailphone',
  'input[autocomplete=username]',
  'input[name=email]',
  '[data-testid*=email] input',
  'input[data-testid*=email]',
];
const PASSWORD_FIELDS = ['#password', 'input[name=login_password]', 'input[type=password]'];
/** Bot-check inputs of the split login layout; visible means PayPal wants a challenge solved. */
const CAPTCHA_FIELDS = [
  'input#splitHybridCaptcha',
  'input#splitPasswordCaptcha',
  'input[name*=captcha i]',
];
const NEXT_RE = '^\\s*(next|continue)\\s*$';
const NEXT_BUTTONS = [
  '#btnNext',
  `button:text-matches("${NEXT_RE}", "i")`,
  `[role=button]:text-matches("${NEXT_RE}", "i")`,
  'button[type=submit]',
];
const LOGIN_RE = '^\\s*(log ?in|sign ?in|continue)\\s*$';
const LOGIN_BUTTONS = [
  '#btnLogin',
  `button:text-matches("${LOGIN_RE}", "i")`,
  `[role=button]:text-matches("${LOGIN_RE}", "i")`,
  'button[type=submit]',
];
const CONFIRM_RE = '^\\s*(continue|complete purchase|agree (&|and) continue|pay now)\\s*$';
const CONFIRM_BUTTONS = [
  '#payment-submit-btn',
  'button[data-testid="submit-button-initial"]',
  `button:text-matches("${CONFIRM_RE}", "i")`,
  `[role=button]:text-matches("${CONFIRM_RE}", "i")`,
  'button:has-text("Complete Purchase")',
  'button:has-text("Pay Now")',
  'button:has-text("Agree")',
];
const COOKIE_BUTTONS = [
  '#acceptAllButton',
  '#onetrust-accept-btn-handler',
  '#gdprCookieBanner button:has-text("Accept")',
  'button:text-matches("^\\s*(accept( all)?( cookies)?|decline|reject all)\\s*$", "i")',
];

/**
 * Script run inside each frame for failure evidence. It reports tags, types, ids, names, roles
 * and aria-labels of inputs and buttons plus counts. It never reads values or page text.
 */
const DOM_SUMMARY_SCRIPT = `(() => {
  const cut = (v) => (v === null ? '' : String(v).slice(0, 60));
  const shown = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    type: cut(el.getAttribute('type')),
    id: cut(el.id),
    name: cut(el.getAttribute('name')),
    role: cut(el.getAttribute('role')),
    aria: cut(el.getAttribute('aria-label')),
    visible: shown(el),
  });
  const q = (s) => Array.from(document.querySelectorAll(s));
  return {
    inputs: q('input,textarea,select').slice(0, 40).map(describe),
    buttons: q('button,[role=button],input[type=submit]').slice(0, 40).map(describe),
    counts: {
      inputs: q('input').filter(shown).length,
      buttons: q('button,[role=button],input[type=submit]').filter(shown).length,
      links: q('a').filter(shown).length,
      iframes: q('iframe').length,
    },
  };
})()`;

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

/** Expression that removes the injected hiding style again, so the page is usable afterwards. */
const REMOVE_MASK_EXPRESSION = `Array.from(document.querySelectorAll('style')).filter((s) => s.textContent === ${JSON.stringify(HIDE_PAGE_CONTENT_CSS)}).forEach((s) => s.remove())`;

async function visible(l: LocatorLike): Promise<boolean> {
  try {
    return await l.isVisible();
  } catch {
    return false;
  }
}

/** Page URL without query string or fragment. */
function bareUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return 'unparsable';
  }
}

/** Finds the first visible element for any selector, in the page and all its frames. */
async function findVisible(
  page: PageLike,
  selectors: readonly string[],
  timeoutMs: number,
): Promise<LocatorLike | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const frame of page.frames()) {
      for (const sel of selectors) {
        const l = frame.locator(sel).first();
        if (await visible(l)) return l;
      }
    }
    if (Date.now() >= deadline) return undefined;
    await page.waitForTimeout(500);
  }
}

/**
 * Waits until one of the selectors is visible in the page or any of its frames and returns the
 * locator with its selector. Uses real locator waits (retrying inside the browser) in rounds, so
 * frames that appear late are picked up. Returns undefined when the timeout passes.
 */
async function waitVisible(
  page: PageLike,
  selectors: readonly string[],
  timeoutMs: number,
): Promise<{ locator: LocatorLike; selector: string } | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const slice = Math.max(1, Math.min(5000, deadline - Date.now()));
    const waits: Promise<{ locator: LocatorLike; selector: string }>[] = [];
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(selector).first();
        waits.push(
          locator.waitFor({ state: 'visible', timeout: slice }).then(() => ({ locator, selector })),
        );
      }
    }
    if (waits.length > 0) {
      try {
        return await Promise.any(waits);
      } catch {
        // none visible in this round
      }
    }
    if (Date.now() >= deadline) return undefined;
  }
}

async function settle(page: PageLike): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

/** Clicks away a cookie banner when one is shown. Never fails. */
async function dismissCookies(page: PageLike): Promise<void> {
  try {
    const banner = await findVisible(page, COOKIE_BUTTONS, 0);
    if (banner !== undefined) {
      await banner.click({ timeout: 5000 });
      await page.waitForTimeout(500);
    }
  } catch {
    // a banner that cannot be clicked is not fatal
  }
}

/** Layout-only description of the current page for failure evidence. No text, no values. */
async function describePage(page: PageLike): Promise<string> {
  const frames: unknown[] = [];
  const list = page.frames();
  for (const frame of list.slice(0, 6)) {
    try {
      frames.push(await frame.evaluate(DOM_SUMMARY_SCRIPT));
    } catch {
      frames.push('unreadable');
    }
  }
  return JSON.stringify({ url: bareUrl(page.url()), frameCount: list.length, frames });
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
      // content is hidden in every frame before the shot; if that fails no screenshot is taken.
      try {
        try {
          for (const frame of page.frames())
            await frame.addStyleTag({ content: HIDE_PAGE_CONTENT_CSS });
        } catch {
          return;
        }
        const mask = page.frames().map((f) => f.locator('input'));
        await page.screenshot({ path: file, mask }).catch(() => undefined);
      } finally {
        // The hiding style must not outlive the shot: later steps wait for visible fields.
        for (const frame of page.frames())
          await frame.evaluate(REMOVE_MASK_EXPRESSION).catch(() => undefined);
      }
    };
    /** Takes a masked shot, gathers layout-only diagnostics and throws the stage error. */
    const fail = async (stage: string, message: string, shot: string): Promise<never> => {
      await snap(shot);
      let diagnostics: string | undefined;
      try {
        diagnostics = await describePage(page);
      } catch {
        diagnostics = undefined;
      }
      throw new BuyerApprovalError(stage, message, diagnostics);
    };
    const clickPrimary = async (selectors: readonly string[]): Promise<boolean> => {
      const b = await findVisible(page, selectors, 5000);
      if (b === undefined) return false;
      await b.click({ timeout: 10_000 });
      return true;
    };

    try {
      await page.goto(opts.approveUrl, { waitUntil: 'domcontentloaded', timeout });
    } catch {
      throw new BuyerApprovalError('open', 'the approval page did not load');
    }
    await settle(page);
    await dismissCookies(page);
    await snap('landing');

    const emailHit = await waitVisible(page, EMAIL_FIELDS, Math.min(timeout, 45_000));
    if (emailHit === undefined) {
      return await fail(
        'login form',
        'no email field appeared (PayPal may have changed the page or shown a bot check)',
        'no-login-form',
      );
    }
    await emailHit.locator.fill(opts.credentials.email, { timeout: 10_000 });

    // The one-page layout shows both fields; the split layout needs Next first.
    let password = await findVisible(page, PASSWORD_FIELDS, 0);
    if (password === undefined) {
      if (!(await clickPrimary(NEXT_BUTTONS))) {
        return await fail('login form', 'no Next button was found after the email', 'no-next');
      }
      await settle(page);
      await dismissCookies(page);
      const hit = await waitVisible(
        page,
        [...PASSWORD_FIELDS, ...CAPTCHA_FIELDS],
        Math.min(timeout, 45_000),
      );
      if (hit !== undefined && CAPTCHA_FIELDS.includes(hit.selector)) {
        return await fail(
          'password step',
          'captcha shown: PayPal asked for a bot check before the password',
          'captcha',
        );
      }
      password = hit?.locator;
    }
    if (password === undefined) {
      return await fail(
        'password step',
        'no password field appeared; check that SANDBOX_BUYER_EMAIL is a sandbox buyer account',
        'no-password-field',
      );
    }
    await password.fill(opts.credentials.password, { timeout: 10_000 });
    if (!(await clickPrimary(LOGIN_BUTTONS))) {
      return await fail(
        'login',
        'no log in button was found after the password step',
        'no-login-button',
      );
    }
    await settle(page);
    await dismissCookies(page);

    // Signed in when the review page shows up or the browser is already on the return URL.
    const returned = (): boolean => opts.returnPattern.test(page.url());
    const confirmHit = returned()
      ? undefined
      : await waitVisible(page, CONFIRM_BUTTONS, Math.min(timeout, 60_000));
    if (returned()) {
      await snap('returned');
      return;
    }
    if (confirmHit === undefined) {
      if ((await findVisible(page, PASSWORD_FIELDS, 0)) !== undefined) {
        return await fail(
          'login',
          'PayPal showed the password field again; check SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD',
          'login-rejected',
        );
      }
      return await fail(
        'review page',
        'no confirm button appeared after sign-in',
        'no-confirm-button',
      );
    }
    const confirm = confirmHit.locator;
    await snap('after-login');
    await snap('review');
    await confirm.click({ timeout: 10_000 });
    try {
      await page.waitForURL(opts.returnPattern, { timeout });
    } catch {
      return await fail(
        'confirm',
        'the browser never reached the return URL after confirming',
        'no-return',
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
