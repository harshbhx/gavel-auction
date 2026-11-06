import { describe, expect, it } from 'vitest';
import { decodeServerMsg, serverSchemas } from '../src/wire/server';
import { encodeMsg } from '../src/wire/codec';

const B1 = '01J9ZQ3A0B2C4D6F8H0J2K4M6N';
const MID = '01J9ZQ5A0B2C4D6F8H0J2K4M6N';
const BID = '01J9ZQ5C0B2C4D6F8H0J2K4M6N';
const AUCTION = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V';
const ev = { v: 1, seq: 15, ts: 1789000001500 };

const audit = {
  bidId: BID,
  bidderId: B1,
  source: 'qr',
  outcome: 'accepted',
  serverTs: 1789000001500,
  seq: 15,
};

const snapshot = {
  auctionId: AUCTION,
  config: {
    currency: 'USD',
    reserve: 10000,
    minIncrement: 1000,
    endTs: 1789000060000,
    softCloseWindowMs: 10000,
    softCloseExtensionMs: 10000,
    maxExtensions: 3,
    ceilingPresets: [50000],
    confirmConfidenceThreshold: 0.7,
  },
  status: 'OPEN',
  price: 35000,
  leaderId: B1,
  endTs: 1789000060000,
  minNext: 36000,
  roster: [{ bidderId: B1, paddle: 12, name: 'Ada', hold: 'HELD' }],
  recentAudit: [audit],
  you: { bidderId: B1, ceiling: 50000 },
};

const fixtures: Record<string, unknown> = {
  registered: { ...ev, t: 'registered', bidderId: B1, paddle: 12, ceiling: 50000, role: 'bidder' },
  bid_accepted: { ...ev, t: 'bid_accepted', mid: MID, bidId: BID, amount: 35000 },
  bid_rejected: {
    ...ev,
    t: 'bid_rejected',
    mid: MID,
    reason: 'over_ceiling',
    retryable: false,
  },
  price: {
    ...ev,
    t: 'price',
    price: 35000,
    leaderId: B1,
    leaderPaddle: 12,
    endTs: 1789000060000,
    minNext: 36000,
    extensions: 0,
  },
  state: { ...ev, t: 'state', snapshot },
  confirm_request: {
    ...ev,
    t: 'confirm_request',
    confirmId: 'c1',
    amount: 35000,
    expiresAt: 1789000018000,
  },
  hammer: {
    ...ev,
    t: 'hammer',
    winnerId: B1,
    price: 52000,
    ranking: [{ bidderId: B1, amount: 52000 }],
  },
  settlement_update: {
    ...ev,
    t: 'settlement_update',
    rev: 2,
    auctionState: 'CAPTURING',
    you: 'CAPTURING',
  },
  audit_event: { ...ev, t: 'audit_event', audit },
  error: { v: 1, t: 'error', code: 'rate_limited', message: 'slow down', retryAfterMs: 333 },
};

const dec = (o: unknown) => decodeServerMsg(JSON.stringify(o));

describe('server messages (T-RT-015)', () => {
  it('covers all ten message types', () => {
    expect(Object.keys(serverSchemas).sort()).toEqual(Object.keys(fixtures).sort());
    expect(Object.keys(fixtures)).toHaveLength(10);
  });

  it.each(Object.keys(fixtures))('parses %s from its fixture', (t) => {
    expect(dec(fixtures[t]).ok).toBe(true);
  });

  it('accepts a hammer with no winner and a price with no leader', () => {
    expect(dec({ ...(fixtures.hammer as object), winnerId: null, ranking: [] }).ok).toBe(true);
    expect(dec({ ...(fixtures.price as object), leaderId: null, leaderPaddle: null }).ok).toBe(
      true,
    );
  });

  it('rejects more than 50 recent audit entries', () => {
    const big = { ...snapshot, recentAudit: Array.from({ length: 51 }, () => audit) };
    expect(dec({ ...ev, t: 'state', snapshot: big }).ok).toBe(false);
  });

  it('rejects extra fields and unknown reason codes', () => {
    expect(dec({ ...(fixtures.price as object), extra: 1 }).ok).toBe(false);
    expect(dec({ ...(fixtures.bid_rejected as object), reason: 'nope' }).ok).toBe(false);
  });

  it('rejects client-only types', () => {
    expect(dec({ v: 1, t: 'join', token: 'x' }).ok).toBe(false);
  });
});

