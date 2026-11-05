/**
 * Boot validation (R-QA-043). Runs before the full config parse: a deployment that lacks a
 * required variable, or points PAYPAL_ENV anywhere but the sandbox, exits with code 78
 * (EX_CONFIG) and prints one JSON line per problem. A line names the variable and the reason
 * and never carries a value, so a secret cannot reach the log through this path.
 */

export const EXIT_CONFIG = 78;

/** Required in every deployment. */
export const REQUIRED_ALWAYS: readonly string[] = [
  'PUBLIC_URL',
  'TOKEN_SECRET',
  'ADMIN_KEY',
  'PAYMENTS',
  'PAYPAL_ENV',
];

/** Additionally required when PAYMENTS=sandbox (staging and production both use it). */
export const REQUIRED_WITH_SANDBOX_PAYMENTS: readonly string[] = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
];

export type BootProblemReason = 'missing' | 'not_sandbox';

export interface BootProblem {
  variable: string;
  reason: BootProblemReason;
}

type Env = Readonly<Record<string, string | undefined>>;

function isBlank(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

/** Every problem found, in a stable order. Empty when the environment may boot. */
export function findBootProblems(env: Env): BootProblem[] {
  const problems: BootProblem[] = [];
  const required = [...REQUIRED_ALWAYS];
  if (env['PAYMENTS'] === 'sandbox') required.push(...REQUIRED_WITH_SANDBOX_PAYMENTS);
  for (const variable of required) {
    if (isBlank(env[variable])) problems.push({ variable, reason: 'missing' });
  }
  const paypalEnv = env['PAYPAL_ENV'];
  if (!isBlank(paypalEnv) && paypalEnv !== 'sandbox') {
    problems.push({ variable: 'PAYPAL_ENV', reason: 'not_sandbox' });
  }
  return problems;
}

/** The log line for one problem. Names and reasons only. */
export function bootProblemLine(p: BootProblem): string {
  return JSON.stringify({
    level: 'fatal',
    event: 'boot_config_invalid',
    variable: p.variable,
    reason: p.reason,
  });
}

export interface BootHooks {
  log: (line: string) => void;
  exit: (code: number) => never;
}

/** Logs each problem and exits 78; returns normally when nothing is wrong. */
export function validateBootEnv(
  env: Env,
  hooks: BootHooks = {
    log: (line) => process.stderr.write(`${line}\n`),
    exit: (code) => process.exit(code),
  },
): void {
  const problems = findBootProblems(env);
  if (problems.length === 0) return;
  for (const p of problems) hooks.log(bootProblemLine(p));
  hooks.exit(EXIT_CONFIG);
}
