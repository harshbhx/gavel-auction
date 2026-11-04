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

  it('rejects fractional or negative amounts, bad ids and extra fields', () => {
    const bad = [
      { v: 1, t: 'bid', mid: MID, amount: 10.5, source: 'qr' },
      { v: 1, t: 'bid', mid: MID, amount: -1, source: 'qr' },
      { v: 1, t: 'bid', mid: 'nope', amount: 1, source: 'qr' },
      { v: 1, t: 'bid', mid: MID, amount: 1, source: 'sms' },
      { v: 1, t: 'bid', mid: MID, amount: 1, source: 'qr', extra: 1 },
      { v: 1, t: 'join', token: '', auctionId: AUCTION },
    ];
    for (const b of bad) expect(decodeClientMsg(enc(b)).ok).toBe(false);
  });
});
