import { z } from 'zod';
import { parseUtterance } from '../parser/utterance.js';
import type { ParseResult } from '../types.js';
import type { Actual, Expected, Pair } from './metrics.js';
import { evaluate } from './metrics.js';
import { renderReport, type ReportItem } from './report.js';

/**
 * Evaluation CLI (R-VOX-075, R-VOX-080): text, cached and live modes.
 *
 *   npm run eval -- --mode text [--set dev|heldout|all] [--out dir]
 *   npm run eval -- --mode cached --provider deepgram
 *   npm run eval -- --mode live --provider deepgram
 *
 * Exit codes: 0 done, 1 bad input or failed run, 2 live mode without keys.
 */

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_NO_KEYS = 2;

/** At most this many provider calls run at once in live mode. */
export const LIVE_CONCURRENCY = 2;

export type EvalMode = 'text' | 'cached' | 'live';
export type EvalSet = 'dev' | 'heldout' | 'all';
export type Provider = 'deepgram' | 'groq';

/** Environment variable that holds the key of each live provider. */
export const PROVIDER_KEY_ENV: Record<Provider, string> = {
  deepgram: 'DEEPGRAM_API_KEY',
  groq: 'GROQ_API_KEY',
};

export interface CliOptions {
  mode: EvalMode;
  provider: Provider;
  set: EvalSet;
  out: string;
}

export function parseArgs(argv: readonly string[]): CliOptions | string {
  const opts: CliOptions = { mode: 'text', provider: 'deepgram', set: 'all', out: 'eval-out' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) return `missing value for ${String(flag)}`;
    if (flag === '--mode') {
      if (value !== 'text' && value !== 'cached' && value !== 'live') {
        return `--mode must be text, cached or live, got ${value}`;
      }
      opts.mode = value;
    } else if (flag === '--provider') {
      if (value !== 'deepgram' && value !== 'groq') return `--provider must be deepgram or groq`;
      opts.provider = value;
    } else if (flag === '--set') {
      if (value !== 'dev' && value !== 'heldout' && value !== 'all') {
        return `--set must be dev, heldout or all, got ${value}`;
      }
      opts.set = value;
    } else if (flag === '--out') {
      opts.out = value;
    } else {
      return `unknown flag ${String(flag)}`;
    }
  }
  return opts;
}

/** A recorded provider answer for one audio fixture (fixtures/stt-cache/<provider>/<id>.json). */
const sttCacheSchema = z.object({
  text: z.string(),
  latencyMs: z.number().nonnegative().default(0),
});

const manifestSchema = z.array(
  z.object({
    id: z.string(),
    category: z.string(),
    text: z.string(),
    speakerBidderId: z.string().nullable().optional(),
    context: z.object({
      currentPriceCents: z.number().int().optional(),
      minIncrementCents: z.number().int().optional(),
    }),
    expected: z.object({
      outcome: z.enum(['bid', 'confirm', 'none']),
      amountCents: z.number().int().optional(),
    }),
  }),
);

const casesSchema = z.array(
  z.object({
    id: z.string(),
    set: z.enum(['dev', 'heldout']),
    category: z.string(),
    text: z.string(),
    speaker: z.string().nullable(),
    currentPriceCents: z.number().int().nullable(),
    expected: z.discriminatedUnion('status', [
      z.object({ status: z.literal('bid'), bidder: z.string(), amountCents: z.number().int() }),
      z.object({ status: z.literal('confirm') }),
      z.object({ status: z.literal('none') }),
    ]),
  }),
);

/** File access and process facts, injected so tests need no disk, env or network. */
export interface CliDeps {
  /** Path relative to the package root; throws when missing. */
  readFile(path: string): string;
  /** True when the file or directory exists. */
  exists(path: string): boolean;
  writeFile(path: string, data: string): void;
  env: Readonly<Record<string, string | undefined>>;
  gitSha(): string;
  log(line: string): void;
  /**
   * Live transcription of one audio fixture; absent when no provider adapter is wired in.
   * Receives the key so the adapter never reads the environment itself.
   */
  transcribe?: (id: string, provider: Provider, key: string) => Promise<{ text: string }>;
  /** True when the recording of a clip is available to the live adapter. */
  recordingExists?: (id: string) => boolean;
}

const ctxOf = (speaker: string | null | undefined, price: number | null | undefined) => ({
  ...(speaker === null || speaker === undefined ? {} : { speakerBidderId: speaker }),
  ...(price === null || price === undefined ? {} : { currentPriceCents: price }),
});

function toActual(r: ParseResult, speaker: string | null | undefined): Actual {
  const who = (b: { value: string } | null): string => b?.value ?? speaker ?? '';
  if (r.status === 'bid' && r.amountCents !== null) {
    return { kind: 'accept', pair: { who: who(r.bidder), amountCents: r.amountCents } };
  }
  if (r.status === 'confirm') {
    const candidates: Pair[] = [];
    for (const c of r.candidates) {
      if (c.amountCents !== null)
        candidates.push({ who: who(c.bidder), amountCents: c.amountCents });
    }
    if (candidates.length === 0 && r.amountCents !== null) {
      candidates.push({ who: who(r.bidder), amountCents: r.amountCents });
    }
    return { kind: 'confirm', candidates };
  }
  return { kind: 'none' };
}

