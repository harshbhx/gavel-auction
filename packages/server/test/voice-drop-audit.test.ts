import type { BidMsg, MsgId } from '@gavel/shared';
import { auditRecordsFromEvents } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { dropOf } from '../src/voice/bridge';
import { redactEventForExport } from '../src/auth/authorize';
import { setup } from './room-harness';

describe('voice drops and audio times in the room log (issue 710)', () => {
  it('persists a drop as its own event without a transcript', async () => {
    const t = await setup();
    await t.room.recordVoiceDrop({
      segmentId: 'seg-1',
      audioStartMs: 100,
      audioEndMs: 900,
      confidenceBps: 700,
      reason: 'hedged',
    });
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    const drop = events.find((e) => e.type === 'voice_dropped');
    expect(drop).toBeDefined();
    expect(JSON.stringify(drop)).not.toMatch(/transcript/);
    expect(auditRecordsFromEvents(events).at(-1)).toMatchObject({
      outcome: 'dropped',
      source: 'voice',
      confidenceBps: 700,
      audioEndMs: 900,
    });
  });

  it('keeps start and end of a voice bid in its audit row', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const msg: BidMsg = {
      v: 1,
      t: 'bid',
      mid: t.ids.mint<'MsgId'>() as MsgId,
      amount: 12000,
      source: 'voice',
      confidence: 0.97,
      audioTsMs: 1200,
      audioEndMs: 2100,
    };
    await t.room.submitBid(c1.conn, msg);
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    const rec = auditRecordsFromEvents(events).find((r) => r.outcome === 'accepted');
    expect(rec).toMatchObject({ audioStartMs: 1200, audioEndMs: 2100, confidenceBps: 9700 });
  });

  it('hides who and how much from the auctioneer export of a drop', async () => {
    const t = await setup();
    await t.room.recordVoiceDrop({
      segmentId: 'seg-2',
      confidenceBps: 100,
      reason: 'no_bidder',
      parsedCents: 12000 as never,
    });
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    const drop = events.find((e) => e.type === 'voice_dropped');
    if (drop === undefined) throw new Error('no drop');
    expect(JSON.stringify(redactEventForExport('auctioneer', drop))).not.toMatch(/12000/);
    expect(JSON.stringify(redactEventForExport('admin', drop))).toMatch(/12000/);
  });

  it('maps a decision to a drop record with an integer confidence', () => {
    const drop = dropOf({
      kind: 'drop',
      reason: 'hedged',
      evidence: {
        segmentId: 'seg-3',
        idempotencyKey: 'k',
        transcript: 'maybe about fifty',
        audioStartMs: 5,
        audioEndMs: 9,
        sttProvider: 'x',
        sttConfidence: 0.07,
        replay: false,
        rules: {
          status: 'ambiguous',
          bidder: null,
          amountCents: null,
          reason: 'hedged',
          candidates: [],
          flags: [],
          confidence: 0.07,
          source: 'rules',
        },
        llm: null,
        confidence: 0.07,
        reason: 'hedged',
      },
    } as never);
    expect(drop).toEqual({
      segmentId: 'seg-3',
      audioStartMs: 5,
      audioEndMs: 9,
      confidenceBps: 700,
      reason: 'hedged',
    });
  });
});
