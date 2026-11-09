import { genesisHead, headOf, sealBatch } from '@gavel/engine';
import type { LedgerEntry, LedgerEvent } from '@gavel/engine';
import { describe, expect, it } from 'vitest';
import {
  buildKillEvidence,
  diffJournalAgainstTruth,
  evaluateKillRun,
  killMarkdown,
  killVerdict,
  type JournalView,
  type KillRunInput,
  type TruthRow,
} from '../src/sandbox/kill-evidence';

const A = '01HZZZZZZZZZZZZZZZZZZZZZZA';

function chain(n: number): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (let i = 0; i < n; i += 1) {
    const type = i === 0 ? 'AUCTION_CREATED' : 'BID_RECORDED';
    const head =
      out.length === 0
        ? genesisHead(A as never)
        : {
            auctionId: A as never,
            seq: out.length,
            hash: (out[out.length - 1] as LedgerEntry).hash,
          };
    out.push(
      ...sealBatch([{ type, payload: { n: i } } as unknown as LedgerEvent], head, 100 + i, null),
    );
  }
  return out;
}

const captured: TruthRow = { status: 'CAPTURED', capturedCents: 12_500, captureCount: 1 };
const voided: TruthRow = { status: 'VOIDED', capturedCents: 0, captureCount: 0 };

function good(): KillRunInput {
  const entries = chain(4);
  return {
    mode: 'sandbox',
    checkpoint: 'after_capture_request_before_response',
    pidBefore: 111,
    pidAfter: 222,
    exitedAtCheckpoint: true,
    journal: {
      state: 'SETTLED',
      winner: { bidderId: 'A', amountCents: 12_500 },
      holdBidders: ['A', 'B', 'C'],
    },
    truth: { A: captured, B: voided, C: voided },
    ledger: { entries, head: headOf(entries) },
    lot: { winnerId: 'A', priceCents: 12_500, capturedCents: 12_500 },
  };
}

const failing = (checks: ReturnType<typeof evaluateKillRun>): string[] =>
  checks.filter((c) => !c.pass).map((c) => c.name);

describe('evaluateKillRun', () => {
  it('passes a run in which everything holds', () => {
    const checks = evaluateKillRun(good());
    expect(failing(checks)).toEqual([]);
    expect(killVerdict(checks)).toBe('PASS');
  });

  it('fails when the server did not die at the checkpoint', () => {
    const i = { ...good(), exitedAtCheckpoint: false };
    expect(failing(evaluateKillRun(i))).toContain('server_died_at_checkpoint');
  });

  it('fails when the pid did not change or is unknown', () => {
    expect(failing(evaluateKillRun({ ...good(), pidAfter: 111 }))).toContain(
      'restarted_as_new_process',
    );
    expect(failing(evaluateKillRun({ ...good(), pidBefore: undefined }))).toContain(
      'restarted_as_new_process',
    );
  });

  it('fails when the journal is not settled', () => {
    const i = good();
    i.journal = { ...(i.journal as JournalView), state: 'CAPTURING' };
    expect(failing(evaluateKillRun(i))).toContain('journal_settled_after_restart');
    expect(failing(evaluateKillRun({ ...good(), journal: null }))).toContain(
      'journal_settled_after_restart',
    );
  });

  it('fails on a second capture, a wrong amount or an unobservable count', () => {
    for (const bad of [
      { ...captured, captureCount: 2 },
      { ...captured, capturedCents: 12_000 },
      { ...captured, captureCount: null },
    ]) {
      const i = good();
      i.truth = { ...i.truth, A: bad };
      expect(failing(evaluateKillRun(i))).toContain('one_capture_for_hammer_price');
    }
  });

  it('fails when a loser is not voided or has money captured', () => {
    const i = good();
    i.truth = { ...i.truth, B: { status: 'CREATED', capturedCents: 0, captureCount: 0 } };
    expect(failing(evaluateKillRun(i))).toContain('losers_voided');
    const j = good();
    j.truth = { ...j.truth, C: { status: 'VOIDED', capturedCents: 5, captureCount: 0 } };
    expect(failing(evaluateKillRun(j))).toContain('losers_voided');
  });

  it('fails when the journal and PayPal differ', () => {
    const i = good();
    i.journal = { ...(i.journal as JournalView), winner: { bidderId: 'B', amountCents: 12_500 } };
    expect(failing(evaluateKillRun(i))).toContain('journal_equals_paypal');
  });

  it('fails on a broken or truncated ledger chain', () => {
    const i = good();
    const broken = [...i.ledger.entries];
    broken[2] = { ...(broken[2] as LedgerEntry), at: 99_999 } as LedgerEntry;
    expect(
      failing(evaluateKillRun({ ...i, ledger: { entries: broken, head: i.ledger.head } })),
    ).toContain('ledger_chain_verifies');
    const cut = i.ledger.entries.slice(0, 3);
    expect(
      failing(evaluateKillRun({ ...i, ledger: { entries: cut, head: i.ledger.head } })),
    ).toContain('ledger_chain_verifies');
    expect(failing(evaluateKillRun({ ...i, ledger: { entries: [], head: null } }))).toContain(
      'ledger_chain_verifies',
    );
  });

  it('fails when the ledger captured amount differs from PayPal', () => {
    const i = good();
    i.lot = { winnerId: 'A', priceCents: 12_500, capturedCents: 0 };
    expect(failing(evaluateKillRun(i))).toContain('ledger_capture_equals_paypal');
    expect(failing(evaluateKillRun({ ...good(), lot: undefined }))).toContain(
      'one_capture_for_hammer_price',
    );
  });

  it('is FAIL for an empty list of checks', () => {
    expect(killVerdict([])).toBe('FAIL');
  });
});

