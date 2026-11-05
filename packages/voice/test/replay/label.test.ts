import { describe, expect, it } from 'vitest';
import { REPLAY_LABEL, replayStatusPayload, tagReplay } from '../../src/replay/label.js';
import type { Decision, ParseResult, PipelineEvent, VoiceEvidence } from '../../src/types.js';

const rules: ParseResult = {
  status: 'none',
  bidder: null,
  amountCents: null,
  reason: 'no_amount',
  candidates: [],
  flags: [],
  confidence: 0,
  source: 'rules',
};

const evidence: VoiceEvidence = {
  segmentId: 's1',
  idempotencyKey: 'k',
  transcript: 'hello',
  audioStartMs: 0,
  audioEndMs: 10,
  sttProvider: 'replay',
  sttConfidence: 0.9,
  replay: false,
  rules,
  llm: null,
  confidence: 0.5,
  reason: 'no_amount',
};

const drop: Decision = { kind: 'drop', reason: 'no_amount', evidence };

describe('replay labelling', () => {
  it('T-VOX-091: every replay event has replay=true and decisions carry replay evidence', () => {
    const events: PipelineEvent[] = [
      { type: 'caption', text: 'hello', final: true },
      { type: 'decision', decision: drop },
      { type: 'confirm_expired', promptId: 'p1' },
      { type: 'status', stt: 'ok', llm: 'off', droppedFrames: 0 },
    ];
    const tagged = events.map(tagReplay);
    expect(tagged.every((e) => e.replay)).toBe(true);
    const decision = tagged.find((e) => e.type === 'decision');
    if (decision?.type !== 'decision') throw new Error('expected decision');
    expect(decision.decision.evidence.replay).toBe(true);
    expect(drop.evidence.replay).toBe(false);
  });

  it('T-VOX-091: status payload label is Recorded audio replay', () => {
    expect(REPLAY_LABEL).toBe('Recorded audio replay');
    expect(replayStatusPayload()).toEqual({ replay: true, label: 'Recorded audio replay' });
  });
});
