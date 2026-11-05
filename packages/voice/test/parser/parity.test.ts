import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseUtterance } from '../../src/parser/utterance.js';
import { parseBid } from '../../src/parser/parse.js';
import type { ParseResult } from '../../src/types.js';

const caseSchema = z.object({
  id: z.string(),
  set: z.enum(['dev', 'heldout']),
  text: z.string(),
  speaker: z.string().nullable(),
  currentPriceCents: z.number().int().nullable(),
  knownDivergence: z.string().optional(),
});

const goldenSchema = z.object({
  id: z.string(),
  status: z.enum(['bid', 'confirm', 'none']),
  bidder: z.string().nullable(),
  amountCents: z.number().int().nullable(),
});

function load<T>(file: string, schema: z.ZodType<T>): T[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../../fixtures/text/${file}`, import.meta.url), 'utf8'),
  );
  return z.array(schema).parse(raw);
}

const cases = load('cases.json', caseSchema);
const golden = new Map(load('parser-golden.json', goldenSchema).map((g) => [g.id, g]));

type Case = (typeof cases)[number];

const ctxOf = (c: Case) => ({
  ...(c.speaker === null ? {} : { speakerBidderId: c.speaker }),
  ...(c.currentPriceCents === null ? {} : { currentPriceCents: c.currentPriceCents }),
});

type Verdict = 'same' | 'speaker_conflict' | 'retraction' | 'differs';

/** Compares status, bidder and amount with the Python golden; named, intended differences are classified. */
function compare(c: Case, r: ParseResult): Verdict {
  const g = golden.get(c.id);
  if (g === undefined) return 'differs';
  const exact =
    r.status === g.status &&
    (g.status !== 'bid' || (r.bidder?.value === g.bidder && r.amountCents === g.amountCents));
  if (exact) return 'same';
  // R-VOX-041: a spoken paddle that differs from the speaker is a confirm naming both bidders.
  if (
    g.status === 'bid' &&
    r.reason === 'multiple_bidders' &&
    c.speaker !== null &&
    r.candidates.some((x) => x.bidder?.value === g.bidder) &&
    r.candidates.some((x) => x.bidder?.value === c.speaker)
  ) {
    return 'speaker_conflict';
  }
  // R-VOX-044: a retraction without a new amount is none, the prototype says confirm.
  if (g.status === 'confirm' && r.status === 'none' && r.reason === 'retract') return 'retraction';
  return 'differs';
}

describe('T-VOX-036 parser parity with the Python golden (R-VOX-036)', () => {
  it('covers every dev and held-out case, with a golden entry for each', () => {
    expect(cases.some((c) => c.set === 'dev')).toBe(true);
    expect(cases.some((c) => c.set === 'heldout')).toBe(true);
    expect(cases.filter((c) => !golden.has(c.id))).toEqual([]);
  });

  it('matches status, bidder and amount on every case, printing the mismatch list', () => {
    const mismatches: string[] = [];
    for (const c of cases) {
      const r = parseUtterance(c.text, ctxOf(c));
      if (compare(c, r) === 'differs') {
        const g = golden.get(c.id);
        mismatches.push(
          `${c.id}: ts ${r.status}/${r.bidder?.value ?? '-'}/${String(r.amountCents)} golden ${g?.status}/${g?.bidder ?? '-'}/${String(g?.amountCents)}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('records the known held-out divergence instead of deleting it', () => {
    const flagged = cases.filter((c) => c.knownDivergence !== undefined);
    expect(flagged.map((c) => [c.set, c.text])).toEqual([['heldout', 'I raise to eight hundred']]);
  });

  it('keeps the intended differences to the prototype small and named', () => {
    const verdicts = cases.map((c) => compare(c, parseUtterance(c.text, ctxOf(c))));
    expect(verdicts.filter((v) => v !== 'same' && v !== 'differs').length).toBeLessThan(10);
  });
});

/** Case, spacing and edge whitespace changes that normalization must absorb. */
function disturb(text: string): string {
  return `  ${text.toUpperCase().replace(/ /g, '   ')}  `;
}

/** Serialized parse without the character spans, which move with the text. */
const withoutSpans = (r: ParseResult): string =>
  JSON.stringify(r, (key, value: unknown) => (key === 'spans' ? undefined : value));

describe('T-VOX-054 normalization is idempotent (R-VOX-035, 036)', () => {
  it('upper case and extra whitespace give the same parse for every dev case', () => {
    const diffs: string[] = [];
    for (const c of cases.filter((x) => x.set === 'dev')) {
      const a = withoutSpans(parseBid(c.text, ctxOf(c)));
      const b = withoutSpans(parseBid(disturb(c.text), ctxOf(c)));
      if (a !== b) diffs.push(c.id);
    }
    expect(diffs).toEqual([]);
  });
});
