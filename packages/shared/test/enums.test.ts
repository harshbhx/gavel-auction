import { describe, expect, it } from 'vitest';
import { SETTLEMENT_STATES, ROLES, BID_SOURCES, AUCTION_STATUSES } from '../src/enums';

describe('enums (T-RT-012)', () => {
  it('SettlementState has exactly the 9 names in order', () => {
    expect([...SETTLEMENT_STATES]).toEqual([
      'HELD',
      'BIDDING',
      'WINNER_SELECTED',
      'CAPTURING',
      'CAPTURED',
      'VOIDING',
      'SETTLED',
      'FALLBACK_RUNNER_UP',
      'FAILED_NEEDS_REVIEW',
    ]);
  });
  it('other enums', () => {
    expect([...ROLES]).toEqual(['auctioneer', 'bidder', 'screen']);
    expect([...BID_SOURCES]).toEqual(['voice', 'qr', 'manual']);
    expect([...AUCTION_STATUSES]).toEqual([
      'SCHEDULED',
      'OPEN',
      'PAUSED',
      'CLOSING',
      'SETTLING',
      'DONE',
    ]);
  });
});
