import type { SettlementState } from '@gavel/shared';
import type { SimHold } from './simLedger';

/** One hold and where it is in settlement, as the holds grid shows it. */
export interface HoldRow {
  /** Unique and stable, used as the AG Grid row id. */
  id: string;
  /** Short reference, for example the last characters of the hold id. */
  ref: string;
  paddle: number;
  state: SettlementState;
  /** What the hold set aside, in integer cents. */
  heldCents: number;
  /** Amount turned into a charge. Zero until a winner is charged. */
  capturedCents: number;
  /** Amount let go. */
  releasedCents: number;
  /** Simulated day, when the rows come from the run. */
  day?: number;
}

export interface WireHold {
  paddle: number;
  state: SettlementState;
  capturedCents: number;
  releasedCents: number;
  idSuffix: string;
}

/** Holds from a settlement update. The wire has no hold size, so it is the two settled parts added. */
export function holdRowsFromWire(holds: readonly WireHold[]): HoldRow[] {
  return holds.map((h) => ({
    id: `${h.paddle}-${h.idSuffix}`,
    ref: h.idSuffix,
    paddle: h.paddle,
    state: h.state,
    heldCents: h.capturedCents + h.releasedCents,
    capturedCents: h.capturedCents,
    releasedCents: h.releasedCents,
  }));
}

export function holdRowsFromSim(holds: readonly SimHold[]): HoldRow[] {
  return holds.map((h) => ({
    id: h.id,
    ref: h.id,
    paddle: h.paddle,
    state: h.state,
    heldCents: h.heldCents,
    capturedCents: h.capturedCents,
    releasedCents: h.releasedCents,
    day: h.day,
  }));
}

export interface HoldTotals {
  count: number;
  heldCents: number;
  capturedCents: number;
  releasedCents: number;
}

export function holdTotals(rows: readonly HoldRow[]): HoldTotals {
  return rows.reduce<HoldTotals>(
    (t, r) => ({
      count: t.count + 1,
      heldCents: t.heldCents + r.heldCents,
      capturedCents: t.capturedCents + r.capturedCents,
      releasedCents: t.releasedCents + r.releasedCents,
    }),
    { count: 0, heldCents: 0, capturedCents: 0, releasedCents: 0 },
  );
}

/** Settled holds must add up: charged plus released equals held. Open holds are not checked. */
export function totalsAddUp(rows: readonly HoldRow[]): boolean {
  return rows
    .filter((r) => r.state === 'CAPTURED' || r.state === 'SETTLED')
    .every((r) => r.capturedCents + r.releasedCents === r.heldCents);
}
