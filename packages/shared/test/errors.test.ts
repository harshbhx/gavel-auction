import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_TABLE } from '../src/errors';

describe('error table (T-RT-008)', () => {
  it('every code has status, closeCode and retryable', () => {
    for (const code of ERROR_CODES) {
      const e = ERROR_TABLE[code];
      expect(e.status).toBeGreaterThanOrEqual(400);
      expect(e.closeCode === null || Number.isInteger(e.closeCode)).toBe(true);
      expect(typeof e.retryable).toBe('boolean');
    }
  });
  it('has no duplicate codes and table matches the list', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(Object.keys(ERROR_TABLE).sort()).toEqual([...ERROR_CODES].sort());
  });
  it('matches the snapshot', () => {
    const rows = ERROR_CODES.map((c) => {
      const e = ERROR_TABLE[c];
      return `${c} ${e.status} ${e.closeCode} ${e.retryable}`;
    });
    expect(rows).toEqual([
      'bad_message 400 1008 false',
      'unsupported_version 400 4002 false',
      'not_joined 400 4003 false',
      'unauthorized 401 4401 false',
      'forbidden 403 null false',
      'invite_used 409 null false',
      'rate_limited 429 null true',
      'room_full 503 4009 true',
      'auction_full 503 4009 false',
      'room_cap 503 4009 false',
      'unregistered 403 null false',
      'below_increment 422 null false',
      'over_ceiling 422 null false',
      'below_reserve 422 null false',
      'closed 409 null false',
      'already_leading 409 null false',
      'bad_amount 400 null false',
      'lot_not_open 409 null false',
      'ceiling_revoked 403 null false',
      'unconfirmed 409 null true',
      'not_higher_than_own_max 422 null false',
      'already_bid 409 null false',
      'limit_exceeded 422 null false',
      'auction_paused 409 null true',
      'store_unavailable 503 null true',
      'conflict 409 4010 false',
      'host_fenced 409 4010 false',
      'not_found 404 null false',
      'internal 500 1011 false',
    ]);
  });
});
