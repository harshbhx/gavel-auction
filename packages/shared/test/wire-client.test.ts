import { describe, expect, it } from 'vitest';
import { decodeClientMsg } from '../src/wire/client';

const enc = (o: unknown) => JSON.stringify(o);
const AUCTION = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V';
const MID = '01J9ZQ5A0B2C4D6F8H0J2K4M6N';

describe('client messages (T-RT-014)', () => {
  it('parses join', () => {
    const r = decodeClientMsg(
      enc({ v: 1, t: 'join', token: 'tok', auctionId: AUCTION, lastSeq: 14 }),
    );
    expect(r.ok).toBe(true);
  });

  it('parses join with client info', () => {
    const r = decodeClientMsg(
      enc({
        v: 1,
        t: 'join',
        token: 'tok',
        auctionId: AUCTION,
        client: { name: 'web', version: '1' },
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('parses bid, including voice metadata', () => {
    expect(decodeClientMsg(enc({ v: 1, t: 'bid', mid: MID, amount: 35000, source: 'qr' })).ok).toBe(
      true,
    );
    const voice = decodeClientMsg(
      enc({
        v: 1,
        t: 'bid',
        mid: MID,
        amount: 35000,
        source: 'voice',
        transcript: 'three fifty',
        confidence: 0.62,
        audioTsMs: 1200,
      }),
    );
    expect(voice.ok).toBe(true);
  });

  it('parses confirm_response', () => {
    const r = decodeClientMsg(enc({ v: 1, t: 'confirm_response', confirmId: 'c1', accept: true }));
    expect(r.ok).toBe(true);
  });

  it('rejects server-only types sent by a client', () => {
    for (const t of ['registered', 'bid_accepted', 'price', 'state', 'hammer', 'error']) {
      const r = decodeClientMsg(enc({ v: 1, t, seq: 1, ts: 1 }));
      expect(r.ok === false && r.code).toBe('bad_message');
    }
  });

  it('decodes fractional or negative amounts so the room can answer bad_amount', () => {
    for (const amount of [350.5, -1]) {
      const r = decodeClientMsg(enc({ v: 1, t: 'bid', mid: MID, amount, source: 'qr' }));
      expect(r.ok).toBe(true);
    }
  });

  it('rejects non-finite amounts, bad ids and extra fields', () => {
    const bad = [
      { v: 1, t: 'bid', mid: MID, amount: '10', source: 'qr' },
      { v: 1, t: 'bid', mid: MID, amount: null, source: 'qr' },
      { v: 1, t: 'bid', mid: 'nope', amount: 1, source: 'qr' },
      { v: 1, t: 'bid', mid: MID, amount: 1, source: 'sms' },
      { v: 1, t: 'bid', mid: MID, amount: 1, source: 'qr', extra: 1 },
      { v: 1, t: 'join', token: '', auctionId: AUCTION },
    ];
    for (const b of bad) expect(decodeClientMsg(enc(b)).ok).toBe(false);
  });
});

describe('client free text is bounded (R-RT-017)', () => {
  const long = 'x'.repeat(5000);

  it('rejects oversized names, versions, transcripts and confirm ids', () => {
    const cases = [
      { v: 1, t: 'join', token: 't', auctionId: AUCTION, client: { name: long, version: '1' } },
      { v: 1, t: 'join', token: 't', auctionId: AUCTION, client: { name: 'w', version: long } },
      { v: 1, t: 'bid', mid: MID, amount: 1, source: 'voice', transcript: long },
      { v: 1, t: 'confirm_response', confirmId: long, accept: true },
    ];
    for (const c of cases) expect(decodeClientMsg(enc(c)).ok).toBe(false);
  });
});
