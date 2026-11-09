import { verifyChain } from '@gavel/engine';
import type { LedgerEntry } from '@gavel/engine';

// Pure part of the real-process kill run (issue 2185): given what the harness observed before the
// kill, after the restart and at PayPal (or the fake), decide which checks hold and build the
// evidence. Nothing here does I/O, so it is covered by unit tests; the harness feeds it.

export interface TruthRow {
  /** PayPal's status of the authorization: CAPTURED, VOIDED, ... */
  status: string;
  capturedCents: number;
  /** Number of captures PayPal lists; null when it cannot be observed. */
  captureCount: number | null;
}

export interface JournalView {
  state: string;
  winner?: { bidderId: string; amountCents: number } | null;
  /** Bidder ids the settlement plan holds. */
  holdBidders: string[];
}

export interface KillRunInput {
  mode: 'sandbox' | 'fake';
  checkpoint: string;
  pidBefore: number | undefined;
  pidAfter: number | undefined;
  /** True when the server process went away on its own after the hammer (the checkpoint fired). */
  exitedAtCheckpoint: boolean;
  journal: JournalView | null;
  /** Keyed by bidder id. */
  truth: Record<string, TruthRow>;
  ledger: { entries: readonly LedgerEntry[]; head: { seq: number; hash: string } | null };
  lot: { winnerId: string | null; priceCents: number | null; capturedCents: number } | undefined;
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export type KillVerdict = 'PASS' | 'FAIL';

/** Differences between what the journal says and what PayPal says, one line each. */
export function diffJournalAgainstTruth(
  journal: JournalView,
  truth: Record<string, TruthRow>,
): string[] {
  const diffs: string[] = [];
  const winner = journal.winner?.bidderId;
  for (const id of [...journal.holdBidders].sort()) {
    const t = truth[id];
    if (t === undefined) {
      diffs.push(`${id}: missing at PayPal`);
      continue;
    }
    const wantStatus = id === winner ? 'CAPTURED' : 'VOIDED';
    const wantCents = id === winner ? (journal.winner?.amountCents ?? 0) : 0;
    if (t.status !== wantStatus) diffs.push(`${id}: journal ${wantStatus}, PayPal ${t.status}`);
    if (t.capturedCents !== wantCents) {
      diffs.push(`${id}: journal captured ${wantCents}, PayPal ${t.capturedCents}`);
    }
  }
  for (const id of Object.keys(truth)) {
    if (!journal.holdBidders.includes(id)) diffs.push(`${id}: at PayPal, not in the journal`);
  }
  return diffs;
}

export function evaluateKillRun(i: KillRunInput): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail });
  };
  add(
    'server_died_at_checkpoint',
    i.exitedAtCheckpoint,
    i.exitedAtCheckpoint
      ? `the server process ended itself at ${i.checkpoint}`
      : `the server did not end at ${i.checkpoint}`,
  );
  const distinct =
    i.pidBefore !== undefined && i.pidAfter !== undefined && i.pidBefore !== i.pidAfter;
  add(
    'restarted_as_new_process',
    distinct,
    `pid before ${i.pidBefore ?? 'unknown'}, pid after ${i.pidAfter ?? 'unknown'}`,
  );
  const state = i.journal?.state ?? 'missing';
  add('journal_settled_after_restart', state === 'SETTLED', `journal state ${state}`);

  const winner = i.lot?.winnerId ?? null;
  const wt = winner === null ? undefined : i.truth[winner];
  add(
    'one_capture_for_hammer_price',
    winner !== null &&
      wt !== undefined &&
      wt.captureCount === 1 &&
      i.lot?.priceCents != null &&
      wt.capturedCents === i.lot.priceCents,
    wt === undefined
      ? 'no winner or no PayPal reading for the winner'
      : `winner has ${wt.captureCount ?? 'unobservable'} capture(s), ${wt.capturedCents} captured, hammer price ${i.lot?.priceCents ?? 'unknown'}`,
  );
  const others = Object.entries(i.truth).filter(([id]) => id !== winner);
  const bad = others.filter(([, t]) => t.status !== 'VOIDED' || t.capturedCents !== 0);
  add(
    'losers_voided',
    others.length > 0 && bad.length === 0,
    `${others.length - bad.length} of ${others.length} other holds are VOIDED with nothing captured`,
  );
  const diffs =
    i.journal === null ? ['journal missing'] : diffJournalAgainstTruth(i.journal, i.truth);
  add(
    'journal_equals_paypal',
    diffs.length === 0,
    `${diffs.length} difference(s)${diffs.length ? `: ${diffs.join('; ')}` : ''}`,
  );
  const chain = verifyChain(
    i.ledger.entries,
    i.ledger.head === null ? {} : { expectedHead: i.ledger.head },
  );
  add(
    'ledger_chain_verifies',
    chain.ok && i.ledger.entries.length > 0,
    chain.ok
      ? `${i.ledger.entries.length} entries, head seq ${i.ledger.head?.seq ?? 'none'}`
      : `broken at ${chain.firstBadIndex}: ${chain.reason}`,
  );
  add(
    'ledger_capture_equals_paypal',
    wt !== undefined && i.lot !== undefined && i.lot.capturedCents === wt.capturedCents,
    `ledger captured ${i.lot?.capturedCents ?? 'unknown'}, PayPal ${wt?.capturedCents ?? 'unknown'}`,
  );
  return checks;
}

