import type { BidStreamRow } from '../screens/console/BidStream';

/** The row id AG Grid keeps a bid under. A bid keeps its id and seq for life. */
export function bidRowId(row: BidStreamRow): string {
  return `${row.id}-${row.seq}`;
}

export interface BidDiff {
  add: BidStreamRow[];
  update: BidStreamRow[];
  remove: BidStreamRow[];
}

function sameRow(a: BidStreamRow, b: BidStreamRow): boolean {
  return (
    a.status === b.status &&
    a.amountCents === b.amountCents &&
    a.reason === b.reason &&
    a.confidence === b.confidence &&
    a.paddle === b.paddle &&
    a.control === b.control
  );
}

/**
 * What changed between two renders of the bid history, as an AG Grid transaction. Only rows that are
 * new, changed or gone are sent, so the grid never rebuilds the rows that stayed the same.
 */
export function diffBids(prev: readonly BidStreamRow[], next: readonly BidStreamRow[]): BidDiff {
  const before = new Map(prev.map((r) => [bidRowId(r), r]));
  const after = new Map(next.map((r) => [bidRowId(r), r]));
  const add: BidStreamRow[] = [];
  const update: BidStreamRow[] = [];
  for (const row of next) {
    const old = before.get(bidRowId(row));
    if (old === undefined) add.push(row);
    else if (!sameRow(old, row)) update.push(row);
  }
  const remove = prev.filter((r) => !after.has(bidRowId(r)));
  return { add, update, remove };
}

export function isEmptyDiff(d: BidDiff): boolean {
  return d.add.length === 0 && d.update.length === 0 && d.remove.length === 0;
}
