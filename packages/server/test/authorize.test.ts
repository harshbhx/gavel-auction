import { describe, expect, it } from 'vitest';
import {
  AUTH_MATRIX,
  AUTH_ROLES,
  OPERATIONS,
  authorize,
  redactForRole,
  type AuthRole,
  type Operation,
} from '../src/auth/authorize';

const Y = true;
const N = false;
// Spec 4.5 table, one row per operation: [auctioneer, bidder, screen, admin].
const EXPECTED: Record<Operation, [boolean, boolean, boolean, boolean]> = {
  ws_join: [Y, Y, Y, N],
  bid_own: [N, Y, N, N],
  bid_manual_for_others: [Y, N, N, N],
  confirm_response: [N, Y, N, N],
  control: [Y, N, N, N],
  invites_rotate: [Y, N, N, N],
  snapshot: [Y, Y, Y, N],
  export: [Y, N, N, Y],
  create_demo_ops: [N, N, N, Y],
};

describe('authorization matrix (T-RT-064)', () => {
  for (const op of OPERATIONS) {
    AUTH_ROLES.forEach((role, i) => {
      const allowed = EXPECTED[op][i];
      it(`${op} x ${role}: ${allowed ? 'allowed' : 'forbidden'}`, () => {
        expect(authorize(op, role)).toEqual(
          allowed ? { ok: true } : { ok: false, code: 'forbidden' },
        );
      });
    });
  }

  it('matrix covers every operation', () => {
    expect(Object.keys(AUTH_MATRIX).sort()).toEqual([...OPERATIONS].sort());
  });

  it('unknown operation or role is denied', () => {
    expect(authorize('nope' as Operation, 'admin').ok).toBe(false);
    expect(authorize('control', 'root' as AuthRole).ok).toBe(false);
  });

  it('screen token cannot bid or control', () => {
    expect(authorize('bid_own', 'screen')).toEqual({ ok: false, code: 'forbidden' });
    expect(authorize('control', 'screen')).toEqual({ ok: false, code: 'forbidden' });
  });

  it('frames sent to a screen carry no ceiling', () => {
    const frame = {
      t: 'registered',
      ceiling: 50000,
      snapshot: {
        you: { bidderId: 'x', ceiling: 1 },
        price: 5,
        roster: [{ ceiling: 9, name: 'a' }],
      },
    };
    const out = JSON.stringify(redactForRole('screen', frame));
    expect(out).not.toContain('ceiling');
    expect(out).toContain('price');
    expect(redactForRole('bidder', frame)).toBe(frame);
  });
});
