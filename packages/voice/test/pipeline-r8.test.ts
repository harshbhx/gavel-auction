import { describe, expect, it } from 'vitest';
import { answerConfirm } from '../src/decide/answer.js';
import { isReplayConflict, toPlaceBid, type Decision, type VoiceEvidence } from '../src/index.js';
import type { BidContext, ConfirmPrompt } from '../src/types.js';

const AUCTION = '01JC0000000000000000000009';
const rules = {
  status: 'bid' as const,
  amountCents: 50000,
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
    transcript: 'paddle twelve five hundred',
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

function accept(over: Partial<VoiceEvidence> = {}): Decision {
  return {
    kind: 'accept',
    bidderId: '01JB0000000000000000000001',
    amountCents: 50000,
    confidence: 0.92,
    evidence: evidence(over),
  };
}

const prompt = (spokenAnswerAllowed: boolean): ConfirmPrompt => ({
  promptId: 'p1',
  text: '$500 or $600 for paddle 7?',
  ttlMs: 5000,
  expiresAtMs: 9000,
  defaultAction: 'drop',
  spokenAnswerAllowed,
  options: [
    { id: 'o500', label: '$500', bidderId: 'B7', amountCents: 50000 },
    { id: 'o600', label: '$600', bidderId: 'B7', amountCents: 60000 },
  ],
});

const confirm = (spokenAnswerAllowed: boolean): Decision => ({
  kind: 'confirm',
  evidence: evidence({ confidence: 0.6, reason: 'hedged' }),
  prompt: prompt(spokenAnswerAllowed),
});

const base = { auctionId: AUCTION, lotId: 'lot1', at: 5000 };

const fresh = (over: Partial<BidContext> = {}): BidContext => ({
  nowMs: 5000,
  lotState: 'OPEN',
  currentPriceCents: 30000,
  minIncrementCents: 1000,
  highBidderId: null,
  roster: new Map([['7', { bidderId: 'B7', ceilingCents: 1_000_000, holdActive: true }]]),
  recent: [],
  ...over,
});

describe('R8-V03 command id covers the command body', () => {
  it('two options of one prompt get different ids', () => {
    const a = toPlaceBid(confirm(true), { ...base, confirmedOptionId: 'o500', current: fresh() });
    const b = toPlaceBid(confirm(true), { ...base, confirmedOptionId: 'o600', current: fresh() });
    expect(a?.commandId).toBeDefined();
    expect(b?.commandId).not.toBe(a?.commandId);
  });

  it('a replay differing only in transcript or confidence keeps the same id (R9-V05)', () => {
    const a = toPlaceBid(accept(), base);
    const b = toPlaceBid(
      accept({ transcript: 'Paddle 12, $500.', confidence: 0.95, audioStartMs: 183450 }),
      base,
    );
    expect(b?.commandId).toBe(a?.commandId);
    expect(b?.audit.transcript).toBe('Paddle 12, $500.');
    expect(b?.audit.confidenceBps).not.toBe(a?.audit.confidenceBps);
  });

  it('a different amount or bidder gets a different id (R9-V05)', () => {
    const a = toPlaceBid(accept(), base);
    const other = accept();
    if (other.kind !== 'accept') return;
    const b = toPlaceBid({ ...other, amountCents: 60000 }, base);
    const c = toPlaceBid({ ...other, bidderId: '01JB0000000000000000000002' }, base);
    expect(b?.commandId).not.toBe(a?.commandId);
    expect(c?.commandId).not.toBe(a?.commandId);
  });

  it('isReplayConflict recognises an engine command_conflict only (R9-V05)', () => {
    expect(isReplayConflict(Object.assign(new Error('x'), { code: 'command_conflict' }))).toBe(
      true,
    );
    expect(isReplayConflict(Object.assign(new Error('x'), { code: 'bad_command' }))).toBe(false);
    expect(isReplayConflict(null)).toBe(false);
  });

  it('an identical replay keeps the same id', () => {
    expect(toPlaceBid(accept(), { ...base, at: 9999 })?.commandId).toBe(
      toPlaceBid(accept(), base)?.commandId,
    );
  });
});

describe('R8-V10 spoken confirmation gate', () => {
  it('toPlaceBid refuses a voice confirm when the prompt forbids spoken answers', () => {
    const ctx = {
      ...base,
      confirmedOptionId: 'o500',
      confirmedBy: 'voice' as const,
      current: fresh(),
    };
    expect(toPlaceBid(confirm(false), ctx)).toBeNull();
    expect(toPlaceBid(confirm(true), ctx)).not.toBeNull();
    expect(toPlaceBid(confirm(false), { ...ctx, confirmedBy: 'bidder' as const })).not.toBeNull();
  });

  it('answerConfirm rejects by voice when the prompt forbids spoken answers', () => {
    const ctx: BidContext = {
      nowMs: 5000,
      lotState: 'OPEN',
      currentPriceCents: 30000,
      minIncrementCents: 1000,
      highBidderId: null,
      roster: new Map([['7', { bidderId: 'B7', ceilingCents: 1_000_000, holdActive: true }]]),
      recent: [],
    };
    expect(answerConfirm({ prompt: prompt(false), ctx, optionId: 'o500', by: 'voice' })).toEqual({
      kind: 'rejected',
      by: 'voice',
    });
  });
});

describe('toPlaceBid re-validation of a confirmed option (R-VOX-069)', () => {
  const ctx = { ...base, confirmedOptionId: 'o500', current: fresh() };

  it('places the bid when the option still validates', () => {
    expect(toPlaceBid(confirm(true), { ...ctx, current: fresh() })?.amountCents).toBe(50000);
  });

  it('refuses when the price moved past the option', () => {
    expect(
      toPlaceBid(confirm(true), { ...ctx, current: fresh({ currentPriceCents: 60000 }) }),
    ).toBeNull();
  });

  it('refuses when the bidder is already the high bidder', () => {
    expect(
      toPlaceBid(confirm(true), { ...ctx, current: fresh({ highBidderId: 'B7' }) }),
    ).toBeNull();
  });

  it('refuses when the lot is no longer open', () => {
    expect(toPlaceBid(confirm(true), { ...ctx, current: fresh({ lotState: 'OTHER' }) })).toBeNull();
  });
});

describe('toPlaceBid needs a fresh context for a confirmed option (R-VOX-069)', () => {
  it('gives no bid without a fresh context', () => {
    expect(toPlaceBid(confirm(true), { ...base, confirmedOptionId: 'o500' })).toBeNull();
  });

  it('records who confirmed the bid', () => {
    const ctx = { ...base, confirmedOptionId: 'o500', current: fresh() };
    expect(toPlaceBid(confirm(true), ctx)?.audit.confirmedBy).toBe('bidder');
    expect(toPlaceBid(confirm(true), { ...ctx, confirmedBy: 'auctioneer' })?.audit.confirmedBy).toBe(
      'auctioneer',
    );
  });

  it('keeps the expiry drop', () => {
    const ctx = { ...base, at: 9000, confirmedOptionId: 'o500', current: fresh() };
    expect(toPlaceBid(confirm(true), ctx)).toBeNull();
  });
});
