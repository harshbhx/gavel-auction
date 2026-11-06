import { describe, expect, it } from 'vitest';
import { EXPIRED_ID_LIMIT, PromptBook } from '../../src/decide/prompts.js';

function setup() {
  let t = 0;
  const book = new PromptBook<string>(() => t);
  return {
    book,
    at: (ms: number) => {
      t = ms;
    },
  };
}

describe('PromptBook', () => {
  it('T-VOX-075: ttl expiry audits and rejects late answers', () => {
    const { book, at } = setup();
    const r = book.open('paddle:12', 'x');
    if (!r.opened) throw new Error('expected open');
    at(9999);
    expect(book.sweep()).toEqual([]);
    at(10001);
    const audit = book.sweep();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.reason).toBe('confirm_expired');
    expect(book.take(r.prompt.promptId).status).toBe('expired');
    expect(book.size).toBe(0);
  });

  it('remembers only a bounded number of expired ids (HRD-57)', () => {
    const { book, at } = setup();
    const first = book.open('k:0', 'x');
    if (!first.opened) throw new Error('expected open');
    for (let i = 1; i <= EXPIRED_ID_LIMIT + 50; i++) {
      at(i * 20_000);
      book.open(`k:${i}`, 'x');
    }
    at((EXPIRED_ID_LIMIT + 60) * 20_000);
    book.sweep();
    expect(book.expiredRemembered).toBe(EXPIRED_ID_LIMIT);
    expect(book.take(first.prompt.promptId).status).toBe('unknown');
  });

  it('answer inside the ttl is accepted once', () => {
    const { book, at } = setup();
    const r = book.open('paddle:12', 'x');
    if (!r.opened) throw new Error('expected open');
    at(5000);
    expect(book.take(r.prompt.promptId).status).toBe('ok');
    expect(book.take(r.prompt.promptId).status).toBe('unknown');
  });

  it('T-VOX-076: same key supersedes', () => {
    const { book } = setup();
    const a = book.open('paddle:12', 'a');
    const b = book.open('paddle:12', 'b');
    if (!a.opened || !b.opened) throw new Error('expected open');
    expect(b.audit.map((x) => x.reason)).toEqual(['superseded']);
    expect(b.audit[0]?.promptId).toBe(a.prompt.promptId);
    expect(book.size).toBe(1);
  });

  it('T-VOX-076: more than 3 in 10 s are dropped and counted', () => {
    const { book, at } = setup();
    expect(book.open('k1', 'a').opened).toBe(true);
    expect(book.open('k2', 'a').opened).toBe(true);
    expect(book.open('k3', 'a').opened).toBe(true);
    const fourth = book.open('k4', 'a');
    expect(fourth.opened).toBe(false);
    expect(fourth.audit[0]?.reason).toBe('low_confidence');
    expect(book.open('k5', 'a').opened).toBe(false);
    expect(book.rateLimited).toBe(2);
    at(10001);
    expect(book.open('k6', 'a').opened).toBe(true);
  });
});
