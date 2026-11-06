import {
  evaluate,
  isFalsePrompt,
  isMissedBid,
  isRecoverable,
  isWrongAccept,
  type Actual,
  type EvalResult,
  type Expected,
  type Metrics,
} from './metrics.js';
import { gateG5 } from './harness.js';
import type { GateRecord } from './gate.js';

/** One evaluated utterance with the fields the report groups and sweeps by. */
export interface ReportItem extends EvalResult {
  category: string;
  /** Parser confidence 0..1, used by the threshold sweep. */
  confidence: number;
  /** What the room pipeline did with this utterance (AUTO, CONFIRM or DROP); absent for parser-only runs. */
  gate?: GateRecord;
}

export interface ReportMeta {
  gitSha: string;
  mode: string;
  /** Free-form label of the input set, for example "dev" or "audio". */
  set: string;
  provider: string;
  /** Microphone rule the gate ran under; reported with the gated section. */
  mic?: string;
  items: readonly ReportItem[];
}

/** AUTO threshold sweep of R-VOX-078: 0.70 to 0.95, step 0.05. */
export const SWEEP_THRESHOLDS: readonly number[] = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

export interface SweepRow {
  threshold: number;
  wrongAcceptRate: number;
  confirmRate: number;
}

export interface ConfusionEntry {
  id: string;
  kind: 'wrong_accept' | 'missed_bid' | 'false_prompt' | 'unrecovered_confirm';
  expected: string;
  actual: string;
}

