import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseUtterance } from '../src/parser/utterance.js';

const caseSchema = z.object({
  id: z.string().regex(/^[a-z_]+-\d{3}$/),
  set: z.enum(['dev', 'heldout']),
  category: z.string().min(1),
  text: z.string(),
  speaker: z.string().nullable(),
  currentPriceCents: z.number().int().nullable(),
  expected: z.discriminatedUnion('status', [
    z.object({ status: z.literal('bid'), bidder: z.string(), amountCents: z.number().int() }),
    z.object({ status: z.literal('confirm') }),
    z.object({ status: z.literal('none') }),
  ]),
  knownDivergence: z.string().optional(),
});

const goldenSchema = z.object({
  id: z.string(),
  status: z.enum(['bid', 'confirm', 'none']),
  bidder: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  reason: z.string(),
  candidatesCents: z.array(z.union([z.number(), z.string()])),
});

function load<T>(file: string, schema: z.ZodType<T>): T[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../fixtures/text/${file}`, import.meta.url), 'utf8'),
  );
  return z.array(schema).parse(raw);
}

const cases = load('cases.json', caseSchema);
const golden = load('parser-golden.json', goldenSchema);

/** Floors for the corpus size and category count (SPEC R-VOX-077). */
const MIN_CASES = 150;
const MIN_CATEGORIES = 12;
const SPEC_MIN_CASES = 150;
const SPEC_MIN_CATEGORIES = 12;

/** Lower case, punctuation and spacing removed, so trivial edits do not hide a repeat. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Ids of held-out cases whose normalized text also appears in the dev set, whatever speaker or price. */
function findOverlaps(all: ReadonlyArray<{ id: string; set: string; text: string }>): string[] {
  const dev = new Set(all.filter((c) => c.set === 'dev').map((c) => normalizeText(c.text)));
  return all.filter((c) => c.set === 'heldout' && dev.has(normalizeText(c.text))).map((c) => c.id);
}

describe('T-VOX-085 corpus shape (R-VOX-077)', () => {
  it('has enough cases and categories', () => {
    expect(cases.length).toBeGreaterThanOrEqual(MIN_CASES);
    expect(new Set(cases.map((c) => c.category)).size).toBeGreaterThanOrEqual(MIN_CATEGORIES);
  });

  it('meets the spec floor of 150 cases and 12 categories', () => {
    expect(cases.length).toBeGreaterThanOrEqual(SPEC_MIN_CASES);
    expect(new Set(cases.map((c) => c.category)).size).toBeGreaterThanOrEqual(SPEC_MIN_CATEGORIES);
  });

  it('has unique ids and a non-empty dev and held-out set', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const dev = cases.filter((c) => c.set === 'dev');
    const held = cases.filter((c) => c.set === 'heldout');
    expect(dev.length).toBeGreaterThan(0);
    expect(held.length).toBeGreaterThan(0);
    const devIds = new Set(dev.map((c) => c.id));
    expect(held.some((c) => devIds.has(c.id))).toBe(false);
  });

  it('never repeats the same utterance across dev and held-out, whoever speaks it', () => {
    expect(findOverlaps(cases)).toEqual([]);
  });

  it('detects the same text with a different speaker or price (VOICE-RT-06)', () => {
    const base = cases[0];
    if (!base) throw new Error('no cases');
    const dev = { ...base, id: 'x-001', set: 'dev' as const, text: 'Around  three hundred!' };
    const held = {
      ...base,
      id: 'x-002',
      set: 'heldout' as const,
      text: 'around three hundred',
      speaker: 'someone else',
      currentPriceCents: 5000,
    };
    expect(findOverlaps([dev, held])).toEqual(['x-002']);
  });

  it('keeps held-out utterances out of the parser unit tests (VOICE-RT-06)', () => {
    const dir = new URL('./parser/', import.meta.url);
    const held = new Set(
      cases.filter((c) => c.set === 'heldout').map((c) => normalizeText(c.text)),
    );
    const hits: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.test.ts')) continue;
      const source = readFileSync(new URL(name, dir), 'utf8');
      for (const m of source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
        const literal = normalizeText(m[2] ?? '');
        if (literal !== '' && held.has(literal)) hits.push(`${name}: ${m[2] ?? ''}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('Python golden (R-VOX-036)', () => {
  it('has exactly one entry per case, in order', () => {
    expect(golden.map((g) => g.id)).toEqual(cases.map((c) => c.id));
  });

  it('agrees with every expected label except the recorded divergence', () => {
    const diverged: string[] = [];
    for (const c of cases) {
      const g = golden.find((x) => x.id === c.id);
      expect(g, c.id).toBeDefined();
      if (!g) continue;
      const e = c.expected;
      const same =
        g.status === e.status &&
        (e.status !== 'bid' || (g.bidder === e.bidder && g.amountCents === e.amountCents));
      if (!same) diverged.push(c.id);
    }
    const flagged = cases.filter((c) => c.knownDivergence !== undefined).map((c) => c.id);
    expect(diverged).toEqual(flagged);
    expect(flagged.map((id) => cases.find((c) => c.id === id)?.text)).toEqual([
      'I raise to eight hundred',
    ]);
  });

  it('keeps amounts in whole cents', () => {
    for (const g of golden) {
      if (g.amountCents !== null) expect(g.amountCents % 100).toBe(0);
    }
  });
});

describe('TypeScript parser against the golden (T-VOX-036, R-VOX-036)', () => {
  it('matches status, bidder and amount of every case except the recorded divergences', () => {
    const mismatches: string[] = [];
    for (const c of cases) {
      const g = golden.find((x) => x.id === c.id);
      if (!g) continue;
      const r = parseUtterance(c.text, {
        ...(c.speaker === null ? {} : { speakerBidderId: c.speaker }),
        ...(c.currentPriceCents === null ? {} : { currentPriceCents: c.currentPriceCents }),
      });
      const exact =
        r.status === g.status &&
        (g.status !== 'bid' || (r.bidder?.value === g.bidder && r.amountCents === g.amountCents));
      // R-VOX-041: a spoken paddle that differs from the speaker is a confirm with both bidders,
      // where the Python prototype lets the paddle win.
      const speakerConflict =
        g.status === 'bid' &&
        r.reason === 'multiple_bidders' &&
        c.speaker !== null &&
        r.candidates.some((x) => x.bidder?.value === g.bidder) &&
        r.candidates.some((x) => x.bidder?.value === c.speaker);
      // R-VOX-044: a retraction without a new amount is none (retract), the prototype says confirm.
      const retraction = g.status === 'confirm' && r.status === 'none' && r.reason === 'retract';
      const same = exact || speakerConflict || retraction;
      if (!same) {
        mismatches.push(
          `${c.id} "${c.text}": ts ${r.status}/${r.bidder?.value ?? '-'}/${String(r.amountCents)} golden ${g.status}/${g.bidder ?? '-'}/${String(g.amountCents)}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});
