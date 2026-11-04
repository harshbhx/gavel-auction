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

type Env = Record<string, string | undefined>;

function positiveInt(env: Env, name: string, dflt: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return dflt;
  if (!/^\d+$/.test(raw)) throw new PaymentsConfigError('payments_bad_config', `${name} must be a positive integer`);
  const n = parseInt(raw, 10);
  if (!(n > 0) || n > 9007199254740991) {
    throw new PaymentsConfigError('payments_bad_config', `${name} must be a positive integer`);
  }
  return n;
}

function required(env: Env, name: string): string {
  const v = env[name];
  if (v === undefined || v === '') throw new PaymentsConfigError('payments_bad_config', `${name} is required`);
  return v;
}

/** Parse environment variables into a typed config (R-PAY-001). */
export function loadConfig(env: Env): PaymentsConfig {
  if (env['PAYPAL_ENV'] !== 'sandbox') {
    throw new PaymentsConfigError('payments_not_sandbox', 'PAYPAL_ENV must equal "sandbox"');
  }
  const fake = env['GAVEL_PAYMENTS_FAKE'] === '1';
  const baseUrl = env['PAYPAL_BASE_URL'] || (fake ? DEFAULT_FAKE_BASE_URL : DEFAULT_BASE_URL);
  return {
    env: 'sandbox',
    clientId: fake ? (env['PAYPAL_CLIENT_ID'] ?? '') : required(env, 'PAYPAL_CLIENT_ID'),
    clientSecret: fake ? (env['PAYPAL_CLIENT_SECRET'] ?? '') : required(env, 'PAYPAL_CLIENT_SECRET'),
    webhookId: env['PAYPAL_WEBHOOK_ID'] ?? '',
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
