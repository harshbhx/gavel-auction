import { describe, expect, it } from 'vitest';
import {
  AUDIT_KEYS,
  EVIDENCE_KEYS,
  buildAudit,
  captionPayload,
  promptPayload,
} from '../../src/decide/audit.js';
import { decide, type DecideSegment } from '../../src/decide/decide.js';
import { auditRecordSchema, type BidContext, type ParseResult } from '../../src/types.js';

function bidParse(paddle: string | null, amountCents: number | null): ParseResult {
  return {
    status: 'bid',
    bidder: paddle === null ? null : { kind: 'paddle', value: paddle },
    amountCents,
    reason: 'ok',
    candidates: [],
    flags: [],
    confidence: 0.95,
    source: 'rules',
  };
}

function ctxFor(): BidContext {
  return {
    nowMs: 10_000,
    lotState: 'OPEN',
    currentPriceCents: 10_000,
    minIncrementCents: 500,
    highBidderId: null,
    roster: new Map([
      ['12', { bidderId: 'b12', ceilingCents: 1_000_000, holdActive: true }],
      ['7', { bidderId: 'b7', ceilingCents: 1_000_000, holdActive: true }],
    ]),
    recent: [],
  };
}

function segFor(text: string): DecideSegment {
  return {
    segmentId: 's1',
    idempotencyKey: `room:lot:0:${text.length}`,
    transcript: text,
    audioStartMs: 0,
    audioEndMs: 1000,
    sttProvider: 'fake',
    sttConfidence: 0.95,
    replay: false,
  };
}

describe('decision audit record', () => {
  it('T-VOX-079: accept, confirm and drop each write a complete record', () => {
    const rules = bidParse('12', 15_000);
    const accept = decide(segFor('paddle twelve one fifty'), rules, rules, ctxFor());
    const jump = bidParse('12', 900_000);
    const confirm = decide(segFor('paddle twelve nine thousand'), jump, jump, ctxFor());
    const none: ParseResult = { ...bidParse(null, null), status: 'none', reason: 'no_amount' };
    const drop = decide(segFor('hello'), none, none, ctxFor());

    expect(accept.kind).toBe('accept');
    expect(confirm.kind).toBe('confirm');
    expect(drop.kind).toBe('drop');

    const outcomes = [accept, confirm, drop].map((d) => buildAudit(d).outcome);
    expect(outcomes).toEqual(['accepted', 'pending_confirm', 'rejected']);

    for (const d of [accept, confirm, drop]) {
      const rec = buildAudit(d);
      expect(rec.transcript).toBe(d.kind === 'drop' ? '' : d.evidence.transcript);
      expect(typeof rec.confirmed).toBe('boolean');
      expect(rec.reason).toBe(d.kind === 'drop' ? d.reason : d.evidence.reason);
      for (const key of EVIDENCE_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(rec.evidence, key)).toBe(true);
      }
    }
    const accepted = buildAudit(accept);
    expect(accepted.bidderId).toBe('b12');
    expect(accepted.amountCents).toBe(15_000);
  });

  it('T-VOX-080: caption and prompt payloads carry ariaLive and an alternative action id', () => {
    const cap = captionPayload('Did not catch that.');
    expect(cap.ariaLive).toBe('polite');
    expect(cap.altActionId.length).toBeGreaterThan(0);

    const jump = bidParse('12', 900_000);
    const d = decide(segFor('big'), jump, jump, ctxFor());
    if (d.kind !== 'confirm') throw new Error('expected confirm');
    const p = promptPayload(d.prompt);
    expect(p.ariaLive).toBe('assertive');
    expect(p.altActionId.length).toBeGreaterThan(0);
    expect(p.text).toBe(d.prompt.text);
  });

  it('T-VOX-103: persisted records contain only allow-listed keys', () => {
    const rules = bidParse('12', 15_000);
    const rec = buildAudit(decide(segFor('x'), rules, rules, ctxFor()));
    expect(Object.keys(rec).sort()).toEqual([...AUDIT_KEYS].sort());
    expect(Object.keys(rec.evidence).sort()).toEqual([...EVIDENCE_KEYS].sort());
    expect(auditRecordSchema.safeParse({ ...rec, speakerName: 'Ann' }).success).toBe(false);
    expect(
      auditRecordSchema.safeParse({ ...rec, evidence: { ...rec.evidence, email: 'a@b.c' } })
        .success,
    ).toBe(false);
  });
});
