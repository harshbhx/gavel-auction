import { describe, expect, it } from 'vitest';
import { toBps } from '../../shared/src/confidence';
import {
  commandIdFromKey,
  confidenceToBps,
  resolveConfirm,
  toPlaceBid,
  type Decision,
  type VoiceEvidence,
} from '../src/index.js';

const rules = {
  status: 'bid' as const,
  amountCents: 35000,
  bidder: null,
  reason: 'ok' as const,
  candidates: [],
  flags: [],
  confidence: 0.92,
  source: 'rules' as const,
};

function evidence(over: Partial<VoiceEvidence> = {}): VoiceEvidence {
  return {
    segmentId: 'seg1',
    idempotencyKey: 'room1:lot1:183420:0123456789ab',
    transcript: 'paddle twelve three fifty',
    audioStartMs: 183420,
    audioEndMs: 185010,
    sttProvider: 'fake',
    sttConfidence: 0.9,
    replay: false,
    confidence: 0.92,
    reason: 'ok',
    rules,
    llm: null,
    ...over,
  };
}

const AUCTION = '01JC0000000000000000000009';
const accept: Decision = {
  kind: 'accept',
  bidderId: '01JB0000000000000000000001',
  amountCents: 35000,
  confidence: 0.92,
  evidence: evidence(),
};
const confirm: Decision = {
  kind: 'confirm',
  evidence: evidence({ confidence: 0.6, reason: 'hedged' }),
  prompt: {
    promptId: 'p1',
    text: 'Paddle 12 at 350?',
    ttlMs: 5000,
    expiresAtMs: 9000,
    defaultAction: 'drop',
    spokenAnswerAllowed: true,
    options: [
      { id: 'o1', label: 'Yes', bidderId: '01JB0000000000000000000002', amountCents: 35000 },
    ],
  },
};

describe('confidence units (R-VOX-046)', () => {
  it('matches the shared conversion', () => {
    for (const c of [0, 0.5, 0.85, 0.92, 1, 1.4, -1, Number.NaN]) {
      expect(confidenceToBps(c)).toBe(toBps(c));
    }
  });
});

describe('toPlaceBid (R-VOX-071, R-RT-053)', () => {
  it('maps an accept to a voice PlaceBid with integer basis points', () => {
    const cmd = toPlaceBid(accept, { auctionId: AUCTION, lotId: 'lot1', at: 5000 });
    expect(cmd).toMatchObject({
      type: 'PlaceBid',
      source: 'voice',
      bidderId: '01JB0000000000000000000001',
      amountCents: 35000,
      audit: { confidenceBps: 9200, confirmed: false, audioStartMs: 183420 },
    });
    expect(cmd?.commandId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });

  it('gives a replayed segment the same command id at a later time', () => {
    const first = toPlaceBid(accept, { auctionId: AUCTION, lotId: 'lot1', at: 5000 });
    const replay = toPlaceBid(accept, { auctionId: AUCTION, lotId: 'lot1', at: 10_000 });
    expect(replay?.commandId).toBe(first?.commandId);
  });

  it('gives different segments and auctions different ids', () => {
    const a = commandIdFromKey(AUCTION, 'room1:lot1:100:aaaa');
    expect(commandIdFromKey(AUCTION, 'room1:lot1:101:aaaa')).not.toBe(a);
    expect(commandIdFromKey('01JC0000000000000000000008', 'room1:lot1:100:aaaa')).not.toBe(a);
  });

  it('turns a drop or an unresolved confirm into no bid', () => {
    const drop: Decision = { kind: 'drop', reason: 'question', evidence: evidence() };
    expect(toPlaceBid(drop, { auctionId: AUCTION, lotId: 'lot1', at: 1 })).toBeNull();
    expect(toPlaceBid(confirm, { auctionId: AUCTION, lotId: 'lot1', at: 1 })).toBeNull();
  });

  it('builds a confirmed bid only for a real option', () => {
    const ctx = { auctionId: AUCTION, lotId: 'lot1', at: 1 };
    expect(toPlaceBid(confirm, { ...ctx, confirmedOptionId: 'nope' })).toBeNull();
    const cmd = toPlaceBid(confirm, { ...ctx, confirmedOptionId: 'o1' });
    expect(cmd?.audit).toMatchObject({ confirmed: true, confidenceBps: 6000 });
    expect(cmd?.bidderId).toBe('01JB0000000000000000000002');
  });
});

describe('resolveConfirm (R-ENG-084)', () => {
  it('marks the audit confirmed when the bidder says yes', () => {
    const audit = resolveConfirm(confirm, { optionId: 'o1' });
    expect(audit).toMatchObject({ outcome: 'accepted', confirmed: true, amountCents: 35000 });
  });

  it('rejects on no, unknown option, or a non-confirm decision', () => {
    expect(resolveConfirm(confirm, { accept: false })).toMatchObject({
      outcome: 'rejected',
      confirmed: false,
    });
    expect(resolveConfirm(confirm, { optionId: 'zz' })?.outcome).toBe('rejected');
    expect(resolveConfirm(accept, { optionId: 'o1' })).toBeNull();
  });
});
