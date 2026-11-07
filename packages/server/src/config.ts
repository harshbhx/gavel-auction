import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { isSecretKey } from './log/logger';

const flag = z.enum(['0', '1']).transform((v) => v === '1');
/** Like `flag`, but also accepts true and false, for the judge room switches. */
const boolFlag = z.enum(['0', '1', 'true', 'false']).transform((v) => v === '1' || v === 'true');
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

/** Minimum TOKEN_SECRET length in bytes and ADMIN_KEY length in characters (R-RT-131). */
const MIN_SECRET_BYTES = 32;
const MIN_ADMIN_KEY_CHARS = 24;

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
  /** Most live demo rooms the demo rooms route keeps; further creates answer 429. */
  DEMO_MAX_ROOMS: int(1).default('20'),
  /**
   * Judge rooms: a key-less create route for real sandbox rooms, so a judge can run an auction
   * with no setup. Off by default; only allowed with sandbox PayPal (see the refinement below).
   */
  JUDGE_ROOMS: boolFlag.default('0'),
  /** Boot-time state of the judge rooms kill switch; the admin route flips it at runtime. */
  JUDGE_ROOMS_PAUSED: boolFlag.default('0'),
  /** Most judge rooms live at once. */
  JUDGE_ROOMS_MAX: int(1).max(50).default('5'),
  /** Lifetime of a judge room in ms before the sweeper ends it (at most 2 hours). */
  JUDGE_ROOM_TTL_MS: int(60_000).pipe(z.number().max(7_200_000)).default('1800000'),
  /** Judge rooms one source address may create per hour. */
  JUDGE_ROOMS_PER_IP_HOUR: int(1).max(100).default('4'),
  /** Judge rooms the whole host may create per hour. */
  JUDGE_ROOMS_PER_HOUR: int(1).max(1000).default('40'),
  ALLOW_MEMORY_STORE: flag.default('0'),
  RATE_BID_PER_S: int(1).default('3'),
  RATE_BID_BURST: int(1).default('5'),
  RATE_JOIN_PER_MIN: int(1).default('10'),
  RATE_JOIN_BURST: int(1).default('40'),
  RATE_HTTP_PER_MIN: int(1).default('60'),
  RATE_HTTP_BURST: int(1).default('60'),
  /** Reverse proxies in front of the host; the client address is read from x-forwarded-for. */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
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
  /**
   * Speech provider for the /audio route. Unset or `replay` plays cached transcripts and needs no
   * key; `groq` needs GROQ_API_KEY and `deepgram` needs DEEPGRAM_API_KEY. Both fall back to the
   * cached provider when they fail.
   */
  VOICE_STT: z.enum(['replay', 'fake', 'groq', 'deepgram']).optional(),
  GAVEL_MAX_CEILING_CENTS: int(1).optional(),
  GAVEL_HOLD_MAX_AGE_MS: int(1).optional(),
  /** Period of the reconcile pass over settled auctions, in ms; unset or 0 turns it off. */
  GAVEL_RECONCILE_INTERVAL_MS: int(0).optional(),
  /** With the reconcile pass on, void holds still live after SETTLED. */
  GAVEL_RECONCILE_REPAIR: flag.default('0'),
  /** Reauthorize holds older than the honor window before the capture. */
  GAVEL_REAUTH: flag.default('0'),
  /** Age after which a hold is reauthorized, in ms; payments default when unset. */
  GAVEL_REAUTH_HONOR_SAFE_MS: int(1).optional(),
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/**
 * True when the production rules apply: NODE_ENV=production, or a public https host
 * (an operator who forgot NODE_ENV must not boot with weak secrets, R-RT-131).
 */
