/** Every reason a bid can be rejected; the only values allowed in BID_REJECTED.reason. */
export const REJECT_REASONS = [
  'lot_not_open',
  'unregistered',
  'ceiling_revoked',
  'bad_amount',
  'unconfirmed',
  'over_ceiling',
  'below_reserve',
  'below_increment',
  'already_leading',
  'not_higher_than_own_max',
  'already_bid',
  'limit_exceeded',
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];
