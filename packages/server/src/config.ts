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

const EnvSchema = z.object({
  PORT: int(1).pipe(z.number().max(65535)).default('8080'),
  PUBLIC_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TOKEN_SECRET: z.string().min(1),
  TOKEN_SECRET_PREVIOUS: z.string().min(1).optional(),
  ADMIN_KEY: z.string().min(1),
  STORE: z.enum(['memory', 'postgres', 'd1']).default('memory'),
  DATABASE_URL: z.string().min(1).optional(),
  CORS_ORIGINS: csv.default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEMO_MODE: flag.default('0'),
  ALLOW_MEMORY_STORE: flag.default('0'),
  RATE_BID_PER_S: int(1).default('3'),
  RATE_BID_BURST: int(1).default('5'),
  MAX_CONN_PER_ROOM: int(1).default('500'),
  MAX_BIDDERS_PER_ROOM: int(1).default('200'),
  MAX_ROOMS: int(1).default('20'),
  MAX_BIDS_PER_AUCTION: int(1).default('5000'),
  PAYMENTS: z.enum(['fake', 'sandbox']).default('fake'),
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
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
  };
}

const SECRET_KEYS = ['TOKEN_SECRET', 'TOKEN_SECRET_PREVIOUS', 'ADMIN_KEY', 'DATABASE_URL'] as const;
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
