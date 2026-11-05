import type { IncomingMessage } from 'node:http';
import { ManualClock } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { createLogger, MemorySink } from '../src/log/logger';
import { requestContext, requestIdFrom, withLogContext } from '../src/log/context';

const clock = new ManualClock();

function setup(): { sink: MemorySink; base: ReturnType<typeof createLogger> } {
  const sink = new MemorySink();
  return { sink, base: createLogger({ clock, sink: sink.write }) };
}

function reqWith(headers: Record<string, string | string[]>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('log context', () => {
  it('T-RT-092 bid handling logs include reqId, connId, auctionId and seq', () => {
    const { sink, base } = setup();
    const log = withLogContext(base, { reqId: 'r1', connId: 'c1', auctionId: 'a1', seq: 7 });
    log.info('bid accepted');
    expect(sink.records()[0]?.context).toEqual({
      reqId: 'r1',
      connId: 'c1',
      auctionId: 'a1',
      seq: 7,
    });
  });

  it('omits fields that are not set', () => {
    const { sink, base } = setup();
    withLogContext(base, { reqId: 'r1' }).info('x');
    expect(sink.records()[0]?.context).toEqual({ reqId: 'r1' });
  });

  it('keeps a well formed request id and mints otherwise', () => {
    expect(requestIdFrom(reqWith({ 'x-request-id': 'abc-1' }), () => 'minted')).toBe('abc-1');
    expect(requestIdFrom(reqWith({ 'x-request-id': 'bad id!' }), () => 'minted')).toBe('minted');
    expect(requestIdFrom(reqWith({}), () => 'minted')).toBe('minted');
  });

  it('requestContext binds the id to the logger', () => {
    const { sink, base } = setup();
    const { reqId, log } = requestContext(base, reqWith({}), () => 'req-9');
    log.info('hi');
    expect(reqId).toBe('req-9');
    expect(sink.records()[0]?.context).toEqual({ reqId: 'req-9' });
  });
});