describe('diffJournalAgainstTruth', () => {
  it('names each difference and holds missing on either side', () => {
    const j: JournalView = {
      state: 'SETTLED',
      winner: { bidderId: 'A', amountCents: 100 },
      holdBidders: ['A', 'B'],
    };
    expect(
      diffJournalAgainstTruth(j, { A: { ...captured, capturedCents: 100 }, B: voided }),
    ).toEqual([]);
    expect(diffJournalAgainstTruth(j, { A: captured })).toEqual([
      'A: journal captured 100, PayPal 12500',
      'B: missing at PayPal',
    ]);
    expect(
      diffJournalAgainstTruth(j, { A: { ...captured, capturedCents: 100 }, B: voided, Z: voided }),
    ).toEqual(['Z: at PayPal, not in the journal']);
  });
});

describe('evidence', () => {
  it('labels a sandbox run as a CI-runner process, a fake run as not sandbox evidence', () => {
    const meta = {
      runUrl: 'https://example.test/run',
      startedAt: 't',
      secondsHammerToSettled: 12.3,
      steps: [],
    };
    const sb = buildKillEvidence(good(), evaluateKillRun(good()), meta);
    expect(sb.label).toContain('real PayPal sandbox');
    expect(sb.label).toContain('not a deployed host');
    expect(sb.verdict).toBe('PASS');
    expect(sb).toMatchObject({
      pidBefore: 111,
      pidAfter: 222,
      winnerCaptures: 1,
      voidedLosers: 2,
      journalDiffs: 0,
    });
    const fake = buildKillEvidence({ ...good(), mode: 'fake' }, evaluateKillRun(good()), meta);
    expect(fake.label).toContain('not sandbox evidence');
    expect(killMarkdown(sb)).toContain('Real server-process kill: PASS');
  });

  it('holds no ids from PayPal: only counts and statuses', () => {
    const meta = { runUrl: '', startedAt: 't', secondsHammerToSettled: null, steps: [] };
    const text = JSON.stringify(buildKillEvidence(good(), evaluateKillRun(good()), meta));
    expect(text).not.toMatch(/authId|orderId|holdId/);
  });
});
