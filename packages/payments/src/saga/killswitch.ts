import { PayPalError } from '../errors.js';
import type { Clock, JournalStore, PaymentsGateway } from '../ports.js';
import type { AuditSink } from '../ports.js';
import type { HoldTruth, Journal } from '../types.js';
import { withLease } from './create.js';
import { truthArgs } from './truth.js';
import { defaultLeaseOwner } from './owner.js';
import { voidHold, type VoidStatus } from './void.js';

/**
 * Kill switch in the saga (SPEC 3.6; R-PAY-063, R-PAY-112).
 *
 * Engaging the switch is `PersistentKillSwitch.engage`; it never voids anything.
 * The capture phase returns `pending` with reason `kill_switch` before a capture
 * and keeps the state; the void phase does not look at the switch, so voids go on.
 * Releasing the switch and running the settlement again completes it.
 *
 * `voidAllLiveHolds` is the separate admin operation: it voids every hold of the
 * auction that is not captured, writes each result to the journal, and audits one
 * `void_all` entry per hold with the actor. Voiding a hold that a settlement still
 * wants to capture is the operator's decision; the capture phase then reads the
 * hold as gone and falls back or ends with no sale.
 */

export type VoidAllHoldResult = VoidStatus | 'captured';

export interface VoidAllDeps {
  journals: JournalStore;
  gateway: PaymentsGateway;
  audit: AuditSink;
  clock: Clock;
  owner?: string;
  boundary?: (label: string) => Promise<void> | void;
}

export type VoidAllOutcome =
  | { status: 'done'; journal: Journal; holds: Record<string, VoidAllHoldResult> }
  | { status: 'busy' };

const CAPTURED_TRUTH: ReadonlySet<HoldTruth['status']> = new Set([
  'CAPTURED',
  'PARTIALLY_CAPTURED',
]);

/** Voids every hold of the auction that is not captured. Idempotent. */
export async function voidAllLiveHolds(
  deps: VoidAllDeps,
  auctionId: string,
  actor: string,
): Promise<VoidAllOutcome> {
  const leased = await withLease(
    { journals: deps.journals, clock: deps.clock },
    auctionId,
    deps.owner ?? defaultLeaseOwner('admin'),
    async (renew) => {
      let journal = await deps.journals.load(auctionId);
      if (journal === null) throw new Error(`no settlement for auction ${auctionId}`);
      const holds: Record<string, VoidAllHoldResult> = {};
      const bidders = Object.keys(journal.holds).sort();
      for (const bidderId of bidders) {
        const hold = journal.holds[bidderId];
        if (hold === undefined) continue;
        const done = journal.voids[bidderId];
        if (done === 'voided' || done === 'released') {
          holds[bidderId] = done;
          continue;
        }
        if (journal.winner?.holdId === hold.holdId) {
          holds[bidderId] = 'captured';
          continue;
        }
        let truth: HoldTruth | undefined;
        try {
          await deps.boundary?.('before:get');
          truth = await deps.gateway.getHoldTruth(truthArgs(hold));
          await deps.boundary?.('after:get');
        } catch (e) {
          if (!(e instanceof PayPalError)) throw e;
        }
        if (truth !== undefined && CAPTURED_TRUTH.has(truth.status)) {
          holds[bidderId] = 'captured';
          continue;
        }
        const status = await voidHold(deps, auctionId, hold);
        holds[bidderId] = status;
        await deps.audit.append({
          kind: 'void_all',
          auctionId,
          holdId: hold.holdId,
          label: status,
          actor,
          tsMs: deps.clock.nowMs(),
        });
        await renew();
        const from: Journal = journal;
        const next = structuredClone(from);
        next.voids[bidderId] = status;
        next.version = from.version + 1;
        await deps.journals.save(next, from.version);
        journal = next;
        await deps.boundary?.(`journaled:void_${bidderId}`);
      }
      return { journal, holds };
    },
  );
  return leased.status === 'busy' ? { status: 'busy' } : { status: 'done', ...leased.value };
}
