import { createHash } from 'node:crypto';
import { parseUtterance } from '@gavel/voice';

// Gate G5 harness (R-QA-029, T-QA-059): 20 noisy bid utterances go through a live speech-to-text
// provider and then the rule parser. The harness measures exact amount and bidder accuracy and
// the confirm rate, and renders the G5 block of docs/GATES.md. It runs by hand or in the nightly
// workflow, never in pull request CI. Without a key or without the recordings it reports
// `skipped`. Keys come from the environment and are never written anywhere.

export interface G5Utterance {
  id: string;
  /** What the speaker says; the recording is G5_AUDIO_DIR/<id>.wav. */
  text: string;
  noise: string;
  amountCents: number;
  bidder: string;
}

const NOISES = [
  'crowd-snr-10db',
  'street-snr-8db',
  'room-snr-15db',
  'crowd-snr-5db',
  'hvac-snr-20db',
];
const RAW: ReadonlyArray<readonly [string, number, string]> = [
  ['four hundred for paddle six', 40000, '6'],
  ['nine hundred for paddle thirty', 90000, '30'],
  ['one twenty for paddle fourteen', 12000, '14'],
  ['six fifty for paddle two', 65000, '2'],
  ['three fifty for paddle twelve', 35000, '12'],
  ['two thousand for paddle eight', 200000, '8'],
  ['eleven hundred for paddle nineteen', 110000, '19'],
  ['four twenty five for paddle one', 42500, '1'],
  ['five hundred for paddle seven', 50000, '7'],
  ['seven fifty for paddle twenty one', 75000, '21'],
  ['one thousand for paddle three', 100000, '3'],
  ['two fifty for paddle nine', 25000, '9'],
  ['eight hundred for paddle forty', 80000, '40'],
  ['six hundred for paddle eleven', 60000, '11'],
  ['three hundred for paddle five', 30000, '5'],
  ['fifteen hundred for paddle sixteen', 150000, '16'],
  ['four fifty for paddle twenty', 45000, '20'],
  ['nine fifty for paddle four', 95000, '4'],
  ['twelve hundred for paddle thirteen', 120000, '13'],
  ['two hundred for paddle seventeen', 20000, '17'],
];

export const G5_UTTERANCES: readonly G5Utterance[] = RAW.map(([text, amountCents, bidder], i) => ({
  id: `g5-${String(i + 1).padStart(2, '0')}`,
  text,
  noise: NOISES[i % NOISES.length] ?? 'room-snr-15db',
  amountCents,
  bidder,
}));

export type G5Outcome = 'exact' | 'confirm_recoverable' | 'confirm_other' | 'wrong_accept' | 'none';
export type G5Verdict = 'PASS' | 'PARTIAL' | 'FAIL';

/** R-VOX-076: usable (exact plus recoverable confirm) at least 0.90 and wrong accepts at most 0.05. */
export const G5_PASS_USABLE = 0.9;
export const G5_PARTIAL_USABLE = 0.7;
export const G5_MAX_WRONG_ACCEPT = 0.05;

export interface G5Row {
  id: string;
  noise: string;
  heard: string;
  outcome: G5Outcome;
  latencyMs: number;
}

export interface G5Summary {
  n: number;
  exact: number;
  confirm: number;
  wrongAccept: number;
  none: number;
  exactRate: number;
  confirmRate: number;
  usableRate: number;
  wrongAcceptRate: number;
  verdict: G5Verdict;
  decision: string;
}

type Parsed = ReturnType<typeof parseUtterance>;

/** Compares one parse with the label. A confirm that offers the right pair counts as recoverable. */
export function classify(parsed: Parsed, want: G5Utterance): G5Outcome {
  const same = (who: string | undefined, cents: number | null): boolean =>
    cents === want.amountCents && who === want.bidder;
  if (parsed.status === 'bid') {
    return same(parsed.bidder?.value, parsed.amountCents) ? 'exact' : 'wrong_accept';
  }
  if (parsed.status === 'confirm') {
    const pairs = parsed.candidates.map((c) => same(c.bidder?.value, c.amountCents));
    const primary = same(parsed.bidder?.value, parsed.amountCents);
    return primary || pairs.some(Boolean) ? 'confirm_recoverable' : 'confirm_other';
  }
  return 'none';
}

