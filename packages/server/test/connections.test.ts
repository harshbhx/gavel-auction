import { ManualClock } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { BoundedConnection, type FrameSink } from '../src/transport/connections';

class FakeSink implements FrameSink {
  readonly written: string[] = [];
  closed: { code: number; reason: string } | undefined;
  private readonly pendingDone: Array<() => void> = [];

  constructor(private readonly autoDrain: boolean) {}

  write(text: string, done: (err?: Error) => void): void {
    this.written.push(text);
    if (this.autoDrain) done();
    else this.pendingDone.push(() => done());
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  drainOne(): void {
    this.pendingDone.shift()?.();
  }
}

const START = 1_789_000_000_000;

describe('T-RT-055 bounded outbound queue', () => {
  it('closes a consumer that never drains after 256 frames, others unaffected', () => {
    const clock = new ManualClock(START);
    const slowSink = new FakeSink(false);
    const goodSink = new FakeSink(true);
    const slow = new BoundedConnection({ clock, sink: slowSink });
    const good = new BoundedConnection({ clock, sink: goodSink });
    for (let i = 0; i < 256; i++) {
      slow.send(`f${i}`);
      good.send(`f${i}`);
    }
    expect(slowSink.closed).toBeUndefined();
    slow.send('overflow');
    good.send('overflow');
    expect(slowSink.closed).toEqual({ code: 4008, reason: 'slow_consumer' });
    expect(goodSink.closed).toBeUndefined();
    expect(goodSink.written).toHaveLength(257);
    expect(slowSink.written).toHaveLength(1);
  });

  it('closes 4008 when a write is not drained within 5 s', () => {
    const clock = new ManualClock(START);
    const sink = new FakeSink(false);
    const conn = new BoundedConnection({ clock, sink });
    conn.send('a');
    clock.advanceTo(START + 4999);
    expect(sink.closed).toBeUndefined();
    clock.advanceTo(START + 5000);
    expect(sink.closed?.code).toBe(4008);
    conn.send('b');
    expect(sink.written).toEqual(['a']);
  });

  it('delivers in send order and resets the drain timer on progress', () => {
    const clock = new ManualClock(START);
    const sink = new FakeSink(false);
    const conn = new BoundedConnection({ clock, sink });
    conn.send('a');
    conn.send('b');
    clock.advanceTo(START + 4000);
    sink.drainOne();
    clock.advanceTo(START + 8000);
    expect(sink.closed).toBeUndefined();
    sink.drainOne();
    expect(sink.written).toEqual(['a', 'b']);
    expect(conn.pending).toBe(0);
    clock.advanceTo(START + 20000);
    expect(sink.closed).toBeUndefined();
  });

  it('reports the close once', () => {
    const clock = new ManualClock(START);
    const codes: number[] = [];
    const conn = new BoundedConnection({
      clock,
      sink: new FakeSink(true),
      onClosed: (c) => codes.push(c),
    });
    conn.close(1001, 'stop');
    conn.close(4008, 'again');
    expect(codes).toEqual([1001]);
  });
});
