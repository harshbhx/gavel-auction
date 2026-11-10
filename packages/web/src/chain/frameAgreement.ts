import type { ReplayBundle } from '../screens/replay/bundle';
import { verifyLedger } from './verifyLedger';

/** Whether the hammer price the replay shows is the one the verified ledger recorded. */
export type FrameAgreement =
  | { kind: 'unchecked' }
  | { kind: 'agree'; hammers: number }
  | { kind: 'disagree'; hammer: number };

function ledgerHammers(ledger: unknown): number[] {
  const events = (ledger as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  const out: number[] = [];
  for (const e of events as Array<{ type?: unknown; payload?: { priceCents?: unknown } }>) {
    if (e.type === 'LOT_HAMMERED') {
      const price = e.payload?.priceCents;
      out.push(typeof price === 'number' ? price : Number.NaN);
    }
  }
  return out;
}

/**
 * The chain badge proves the ledger is intact, not that the frames being played come from it.
 * This checks the one number a judge reads off the replay: every hammer frame must carry the
 * price of the matching LOT_HAMMERED entry, in order. Only a ledger that verifies is compared.
 * Anything else is `unchecked`: nothing is claimed.
 */
export function frameAgreement(bundle: ReplayBundle, ledger: unknown): FrameAgreement {
  if (verifyLedger(ledger).kind !== 'verified') return { kind: 'unchecked' };
  const sealed = ledgerHammers(ledger);
  const shown: number[] = [];
  for (const { msg } of bundle.events) if (msg.t === 'hammer') shown.push(msg.price);
  if (shown.length === 0 && sealed.length === 0) return { kind: 'unchecked' };
  const count = Math.max(shown.length, sealed.length);
  for (let i = 0; i < count; i += 1) {
    if (shown[i] !== sealed[i]) return { kind: 'disagree', hammer: i + 1 };
  }
  return { kind: 'agree', hammers: shown.length };
}
