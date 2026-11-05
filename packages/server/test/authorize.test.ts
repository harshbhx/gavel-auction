import type { RoomEvent } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import {
  AUTH_MATRIX,
  AUTH_ROLES,
  OPERATIONS,
  authorize,
  redactEventForExport,
  redactForViewer,
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
    const out = JSON.stringify(redactForViewer('screen', undefined, frame));
    expect(out).not.toContain('ceiling');
    expect(out).toContain('price');
  });
});

const B1 = '01J9ZQ3A0B2C4D6F8H0J2K4M6N';
const B2 = '01J9ZQ3A0B2C4D6F8H0J2K4M6P';
const BID = '01J9ZQ7A0B2C4D6F8H0J2K4M6N';

describe('ceiling redaction per viewer (R-RT-055)', () => {
  const registeredB2 = { t: 'registered', bidderId: B2, ceiling: 30000 };

  it('a bidder never sees another bidder ceiling', () => {
    const out = redactForViewer('bidder', B1, registeredB2);
    expect(JSON.stringify(out)).not.toContain('ceiling');
  });

  it('a bidder keeps their own ceiling and own you block', () => {
    const own = { t: 'registered', bidderId: B1, ceiling: 30000 };
    expect(redactForViewer('bidder', B1, own)).toEqual(own);
    const snap = { snapshot: { you: { bidderId: B1, ceiling: 7 } } };
    expect(redactForViewer('bidder', B1, snap)).toEqual(snap);
    expect(JSON.stringify(redactForViewer('bidder', B2, snap))).not.toContain('you');
  });

  it('a ceiling with no named owner is dropped for bidders', () => {
    expect(JSON.stringify(redactForViewer('bidder', B1, { ceiling: 5 }))).not.toContain('ceiling');
  });

  it('redacts the web wire ceilingCents key for screen, auctioneer and other bidders', () => {
    const frame = {
      t: 'state',
      bidders: [{ bidderId: B2, name: 'b', ceilingCents: 30000 }],
      you: { bidderId: B2, ceilingCents: 30000 },
    };
    for (const [role, viewer] of [
      ['screen', undefined],
      ['auctioneer', undefined],
      ['bidder', B1],
    ] as const) {
      expect(JSON.stringify(redactForViewer(role, viewer, frame)).toLowerCase()).not.toContain(
        'ceiling',
      );
    }
  });

  it('the auctioneer never sees ceilings', () => {
    expect(JSON.stringify(redactForViewer('auctioneer', undefined, registeredB2))).not.toContain(
      'ceiling',
    );
  });
});

describe('public audit rows (R-RT-038, R-RT-055)', () => {
  const full = {
    bidId: BID,
    bidderId: B2,
    source: 'voice',
    transcript: 'sixty thousand',
    parsedAmount: 60000,
    outcome: 'rejected',
    reason: 'over_ceiling',
    serverTs: 1,
    seq: 3,
  };
  const accepted = { ...full, outcome: 'accepted', reason: undefined };

  it('does not broadcast a rejected row to non-auctioneers', () => {
    const frame = { v: 1, t: 'audit_event', seq: 3, ts: 1, audit: full };
    expect(redactForViewer('bidder', B1, frame)).toBeNull();
    expect(redactForViewer('screen', undefined, frame)).toBeNull();
    expect(redactForViewer('auctioneer', undefined, frame)).toEqual(frame);
  });

  it('strips transcripts from accepted rows for non-auctioneers', () => {
    const frame = { v: 1, t: 'audit_event', seq: 3, ts: 1, audit: accepted };
    const out = JSON.stringify(redactForViewer('bidder', B1, frame));
    expect(out).not.toContain('transcript');
    expect(out).toContain('parsedAmount');
  });

  it('filters snapshot recentAudit to public accepted rows', () => {
    const snap = { snapshot: { recentAudit: [full, accepted] } };
    const out = redactForViewer('screen', undefined, snap) as {
      snapshot: { recentAudit: Array<Record<string, unknown>> };
    };
    expect(out.snapshot.recentAudit).toHaveLength(1);
    expect(out.snapshot.recentAudit[0]).not.toHaveProperty('transcript');
    expect(out.snapshot.recentAudit[0]).not.toHaveProperty('reason');
  });
});

describe('event export (R-RT-108)', () => {
  const base = { auctionId: BID, seq: 1, ts: 1 };
  const registered = {
    ...base,
    type: 'bidder_registered',
    bidderId: B1,
    paddle: 1,
    name: 'a',
    ceiling: 9000,
    holdRef: 'h',
  } as unknown as RoomEvent;

  it('drops the ceiling for the auctioneer, keeps it for admin', () => {
    expect(redactEventForExport('auctioneer', registered)).not.toHaveProperty('ceiling');
    expect(redactEventForExport('admin', registered)).toHaveProperty('ceiling', 9000);
  });
});

describe('confirm events in the auctioneer export (R7S-03)', () => {
  const audit = { parsedAmount: 50000, confidence: 0.4 };
  const requested = {
    auctionId: BID,
    seq: 2,
    ts: 1,
    type: 'confirm_requested',
    confirmId: 'c1',
    bidderId: B1,
    mid: 'M1',
    amount: 50000,
    expiresAt: 9,
    audit,
  } as unknown as RoomEvent;
  const resolved = {
    auctionId: BID,
    seq: 3,
    ts: 1,
    type: 'confirm_resolved',
    confirmId: 'c1',
    outcome: 'accepted',
    audit,
  } as unknown as RoomEvent;

  it('drops the held amount for the auctioneer so it cannot be matched to an over_ceiling', () => {
    const out = redactEventForExport('auctioneer', requested) as unknown as Record<string, unknown>;
    expect(out).not.toHaveProperty('amount');
    expect(JSON.stringify(out)).not.toContain('50000');
    expect(JSON.stringify(redactEventForExport('auctioneer', resolved))).not.toContain('50000');
  });

  it('keeps everything for admin', () => {
    expect(redactEventForExport('admin', requested)).toHaveProperty('amount', 50000);
  });
});

describe('settlement state in you (RT-91)', () => {
  it('keeps the bidder their own settlement state and hides it from screens', () => {
    const frame = { t: 'settlement_update', rev: 1, auctionState: 'CAPTURED', you: 'CAPTURED' };
    expect(redactForViewer('bidder', B1, frame)).toEqual(frame);
    expect(JSON.stringify(redactForViewer('screen', undefined, frame))).not.toContain('you');
  });
});
