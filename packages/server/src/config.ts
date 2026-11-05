import { isAbsolute } from 'node:path';
import { z } from 'zod';

const flag = z.enum(['0', '1']).transform((v) => v === '1');
const int = (min: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .transform(Number)
    .pipe(z.number().int().min(min));

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/** An optional secret; the field lists name it so that no name is followed by a value. */
const secret = z.string().min(1).optional();

const EnvObject = z.object({
  PORT: int(1).pipe(z.number().max(65535)).default('8080'),
  PUBLIC_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TOKEN_SECRET: z.string().min(1),
  TOKEN_SECRET_PREVIOUS: z.string().min(1).optional(),
  /** Epoch ms after which TOKEN_SECRET_PREVIOUS is no longer accepted. */
  TOKEN_SECRET_PREVIOUS_UNTIL: int(1).optional(),
  ADMIN_KEY: z.string().min(1),
  STORE: z.enum(['memory', 'file', 'postgres', 'd1']).default('memory'),
  /** Directory for the durable files when STORE=file. */
  DATA_DIR: z.string().min(1).default('./data'),
  DATABASE_URL: z.string().min(1).optional(),
  CORS_ORIGINS: csv.default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEMO_MODE: flag.default('0'),
  ALLOW_MEMORY_STORE: flag.default('0'),
  RATE_BID_PER_S: int(1).default('3'),
  RATE_BID_BURST: int(1).default('5'),
  RATE_JOIN_PER_MIN: int(1).default('10'),
  RATE_JOIN_BURST: int(1).default('10'),
  RATE_HTTP_PER_MIN: int(1).default('60'),
  RATE_HTTP_BURST: int(1).default('60'),
  MAX_CONN_PER_BIDDER: int(1).default('3'),
  MAX_CONN_PER_ROOM: int(1).default('500'),
  MAX_BIDDERS_PER_ROOM: int(1).default('200'),
  MAX_ROOMS: int(1).default('20'),
  MAX_BIDS_PER_AUCTION: int(1).default('5000'),
  /** The one payments switch: `fake` runs the in-process fake PayPal, `sandbox` the PayPal sandbox. */
  PAYMENTS: z.enum(['fake', 'sandbox']).default('fake'),
  /** Must be `sandbox`; any other value stops the boot (R-QA-043). */
  PAYPAL_ENV: z.literal('sandbox').default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().min(1).optional(),
  PAYPAL_CLIENT_SECRET: secret,
  PAYPAL_WEBHOOK_ID: z.string().min(1).optional(),
  PAYPAL_BASE_URL: z.string().url().optional(),
  GAVEL_MAX_CEILING_CENTS: int(1).optional(),
  GAVEL_HOLD_MAX_AGE_MS: int(1).optional(),
});

/** Every variable name the server reads; `.env.example` is checked against it. */
export const CONFIG_KEYS: readonly string[] = Object.keys(EnvObject.shape);

/** Production rules (R-RT-131) that a plain field schema cannot express. */
const EnvSchema = EnvObject.superRefine((env, ctx) => {
  const problem = (path: string, message: string): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  };
  if (env.STORE === 'postgres' && env.DATABASE_URL === undefined) {
    problem('DATABASE_URL', 'required when STORE=postgres');
  }
  if (env.PAYMENTS === 'sandbox') {
    for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'] as const) {
      if (env[key] === undefined) problem(key, 'required when PAYMENTS=sandbox');
    }
  }
  if (env.NODE_ENV !== 'production') return;
  if (byteLength(env.TOKEN_SECRET) < 32) {
    problem('TOKEN_SECRET', 'must be at least 32 bytes in production');
  }
  if (env.TOKEN_SECRET_PREVIOUS !== undefined && byteLength(env.TOKEN_SECRET_PREVIOUS) < 32) {
    problem('TOKEN_SECRET_PREVIOUS', 'must be at least 32 bytes in production');
  }
  if (env.ADMIN_KEY.length < 24)
    problem('ADMIN_KEY', 'must be at least 24 characters in production');
  if (env.STORE === 'memory' && !env.ALLOW_MEMORY_STORE) {
    problem('STORE', 'memory store needs ALLOW_MEMORY_STORE=1 in production');
  }
  if (env.PAYMENTS === 'fake') problem('PAYMENTS', 'fake payments are not allowed in production');
  if (env.DEMO_MODE) problem('DEMO_MODE', 'demo endpoints must be off in production');
});

export type ServerConfig = z.infer<typeof EnvSchema>;

export type ConfigResult = { ok: true; config: ServerConfig } | { ok: false; errors: string[] };

/** Validate an env map. Every problem is reported, not just the first. */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  // Treat empty strings as unset so `FOO=` behaves like a missing variable.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== '') cleaned[k] = v;
  }
  const parsed = EnvSchema.safeParse(cleaned);
  if (parsed.success) {
    const c = parsed.data;
    // A durable store that silently lands in ./data is lost on the next deploy (R-RT-131).
    if (c.NODE_ENV === 'production' && c.STORE === 'file' && !isAbsolute(cleaned.DATA_DIR ?? '')) {
      return {
        ok: false,
        errors: ['DATA_DIR: must be set to an absolute path when STORE=file in production'],
      };
    }
    return { ok: true, config: c };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
  };
}

const SECRET_KEYS = [
  'TOKEN_SECRET',
  'TOKEN_SECRET_PREVIOUS',
  'ADMIN_KEY',
  'DATABASE_URL',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
] as const;
export const REDACTED = '[redacted]';

/** A copy of the config that is safe to log: secrets are replaced. */
export function redactConfig(config: ServerConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of SECRET_KEYS) {
    if (out[key] !== undefined) out[key] = REDACTED;
  }
  return out;
}

export interface LoadHooks {
  exit: (code: number) => never;
  error: (line: string) => void;
}

/** Load config at boot. On any error, print them all and exit with code 1. */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  hooks: LoadHooks = {
    exit: (code) => process.exit(code),
    error: (line) => console.error(line),
  },
): ServerConfig {
  const result = parseConfig(env);
  if (result.ok) return result.config;
  hooks.error(`Invalid configuration:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`);
  return hooks.exit(1);
}
