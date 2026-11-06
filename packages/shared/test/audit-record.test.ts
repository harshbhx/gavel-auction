import { describe, expect, it } from 'vitest';
import {
  AuditPayloadSchema,
  RoomEventSchema,
  auditRecordsFromEvents,
  BidAuditRecordSchema,
  confidenceToBps,
  toBidAuditRecord,
  toPublicBidAuditRecord,
  type AuditPayload,
  type RoomEvent,
} from '../src';

const A = '01J9ZQ5C0B2C4D6F8H0J2K4M6N';
const B = '01J9ZQ3A0B2C4D6F8H0J2K4M6N';
const C = '01J9ZQ7A0B2C4D6F8H0J2K4M6N';

const audit = (extra: Record<string, unknown> = {}): AuditPayload =>
  AuditPayloadSchema.parse({
    bidId: A,
    bidderId: B,
    source: 'voice',
    outcome: 'accepted',
    serverTs: 1_789_000_001_500,
    seq: 7,
    ...extra,
  });

describe('confidenceToBps', () => {
  it('gives an integer for the fractions that are not exact in floating point', () => {
    for (const c of [0.07, 0.14, 0.17, 0.28, 0.34, 0.56]) {
      const bps = confidenceToBps(c);
      expect(Number.isInteger(bps)).toBe(true);
      expect(bps).toBe(Math.round(c * 100) * 100);
    }
    expect(confidenceToBps(0.07)).toBe(700);
  });

  it('clamps and treats NaN as zero', () => {
    expect(confidenceToBps(-1)).toBe(0);
    expect(confidenceToBps(7)).toBe(10_000);
    expect(confidenceToBps(Number.NaN)).toBe(0);
  });
});

describe('one audit record (issue 710)', () => {
  it('carries start, end, integer confidence, parsed amount, outcome and reason', () => {
    const rec = toBidAuditRecord(
      audit({
        audioTsMs: 1200,
        audioEndMs: 2100,
        transcript: 'three fifty',
        parsedAmount: 35000,
        confidence: 0.07,
        confirmed: true,
        outcome: 'rejected',
        reason: 'unconfirmed',
      }),
    );
    expect(BidAuditRecordSchema.parse(rec)).toEqual({
      bidderId: B,
      source: 'voice',
      audioStartMs: 1200,
      audioEndMs: 2100,
      transcript: 'three fifty',
      confidenceBps: 700,
      parsedCents: 35000,
      confirmed: true,
      outcome: 'rejected',
      reason: 'unconfirmed',
      seq: 7,
      serverTs: 1_789_000_001_500,
    });
  });

  it('keeps old audit payloads without an end time valid', () => {
    expect(AuditPayloadSchema.safeParse({ ...audit(), audioTsMs: 5 }).success).toBe(true);
  });

  it('lists drops and pending confirms from the event log', () => {
    const events: RoomEvent[] = [
      RoomEventSchema.parse({
        type: 'confirm_requested',
        auctionId: C,
        seq: 7,
        ts: 1,
        confirmId: 'c1',
        bidderId: B,
        mid: A,
        amount: 35000,
        expiresAt: 2,
        audit: audit({ outcome: 'rejected', reason: 'confirm_pending' }),
      }),
      RoomEventSchema.parse({
        type: 'voice_dropped',
        auctionId: C,
        seq: 8,
        ts: 3,
        drop: { segmentId: 'seg-1', confidenceBps: 700, reason: 'hedged', audioStartMs: 10 },
      }),
    ];
    const recs = auditRecordsFromEvents(events);
    expect(recs.map((r) => r.outcome)).toEqual(['pending_confirm', 'dropped']);
    expect(recs[1]).toMatchObject({ confidenceBps: 700, reason: 'hedged', audioStartMs: 10 });
    expect(recs[1]?.transcript).toBeUndefined();
  });

  it('rejects a drop with a fractional confidence', () => {
    expect(
      RoomEventSchema.safeParse({
        type: 'voice_dropped',
        auctionId: C,
        seq: 1,
        ts: 1,
        drop: { segmentId: 's', confidenceBps: 700.5, reason: 'x' },
      }).success,
    ).toBe(false);
  });

  it('exports accepted rows only, with no transcript, confidence or reason', () => {
    const accepted = toBidAuditRecord(audit({ transcript: 'secret', confidence: 0.9 }));
    expect(toPublicBidAuditRecord(accepted)).toEqual({
      bidderId: B,
      source: 'voice',
      outcome: 'accepted',
      seq: 7,
      serverTs: 1_789_000_001_500,
    });
    expect(toPublicBidAuditRecord(toBidAuditRecord(audit({ outcome: 'rejected' })))).toBeNull();
  });
});
