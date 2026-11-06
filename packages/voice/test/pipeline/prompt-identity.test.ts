import { describe, expect, it } from 'vitest';
import { answerConfirm } from '../../src/decide/answer.js';
import { PromptBook } from '../../src/decide/prompts.js';
import { VoicePipeline, type PipelineOutput } from '../../src/pipeline/pipeline.js';
import type { SttEvent } from '../../src/stt/provider.js';
import type { BidContext, ConfirmPrompt } from '../../src/types.js';

const ctx = (): BidContext => ({
  nowMs: 1000,
  lotState: 'OPEN',
  currentPriceCents: 30000,
  minIncrementCents: 1000,
  highBidderId: null,
  roster: new Map([
    ['7', { bidderId: 'B7', ceilingCents: 10_000_000, holdActive: true }],
    ['12', { bidderId: 'B12', ceilingCents: 10_000_000, holdActive: true }],
  ]),
  recent: [],
});

const prompt: ConfirmPrompt = {
  promptId: 'p1',
  text: 'q',
  ttlMs: 10000,
  expiresAtMs: 11000,
  defaultAction: 'drop',
  options: [
    { id: 'a', label: '$500', bidderId: 'B7', amountCents: 50000 },
    { id: 'b', label: '$500', bidderId: 'B12', amountCents: 50000 },
  ],
  spokenAnswerAllowed: true,
  targetBidderId: 'B7',
};

describe('R-VOX-069 answers are tied to the answering bidder', () => {
  it('a bidder cannot confirm an option naming another bidder', () => {
    const own = answerConfirm({
      prompt,
      ctx: ctx(),
      optionId: 'b',
      by: 'bidder',
      answeringBidderId: 'B7',
    });
    expect(own).toEqual({ kind: 'rejected', by: 'bidder' });
  });

  it('an answer with no identity is refused for a bidder and for voice', () => {
    expect(answerConfirm({ prompt, ctx: ctx(), optionId: 'a', by: 'bidder' }).kind).toBe(
      'rejected',
    );
    expect(answerConfirm({ prompt, ctx: ctx(), optionId: 'a', by: 'voice' }).kind).toBe('rejected');
  });

  it('a bidder confirms their own option and the auctioneer may pick another bidder', () => {
    expect(
      answerConfirm({ prompt, ctx: ctx(), optionId: 'a', by: 'bidder', answeringBidderId: 'B7' }),
    ).toMatchObject({ kind: 'bid', bidderId: 'B7', by: 'bidder' });
    expect(answerConfirm({ prompt, ctx: ctx(), optionId: 'b', by: 'auctioneer' })).toMatchObject({
      kind: 'bid',
      bidderId: 'B12',
      by: 'auctioneer',
    });
  });

  it('an echo that differs from the stored option is refused', () => {
    const base = { prompt, ctx: ctx(), optionId: 'a', by: 'bidder' as const };
    const mine = { ...base, answeringBidderId: 'B7' };
    expect(answerConfirm({ ...mine, echo: { bidderId: 'B7', amountCents: 90000 } }).kind).toBe(
      'rejected',
    );
    expect(answerConfirm({ ...mine, echo: { bidderId: 'B12', amountCents: 50000 } }).kind).toBe(
      'rejected',
    );
    expect(answerConfirm({ ...mine, echo: { bidderId: 'B7', amountCents: 50000 } }).kind).toBe(
      'bid',
    );
  });
});

describe('prompt rate limit', () => {
  it('limits per key, with a larger room cap, and answered prompts do not count', () => {
    let t = 0;
    const book = new PromptBook<null>(() => t, { rateMax: 2, roomMax: 4 });
    // Four bidders are each allowed a prompt: ordinary bidding is not locked out.
    for (const k of ['a', 'b', 'c', 'd']) expect(book.open(k, null).opened).toBe(true);
    expect(book.open('e', null).opened).toBe(false);
    expect(book.rateLimited).toBe(1);
    // Answering one frees its slot.
    const first = book.open('a', null);
    expect(first.opened).toBe(true);
    if (first.opened) expect(book.take(first.prompt.promptId).status).toBe('ok');
    expect(book.open('e', null).opened).toBe(true);
    t = 20000;
    expect(book.open('f', null).opened).toBe(true);
  });

  it('a superseded prompt is not counted against the key', () => {
    const book = new PromptBook<null>(() => 0, { rateMax: 2, roomMax: 10 });
    for (let i = 0; i < 6; i++) expect(book.open('k', null).opened).toBe(true);
    const r = book.open('k', null);
    expect(r.opened).toBe(true);
  });

  it('a rejected open carries the rate_limited audit reason', () => {
    const book = new PromptBook<null>(() => 0, { rateMax: 1, roomMax: 1 });
    book.open('a', null);
    const r = book.open('b', null);
    expect(r.opened).toBe(false);
    expect(r.audit.at(-1)?.reason).toBe('rate_limited');
  });
});

function final(text: string, startMs: number, endMs: number): SttEvent {
  return { type: 'final', text, words: [], startMs, endMs, confidence: 0.95, speechFinal: true };
}

function promptsOf(out: PipelineOutput[]): ConfirmPrompt[] {
  return out.flatMap((o) =>
    o.type === 'decision' && o.decision.kind === 'confirm' ? [o.decision.prompt] : [],
  );
}

function pipelineFor(lotId: string): { pipeline: VoicePipeline; setNow: (ms: number) => void } {
  let now = 0;
  let n = 0;
  const pipeline = new VoicePipeline({
    roomId: 'room1',
    lotId,
    clock: () => now,
    ids: () => `seg-${++n}`,
    context: ctx,
    policy: { auto: 1.01, confirm: 0.5 },
  });
  return { pipeline, setNow: (ms) => (now = ms) };
}

describe('prompt and option ids are unique across pipelines', () => {
  it('the same speech on two lots gives different prompt and option ids', () => {
    const run = (lot: string): ConfirmPrompt | undefined => {
      const { pipeline, setNow } = pipelineFor(lot);
      setNow(1100);
      return promptsOf(pipeline.push(final('paddle seven five hundred', 0, 1000)))[0];
    };
    const a = run('lot3');
    const b = run('lot4');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.promptId).not.toBe(b?.promptId);
    expect(a?.options[0]?.id).not.toBe(b?.options[0]?.id);
  });

  it('a delayed answer from another lot does not confirm this lot prompt', () => {
    const lot3 = pipelineFor('lot3');
    lot3.setNow(1100);
    const old = promptsOf(lot3.pipeline.push(final('paddle seven five hundred', 0, 1000)))[0];
    const lot4 = pipelineFor('lot4');
    lot4.setNow(1100);
    const fresh = promptsOf(lot4.pipeline.push(final('paddle seven five hundred', 0, 1000)))[0];
    expect(old).toBeDefined();
    expect(fresh).toBeDefined();
    const out = lot4.pipeline.answer(
      old?.promptId ?? '',
      old?.options[0]?.id ?? '',
      'bidder',
      'B7',
    );
    expect(out.kind).not.toBe('bid');
  });

  it('two prompts for unresolved bidders do not supersede each other', () => {
    const { pipeline, setNow } = pipelineFor('lot1');
    setNow(1100);
    const first = pipeline.push(final('five hundred', 0, 1000));
    setNow(2200);
    const second = pipeline.push(final('six hundred', 1500, 2100));
    const all = [...first, ...second];
    expect(promptsOf(all)).toHaveLength(2);
    expect(all.some((o) => o.type === 'audit' && o.audit === 'superseded')).toBe(false);
  });
});
