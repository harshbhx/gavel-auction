import { describe, expect, it } from 'vitest';
import { answerConfirm, parseSpokenAnswer } from '../../src/decide/answer.js';
import type { BidContext, ConfirmPrompt } from '../../src/types.js';

const prompt: ConfirmPrompt = {
  promptId: 'p1',
  text: 'Paddle 7 at $350?',
  ttlMs: 5000,
  expiresAtMs: 9000,
  defaultAction: 'drop',
  spokenAnswerAllowed: true,
  options: [{ id: 'o1', label: 'Yes', bidderId: 'B7', amountCents: 35000 }],
};

function ctx(over: Partial<BidContext> = {}): BidContext {
  return {
    nowMs: 5000,
    lotState: 'OPEN',
    currentPriceCents: 30000,
    minIncrementCents: 1000,
    highBidderId: null,
    roster: new Map([['7', { bidderId: 'B7', ceilingCents: 1_000_000, holdActive: true }]]),
    recent: [],
    ...over,
  };
}

describe('T-VOX-077 answerConfirm (R-VOX-069)', () => {
  it('re-validates against current context and records who confirmed', () => {
    expect(answerConfirm({ prompt, ctx: ctx(), optionId: 'o1', by: 'auctioneer' })).toEqual({
      kind: 'bid',
      bidderId: 'B7',
      amountCents: 35000,
      confirmed: true,
      by: 'auctioneer',
    });
  });

  it('drops when the price moved above the amount and says why', () => {
    const out = answerConfirm({
      prompt,
      ctx: ctx({ currentPriceCents: 36000 }),
      optionId: 'o1',
      by: 'bidder',
      answeringBidderId: 'B7',
    });
    expect(out).toMatchObject({ kind: 'dropped', reason: 'below_minimum' });
    expect(out.kind === 'dropped' && out.message.length > 0).toBe(true);
  });

  it('a decline, an unknown option or an expired prompt places nothing', () => {
    expect(answerConfirm({ prompt, ctx: ctx(), optionId: null, by: 'voice' })).toEqual({
      kind: 'rejected',
      by: 'voice',
    });
    expect(
      answerConfirm({ prompt, ctx: ctx(), optionId: 'zz', by: 'bidder', answeringBidderId: 'B7' })
        .kind,
    ).toBe('rejected');
    expect(
      answerConfirm({
        prompt,
        ctx: ctx({ nowMs: 9000 }),
        optionId: 'o1',
        by: 'bidder',
        answeringBidderId: 'B7',
      }).kind,
    ).toBe('dropped');
  });

  it('a confirmed large jump is placed', () => {
    const jump: ConfirmPrompt = {
      ...prompt,
      options: [{ id: 'o1', label: 'Yes', bidderId: 'B7', amountCents: 300000 }],
    };
    expect(
      answerConfirm({
        prompt: jump,
        ctx: ctx(),
        optionId: 'o1',
        by: 'bidder',
        answeringBidderId: 'B7',
      }),
    ).toMatchObject({ kind: 'bid', amountCents: 300000, confirmed: true });
  });
});

describe('T-VOX-078 spoken answers (R-VOX-070)', () => {
  const device = { mic: 'device', speakerBidderId: 'B7', openPrompts: 1 } as const;

  it('accepts yes words and rejects no words on the device mic', () => {
    for (const t of ['yeah', 'Yes.', 'yep', 'correct', "that's right", 'confirm']) {
      expect(parseSpokenAnswer(t, prompt, device)).toBe('yes');
    }
    for (const t of ['no', 'nope', 'cancel', 'wrong']) {
      expect(parseSpokenAnswer(t, prompt, device)).toBe('no');
    }
    expect(parseSpokenAnswer('maybe', prompt, device)).toBe('ignore');
  });

  it('ignores answers from a room mic, another speaker, or with two open prompts', () => {
    expect(parseSpokenAnswer('yes', prompt, { ...device, mic: 'room' })).toBe('ignore');
    expect(parseSpokenAnswer('yes', prompt, { ...device, speakerBidderId: 'B9' })).toBe('ignore');
    expect(parseSpokenAnswer('yes', prompt, { ...device, openPrompts: 2 })).toBe('ignore');
    expect(parseSpokenAnswer('yes', { ...prompt, spokenAnswerAllowed: false }, device)).toBe(
      'ignore',
    );
  });
});
