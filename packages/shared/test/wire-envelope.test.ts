import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MAX_FRAME_BYTES, decodeFrame, message } from '../src/wire/envelope';

const schemas = {
  join: message('join', { token: z.string() }),
  bid: message('bid', { amount: z.number().int() }),
};

const ok = (o: unknown) => decodeFrame(JSON.stringify(o), schemas);

describe('wire envelope (T-RT-013)', () => {
  it('accepts a valid frame', () => {
    expect(ok({ v: 1, t: 'bid', amount: 5 })).toEqual({
      ok: true,
      value: { v: 1, t: 'bid', amount: 5 },
    });
  });

  it('rejects an unknown t', () => {
    const r = ok({ v: 1, t: 'nope' });
    expect(r.ok === false && r.code).toBe('bad_message');
  });

  it('rejects extra fields', () => {
    const r = ok({ v: 1, t: 'bid', amount: 5, extra: true });
    expect(r.ok === false && r.code).toBe('bad_message');
  });

  it('rejects v:2 as bad_message, and as unsupported_version for join', () => {
    const r = ok({ v: 2, t: 'bid', amount: 5 });
    expect(r.ok === false && r.code).toBe('bad_message');
    const j = ok({ v: 2, t: 'join', token: 'x' });
    expect(j.ok === false && j.code).toBe('unsupported_version');
  });

  it('rejects a 16385-byte frame and accepts the limit boundary', () => {
    const base = JSON.stringify({ v: 1, t: 'join', token: '' });
    const pad = (n: number) =>
      JSON.stringify({ v: 1, t: 'join', token: 'a'.repeat(n - base.length) });
    const over = pad(MAX_FRAME_BYTES + 1);
    expect(over.length).toBe(16385);
    const r = decodeFrame(over, schemas);
    expect(r.ok === false && r.code).toBe('bad_message');
    expect(decodeFrame(pad(MAX_FRAME_BYTES), schemas).ok).toBe(true);
  });

  it('never throws on garbage and measures bytes, not characters', () => {
    for (const raw of ['', 'not json', '[]', 'null', '42', '{"t":1}']) {
      const r = decodeFrame(raw, schemas);
      expect(r.ok).toBe(false);
    }
    const wide = JSON.stringify({ v: 1, t: 'join', token: '€'.repeat(6000) });
    expect(decodeFrame(wide, schemas).ok).toBe(false);
    expect(decodeFrame(new Uint8Array([0xff, 0xfe]), schemas).ok).toBe(false);
  });
});