export function killVerdict(checks: readonly Check[]): KillVerdict {
  return checks.length > 0 && checks.every((c) => c.pass) ? 'PASS' : 'FAIL';
}

export interface KillEvidenceMeta {
  runUrl: string;
  startedAt: string;
  /** Wall-clock seconds from the hammer to the journal reading SETTLED after the restart. */
  secondsHammerToSettled: number | null;
  steps: Array<{ at: string; step: string; note?: string }>;
}

export function buildKillEvidence(
  i: KillRunInput,
  checks: readonly Check[],
  meta: KillEvidenceMeta,
) {
  const winner = i.lot?.winnerId ?? null;
  return {
    v: 1,
    kind: 'server-kill-evidence',
    label:
      i.mode === 'sandbox'
        ? 'real server process on a CI runner against the real PayPal sandbox (not a deployed host)'
        : 'real server process against the fake PayPal (harness self-check, not sandbox evidence)',
    mode: i.mode,
    checkpoint: i.checkpoint,
    verdict: killVerdict(checks),
    runUrl: meta.runUrl,
    startedAt: meta.startedAt,
    pidBefore: i.pidBefore ?? null,
    pidAfter: i.pidAfter ?? null,
    exitedAtCheckpoint: i.exitedAtCheckpoint,
    secondsHammerToSettled: meta.secondsHammerToSettled,
    journalState: i.journal?.state ?? null,
    holds: i.journal?.holdBidders.length ?? 0,
    winnerCaptures: winner === null ? null : (i.truth[winner]?.captureCount ?? null),
    capturedCents: winner === null ? null : (i.truth[winner]?.capturedCents ?? null),
    hammerPriceCents: i.lot?.priceCents ?? null,
    voidedLosers: Object.entries(i.truth).filter(
      ([id, t]) => id !== winner && t.status === 'VOIDED',
    ).length,
    journalDiffs: i.journal === null ? null : diffJournalAgainstTruth(i.journal, i.truth).length,
    ledger: { entries: i.ledger.entries.length, headSeq: i.ledger.head?.seq ?? null },
    checks,
    steps: meta.steps,
  };
}

export function killMarkdown(ev: ReturnType<typeof buildKillEvidence>): string {
  const lines = [
    `# Real server-process kill: ${ev.verdict}`,
    '',
    ev.label,
    '',
    `Checkpoint: ${ev.checkpoint}. Server pid before ${ev.pidBefore ?? 'unknown'}, after restart ${ev.pidAfter ?? 'unknown'}.`,
    '',
    '| check | result | detail |',
    '| --- | --- | --- |',
    ...ev.checks.map(
      (c) => `| ${c.name} | ${c.pass ? 'pass' : 'FAIL'} | ${c.detail.replace(/\|/g, '/')} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
