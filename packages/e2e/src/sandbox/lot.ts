import { loadConfig, DEFAULT_HOLD_MAX_AGE_MS } from '../../../payments/src/config.js';
import { PayPalGateway } from '../../../payments/src/gateway.js';
import { assertSandboxConfig } from '../../../payments/src/guard.js';
import { TokenManager } from '../../../payments/src/oauth.js';
import { createSettlement } from '../../../payments/src/saga/create.js';
import { runSettlement } from '../../../payments/src/saga/void.js';
import { MemoryJournalStore } from '../../../payments/src/stores/memory.js';
import { Transport } from '../../../payments/src/transport.js';
import type { HoldTruth, Journal } from '../../../payments/src/types.js';
import type { LedgerRow } from './harness.js';

// Drives the real settlement code (saga and PayPalGateway of @gavel/payments) against the sandbox.
// The journal is the ledger of record; PayPal is read back through the gateway truth check.

export interface LotHold {
  bidderId: string;
  authId: string;
  orderId: string;
  ceilingCents: number;
}

export interface LotCandidate {
  bidderId: string;
  priceCents: number;
}

export interface LotResult {
  status: string;
  journal: Journal;
  /** What PayPal reports for each hold, keyed by bidder, read after the run. */
  truth: Record<string, HoldTruth>;
}

type Env = Readonly<Record<string, string | undefined>>;

export function sandboxGateway(env: Env): PayPalGateway {
  const config = loadConfig(
    { ...env, PAYPAL_ENV: 'sandbox', GAVEL_PAYMENTS_FAKE: '' },
    { requireWebhookId: false },
  );
  const base = assertSandboxConfig(config);
  const auth = new TokenManager({
    transport: new Transport(),
    baseUrl: base.origin,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  return new PayPalGateway({ auth, fake: false });
}

/** Creates the settlement journal, runs the saga to its end and reads PayPal's truth. */
export async function settleLot(
  env: Env,
  auctionId: string,
  holds: readonly LotHold[],
  candidates: readonly LotCandidate[],
): Promise<LotResult> {
  const gateway = sandboxGateway(env);
  const journals = new MemoryJournalStore();
  const clock = { nowMs: (): number => Date.now() };
  const audit = { append: async (): Promise<void> => undefined };
  const plan: Record<
    string,
    { holdId: string; authId: string; orderId: string; ceilingCents: number; createdAtMs: number }
  > = {};
  for (const h of holds) {
    plan[h.bidderId] = {
      holdId: `hold-${h.bidderId}`,
      authId: h.authId,
      orderId: h.orderId,
      ceilingCents: h.ceilingCents,
      createdAtMs: clock.nowMs(),
    };
  }
  await createSettlement(
    { journals, clock, holdMaxAgeMs: DEFAULT_HOLD_MAX_AGE_MS, audit },
    { auctionId, reserveCents: 100, candidates: [...candidates], holds: plan },
  );
  const outcome = await runSettlement({ journals, gateway, audit, clock }, auctionId);
  const journal = await journals.load(auctionId);
  if (journal === null) throw new Error('settlement journal is missing');
  const truth: Record<string, HoldTruth> = {};
  for (const h of holds) {
    truth[h.bidderId] = await gateway.getHoldTruth({
      holdId: `hold-${h.bidderId}`,
      authId: h.authId,
      orderId: h.orderId,
    });
  }
  return { status: outcome.status, journal, truth };
}

/** Our side of the reconciliation, built from the settlement journal only. */
export function ledgerFromJournal(j: Journal): LedgerRow[] {
  return Object.keys(j.holds)
    .sort()
    .map((bidderId) => {
      const won = j.winner?.bidderId === bidderId;
      return {
        id: bidderId,
        status: won ? 'CAPTURED' : 'VOIDED',
        capturedCents: won ? (j.winner?.amountCents ?? 0) : 0,
      };
    });
}

/** PayPal's side, built from the gateway truth (the amounts PayPal returned). */
export function ledgerFromTruth(truth: Record<string, HoldTruth>): LedgerRow[] {
  return Object.keys(truth)
    .sort()
    .map((bidderId) => {
      const t = truth[bidderId];
      return {
        id: bidderId,
        status: t?.status ?? 'NOT_FOUND',
        capturedCents: t?.capturedCents ?? 0,
      };
    });
}
