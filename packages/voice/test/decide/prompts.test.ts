import { describe, expect, it } from 'vitest';
import { PromptBook } from '../../src/decide/prompts.js';

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

  it('T-VOX-076: more than the room cap in 10 s are dropped and counted', () => {
    const t = { v: 0 };
    const book = new PromptBook<string>(() => t.v, { roomMax: 3 });
    const at = (ms: number): void => {
      t.v = ms;
    };
    expect(book.open('k1', 'a').opened).toBe(true);
    expect(book.open('k2', 'a').opened).toBe(true);
    expect(book.open('k3', 'a').opened).toBe(true);
    const fourth = book.open('k4', 'a');
    expect(fourth.opened).toBe(false);
    expect(fourth.audit[0]?.reason).toBe('rate_limited');
    expect(book.open('k5', 'a').opened).toBe(false);
    expect(book.rateLimited).toBe(2);
    at(10001);
    expect(book.open('k6', 'a').opened).toBe(true);
  });
});
