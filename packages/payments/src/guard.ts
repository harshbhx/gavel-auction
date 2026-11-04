import { PaymentsConfigError } from './config.js';

export const SANDBOX_API_HOST = 'api-m.sandbox.paypal.com';
export const SANDBOX_APPROVE_HOST = 'www.sandbox.paypal.com';

/** URL.hostname keeps the brackets of IPv6 literals. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface GuardOptions {
  /** True only when GAVEL_PAYMENTS_FAKE=1; unlocks loopback hosts. */
  fake: boolean;
}

function refuse(message: string): never {
  throw new PaymentsConfigError('payments_not_sandbox', message);
}

function parse(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return refuse('url is not parseable');
  }
  return u;
}

function checkSandboxHost(u: URL, sandboxHost: string): void {
  if (u.protocol !== 'https:') refuse(`sandbox host requires https, got ${u.protocol}`);
  if (u.username !== '' || u.password !== '') refuse('credentials in url are not allowed');
  if (u.port !== '' && u.port !== '443') refuse('sandbox host must use the default port');
  if (u.hostname !== sandboxHost) refuse(`host ${u.hostname} is not ${sandboxHost}`);
}

function isLoopbackUrl(u: URL): boolean {
  return (
    (u.protocol === 'http:' || u.protocol === 'https:') &&
    u.username === '' &&
    u.password === '' &&
    LOOPBACK_HOSTS.has(u.hostname)
  );
}

/**
 * Refuses every base URL that is not the sandbox API host over https. Loopback
 * hosts pass only in fake mode. Exact host comparison, so suffix tricks such as
 * api-m.sandbox.paypal.com.evil.test fail. Returns the parsed URL.
 * (R-PAY-002, R-PAY-004)
 */
export function assertSandboxUrl(url: string, opts: GuardOptions): URL {
  const u = parse(url);
  if (opts.fake && isLoopbackUrl(u)) return u;
  if (u.hostname !== SANDBOX_API_HOST) {
    refuse(`host ${u.hostname} is not allowed${opts.fake ? '' : ' (loopback needs fake mode)'}`);
  }
  checkSandboxHost(u, SANDBOX_API_HOST);
  return u;
}

/** PAYPAL_ENV must equal "sandbox" exactly (R-PAY-002). */
export function assertSandboxEnv(env: string | undefined): void {
  if (env !== 'sandbox') refuse('PAYPAL_ENV must equal "sandbox"');
}

/**
 * Validates a rel=approve link returned by Orders: the sandbox checkout host,
 * or a loopback host in fake mode (R-PAY-003). Callers discard the order and
 * raise when this throws.
 */
export function assertApproveUrl(url: string, opts: GuardOptions): URL {
  const u = parse(url);
  if (opts.fake && isLoopbackUrl(u)) return u;
  checkSandboxHost(u, SANDBOX_APPROVE_HOST);
  return u;
}

/**
 * Single entry point for gateway construction: every gateway calls this before
 * it holds a base URL.
 */
export function assertSandboxConfig(c: { env: string; baseUrl: string; fake: boolean }): URL {
  assertSandboxEnv(c.env);
  return assertSandboxUrl(c.baseUrl, { fake: c.fake });
}