describe('seq and ts (T-RT-016)', () => {
  const withSeq = Object.keys(fixtures).filter((t) => t !== 'error');

  it.each(withSeq)('%s without seq is rejected', (t) => {
    const rest: Record<string, unknown> = { ...(fixtures[t] as object) };
    delete rest.seq;
    expect(dec(rest).ok).toBe(false);
  });

  it.each(withSeq)('%s without ts is rejected', (t) => {
    const rest: Record<string, unknown> = { ...(fixtures[t] as object) };
    delete rest.ts;
    expect(dec(rest).ok).toBe(false);
  });

  it.each([0, -1, 1.5, '3'])('seq %s is rejected', (seq) => {
    expect(dec({ ...(fixtures.price as object), seq }).ok).toBe(false);
  });

  it('error frames may omit seq, and may carry a positive one', () => {
    expect(dec(fixtures.error).ok).toBe(true);
    expect(dec({ ...(fixtures.error as object), seq: 7 }).ok).toBe(true);
    expect(dec({ ...(fixtures.error as object), seq: 0 }).ok).toBe(false);
  });
});

describe('error frames and room-size limits (R-RT-017, R-RT-121)', () => {
  it('scrubs bearer tokens and stack lines from the message', () => {
    const msg = 'failed Bearer abc.def.ghi\n    at run (/srv/app.js:1:1)';
    const enc = encodeMsg({ v: 1, t: 'error', code: 'internal', message: msg });
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    expect(enc.value).not.toContain('abc.def.ghi');
    expect(enc.value).not.toContain('app.js');
  });

  it('truncates a very long message instead of failing', () => {
    const enc = encodeMsg({ v: 1, t: 'error', code: 'internal', message: 'a b '.repeat(5000) });
    expect(enc.ok).toBe(true);
    if (enc.ok) expect(enc.value.length).toBeLessThan(600);
  });

  it('rejects paddle 0, negative paddles and duplicate roster entries', () => {
    const roster = (r: unknown) => dec({ ...ev, t: 'state', snapshot: { ...snapshot, roster: r } });
    const row = { bidderId: B1, paddle: 12, name: 'Ada', hold: 'HELD' };
    expect(roster([row]).ok).toBe(true);
    expect(roster([{ ...row, paddle: 0 }]).ok).toBe(false);
    expect(roster([{ ...row, paddle: -5 }]).ok).toBe(false);
    expect(roster([row, { ...row, bidderId: AUCTION }]).ok).toBe(false);
  });

  it('caps the hammer ranking', () => {
    const ranking = Array.from({ length: 201 }, () => ({ bidderId: B1, amount: 1 }));
    expect(dec({ ...(fixtures.hammer as object), ranking }).ok).toBe(false);
  });

  it('accepts the optional stopped flag on hammer and snapshot, and refuses a non-boolean', () => {
    const hammer = fixtures.hammer as object;
    expect(dec({ ...hammer, stopped: true }).ok).toBe(true);
    expect(dec({ ...hammer, stopped: 'yes' }).ok).toBe(false);
    const state = { ...ev, t: 'state' };
    expect(dec({ ...state, snapshot: { ...snapshot, stopped: true } }).ok).toBe(true);
    expect(dec({ ...state, snapshot: { ...snapshot, stopped: 1 } }).ok).toBe(false);
  });

  it('keeps stopped optional so older frames still decode', () => {
    const decoded = dec(fixtures.hammer);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value).not.toHaveProperty('stopped');
  });
});
