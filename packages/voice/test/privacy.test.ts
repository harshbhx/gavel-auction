import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAudit } from '../src/decide/audit.js';
import { decide, type DecideSegment } from '../src/decide/decide.js';
import { auditRecordSchema, type BidContext, type ParseResult } from '../src/types.js';
import {
  PERSISTED_VOICE_KEYS,
  PRIVACY_NOTICE,
  micInUse,
  type CaptureState,
} from '../src/privacy.js';

function bidParse(): ParseResult {
  return {
    status: 'bid',
    bidder: { kind: 'paddle', value: '12' },
    amountCents: 10_000,
    reason: 'ok',
    candidates: [],
    flags: [],
    confidence: 0.95,
    source: 'rules',
  };
}

function ctx(): BidContext {
  return {
    nowMs: 10_000,
    lotState: 'OPEN',
    currentPriceCents: 10_000,
    minIncrementCents: 500,
    highBidderId: null,
    roster: new Map([['12', { bidderId: 'b12', ceilingCents: 1_000_000, holdActive: true }]]),
    recent: [],
  };
}

function seg(transcript: string): DecideSegment {
  return {
    segmentId: 's1',
    idempotencyKey: `room:lot:0:${transcript.length}`,
    transcript,
    audioStartMs: 0,
    audioEndMs: 1000,
    sttProvider: 'fake',
    sttConfidence: 0.95,
    replay: false,
  };
}

const readme = readFileSync(new URL('../docs/PRIVACY.md', import.meta.url), 'utf8');

describe('privacy (T-VOX-104)', () => {
  it('exports the required notice string', () => {
    expect(PRIVACY_NOTICE).toBe(
      'Audio is sent to a speech service to read bids. Do not speak personal data.',
    );
  });

  it('mic indicator is true only for running and muted', () => {
    const states: CaptureState[] = [
      'idle',
      'requesting',
      'denied',
      'no_device',
      'unsupported',
      'insecure_context',
      'running',
      'muted',
      'degraded',
      'error',
    ];
    for (const s of states) {
      if (s === 'running' || s === 'muted') {
        expect(micInUse(s), `${s} should be true`).toBe(true);
      } else {
        expect(micInUse(s), `${s} should be false`).toBe(false);
      }
    }
  });

  it('the persisted keys are exactly the audit record schema keys', () => {
    expect([...PERSISTED_VOICE_KEYS].sort()).toEqual(Object.keys(auditRecordSchema.shape).sort());
  });

  it('a record with a key outside the allow-list is rejected', () => {
    const none = { ...bidParse(), status: 'none' as const };
    const rec = buildAudit(decide(seg('hello'), none, none, ctx()));
    expect(() => auditRecordSchema.parse({ ...rec, speakerName: 'x' })).toThrow();
  });

  it('a drop that read no bid does not keep the transcript', () => {
    const none = { ...bidParse(), status: 'none' as const, reason: 'no_amount' as const };
    const d = decide(seg('my number is five five five'), none, none, ctx());
    expect(d.kind).toBe('drop');
    const rec = buildAudit(d);
    expect(rec.transcript).toBe('');
    expect(rec.evidence.transcript).toBe('');
    expect(JSON.stringify(rec)).not.toContain('number');
  });

  it('a bid-related drop keeps its transcript', () => {
    const low = bidParse();
    const d = decide(seg('paddle twelve one hundred'), low, low, ctx());
    expect(d.kind).toBe('drop');
    expect(buildAudit(d).transcript).toBe('paddle twelve one hundred');
  });
});

describe('PRIVACY.md (T-VOX-108)', () => {
  it('contains the sandbox warning', () => {
    expect(readme.toLowerCase()).toContain('sandbox demo, do not speak personal data');
  });

  it('documents every persisted key and the model vendor', () => {
    for (const key of PERSISTED_VOICE_KEYS) expect(readme, key).toContain(key);
    expect(readme.toLowerCase()).toContain('language model');
  });
});
