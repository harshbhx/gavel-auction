import { afterEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '@gavel/server/src/limits/rate-limiter';
import { MAX_FRAME_BYTES, MAX_TRANSCRIPT_CHARS, decodeClientMsg } from '@gavel/shared';
import type { BidMsg } from '@gavel/shared';
import { CONFIG, connect, enroll, makeRig, type Rig } from '../flow/rig';

// T-QA-038 (R-QA-026, R-QA-036): malformed and hostile frames are each refused with a code, a flood
// is cut by the rate limit, and script text in a transcript stays plain data. The script text is
// checked on the server side only: what the browser does with it belongs to the web tests.

const open: Array<{ stop(): Promise<void> }> = [];
afterEach(async () => {
  for (const p of open.splice(0)) await p.stop();
});

async function newRig(): Promise<Rig> {
  const rig = await makeRig();
  open.push(rig.paypal);
  return rig;
}

const MID = '01HZX3W5Q0R6B7C8D9E0F1G2H3';

function bidFrame(fields: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, t: 'bid', mid: MID, source: 'manual', ...fields });
}

function decodeBid(raw: string): BidMsg {
  const res = decodeClientMsg(raw);
  if (!res.ok || res.value.t !== 'bid') throw new Error('frame did not decode as a bid');
  return res.value;
}

describe('hostile frames are refused at the wire (T-QA-038)', () => {
  const refused: Array<[string, string | Uint8Array]> = [
    ['invalid JSON', '{"v":1,"t":"bid",'],
    ['a bare string', '"bid"'],
    ['an array', '[]'],
    ['null', 'null'],
    ['an unknown type', JSON.stringify({ v: 1, t: 'hammer' })],
    ['a server-only type from a client', JSON.stringify({ v: 1, t: 'price' })],
    ['a missing type', JSON.stringify({ v: 1 })],
    ['a wrong version on a bid', bidFrame({ v: 2, amount: 10000 })],
    ['an extra field', bidFrame({ amount: 10000, admin: true })],
    ['a string amount', bidFrame({ amount: '10000' })],
    ['a null amount', bidFrame({ amount: null })],
    ['an amount that overflows to infinity', bidFrame({ amount: 1 }).replace('1}', '1e999}')],
    ['a missing amount', bidFrame({})],
    ['a 5 KB transcript', bidFrame({ amount: 10000, transcript: 'a'.repeat(5000) })],
    [
      'a frame over the size cap',
      bidFrame({ amount: 10000, transcript: 'a'.repeat(MAX_FRAME_BYTES) }),
    ],
    ['binary garbage', new Uint8Array([0xff, 0xfe, 0x00, 0x7b])],
    ['depth 10000 nesting', '['.repeat(10_000) + ']'.repeat(10_000)],
  ];

  it.each(refused)('refuses %s with bad_message', (_name, raw) => {
    const res = decodeClientMsg(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_message');
  });

  it('refuses a join with an unsupported version with its own code', () => {
    const res = decodeClientMsg(
      JSON.stringify({ v: 2, t: 'join', token: 'x', auctionId: '01HZX3W5Q0R6B7C8D9E0F1G2H3' }),
    );
    expect(res).toMatchObject({ ok: false, code: 'unsupported_version' });
  });

  it('keeps a transcript at the limit and refuses one character more', () => {
    const at = decodeClientMsg(
      bidFrame({ amount: 10000, transcript: 'a'.repeat(MAX_TRANSCRIPT_CHARS) }),
    );
    expect(at.ok).toBe(true);
    const over = decodeClientMsg(
      bidFrame({ amount: 10000, transcript: 'a'.repeat(MAX_TRANSCRIPT_CHARS + 1) }),
    );
    expect(over.ok).toBe(false);
  });
});

describe('hostile amounts are rejected by the room with a code (T-QA-038)', () => {
  const amounts: Array<[string, string, readonly string[]]> = [
    ['negative', '-500', ['bad_amount']],
    ['zero', '0', ['bad_amount', 'below_reserve']],
    ['fractional', '10000.5', ['bad_amount']],
    ['huge', '1e15', ['bad_amount']],
    ['past the largest amount', '100000000000', ['bad_amount']],
  ];

  it.each(amounts)(
    'rejects a %s amount and records nothing as accepted',
    async (_n, text, codes) => {
      const rig = await newRig();
      const service = rig.service();
      const auctionId = rig.ids.mint<'AuctionId'>();
      const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
      const ana = await enroll(rig, service, room, auctionId, 'Ana', 50000);

      const raw = bidFrame({ amount: 0 }).replace('"amount":0', `"amount":${text}`);
      await room.submitBid(ana.conn, decodeBid(raw));

      const rejected = ana.transport.messages('bid_rejected');
      expect(rejected).toHaveLength(1);
      expect(codes).toContain(rejected[0]?.['reason']);
      const events = await rig.stores.store.readEvents(auctionId, 1, 1000);
      expect(events.some((e) => e.type === 'bid_accepted')).toBe(false);
      await service.close();
    },
  );
});

describe('flood and script text (T-QA-038)', () => {
  it('cuts a 200 bids per second flood to the burst plus the refill', async () => {
    const rig = await newRig();
    const service = rig.service({ limiter: new RateLimiter(rig.clock) });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
    const ana = await enroll(rig, service, room, auctionId, 'Ana', 50000);
    const before = await rig.stores.store.lastSeq(auctionId);

    for (let i = 0; i < 200; i++) {
      rig.clock.set(rig.clock.now() + 5);
      await room.submitBid(
        ana.conn,
        decodeBid(bidFrame({ amount: 10000 + (i % 2) * 500, mid: rig.ids.mint<'MsgId'>() })),
      );
    }

    const limited = ana.transport.messages('error').filter((m) => m['code'] === 'rate_limited');
    // One second of flood: a burst of 5 and about 3 refills, never more than 10 handled.
    expect(limited.length).toBeGreaterThanOrEqual(190);
    const appended = (await rig.stores.store.lastSeq(auctionId)) - before;
    expect(appended).toBeLessThanOrEqual(10);
    expect(limited.every((m) => typeof m['retryAfterMs'] === 'number')).toBe(true);
    await service.close();
  });

  it('keeps script text in a transcript as plain data and out of public frames', async () => {
    const rig = await newRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
    const ana = await enroll(rig, service, room, auctionId, 'Ana', 50000);
    const screen = await connect(rig, room, 'screen');
    const script = '<script>alert(document.cookie)</script><img src=x onerror=alert(1)>';

    await room.submitBid(
      ana.conn,
      decodeBid(bidFrame({ amount: 10000, source: 'voice', transcript: script, confidence: 0.99 })),
    );

    const events = await rig.stores.store.readEvents(auctionId, 1, 1000);
    for (const e of events) {
      const transcript = (e as { audit?: { transcript?: string } }).audit?.transcript;
      if (transcript !== undefined) expect(transcript).toBe(script);
    }
    expect(screen.transport.frames.join('\n')).not.toContain('<script');
    expect(screen.transport.frames.join('\n')).not.toContain('onerror');
    for (const frame of ana.transport.frames) {
      expect(() => JSON.parse(frame) as unknown).not.toThrow();
    }
    await service.close();
  });
});
