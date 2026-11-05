import { describe, expect, it } from 'vitest';
import {
  STALE_SEGMENT_MS,
  VoicePipeline,
  type PipelineOutput,
} from '../../src/pipeline/pipeline.js';
import type { SttEvent } from '../../src/stt/provider.js';
import type { BidContext } from '../../src/types.js';

const B7 = 'bidder-7';

function context(recent: BidContext['recent'] = []): BidContext {
  return {
    nowMs: 0,
    lotState: 'OPEN',
    currentPriceCents: 30000,
    minIncrementCents: 1000,
    highBidderId: null,
    roster: new Map([['7', { bidderId: B7, ceilingCents: 10_000_000, holdActive: true }]]),
    recent,
  };
}

function final(text: string, startMs: number, endMs: number): SttEvent {
  return { type: 'final', text, words: [], startMs, endMs, confidence: 0.95, speechFinal: true };
}

interface Rig {
  pipeline: VoicePipeline;
  setNow: (ms: number) => void;
}

function rig(opts: { auto?: number; recent?: BidContext['recent'] } = {}): Rig {
  let now = 0;
  let n = 0;
  const pipeline = new VoicePipeline({
    roomId: 'room1',
    lotId: 'lot1',
    clock: () => now,
    ids: () => `seg-${++n}`,
    context: () => context(opts.recent),
    ...(opts.auto === undefined ? {} : { policy: { auto: opts.auto, confirm: 0.5 } }),
  });
  return { pipeline, setNow: (ms) => (now = ms) };
}

function decisions(out: PipelineOutput[]) {
  return out.flatMap((o) => (o.type === 'decision' ? [o.decision] : []));
}

describe('T-VOX-101 stale segment rule (R-VOX-093)', () => {
  it('drops a segment decided 5100 ms after audioEnd and processes one at 4900 ms', () => {
    expect(STALE_SEGMENT_MS).toBe(5000);

    const late = rig();
    late.setNow(1000 + 5100);
    const lateOut = late.pipeline.push(final('paddle seven three fifty', 0, 1000));
    const [dropped] = decisions(lateOut);
    expect(dropped?.kind).toBe('drop');
    if (dropped?.kind === 'drop') expect(dropped.reason).toBe('low_confidence');
    expect(lateOut.some((o) => o.type === 'audit' && o.audit === 'stale_segment')).toBe(true);

    const ok = rig();
    ok.setNow(1000 + 4900);
    const okOut = ok.pipeline.push(final('paddle seven three fifty', 0, 1000));
    expect(okOut.some((o) => o.type === 'audit' && o.audit === 'stale_segment')).toBe(false);
    const [kept] = decisions(okOut);
    expect(kept).toBeDefined();
    expect(kept?.evidence.reason).not.toBe('low_confidence');
  });
});

describe('T-VOX-110 determinism (R-VOX-102)', () => {
  it('emits an identical output list for identical events and a fake clock', () => {
    const run = (): PipelineOutput[] => {
      const { pipeline, setNow } = rig();
      const out: PipelineOutput[] = [];
      const script: Array<[number, SttEvent]> = [
        [1100, final('paddle seven three fifty', 0, 1000)],
        [3100, final('no make it four hundred', 2000, 3000)],
        [5200, final('paddle seven scratch that', 4000, 5000)],
      ];
      for (const [at, ev] of script) {
        setNow(at);
        out.push(...pipeline.push(ev));
      }
      setNow(9000);
      out.push(...pipeline.tick());
      return out;
    };
    const a = run();
    expect(a.length).toBeGreaterThan(0);
    expect(run()).toEqual(a);
  });
  // The static ban on Date.now and Math.random in src/decide, src/parser, src/segment and
  // src/pipeline is enforced by test/lint/guards.test.ts (determinism guard).
});

describe('T-VOX-114 corrections flow (R-VOX-034, 044)', () => {
  it('asks to change $350 to $400 and places one bid of $400 only', () => {
    const { pipeline, setNow } = rig({ auto: 1.01 });
    const all: PipelineOutput[] = [];

    setNow(1100);
    const first = pipeline.push(final('paddle seven three fifty', 0, 1000));
    all.push(...first);
    const pending = decisions(first).find((d) => d.kind === 'confirm');
    expect(pending?.kind).toBe('confirm');
    if (pending?.kind !== 'confirm') return;
    expect(pending.prompt.options[0]?.amountCents).toBe(35000);

    setNow(3100);
    const second = pipeline.push(final('no make it four hundred', 2000, 3000));
    all.push(...second);
    const correction = decisions(second).find((d) => d.kind === 'confirm');
    expect(correction?.kind).toBe('confirm');
    if (correction?.kind !== 'confirm') return;
    expect(correction.prompt.text).toBe('Change paddle 7 from $350 to $400?');
    expect(correction.prompt.options.map((o) => o.amountCents)).toEqual([40000]);

    setNow(4000);
    const outcome = pipeline.answer(correction.prompt.promptId, 'opt-1', 'bidder');
    expect(outcome).toMatchObject({ kind: 'bid', bidderId: B7, amountCents: 40000 });

    // The superseded $350 prompt can no longer place anything.
    expect(pipeline.answer(pending.prompt.promptId, 'opt-1', 'bidder').kind).not.toBe('bid');
    expect(decisions(all).some((d) => d.kind === 'accept')).toBe(false);
  });
});

describe('retract cancels pending only', () => {
  it('cancels a fresh pending candidate', () => {
    const { pipeline, setNow } = rig({ auto: 1.01 });
    setNow(1100);
    const first = decisions(pipeline.push(final('paddle seven three fifty', 0, 1000)));
    const prompt = first.find((d) => d.kind === 'confirm');
    expect(prompt?.kind).toBe('confirm');
    setNow(3100);
    const out = pipeline.push(final('paddle seven scratch that', 2000, 3000));
    expect(out.some((o) => o.type === 'confirm_cancelled')).toBe(true);
    expect(out.some((o) => o.type === 'advisory')).toBe(false);
    if (prompt?.kind === 'confirm') {
      expect(pipeline.answer(prompt.prompt.promptId, 'opt-1', 'bidder').kind).not.toBe('bid');
    }
  });

  it('emits retract_after_accept for an accepted bid and cancels nothing', () => {
    const recent = [{ bidderId: B7, amountCents: 35000, atMs: 1000 }];
    const { pipeline, setNow } = rig({ recent });
    setNow(3100);
    const out = pipeline.push(final('paddle seven scratch that', 2000, 3000));
    expect(out.some((o) => o.type === 'confirm_cancelled')).toBe(false);
    const advisory = out.find((o) => o.type === 'advisory');
    expect(advisory).toMatchObject({
      advisory: 'retract_after_accept',
      bidderId: B7,
      amountCents: 35000,
    });
    const [d] = decisions(out);
    expect(d).toMatchObject({ kind: 'drop', reason: 'retract' });
  });
});
