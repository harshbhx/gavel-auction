import { loadConfig, DEFAULT_HOLD_MAX_AGE_MS } from '../../../payments/src/config.js';
import { PayPalGateway } from '../../../payments/src/gateway.js';
import { assertSandboxConfig } from '../../../payments/src/guard.js';
import { TokenManager } from '../../../payments/src/oauth.js';
import { createSettlement } from '../../../payments/src/saga/create.js';
import { runSettlement } from '../../../payments/src/saga/void.js';
import { MemoryJournalStore } from '../../../payments/src/stores/memory.js';
import { Transport } from '../../../payments/src/transport.js';
import type { PaymentsGateway } from '../../../payments/src/ports.js';
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

/** Thrown by the crash injection, standing for a process that died. */
export class InjectedCrash extends Error {
  constructor(readonly label: string) {
    super(`injected crash at ${label}`);
    this.name = 'InjectedCrash';
  }
}

export interface CrashPlan {
  /** Saga boundary label at which the first run dies, for example `after:capture`. */
  label: string;
}

export interface CrashLotResult extends LotResult {
  /** True when the first run died at the planned boundary. */
  crashed: boolean;
  /** The journal as the crashed run left it (what a restarted process would load). */
  journalAtCrash: Journal;
  /** Request id of every capture call the gateway received, in order, over both runs. */
  captureCalls: { run: number; requestId: string }[];
}

/** Records every capture call and passes everything to the real gateway. */
function recordCaptures(
  inner: PaymentsGateway,
  onCapture: (requestId: string) => void,
): PaymentsGateway {
  return {
    createOrder: (i) => inner.createOrder(i),
    getOrder: (id) => inner.getOrder(id),
    authorizeOrder: (id, r) => inner.authorizeOrder(id, r),
    getHoldTruth: (h) => inner.getHoldTruth(h),
    capture: (authId, i) => {
      onCapture(i.requestId);
      return inner.capture(authId, i);
    },
    voidAuthorization: (id, r) => inner.voidAuthorization(id, r),
    reauthorize: (id, i) => inner.reauthorize(id, i),
  };
}

/** Creates the settlement journal, runs the saga to its end and reads PayPal's truth. */
export async function settleLot(
  env: Env,
  auctionId: string,
  holds: readonly LotHold[],
  candidates: readonly LotCandidate[],
): Promise<LotResult> {
  return (await runLot(env, auctionId, holds, candidates)).result;
}

/**
 * Like settleLot, but the first run dies at the planned boundary (after the capture call
 * returned and before the journal knows), then a second run resumes from the same journal.
 */
export async function settleLotWithCrash(
  env: Env,
  auctionId: string,
  holds: readonly LotHold[],
  candidates: readonly LotCandidate[],
  crash: CrashPlan,
): Promise<CrashLotResult> {
  return (await runLot(env, auctionId, holds, candidates, crash)).result as CrashLotResult;
}

async function runLot(
  env: Env,
  auctionId: string,
  holds: readonly LotHold[],
  candidates: readonly LotCandidate[],
  crash?: CrashPlan,
): Promise<{ result: LotResult | CrashLotResult }> {
  const real = sandboxGateway(env);
  let run = 1;
  const captureCalls: { run: number; requestId: string }[] = [];
  const gateway = recordCaptures(real, (requestId) => captureCalls.push({ run, requestId }));
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
  let armed = crash !== undefined;
  const boundary = (label: string): void => {
    if (armed && crash !== undefined && label === crash.label) {
      armed = false;
      throw new InjectedCrash(label);
    }
  };
  let crashed = false;
  let journalAtCrash: Journal | null = null;
  let outcome: Awaited<ReturnType<typeof runSettlement>> | undefined;
  for (; run <= 3; run += 1) {
    try {
      outcome = await runSettlement({ journals, gateway, audit, clock, boundary }, auctionId);
      break;
    } catch (e) {
      if (!(e instanceof InjectedCrash)) throw e;
      crashed = true;
      journalAtCrash = await journals.load(auctionId);
    }
  }
  if (outcome === undefined) throw new Error('settlement did not finish');
  const journal = await journals.load(auctionId);
  if (journal === null) throw new Error('settlement journal is missing');
  const truth: Record<string, HoldTruth> = {};
  for (const h of holds) {
    truth[h.bidderId] = await real.getHoldTruth({
      holdId: `hold-${h.bidderId}`,
      authId: h.authId,
      orderId: h.orderId,
    });
  }
  const base: LotResult = { status: outcome.status, journal, truth };
  if (crash === undefined) return { result: base };
  return { result: { ...base, crashed, journalAtCrash: journalAtCrash ?? journal, captureCalls } };
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
