export const SETTLEMENT_STATES = [
  'HELD',
  'BIDDING',
  'WINNER_SELECTED',
  'CAPTURING',
  'CAPTURED',
  'VOIDING',
  'SETTLED',
  'FALLBACK_RUNNER_UP',
  'FAILED_NEEDS_REVIEW',
] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

export const ROLES = ['auctioneer', 'bidder', 'screen'] as const;
export type Role = (typeof ROLES)[number];

export const BID_SOURCES = ['voice', 'qr', 'manual'] as const;
export type BidSource = (typeof BID_SOURCES)[number];

export const AUCTION_STATUSES = ['SCHEDULED', 'OPEN', 'PAUSED', 'CLOSING', 'SETTLING', 'DONE'] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];
