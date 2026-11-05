import { describe, expect, it } from 'vitest';
import { VoicePipeline, type PipelineOutput } from '../../src/pipeline/pipeline.js';
import type { SttEvent } from '../../src/stt/provider.js';
import type { BidContext } from '../../src/types.js';

const context = (): BidContext => ({
  nowMs: 0,
  lotState: 'OPEN',
  currentPriceCents: 30000,
  minIncrementCents: 1000,
  highBidderId: null,
  roster: new Map([
    ['7', { bidderId: 'bidder-7', ceilingCents: 10_000_000, holdActive: true }],
    ['8', { bidderId: 'bidder-8', ceilingCents: 10_000_000, holdActive: true }],
  ]),
  recent: [],
});

function final(text: string, startMs: number, endMs: number): SttEvent {
  return { type: 'final', text, words: [], startMs, endMs, confidence: 0.95, speechFinal: true };
}

describe('R9-V03 answer() expiry audit', () => {
  it('audits a prompt that expired while another was answered', () => {
    let now = 0;
    let n = 0;
    const pipeline = new VoicePipeline({
      roomId: 'room1',
      lotId: 'lot1',
      clock: () => now,
      ids: () => `seg-${++n}`,
      context,
      policy: { auto: 1.01, confirm: 0.5 },
    });
    const prompts: string[] = [];
    const collect = (out: PipelineOutput[]): void => {
      for (const o of out) {
        if (o.type === 'decision' && o.decision.kind === 'confirm') {
          prompts.push(o.decision.prompt.promptId);
        }
      }
    };
    now = 1100;
    collect(pipeline.push(final('paddle seven three fifty', 0, 1000)));
    now = 9100;
    collect(pipeline.push(final('paddle eight four hundred', 8000, 9000)));
    expect(prompts).toHaveLength(2);
    const [expiring, live] = prompts as [string, string];

    // The first prompt is past its 10 s lifetime; answering the second sweeps it out.
    now = 12000;
    pipeline.answer(live, 'opt-1', 'bidder');
    now = 12100;
    const out = pipeline.tick();
    expect(out.some((o) => o.type === 'confirm_expired' && o.promptId === expiring)).toBe(true);
    expect(out.some((o) => o.type === 'audit' && o.audit === 'confirm_expired')).toBe(true);
  });
});

describe('R10-V03 expired prompt pending candidate', () => {
  it('a late answer leaves no pending candidate for a later correction', () => {
    let now = 0;
    let n = 0;
    const pipeline = new VoicePipeline({
      roomId: 'room1',
      lotId: 'lot1',
      clock: () => now,
      ids: () => `seg-${++n}`,
      context,
      policy: { auto: 1.01, confirm: 0.5 },
    });
    let promptId = '';
    now = 1100;
    for (const o of pipeline.push(final('paddle seven three fifty', 0, 1000))) {
      if (o.type === 'decision' && o.decision.kind === 'confirm') {
        promptId = o.decision.prompt.promptId;
      }
    }
    expect(promptId).not.toBe('');
    now = 11500;
    const late = pipeline.answer(promptId, 'opt-1', 'bidder');
    expect(late).toMatchObject({ kind: 'dropped', message: 'That question expired.' });
    now = 11600;
    const texts: string[] = [];
    for (const o of pipeline.push(final('make it four hundred', 10500, 11500))) {
      if (o.type === 'decision' && o.decision.kind === 'confirm') {
        texts.push(o.decision.prompt.text);
      }
    }
    expect(texts.some((t) => t.includes('$350'))).toBe(false);
  });
});