function textItems(deps: CliDeps, set: EvalSet): ReportItem[] {
  const cases = casesSchema.parse(JSON.parse(deps.readFile('fixtures/text/cases.json')));
  return cases
    .filter((c) => set === 'all' || c.set === set)
    .map((c): ReportItem => {
      const r = parseUtterance(c.text, ctxOf(c.speaker, c.currentPriceCents));
      const expected: Expected =
        c.expected.status === 'bid'
          ? {
              outcome: 'bid',
              pair: { who: c.expected.bidder, amountCents: c.expected.amountCents },
            }
          : c.expected.status === 'confirm'
            ? { outcome: 'confirm', acceptableConfirm: [] }
            : { outcome: 'none' };
      return {
        id: c.id,
        category: c.category,
        confidence: r.confidence,
        expected,
        actual: toActual(r, c.speaker),
        latencyMs: 0,
        provider: 'text',
        referenceText: c.text,
        recognizedText: c.text,
      };
    });
}

type AudioCase = z.infer<typeof manifestSchema>[number];

function audioCases(deps: CliDeps): AudioCase[] {
  return manifestSchema.parse(JSON.parse(deps.readFile('fixtures/audio/manifest.json')));
}

function audioExpected(c: AudioCase): Expected {
  if (c.expected.outcome === 'bid') {
    return {
      outcome: 'bid',
      pair: { who: c.speakerBidderId ?? '', amountCents: c.expected.amountCents ?? 0 },
    };
  }
  if (c.expected.outcome === 'confirm') return { outcome: 'confirm', acceptableConfirm: [] };
  return { outcome: 'none' };
}

function audioItem(
  c: AudioCase,
  recognized: string,
  latencyMs: number,
  provider: string,
): ReportItem {
  const r = parseUtterance(recognized, ctxOf(c.speakerBidderId, c.context.currentPriceCents));
  return {
    id: c.id,
    category: c.category,
    confidence: r.confidence,
    expected: audioExpected(c),
    actual: toActual(r, c.speakerBidderId),
    latencyMs,
    provider,
    referenceText: c.text,
    recognizedText: recognized,
  };
}

/** Recorded provider output and model outputs through the parser; deterministic and offline. */
function cachedItems(deps: CliDeps, provider: Provider): ReportItem[] | string {
  const dir = `fixtures/stt-cache/${provider}`;
  if (!deps.exists(dir)) return `no recorded provider output at ${dir}`;
  if (!deps.exists('fixtures/model-cache'))
    return 'no recorded model output at fixtures/model-cache';
  const items: ReportItem[] = [];
  for (const c of audioCases(deps)) {
    const path = `${dir}/${c.id}.json`;
    if (!deps.exists(path)) return `missing ${path}`;
    const rec = sttCacheSchema.parse(JSON.parse(deps.readFile(path)));
    items.push(audioItem(c, rec.text, rec.latencyMs, provider));
  }
  return items;
}

/** Runs `fn` over `inputs` with at most `limit` calls in flight; results keep input order. */
export async function mapLimited<T, R>(
  inputs: readonly T[],
  limit: number,
  fn: (input: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(inputs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= inputs.length) return;
      out[i] = await fn(inputs[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker));
  return out;
}

/** Replaces every occurrence of a secret in a log line. */
export function redact(line: string, secrets: readonly string[]): string {
  let out = line;
  for (const s of secrets) {
    if (s.length > 0) out = out.split(s).join('[redacted]');
  }
  return out;
}

async function liveItems(
  deps: CliDeps,
  provider: Provider,
  key: string,
  transcribe: NonNullable<CliDeps['transcribe']>,
): Promise<ReportItem[]> {
  const cases = audioCases(deps);
  return mapLimited(cases, LIVE_CONCURRENCY, async (c) => {
    const started = Date.now();
    const { text } = await transcribe(c.id, provider, key);
    return audioItem(c, text, Date.now() - started, provider);
  });
}

/** Entry point; returns the exit code. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const opts = parseArgs(argv);
  if (typeof opts === 'string') {
    deps.log(`eval: ${opts}`);
    return EXIT_FAILED;
  }
  const keyName = PROVIDER_KEY_ENV[opts.provider];
  const key = deps.env[keyName] ?? '';
  const log = (line: string): void => deps.log(redact(line, [key]));

  let items: ReportItem[] | string;
  let setLabel: string = opts.set;
  try {
    if (opts.mode === 'text') {
      items = textItems(deps, opts.set);
    } else if (opts.mode === 'cached') {
      items = cachedItems(deps, opts.provider);
      setLabel = 'audio';
    } else {
      if (key === '') {
        log(`eval: live mode needs ${keyName} in the environment`);
        return EXIT_NO_KEYS;
      }
      if (deps.transcribe === undefined) {
        log(`eval: no live adapter for ${opts.provider} is available in this build`);
        return EXIT_FAILED;
      }
      if (deps.recordingExists !== undefined) {
        const ids = audioCases(deps).map((c) => c.id);
        const missing = ids.filter((id) => deps.recordingExists?.(id) !== true).length;
        if (missing > 0) {
          log(`eval: skipped: ${missing} of ${ids.length} recordings missing`);
          return EXIT_OK;
        }
      }
      items = await liveItems(deps, opts.provider, key, deps.transcribe);
      setLabel = 'audio';
    }
  } catch (err) {
    log(`eval: ${err instanceof Error ? err.message : 'run failed'}`);
    return EXIT_FAILED;
  }
  if (typeof items === 'string') {
    log(`eval: ${items}`);
    return EXIT_FAILED;
  }

  const report = renderReport(evaluate(items), {
    gitSha: deps.gitSha(),
    mode: opts.mode,
    set: setLabel,
    provider: opts.mode === 'text' ? 'none' : opts.provider,
    items,
  });
  deps.writeFile(`${opts.out}/report.json`, report.json);
  deps.writeFile(`${opts.out}/report.md`, report.markdown);
  log(`eval: ${items.length} utterances, report written to ${opts.out}`);
  return EXIT_OK;
}