export interface Report {
  /** Byte-identical for the same inputs: fixed key order, sorted rows, no clock. */
  json: string;
  markdown: string;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function describeExpected(e: Expected): string {
  if (e.outcome === 'bid') return `bid ${e.pair.who} ${e.pair.amountCents}`;
  return e.outcome;
}

function describeActual(a: Actual): string {
  if (a.kind === 'accept') return `accept ${a.pair.who} ${a.pair.amountCents}`;
  if (a.kind === 'confirm') {
    return `confirm ${a.candidates.map((c) => `${c.who} ${c.amountCents}`).join(' / ')}`;
  }
  return 'none';
}

/** An accept below the threshold is held for confirmation instead. */
function atThreshold(item: ReportItem, threshold: number): ReportItem {
  const { actual } = item;
  if (actual.kind === 'accept' && round6(item.confidence) < threshold) {
    return { ...item, actual: { kind: 'confirm', candidates: [actual.pair] } };
  }
  return item;
}

export function sweep(items: readonly ReportItem[]): SweepRow[] {
  return SWEEP_THRESHOLDS.map((threshold) => {
    const m = evaluate(items.map((i) => atThreshold(i, threshold)));
    return {
      threshold,
      wrongAcceptRate: round6(m.wrongAcceptRate),
      confirmRate: round6(m.confirmRate),
    };
  });
}

export function confusion(items: readonly ReportItem[]): ConfusionEntry[] {
  const out: ConfusionEntry[] = [];
  for (const r of items) {
    let kind: ConfusionEntry['kind'] | null = null;
    if (isWrongAccept(r)) kind = 'wrong_accept';
    else if (isMissedBid(r)) kind = 'missed_bid';
    else if (isFalsePrompt(r)) kind = 'false_prompt';
    else if (r.expected.outcome === 'bid' && r.actual.kind === 'confirm' && !isRecoverable(r)) {
      kind = 'unrecovered_confirm';
    }
    if (kind !== null) {
      out.push({
        id: r.id,
        kind,
        expected: describeExpected(r.expected),
        actual: describeActual(r.actual),
      });
    }
  }
  return out.sort(byId);
}

function roundMetrics(m: Metrics): Record<string, unknown> {
  const rates: Record<string, number> = {};
  for (const key of Object.keys(m.numberTokenErrorRate).sort()) {
    rates[key] = round6(m.numberTokenErrorRate[key] ?? 0);
  }
  return {
    n: m.n,
    bidN: m.bidN,
    noneN: m.noneN,
    exactRate: round6(m.exactRate),
    wrongAcceptRate: round6(m.wrongAcceptRate),
    confirmRate: round6(m.confirmRate),
    recoverableRate: round6(m.recoverableRate),
    missedBidRate: round6(m.missedBidRate),
    falsePromptRate: round6(m.falsePromptRate),
    numberTokenErrorRate: rates,
    latencyP50Ms: m.latencyP50Ms,
    latencyP95Ms: m.latencyP95Ms,
  };
}

function categoryRows(items: readonly ReportItem[]): Array<Record<string, unknown>> {
  const names = [...new Set(items.map((i) => i.category))].sort();
  return names.map((category) => {
    const m = evaluate(items.filter((i) => i.category === category));
    return {
      category,
      n: m.n,
      exactRate: round6(m.exactRate),
      wrongAcceptRate: round6(m.wrongAcceptRate),
      confirmRate: round6(m.confirmRate),
    };
  });
}

function utteranceRows(items: readonly ReportItem[]): Array<Record<string, unknown>> {
  return [...items].sort(byId).map((i) => ({
    id: i.id,
    category: i.category,
    expected: describeExpected(i.expected),
    actual: describeActual(i.actual),
    confidence: round6(i.confidence),
    latencyMs: i.latencyMs,
    provider: i.provider,
  }));
}

/** Items as the room gate decided them, so the metrics and the sweep describe the policy that runs. */
function gatedItems(items: readonly ReportItem[]): ReportItem[] {
  return items.flatMap((i) => {
    const { gate, ...rest } = i;
    return gate === undefined
      ? []
      : [{ ...rest, actual: gate.actual, confidence: gate.confidence }];
  });
}

function gatedSection(
  items: readonly ReportItem[],
  mic: string | undefined,
): Record<string, unknown> | null {
  const gated = gatedItems(items);
  if (gated.length === 0) return null;
  const records = items.flatMap((i) => (i.gate === undefined ? [] : [i.gate]));
  const count = (d: GateRecord['decision']): number =>
    records.filter((r) => r.decision === d).length;
  return {
    note: 'Outcome after the room pipeline: rules parse, rescoring, validation, AUTO/CONFIRM policy and mic rule.',
    mic: mic ?? 'room',
    assumptions:
      'Roster of paddles 1 to 99 with active holds; price 0 and minimum increment 100 cents where the fixture gives none; neutral speech-to-text confidence where none was recorded.',
    outcomes: { auto: count('auto'), confirm: count('confirm'), drop: count('drop') },
    sttConfidence: {
      recorded: records.filter((r) => r.sttSource === 'recorded').length,
      neutralAssumed: records.filter((r) => r.sttSource === 'neutral_assumed').length,
    },
    metrics: roundMetrics(evaluate(gated)),
    sweep: sweep(gated),
  };
}

const fmt = (n: unknown): string => (typeof n === 'number' ? n.toFixed(3) : String(n));

function table(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
}

/**
 * Builds report.json and report.md (R-VOX-078). The output depends only on the arguments, so two
 * runs over the same inputs give byte-identical JSON.
 */
export function renderReport(metrics: Metrics, meta: ReportMeta): Report {
  const gate = gateG5(metrics);
  const categories = categoryRows(meta.items);
  const utterances = utteranceRows(meta.items);
  const rows = sweep(meta.items);
  const confusions = confusion(meta.items);
  const summary = roundMetrics(metrics);
  const gated = gatedSection(meta.items, meta.mic);

  const doc = {
    gitSha: meta.gitSha,
    mode: meta.mode,
    set: meta.set,
    provider: meta.provider,
    metrics: summary,
    gate: {
      pass: gate.pass,
      usableRate: round6(gate.usableRate),
      wrongAcceptRate: round6(gate.wrongAcceptRate),
      reasons: gate.reasons,
      notice: gate.notice,
    },
    categories,
    sweep: rows,
    ...(gated === null ? {} : { gated }),
    confusion: confusions,
    utterances,
  };
  const json = `${JSON.stringify(doc, null, 2)}\n`;

  const md: string[] = [
    '# Voice evaluation report',
    '',
    `Git sha: ${meta.gitSha}`,
    `Mode: ${meta.mode}, set: ${meta.set}, provider: ${meta.provider}`,
    '',
    `G5 ${gate.pass ? 'pass' : 'fail'}: exact + recoverable ${fmt(gate.usableRate)}, wrong accept ${fmt(gate.wrongAcceptRate)}`,
    ...gate.reasons.map((r) => `- ${r}`),
    ...(gate.notice === null ? [] : ['', gate.notice]),
    '',
    '## Summary',
    '',
    ...table(
      ['metric', 'value'],
      Object.entries(summary)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => [k, fmt(v)]),
    ),
    '',
    '## Per category',
    '',
    ...table(
      ['category', 'n', 'exact', 'wrong accept', 'confirm'],
      categories.map((c) => [
        String(c['category']),
        String(c['n']),
        fmt(c['exactRate']),
        fmt(c['wrongAcceptRate']),
        fmt(c['confirmRate']),
      ]),
    ),
    '',
    '## Threshold sweep (AUTO)',
    '',
    ...table(
      ['threshold', 'wrong accept', 'confirm'],
      rows.map((r) => [r.threshold.toFixed(2), fmt(r.wrongAcceptRate), fmt(r.confirmRate)]),
    ),
    '',
    ...(gated === null
      ? []
      : [
          '## Room gate (AUTO/CONFIRM)',
          '',
          String(gated['note']),
          '',
          `Mic rule: ${String(gated['mic'])}. ${String(gated['assumptions'])}`,
          '',
          ...table(
            ['outcome', 'n'],
            Object.entries(gated['outcomes'] as Record<string, number>).map(([k, v]) => [
              k,
              String(v),
            ]),
          ),
          '',
          ...table(
            ['stt confidence', 'n'],
            Object.entries(gated['sttConfidence'] as Record<string, number>).map(([k, v]) => [
              k,
              String(v),
            ]),
          ),
          '',
          ...table(
            ['metric', 'value'],
            Object.entries(gated['metrics'] as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'number')
              .map(([k, v]) => [k, fmt(v)]),
          ),
          '',
          '### Threshold sweep after the gate',
          '',
          ...table(
            ['threshold', 'wrong accept', 'confirm'],
            (gated['sweep'] as SweepRow[]).map((r) => [
              r.threshold.toFixed(2),
              fmt(r.wrongAcceptRate),
              fmt(r.confirmRate),
            ]),
          ),
          '',
        ]),
    '## Confusions',
    '',
    ...(confusions.length === 0
      ? ['none']
      : table(
          ['id', 'kind', 'expected', 'actual'],
          confusions.map((c) => [c.id, c.kind, c.expected, c.actual]),
        )),
    '',
    '## Per utterance',
    '',
    ...table(
      ['id', 'category', 'expected', 'actual', 'confidence', 'latency ms'],
      utterances.map((u) => [
        String(u['id']),
        String(u['category']),
        String(u['expected']),
        String(u['actual']),
        fmt(u['confidence']),
        String(u['latencyMs']),
      ]),
    ),
    '',
  ];
  return { json, markdown: md.join('\n') };
}