export function summarize(rows: readonly G5Row[]): G5Summary {
  const n = rows.length;
  const count = (o: G5Outcome): number => rows.filter((r) => r.outcome === o).length;
  const exact = count('exact');
  const recoverable = count('confirm_recoverable');
  const confirm = recoverable + count('confirm_other');
  const wrongAccept = count('wrong_accept');
  const rate = (x: number): number => (n === 0 ? 0 : x / n);
  const usableRate = rate(exact + recoverable);
  const wrongAcceptRate = rate(wrongAccept);
  let verdict: G5Verdict = 'FAIL';
  if (wrongAcceptRate <= G5_MAX_WRONG_ACCEPT) {
    // Compared in millionths so 0.9 and 0.7 are exact limits.
    const u = Math.round(usableRate * 1e6);
    if (u >= G5_PASS_USABLE * 1e6) verdict = 'PASS';
    else if (u >= G5_PARTIAL_USABLE * 1e6) verdict = 'PARTIAL';
  }
  const decision =
    verdict === 'PASS'
      ? 'Keep auto-accept for clear bids; the confirm prompt stays for ambiguity.'
      : verdict === 'PARTIAL'
        ? 'Keep the confirm prompt on every spoken bid at this noise level and re-measure after tuning.'
        : 'Always show the confirm prompt for spoken bids (assist mode).';
  return {
    n,
    exact,
    confirm,
    wrongAccept,
    none: count('none'),
    exactRate: rate(exact),
    confirmRate: rate(confirm),
    usableRate,
    wrongAcceptRate,
    verdict,
    decision,
  };
}

export type G5Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export const DEEPGRAM_URL =
  'https://api.deepgram.com/v1/listen?model=nova-2&language=en-US&punctuate=false&smart_format=false';

/** Transcribes one WAV with Deepgram's prerecorded endpoint. The key only goes in the header. */
export async function deepgramTranscribe(
  audio: Uint8Array,
  key: string,
  doFetch: G5Fetch,
): Promise<string> {
  const res = await doFetch(DEEPGRAM_URL, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
    body: audio,
  });
  if (res.status !== 200) throw new Error(`speech-to-text answered ${res.status}`);
  const body = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] };
  };
  const text = body.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return typeof text === 'string' ? text : '';
}

export interface G5Deps {
  env: Readonly<Record<string, string | undefined>>;
  /** Bytes of G5_AUDIO_DIR/<id>.wav, or undefined when absent. */
  readAudio: (id: string) => Uint8Array | undefined;
  transcribe: (audio: Uint8Array, key: string) => Promise<string>;
  now: () => number;
  utterances?: readonly G5Utterance[];
}

export type G5Provider = 'deepgram' | 'groq';
const KEY_VARS: Record<G5Provider, string> = {
  deepgram: 'DEEPGRAM_API_KEY',
  groq: 'GROQ_API_KEY',
};

export type G5Run =
  | { status: 'skipped'; reason: string }
  | { status: 'done'; provider?: G5Provider; rows: G5Row[]; summary: G5Summary };

type G5Done = Extract<G5Run, { status: 'done' }>;

export const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const GROQ_MODEL = 'whisper-large-v3-turbo';

export type G5FormFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Transcribes one WAV with the Groq endpoint and model the product uses. The key only goes in the header. */
export async function groqTranscribe(
  audio: Uint8Array,
  key: string,
  doFetch: G5FormFetch,
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', GROQ_MODEL);
  form.append('response_format', 'json');
  form.append('language', 'en');
  const res = await doFetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (res.status !== 200) throw new Error(`speech-to-text answered ${res.status}`);
  const body = (await res.json()) as { text?: unknown };
  return typeof body.text === 'string' ? body.text : '';
}

export async function runG5(deps: G5Deps, provider: G5Provider = 'deepgram'): Promise<G5Run> {
  const keyVar = KEY_VARS[provider];
  const key = deps.env[keyVar] ?? '';
  if (key.trim() === '') return { status: 'skipped', reason: `${keyVar} is not set` };
  const set = deps.utterances ?? G5_UTTERANCES;
  const audio = new Map<string, Uint8Array>();
  for (const u of set) {
    const bytes = deps.readAudio(u.id);
    if (bytes !== undefined) audio.set(u.id, bytes);
  }
  if (audio.size < set.length) {
    return {
      status: 'skipped',
      reason: `${set.length - audio.size} of ${set.length} recordings missing`,
    };
  }
  const rows: G5Row[] = [];
  for (const u of set) {
    const started = deps.now();
    const heard = await deps.transcribe(audio.get(u.id) as Uint8Array, key);
    const latencyMs = deps.now() - started;
    rows.push({
      id: u.id,
      noise: u.noise,
      heard,
      outcome: classify(parseUtterance(heard, {}), u),
      latencyMs,
    });
  }
  return { status: 'done', provider, rows, summary: summarize(rows) };
}

const pct = (x: number): string => x.toFixed(3);

const providerName = (run: G5Done): string => (run.provider === 'groq' ? 'Groq' : 'Deepgram');

