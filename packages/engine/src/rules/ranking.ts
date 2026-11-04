export interface BidRecord {
  bidId: string;
  bidderId: string;
  amountCents: number;
  at: number;
  seq: number;
  status: 'active' | 'struck';
}

export interface RankedBid {
  bidId: string;
  bidderId: string;
  amountCents: number;
  at: number;
  seq: number;
  rank: number;
}

export function better(a: BidRecord, b: BidRecord): boolean {
  if (a.amountCents !== b.amountCents) return a.amountCents > b.amountCents;
  if (a.at !== b.at) return a.at < b.at;
  return a.seq < b.seq;
}

/** Each bidder's best active bid; struck bids are ignored (R-ENG-024). */
export function bestByBidder(bids: readonly BidRecord[]): Map<string, BidRecord> {
  const best = new Map<string, BidRecord>();
  for (const b of bids) {
    if (b.status === 'struck') continue;
    const cur = best.get(b.bidderId);
    if (cur === undefined || better(b, cur)) best.set(b.bidderId, b);
  }
  return best;
}

/** Total order: amount desc, then at asc, then seq asc. Ranks start at 1. */
export function rank(bids: readonly BidRecord[]): RankedBid[] {
  const sorted = [...bestByBidder(bids).values()].sort((a, b) =>
    a === b ? 0 : better(a, b) ? -1 : 1,
  );
  return sorted.map((b, i) => ({
    bidId: b.bidId,
    bidderId: b.bidderId,
    amountCents: b.amountCents,
    at: b.at,
    seq: b.seq,
    rank: i + 1,
  }));
}
