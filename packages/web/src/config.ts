export type PaymentsMode = 'fake' | 'paypal';

export interface AppConfig {
  readonly apiBase: string;
  readonly wsBase: string;
  readonly paypalClientId: string;
  readonly sandbox: true;
  readonly payments: PaymentsMode;
}

export type EnvSource = Readonly<Record<string, unknown>>;

export type ConfigResult =
  | { readonly ok: true; readonly config: AppConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

/** Thrown at boot. The message lists variable names only, never their values. */
export class ConfigError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`Configuration problem. Fix these environment variables: ${missing.join(', ')}`);
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

function text(env: EnvSource, name: string): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/** Validate the VITE_* variables. Reports the names of every missing or invalid one. */
export function validateEnv(env: EnvSource): ConfigResult {
  const missing: string[] = [];
  const apiBase = text(env, 'VITE_API_BASE');
  const wsBase = text(env, 'VITE_WS_BASE');
  const paypalClientId = text(env, 'VITE_PAYPAL_CLIENT_ID');
  const paymentsRaw = text(env, 'VITE_PAYMENTS');
  const payments: PaymentsMode | null =
    paymentsRaw === '' || paymentsRaw === 'paypal'
      ? 'paypal'
      : paymentsRaw === 'fake'
        ? 'fake'
        : null;

  if (apiBase === '') missing.push('VITE_API_BASE');
  if (wsBase === '') missing.push('VITE_WS_BASE');
  if (text(env, 'VITE_SANDBOX') !== 'true') missing.push('VITE_SANDBOX');
  if (payments === null) missing.push('VITE_PAYMENTS');
  if (payments !== 'fake' && paypalClientId === '') missing.push('VITE_PAYPAL_CLIENT_ID');

  if (missing.length > 0 || payments === null) return { ok: false, missing };
  return { ok: true, config: { apiBase, wsBase, paypalClientId, sandbox: true, payments } };
}

function loadConfig(env: EnvSource): Readonly<AppConfig> {
  const result = validateEnv(env);
  if (!result.ok) throw new ConfigError(result.missing);
  return Object.freeze(result.config);
}

export const config: Readonly<AppConfig> = loadConfig(import.meta.env);