export interface G5Evidence {
  /** Repo-relative path the file is committed at. */
  path: string;
  sha256: string;
}

/** Redacted evidence: per-utterance noise, outcome and latency. No audio and no transcript text. */
export function renderEvidenceFile(run: G5Done, date: string): string {
  const out = {
    gate: 'G5',
    date,
    provider: run.provider ?? 'deepgram',
    summary: run.summary,
    rows: run.rows.map((r) => ({
      id: r.id,
      noise: r.noise,
      outcome: r.outcome,
      latencyMs: r.latencyMs,
    })),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function evidenceName(run: G5Done, date: string): string {
  return `g5-${run.provider ?? 'deepgram'}-${date}.json`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The G5-live subsection: the accuracy table per noise condition and the totals. */
export function renderG5Block(run: G5Done, date: string): string {
  const { rows, summary: s } = run;
  const noises = [...new Set(rows.map((r) => r.noise))].sort();
  const lines = [
    '### G5-live: live speech-to-text on noisy bids',
    '',
    `Run ${date}. ${s.n} recorded noisy utterances through live ${providerName(run)} and the rule parser.`,
    'No transcript text is kept here; only the outcome per utterance.',
    '',
    '| noise | n | exact | confirm | wrong accept | none |',
    '| ----- | - | ----- | ------- | ------------ | ---- |',
    ...noises.map((noise) => {
      const part = rows.filter((r) => r.noise === noise);
      const c = (f: (o: G5Outcome) => boolean): number => part.filter((r) => f(r.outcome)).length;
      return `| ${noise} | ${part.length} | ${c((o) => o === 'exact')} | ${c((o) => o.startsWith('confirm'))} | ${c((o) => o === 'wrong_accept')} | ${c((o) => o === 'none')} |`;
    }),
    `| all | ${s.n} | ${s.exact} | ${s.confirm} | ${s.wrongAccept} | ${s.none} |`,
    '',
    `Exact ${pct(s.exactRate)}, confirm rate ${pct(s.confirmRate)}, usable (exact plus recoverable confirm) ${pct(s.usableRate)}, wrong accept ${pct(s.wrongAcceptRate)}.`,
    `Verdict: ${s.verdict}. Decision: ${s.decision}`,
  ];
  return `${lines.join('\n')}\n`;
}

/** Sets the G5 header fields and swaps in the G5-live subsection. Other sections are untouched. */
export function applyG5ToGates(
  md: string,
  run: G5Done,
  date: string,
  evidenceFile?: G5Evidence,
): string {
  const start = md.indexOf('## G5:');
  if (start < 0) throw new Error('GATES.md has no G5 section');
  const next = md.indexOf('\n## ', start + 1);
  const end = next < 0 ? md.length : next + 1;
  let section = md.slice(start, end);
  const s = run.summary;
  const set = (label: string, value: string): void => {
    section = section.replace(new RegExp(`^${label}:.*$`, 'm'), `${label}: ${value}`);
  };
  // A status the docs check accepts: the verdict, never the old free-form RUN.
  set('Status', s.verdict);
  const scope =
    run.provider === 'groq'
      ? 'Groq whole-file requests, not the chunked streaming path'
      : 'Deepgram prerecorded endpoint only, not the Groq path the product runs';
  const file =
    evidenceFile === undefined
      ? ''
      : `redacted evidence file ${evidenceFile.path} (sha256 ${evidenceFile.sha256}); `;
  const evidence = `${file}G5-live table in this section (${scope})`;
  section = /^Evidence:/m.test(section)
    ? section.replace(/^Evidence:.*$/m, `Evidence: ${evidence}`)
    : section.replace(/^(Status:.*)$/m, `$1\nEvidence: ${evidence}`);
  set('Run date / by', `${date} / g5 harness`);
  set('Setup', `${s.n} noisy recordings, live ${providerName(run)}, rule parser`);
  set(
    'Observed',
    `exact ${pct(s.exactRate)}, confirm ${pct(s.confirmRate)}, wrong accept ${pct(s.wrongAcceptRate)}`,
  );
  set('Verdict', s.verdict);
  set('Decision', s.decision);
  const block = renderG5Block(run, date);
  const at = section.indexOf('### G5-live');
  if (at >= 0) {
    const after = section.indexOf('\n### ', at + 1);
    section = section.slice(0, at) + block + (after < 0 ? '\n' : section.slice(after + 1));
  } else {
    const firstSub = section.indexOf('\n### ');
    section =
      firstSub < 0
        ? `${section.trimEnd()}\n\n${block}\n`
        : `${section.slice(0, firstSub + 1)}${block}\n${section.slice(firstSub + 1)}`;
  }
  return md.slice(0, start) + section + md.slice(end);
}
