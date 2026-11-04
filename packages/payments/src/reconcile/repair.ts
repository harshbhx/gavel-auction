import { PayPalError } from '../errors.js';
import type { AuditSink, PaymentsGateway } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import { reconcile, type ReconcileDeps, type ReconcileReport } from './reconcile.js';

/**
 * Reconciler repair option and timer (SPEC 3.8, R-PAY-101, R-PAY-102).
 *
 * Reconciliation is read-only by default. With `repair: 'void_live_holds'` it also
 * voids holds that are still live after the settlement is SETTLED. It never
 * captures and never touches the journal: the only money call it can make is
 * `voidAuthorization`, and it never voids the winner's hold.
 */

export type RepairMode = 'void_live_holds';

export interface RepairOptions {
  repair?: RepairMode;
}

export interface RepairAction {
  holdId: string;
  bidderId: string | null;
  result: 'voided' | 'not_live' | 'failed';
  detail?: string;
}

export interface RepairedReport extends ReconcileReport {
  /** Empty unless repair was requested. */
  repairs: RepairAction[];
}

export interface RepairDeps extends ReconcileDeps {
  gateway: Pick<PaymentsGateway, 'getHoldTruth' | 'voidAuthorization'>;
  audit: AuditSink;
}

const LIVE = ['CREATED', 'PENDING', 'PARTIALLY_CAPTURED'] as const;

/**
 * Reconciles one auction. With `repair`, each LIVE_HOLD_AFTER_SETTLED finding is
 * re-checked against PayPal and, if the hold is still live and is not the winner's,
 * voided with a request id that is the same on every run. The report is the one the
 * read-only run produced, so the findings stay visible after a repair; `repairs`
 * lists what was done.
 */
export async function reconcileWithRepair(
  deps: RepairDeps,
  auctionId: string,
  opts: RepairOptions = {},
): Promise<RepairedReport> {
  const report = await reconcile(deps, auctionId);
  const repairs: RepairAction[] = [];
  if (opts.repair !== 'void_live_holds') return { ...report, repairs };

  const journal = await deps.journals.load(auctionId);
  const records = new Map((await deps.holds.listByAuction(auctionId)).map((r) => [r.holdId, r]));
  const authOf = new Map<string, string>();
  for (const jh of Object.values(journal?.holds ?? {})) authOf.set(jh.holdId, jh.authId);
  for (const r of records.values()) {
    if (r.authId !== undefined && !authOf.has(r.holdId)) authOf.set(r.holdId, r.authId);
  }

  for (const f of report.findings) {
    if (f.code !== 'LIVE_HOLD_AFTER_SETTLED' || f.holdId === null) continue;
    if (journal === null || journal.state !== 'SETTLED') continue;
    if (journal.winner?.holdId === f.holdId) continue;
    const authId = authOf.get(f.holdId);
    if (authId === undefined) continue;
    const action: RepairAction = { holdId: f.holdId, bidderId: f.bidderId, result: 'not_live' };
    try {
      const orderId = records.get(f.holdId)?.orderId;
      const truth = await deps.gateway.getHoldTruth({
        holdId: f.holdId,
        authId,
        ...(orderId === undefined || orderId === '' ? {} : { orderId }),
      });
      if ((LIVE as readonly string[]).includes(truth.status)) {
        await deps.gateway.voidAuthorization(
          authId,
          buildRequestId({
            auctionId,
            op: 'void',
            holdId: f.holdId,
            amountCents: 0,
            generation: 0,
          }),
        );
        action.result = 'voided';
        deps.metrics?.incr('reconcile_findings_total', { code: 'REPAIR_VOIDED' });
        await deps.audit.append({
          kind: 'state_change',
          op: 'reconcile_repair',
          label: 'void_live_hold',
          auctionId,
          holdId: f.holdId,
          from: truth.status,
          to: 'VOIDED',
          tsMs: deps.clock.nowMs(),
        });
      }
    } catch (e) {
      if (!(e instanceof PayPalError)) throw e;
      action.result = 'failed';
      action.detail = e.kind;
    }
    repairs.push(action);
  }
  return { ...report, repairs };
}

export interface ReconcileAllDeps extends RepairDeps {
  /** Auctions with a settlement that changed at or after `sinceMs`. */
  listAuctions(sinceMs: number): Promise<readonly string[]>;
}

export interface ReconcileAllOptions extends RepairOptions {
  sinceMs?: number;
}

/** Reconciles every listed auction, in the order listed. One failing auction does not stop the rest. */
export async function reconcileAll(
  deps: ReconcileAllDeps,
  opts: ReconcileAllOptions = {},
): Promise<{ reports: RepairedReport[]; errors: Array<{ auctionId: string; message: string }> }> {
  const reports: RepairedReport[] = [];
  const errors: Array<{ auctionId: string; message: string }> = [];
  for (const auctionId of await deps.listAuctions(opts.sinceMs ?? 0)) {
    try {
      reports.push(await reconcileWithRepair(deps, auctionId, opts));
    } catch (e) {
      errors.push({ auctionId, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { reports, errors };
}

export const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;

export interface ReconcileTimerOptions extends RepairOptions {
  intervalMs?: number;
  /** Look-back for each run. Default 0 (everything listed). */
  sinceMs?: () => number;
  /** True while any settlement is non-terminal. Default: always run. */
  isActive?: () => Promise<boolean>;
  onReport?: (r: Awaited<ReturnType<typeof reconcileAll>>) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface ReconcileTimer {
  stop(): void;
  /** Runs one pass now (the auctioneer console route calls this). Skips when a pass is running. */
  runNow(): Promise<boolean>;
}

/** Runs `reconcileAll` every 60 s (default) while `isActive` says so. Passes never overlap. */
export function startReconcileTimer(
  deps: ReconcileAllDeps,
  opts: ReconcileTimerOptions = {},
): ReconcileTimer {
  const set = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clear = opts.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout));
  let running = false;
  const runNow = async (): Promise<boolean> => {
    if (running) return false;
    running = true;
    try {
      if (opts.isActive !== undefined && !(await opts.isActive())) return false;
      const out = await reconcileAll(deps, {
        sinceMs: opts.sinceMs?.() ?? 0,
        ...(opts.repair === undefined ? {} : { repair: opts.repair }),
      });
      opts.onReport?.(out);
      return true;
    } catch {
      return false;
    } finally {
      running = false;
    }
  };
  const handle = set(() => void runNow(), opts.intervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);
  return { stop: () => clear(handle), runNow };
}
