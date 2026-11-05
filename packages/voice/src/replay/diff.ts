import type { ExpectedOutcome } from '../stt/replay.js';
import type { Decision } from '../types.js';

export interface ExpectationDiff {
  index: number;
  expected: ExpectedOutcome | null;
  actual: ExpectedOutcome | null;
}

/** The comparable part of a decision. */
export function outcomeOf(d: Decision): ExpectedOutcome {
  switch (d.kind) {
    case 'accept':
      return { kind: 'accept', bidderId: d.bidderId, amountCents: d.amountCents };
    case 'confirm': {
      const first = d.prompt.options[0];
      return {
        kind: 'confirm',
        bidderId: first?.bidderId ?? null,
        amountCents: first?.amountCents ?? null,
      };
    }
    case 'drop':
      return { kind: 'drop', bidderId: null, amountCents: null };
  }
}

function same(a: ExpectedOutcome | null, b: ExpectedOutcome | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.bidderId === b.bidderId && a.amountCents === b.amountCents;
}

/** Entries where the recorded expectation and the actual decision differ; empty means a match. */
export function diffExpectations(
  expected: readonly ExpectedOutcome[],
  actual: readonly ExpectedOutcome[],
): ExpectationDiff[] {
  const out: ExpectationDiff[] = [];
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    const e = expected[i] ?? null;
    const a = actual[i] ?? null;
    if (!same(e, a)) out.push({ index: i, expected: e, actual: a });
  }
  return out;
}

function show(o: ExpectedOutcome | null): string {
  if (o === null) return 'none';
  return `${o.kind} bidder=${o.bidderId ?? '-'} amount=${o.amountCents ?? '-'}`;
}

export function formatDiff(diff: readonly ExpectationDiff[]): string {
  if (diff.length === 0) return 'expectations match';
  return diff
    .map((d) => `#${d.index}: expected ${show(d.expected)}, got ${show(d.actual)}`)
    .join('\n');
}

/** Process exit code for a replay run: 1 on any mismatch. */
export function exitCodeFor(diff: readonly ExpectationDiff[]): 0 | 1 {
  return diff.length === 0 ? 0 : 1;
}
