import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Shared parts of the real-sandbox specs (R-QA-029, QA-44 and QA-45). Nothing here talks to the
// network or reads the clock by itself: the specs and the tests inject both. Secrets are read by
// name only and no value is ever written to a result, a transcript or a log.

export type SandboxStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped';
export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'none';

export const SANDBOX_SPEC_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'G5'] as const;
export type SandboxSpecId = (typeof SANDBOX_SPEC_IDS)[number];

/** Secrets every wallet-buyer spec needs. */
export const SANDBOX_SECRET_NAMES: readonly string[] = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'SANDBOX_BUYER_EMAIL',
  'SANDBOX_BUYER_PASSWORD',
];

type Env = Readonly<Record<string, string | undefined>>;

export interface Availability {
  ok: boolean;
  /** Names of the missing variables. Never values. */
  missing: string[];
}

function blank(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

/** Whether the real-sandbox specs can run. PAYPAL_ENV, when set, must be `sandbox`. */
export function sandboxAvailability(env: Env): Availability {
  const missing = SANDBOX_SECRET_NAMES.filter((n) => blank(env[n]));
  const paypalEnv = env['PAYPAL_ENV'];
  if (!blank(paypalEnv) && paypalEnv !== 'sandbox') missing.push('PAYPAL_ENV=sandbox');
  return { ok: missing.length === 0, missing };
}

/** Whether a deployed staging stack is configured. */
export function stagingAvailability(env: Env): Availability {
  const missing = ['GAVEL_STAGING_URL', 'GAVEL_STAGING_ADMIN_KEY'].filter((n) => blank(env[n]));
  return { ok: missing.length === 0, missing };
}

/** Whether a card or guest buyer is configured (G2 path). */
export function cardBuyerAvailable(env: Env): boolean {
  return !blank(env['SANDBOX_CARD_BUYER_EMAIL']) && !blank(env['SANDBOX_CARD_BUYER_PASSWORD']);
}

export interface GateFlags {
  g1_remainder_mode: 'A' | 'B' | 'C' | 'unknown';
  g2_card_authorize: boolean;
  g4_webhooks_verified: boolean;
}

/** A gate is closed once its result is recorded in gates-result.json. G3 has no flag: open. */
export function gateClosed(gate: GateId, flags: GateFlags): boolean {
  switch (gate) {
    case 'G1':
      return flags.g1_remainder_mode !== 'unknown';
    case 'G2':
      return flags.g2_card_authorize;
    case 'G4':
      return flags.g4_webhooks_verified;
    default:
      return false;
  }
}

/**
 * A met expectation is a pass. A missed one is `inconclusive` while the gate is open (the spec
 * only records what it observed) and a `fail` once the gate is closed.
 */
export function settle(gate: GateId, met: boolean, flags: GateFlags): SandboxStatus {
  if (met) return 'pass';
  return gateClosed(gate, flags) ? 'fail' : 'inconclusive';
}

export function isTransientStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Calls `fn` again while it answers with a transient status (network error, 429, 5xx), waiting
 * 1x, 2x, 4x the base between tries. After the last try the final answer is returned and the
 * caller records `inconclusive`: a flaky sandbox is not a product failure.
 */
export async function retryTransient<T extends { status: number }>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseMs ?? 1000;
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fn();
    } catch (cause) {
      if (i === attempts - 1) throw cause;
      await opts.sleep(base * 2 ** i);
      continue;
    }
    if (!isTransientStatus(last.status) || i === attempts - 1) return last;
    await opts.sleep(base * 2 ** i);
  }
  return last as T;
}

export interface SpecResult {
  spec: SandboxSpecId;
  gate: GateId;
  status: SandboxStatus;
  /** Short plain statement of what was observed. No ids that identify a buyer, no secrets. */
  observed: string;
  /** Free-form facts such as which path ran or the PayPal error name. */
  facts: Record<string, string | number | boolean>;
  finishedAt: string;
}

/** Where the specs write their results and redacted transcripts, relative to the e2e package. */
export const RESULT_DIR = join('report', 'sandbox', 'results');

export function writeSpecResult(dir: string, result: SpecResult): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${result.spec}.json`);
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return path;
}

export function writeTranscript(
  dir: string,
  spec: SandboxSpecId,
  lines: readonly string[],
): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${spec}.transcript.jsonl`);
  writeFileSync(path, lines.length === 0 ? '' : `${lines.join('\n')}\n`);
  return path;
}

export interface LedgerRow {
  id: string;
  status: string;
  capturedCents: number;
}

/** Differences between our ledger and what PayPal reports. Empty when they agree. */
export function diffLedger(ledger: readonly LedgerRow[], paypal: readonly LedgerRow[]): string[] {
  const diffs: string[] = [];
  const theirs = new Map(paypal.map((r) => [r.id, r]));
  for (const mine of ledger) {
    const other = theirs.get(mine.id);
    if (other === undefined) {
      diffs.push(`${mine.id}: missing at PayPal`);
      continue;
    }
    if (other.status !== mine.status) {
      diffs.push(`${mine.id}: status ${mine.status} here, ${other.status} at PayPal`);
    }
    if (other.capturedCents !== mine.capturedCents) {
      diffs.push(
        `${mine.id}: captured ${mine.capturedCents} here, ${other.capturedCents} at PayPal`,
      );
    }
    theirs.delete(mine.id);
  }
  for (const id of theirs.keys()) diffs.push(`${id}: not in our ledger`);
  return diffs;
}