export function isProductionLike(env: { NODE_ENV: string; PUBLIC_URL: string }): boolean {
  if (env.NODE_ENV === 'production') return true;
  try {
    const url = new URL(env.PUBLIC_URL);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !LOCAL_HOSTS.has(host) && !host.endsWith('.localhost');
  } catch {
    return false;
  }
}

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
  const prodLike = isProductionLike(env);
  if (env.NODE_ENV === 'test' && prodLike) {
    problem('NODE_ENV', 'test is not allowed with a non-local PUBLIC_URL');
  }
  if (env.NODE_ENV !== 'test' || prodLike) {
    if (byteLength(env.TOKEN_SECRET) < MIN_SECRET_BYTES) {
      problem('TOKEN_SECRET', `must be at least ${MIN_SECRET_BYTES} bytes`);
    }
    if (
      env.TOKEN_SECRET_PREVIOUS !== undefined &&
      byteLength(env.TOKEN_SECRET_PREVIOUS) < MIN_SECRET_BYTES
    ) {
      problem('TOKEN_SECRET_PREVIOUS', `must be at least ${MIN_SECRET_BYTES} bytes`);
    }
    if (env.ADMIN_KEY.length < MIN_ADMIN_KEY_CHARS) {
      problem('ADMIN_KEY', `must be at least ${MIN_ADMIN_KEY_CHARS} characters`);
    }
  }
  if (env.TOKEN_SECRET === env.ADMIN_KEY) {
    problem('ADMIN_KEY', 'must differ from TOKEN_SECRET');
  }
  if (env.JUDGE_ROOMS) {
    // Real sandbox holds only. The fake adapter is allowed off-production so tests and local
    // runs can exercise the feature; production-like hosts must use the PayPal sandbox.
    if (env.PAYMENTS !== 'sandbox' && isProductionLike(env)) {
      problem('JUDGE_ROOMS', 'needs PAYMENTS=sandbox');
    }
    if (env.PAYPAL_ENV !== 'sandbox') problem('JUDGE_ROOMS', 'needs PAYPAL_ENV=sandbox');
    if (env.PAYMENTS === 'sandbox' && env.PAYPAL_BASE_URL !== undefined) {
      const host = new URL(env.PAYPAL_BASE_URL).hostname;
      if (host !== 'api-m.sandbox.paypal.com' && !LOCAL_HOSTS.has(host)) {
        problem('JUDGE_ROOMS', 'refused: PAYPAL_BASE_URL is not the PayPal sandbox');
      }
    }
  }
  if (!isProductionLike(env)) return;
  if (env.STORE === 'memory' && !env.ALLOW_MEMORY_STORE) {
    problem('STORE', 'memory store needs ALLOW_MEMORY_STORE=1 in production');
  }
  if (env.PAYMENTS === 'fake') problem('PAYMENTS', 'fake payments are not allowed in production');
  if (env.DEMO_MODE) problem('DEMO_MODE', 'demo endpoints must be off in production');
});

export type ServerConfig = z.infer<typeof EnvSchema>;

export type ConfigResult = { ok: true; config: ServerConfig } | { ok: false; errors: string[] };

/** True only for a parseable URL on a loopback host; anything else counts as public. */
function isLocalUrl(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  try {
    const host = new URL(raw).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** Validate an env map. Every problem is reported, not just the first. */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  // Treat empty strings as unset so `FOO=` behaves like a missing variable.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== '') cleaned[k] = v;
  }
  // A missing NODE_ENV on a public host must not fall open to development rules (R-RT-131).
  if (cleaned.NODE_ENV === undefined && !isLocalUrl(cleaned.PUBLIC_URL)) {
    cleaned.NODE_ENV = 'production';
  }
  const parsed = EnvSchema.safeParse(cleaned);
  if (parsed.success) {
    const c = parsed.data;
    // A durable store that silently lands in ./data is lost on the next deploy (R-RT-131).
    if (isProductionLike(c) && c.STORE === 'file' && !isAbsolute(cleaned.DATA_DIR ?? '')) {
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

export const REDACTED = '[redacted]';

/** A copy of the config that is safe to log: secrets are replaced. */
export function redactConfig(config: ServerConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of Object.keys(out)) {
    if (isSecretKey(key) && out[key] !== undefined) out[key] = REDACTED;
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
