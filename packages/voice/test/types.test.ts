import { describe, expect, it } from 'vitest';
import {
  auditRecordSchema,
  toAuditRecord,
  voiceEvidenceSchema,
  type Decision,
  type VoiceEvidence,
} from '../src/index.js';

const evidence: VoiceEvidence = {
  segmentId: '01JC0000000000000000000001',
  idempotencyKey: 'room1:lot1:183420:0123456789ab',
  transcript: 'paddle twelve three fifty',
  audioStartMs: 183420,
  audioEndMs: 185010,
  sttProvider: 'deepgram',
  sttConfidence: 0.94,
  replay: false,
  confidence: 0.93,
  reason: 'ok',
  rules: {
    status: 'bid',
    amountCents: 35000,
    bidder: { kind: 'paddle', value: '12' },
    reason: 'ok',
    candidates: [],
    flags: [],
    confidence: 0.93,
    source: 'rules',
  },
  llm: {
    status: 'bid',
    amountCents: 35000,
    bidder: null,
    reason: 'ok',
    candidates: [],
    flags: [],
    confidence: 0.9,
    source: 'llm',
  },
};

const decisions: Decision[] = [
  { kind: 'accept', bidderId: '01JB1', amountCents: 35000, confidence: 0.93, evidence },
  {
    kind: 'confirm',
    evidence: { ...evidence, reason: 'low_confidence', confidence: 0.6 },
    prompt: {
      promptId: '01JC2',
      text: 'Did you mean $350 for paddle 12?',
      ttlMs: 10000,
      expiresAtMs: 195000,
      defaultAction: 'drop',
      options: [
        { id: 'o1', label: 'Yes, $350 for paddle 12', bidderId: '01JB1', amountCents: 35000 },
      ],
      spokenAnswerAllowed: false,
    },
  },
  {
    kind: 'drop',
    reason: 'no_amount',
    evidence: { ...evidence, reason: 'no_amount', confidence: 0.1 },
  },
];

describe('T-VOX-079 audit record per decision', () => {
  it('accepts the spec evidence payload', () => {
    expect(voiceEvidenceSchema.parse(evidence)).toEqual(evidence);
  });

  it.each(decisions.map((d) => [d.kind, d] as const))('%s writes a complete record', (_k, d) => {
    const rec = auditRecordSchema.parse(toAuditRecord(d));
    expect(rec.transcript).toBe(d.evidence.transcript);
    expect(rec.reason).toBe(d.kind === 'drop' ? d.reason : d.evidence.reason);
    expect(rec.evidence).toEqual(d.evidence);
    expect(typeof rec.confirmed).toBe('boolean');
    if (d.kind === 'accept') {
      expect(rec.outcome).toBe('accepted');
      expect(rec.bidderId).toBe('01JB1');
      expect(rec.amountCents).toBe(35000);
    }
    if (d.kind === 'confirm') {
      expect(rec.outcome).toBe('pending_confirm');
      expect(rec.amountCents).toBe(35000);
    }
    if (d.kind === 'drop') expect(rec.outcome).toBe('rejected');
  });

  it('rejects unknown keys, fractional cents and bad reasons', () => {
    expect(() => voiceEvidenceSchema.parse({ ...evidence, extra: 1 })).toThrow();
    expect(() =>
      voiceEvidenceSchema.parse({ ...evidence, rules: { ...evidence.rules, amountCents: 1.5 } }),
    ).toThrow();
    expect(() => voiceEvidenceSchema.parse({ ...evidence, reason: 'nope' })).toThrow();
  });
});
