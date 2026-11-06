import { Branches } from './Branches';
import { EventLog } from './EventLog';
import { InvariantBanner } from './InvariantBanner';
import { Ladder } from './Ladder';
import { buildLadder, type SettlementView } from './ladderModel';

export interface SettlementPanelProps {
  view: SettlementView | null;
  /** Link target for the audit view, shown on the needs-review banner. */
  auditHref: string;
  /** False when the server sent no per-hold data: totals are unknown, so no invariant banner. */
  detail?: boolean;
}

/** The settlement ladder with its branch notices, invariant banner and confirmation log. */
export function SettlementPanel({ view, auditHref, detail = true }: SettlementPanelProps) {
  const model = buildLadder(view);
  return (
    <div className="gv-settlement" data-testid="settlement-panel">
      <Ladder view={view} parts="lanes" />
      <Branches model={model} auditHref={auditHref} />
      {detail && <InvariantBanner invariants={model.invariants} />}
      <EventLog events={model.events} />
    </div>
  );
}
