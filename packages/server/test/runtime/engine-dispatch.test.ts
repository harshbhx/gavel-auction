import { EngineError, type AuctionRuntime } from '@gavel/engine';
import type { EngineEnvelope } from '@gavel/payments';
import { describe, expect, it } from 'vitest';
import { dispatchAtHead } from '../../src/runtime/engine-dispatch';

const AUCTION = '01HZZZZZZZZZZZZZZZZZZZZZZ0';
const COMMAND = '01HZZZZZZZZZZZZZZZZZZZZZZ1';

const envelope = (at: number): EngineEnvelope =>
  ({
    type: 'CloseAuction',
    commandId: COMMAND,
    at,
    auctionId: AUCTION,
  }) as unknown as EngineEnvelope;

/** A runtime whose ledger clock jumps once, after the caller has read it. */
function fakeRuntime(heads: number[]) {
  const sent: number[] = [];
  let read = 0;
  const runtime = {
    state: async () => ({ head: { at: heads[Math.min(read++, heads.length - 1)] ?? 0 } }),
    dispatch: async (cmd: { at: number }) => {
      sent.push(cmd.at);
      const head = heads[heads.length - 1] ?? 0;
      if (cmd.at < head) throw new EngineError('time_regression');
      return { ok: true };
    },
  } as unknown as Pick<AuctionRuntime, 'state' | 'dispatch'>;
  return { runtime, sent };
}

describe('dispatchAtHead (INT-R3-10)', () => {
  it('raises the command time to the ledger head', async () => {
    const { runtime, sent } = fakeRuntime([500]);
    await dispatchAtHead(runtime, envelope(100), COMMAND);
    expect(sent).toEqual([500]);
  });

  it('sends again when the head moves between the read and the write', async () => {
    const { runtime, sent } = fakeRuntime([100, 900]);
    await dispatchAtHead(runtime, envelope(100), COMMAND);
    expect(sent).toEqual([100, 900]);
  });

  it('gives up on a head that keeps moving, and on other errors', async () => {
    const stuck = {
      state: async () => ({ head: { at: 0 } }),
      dispatch: async () => {
        throw new EngineError('time_regression');
      },
    } as unknown as Pick<AuctionRuntime, 'state' | 'dispatch'>;
    await expect(dispatchAtHead(stuck, envelope(1), COMMAND)).rejects.toThrow('time_regression');
    const other = {
      state: async () => ({ head: { at: 0 } }),
      dispatch: async () => {
        throw new EngineError('lot_done');
      },
    } as unknown as Pick<AuctionRuntime, 'state' | 'dispatch'>;
    await expect(dispatchAtHead(other, envelope(1), COMMAND)).rejects.toThrow('lot_done');
  });
});
