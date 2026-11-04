import { describe, expect, it } from 'vitest';
import { AuditPayloadSchema, PublicAuditRowSchema, toPublicAudit } from '../src/wire/audit';

const base = {
  bidId: '01J9ZQ5C0B2C4D6F8H0J2K4M6N',
  bidderId: '01J9ZQ3A0B2C4D6F8H0J2K4M6N',
  source: 'voice',
  outcome: 'accepted',
  serverTs: 1789000001500,
  seq: 15,
};

describe('audit_event payload (T-RT-018)', () => {
  it('accepts the minimal payload', () => {
    expect(AuditPayloadSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the full payload', () => {
    const full = {
      ...base,
      audioTsMs: 1200,
      transcript: 'three fifty for twelve',
      parsedAmount: 35000,
      confidence: 0.62,
      confirmed: true,
      reason: 'ok',
    };
    expect(AuditPayloadSchema.safeParse(full).success).toBe(true);
  });

  it.each(['bidId', 'bidderId', 'source', 'outcome', 'serverTs', 'seq'])('requires %s', (key) => {
    const rest = Object.fromEntries(Object.entries(base).filter(([k]) => k !== key));
    expect(AuditPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it('bounds confidence to [0,1]', () => {
    expect(AuditPayloadSchema.safeParse({ ...base, confidence: 0 }).success).toBe(true);
    expect(AuditPayloadSchema.safeParse({ ...base, confidence: 1 }).success).toBe(true);
    expect(AuditPayloadSchema.safeParse({ ...base, confidence: 1.01 }).success).toBe(false);
    expect(AuditPayloadSchema.safeParse({ ...base, confidence: -0.1 }).success).toBe(false);
  });

  it('rejects unknown source, outcome, fractional cents and extra keys', () => {
    expect(AuditPayloadSchema.safeParse({ ...base, source: 'sms' }).success).toBe(false);
    expect(AuditPayloadSchema.safeParse({ ...base, outcome: 'maybe' }).success).toBe(false);
    expect(AuditPayloadSchema.safeParse({ ...base, parsedAmount: 1.5 }).success).toBe(false);
    expect(AuditPayloadSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe('public audit view (R-RT-038, R-RT-055)', () => {
  const parse = (o: unknown) => AuditPayloadSchema.parse(o);

  it('keeps accepted rows and drops transcript, confidence and reason', () => {
    const row = parse({
      ...base,
      transcript: 'sixty thousand',
      confidence: 0.4,
      parsedAmount: 60000,
      reason: 'x',
    });
    const pub = toPublicAudit(row);
    expect(pub).not.toBeNull();
    expect(pub).not.toHaveProperty('transcript');
    expect(pub).not.toHaveProperty('confidence');
    expect(pub).not.toHaveProperty('reason');
    expect(pub?.parsedAmount).toBe(60000);
    expect(PublicAuditRowSchema.safeParse(pub).success).toBe(true);
  });

  it('hides rejected, expired and superseded rows (ceiling probing)', () => {
    for (const outcome of ['rejected', 'expired', 'superseded']) {
      const row = parse({ ...base, outcome, reason: 'over_ceiling', parsedAmount: 60000 });
      expect(toPublicAudit(row)).toBeNull();
    }
  });

  it('bounds free text on full rows', () => {
    expect(AuditPayloadSchema.safeParse({ ...base, transcript: 'x'.repeat(501) }).success).toBe(
      false,
    );
    expect(AuditPayloadSchema.safeParse({ ...base, reason: 'x'.repeat(121) }).success).toBe(false);
  });
});
