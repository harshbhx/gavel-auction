export type PaymentsConfigErrorCode = 'payments_not_sandbox' | 'payments_bad_config';

export class PaymentsConfigError extends Error {
  code: PaymentsConfigErrorCode;
  constructor(code: PaymentsConfigErrorCode, message: string) {
    super(message);
    this.name = 'PaymentsConfigError';
    this.code = code;
  }
}

export interface PaymentsConfig {
  env: 'sandbox';
  clientId: string;
  clientSecret: string;
  webhookId: string;
  baseUrl: string;
  maxCeilingCents: number;
  fake: boolean;
  holdMaxAgeMs: number;
}

export const DEFAULT_BASE_URL = 'https://api-m.sandbox.paypal.com';
export const DEFAULT_FAKE_BASE_URL = 'http://127.0.0.1';
export const DEFAULT_MAX_CEILING_CENTS = 25000;
export const DEFAULT_HOLD_MAX_AGE_MS = 7200000;

/**
 * Latency targets (R-PAY-152), milliseconds. Measured against the fake PayPal the client
 * adds under 25 ms per call, so these budgets are spent almost entirely by PayPal.
 * UNVERIFIED (G1 measurement): the sandbox numbers. Fallback: raise the targets to the
 * sandbox p95 and keep the saga defaults below, which do not depend on them.
 */
export const LATENCY_TARGETS_MS = {
  hammerToCapturedP95: 2500,
  hammerToSettledSixHoldsP95: 6000,
  webhookHandlerOk: 300,
} as const;

/**
 * Saga defaults, chosen from the measured call counts: a settlement of 6 holds makes one
 * truth check and one capture for the winner, then 5 voids. Three voids at a time finish
 * them in two waves, so hammer to SETTLED costs about six sequential call latencies and
 * stays inside the 6 s target while a call stays under 1 s at p95. The values equal the
 * constants in saga/void.ts and saga/unknown.ts; a test keeps them equal.
 */
export const SAGA_DEFAULTS = {
  voidConcurrency: 3,
  maxVoidResumes: 5,
  unknownDeadlineMs: 600000,
} as const;

type Env = Record<string, string | undefined>;

function positiveInt(env: Env, name: string, dflt: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return dflt;
  if (!/^\d+$/.test(raw))
    throw new PaymentsConfigError('payments_bad_config', `${name} must be a positive integer`);
  const n = parseInt(raw, 10);
  if (!(n > 0) || n > 9007199254740991) {
    throw new PaymentsConfigError('payments_bad_config', `${name} must be a positive integer`);
  }
  return n;
}

function required(env: Env, name: string): string {
  const v = env[name];
  if (v === undefined || v === '')
    throw new PaymentsConfigError('payments_bad_config', `${name} is required`);
  return v;
}

/** Variable names this module reads (`GAVEL_PAYMENTS_FAKE` is only a fallback, see `LoadConfigOptions`). */
export const PAYMENTS_ENV_KEYS: readonly string[] = [
  'PAYPAL_ENV',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'PAYPAL_BASE_URL',
  'GAVEL_MAX_CEILING_CENTS',
  'GAVEL_HOLD_MAX_AGE_MS',
];

export interface LoadConfigOptions {
  /**
   * Outside fake mode PAYPAL_WEBHOOK_ID must be set, because an empty id makes every real
   * delivery fail verification at PayPal. Callers that never receive webhooks (the gate and
   * demo scripts) pass false.
   */
  requireWebhookId?: boolean;
  /**
   * Fake mode, decided by the caller. The server passes it from its own PAYMENTS setting so
   * one switch rules every package. When absent, GAVEL_PAYMENTS_FAKE=1 in `env` still selects
   * it, which the standalone gates and demos rely on.
   */
  fake?: boolean;
}

/** Parse environment variables into a typed config (R-PAY-001). */
export function loadConfig(env: Env, opts: LoadConfigOptions = {}): PaymentsConfig {
  if (env['PAYPAL_ENV'] !== 'sandbox') {
    throw new PaymentsConfigError('payments_not_sandbox', 'PAYPAL_ENV must equal "sandbox"');
  }
  const fake = opts.fake ?? env['GAVEL_PAYMENTS_FAKE'] === '1';
  const baseUrl = env['PAYPAL_BASE_URL'] || (fake ? DEFAULT_FAKE_BASE_URL : DEFAULT_BASE_URL);
  return {
    env: 'sandbox',
    clientId: fake ? (env['PAYPAL_CLIENT_ID'] ?? '') : required(env, 'PAYPAL_CLIENT_ID'),
    clientSecret: fake
      ? (env['PAYPAL_CLIENT_SECRET'] ?? '')
      : required(env, 'PAYPAL_CLIENT_SECRET'),
    webhookId:
      fake || opts.requireWebhookId === false
        ? (env['PAYPAL_WEBHOOK_ID'] ?? '')
        : required(env, 'PAYPAL_WEBHOOK_ID'),
    baseUrl,
    maxCeilingCents: positiveInt(env, 'GAVEL_MAX_CEILING_CENTS', DEFAULT_MAX_CEILING_CENTS),
    fake,
    holdMaxAgeMs: positiveInt(env, 'GAVEL_HOLD_MAX_AGE_MS', DEFAULT_HOLD_MAX_AGE_MS),
  };
}

/** Config copy safe for logs: secrets and ids replaced. */
export function redactedConfig(c: PaymentsConfig): Record<string, unknown> {
  return {
    ...c,
    clientId: c.clientId ? '[REDACTED]' : '',
    clientSecret: c.clientSecret ? '[REDACTED]' : '',
    webhookId: c.webhookId ? '[REDACTED]' : '',
  };
}
