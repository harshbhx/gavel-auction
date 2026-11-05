import type { Cents, MsgId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { eventFrames, stripConfirmAudit } from '../src/room/resync';

describe('confirm rows shown to the auctioneer (R-RT-055, #1518)', () => {
  const audit = {
    bidId: 'b1',
    parsedAmount: 150000 as Cents,
    transcript: 'bid fifteen hundred',
    audioTsMs: 42,
    outcome: 'rejected',
    reason: 'awaiting confirmation',
  };

  it('strips amount, transcript and audio time', () => {
    expect(stripConfirmAudit(audit)).toEqual({
      bidId: 'b1',
      outcome: 'rejected',
      reason: 'awaiting confirmation',
    });
  });

  it('replays confirm_requested and confirm_resolved without them', () => {
    for (const type of ['confirm_requested', 'confirm_resolved'] as const) {
      const event = {
        type,
        seq: 5,
        ts: 1,
        mid: 'm' as MsgId,
        outcome: 'expired',
        audit,
      } as never;
      const frames = eventFrames(event, true) as unknown as { audit: object }[];
      expect(frames).toHaveLength(1);
      expect(JSON.stringify(frames[0]?.audit)).not.toMatch(/150000|fifteen|audioTsMs/);
    }
  });
});
