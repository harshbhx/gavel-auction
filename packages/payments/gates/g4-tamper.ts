import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_FAKE_WEBHOOK_ID, FakePayPalServer } from '../src/fake/server.js';
import { assertSandboxUrl } from '../src/guard.js';
import {
  TRANSMISSION_HEADERS,
  VERIFY_PATH,
  buildVerifyBody,
  readRawEvent,
} from '../src/webhooks/verify.js';
import {
  fakeDeliveries,
  parseReceiverLog,
  readRunIds,
  summarizeEvent,
  type Delivery,
  type RunIds,
} from './g4.js';
import { fetchAccessToken } from './http.js';
import {
  EXIT_REFUSED,
  GateUsageError,
  parseGateArgs,
  runGate,
  type GateContext,
} from './runner.js';

/**
 * G4 tamper run (issue 2184): does PayPal's real verify endpoint refuse an event that was
 * altered after delivery? For each of a few fresh deliveries the script asks the verify
 * endpoint five questions: the unmodified delivery (control), the body with one character
 * changed, the body with a different amount, the delivery with a foreign transmission id
 * and the delivery with one character of the signature changed. Only statuses are recorded.
 *
 * Verdict: PASS when the control verifies (SUCCESS) and every tampered case does not (a
 * FAILURE answer or an HTTP error). If the control does not verify (for example the event is
 * too old), the verdict is INCONCLUSIVE and the run exits 1: nothing is proven.
 *
 * Input is a receiver log, as for G4 (--log <file>), and optionally --run-file so that only
 * events of the current run are used. At most MAX_DELIVERIES deliveries are tried, so a run
 * makes at most MAX_DELIVERIES * 5 verify calls.
 *
 * Run: npx vite-node gates/g4-tamper.ts -- --log <file> [--run-file <file>] [--out <dir>]
 */

export const TAMPER_SCRIPT_VERSION = 'g4-tamper-1';
export const MAX_DELIVERIES = 2;
const PREFERRED_TYPES = ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.AUTHORIZATION.VOIDED'] as const;

export type TamperCase =
  'control' | 'body_byte' | 'amount' | 'foreign_transmission_id' | 'signature';
export const TAMPER_CASES: readonly TamperCase[] = [
  'control',
  'body_byte',
  'amount',
  'foreign_transmission_id',
  'signature',
];

export interface TamperInput {
  rawEvent: string;
  headers: Record<string, string>;
}

function flipChar(c: string): string {
  if (c === '0') return '1';
  if (c === 'a') return 'b';
  if (c === 'A') return 'B';
  return '0';
}

/** Changes one character at index i of s (always to a different character). */
export function changeCharAt(s: string, i: number): string {
  const c = s.charAt(i);
  const next = flipChar(c);
  return `${s.slice(0, i)}${next === c ? '2' : next}${s.slice(i + 1)}`;
}

/**
 * Changes exactly one character of a JSON string value in the event, so the body stays valid
 * JSON of the same length. Prefers the digits of the create_time.
 */
export function changeOneByte(rawEvent: string): string {
  const m = /"create_time"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:)(\d)/.exec(rawEvent);
  if (m !== null) {
    const at = m.index + m[0].length - 1;
    const out = changeCharAt(rawEvent, at);
    return out;
  }
  const idAt = rawEvent.search(/"id"\s*:\s*"WH-/);
  if (idAt < 0) throw new Error('event has no create_time or WH- id to change');
  return changeCharAt(rawEvent, rawEvent.indexOf('WH-', idAt) + 3);
}

/** Raises the first amount value to a different number. Undefined when the event has none. */
export function changeAmount(rawEvent: string): string | undefined {
  const re = /("amount"\s*:\s*\{[^{}]*?"value"\s*:\s*")([0-9]+(?:\.[0-9]+)?)(")/;
  const m = re.exec(rawEvent);
  if (m === null) {
    // The simulator's events carry the amount as integer cents.
    const cents = /("amountCents"\s*:\s*)(\d+)/.exec(rawEvent);
    if (cents === null) return undefined;
    return rawEvent.replace(/("amountCents"\s*:\s*)(\d+)/, `$1${Number(cents[2]) + 777}`);
  }
  const bumped = (Number(m[2]) * 100 + 7).toFixed(2);
  return rawEvent.replace(re, `$1${bumped}$3`);
}

/** The five verify inputs for one delivery. `foreignId` is a transmission id of another delivery. */
export function buildCases(
  d: Delivery,
  foreignId: string,
): Partial<Record<TamperCase, TamperInput>> | { error: string } {
  const rawEvent = readRawEvent(d.rawBody);
  if (rawEvent === undefined) return { error: 'delivery is not a single JSON event' };
  const sigName = TRANSMISSION_HEADERS.transmissionSig;
  const idName = TRANSMISSION_HEADERS.transmissionId;
  const sig = d.headers[sigName] ?? '';
  const own = d.headers[idName] ?? '';
  if (sig.length < 2) return { error: 'delivery has no signature header' };
  const foreign = foreignId !== '' && foreignId !== own ? foreignId : changeCharAt(own, 0);
  try {
    const amountEvent = changeAmount(rawEvent);
    return {
      control: { rawEvent, headers: d.headers },
      body_byte: { rawEvent: changeOneByte(rawEvent), headers: d.headers },
      // An event without an amount (the simulator's void) has no amount case.
      ...(amountEvent === undefined
        ? {}
        : { amount: { rawEvent: amountEvent, headers: d.headers } }),
      foreign_transmission_id: { rawEvent, headers: { ...d.headers, [idName]: foreign } },
      signature: {
        rawEvent,
        headers: { ...d.headers, [sigName]: changeCharAt(sig, Math.floor(sig.length / 2)) },
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'could not build cases' };
  }
}

export interface CaseResult {
  eventType: string;
  case: TamperCase;
  http: number;
  verification: string;
}

/** True when the answer refuses the event: a FAILURE status or an HTTP error without SUCCESS. */
export function isRefusal(r: Pick<CaseResult, 'http' | 'verification'>): boolean {
  if (r.verification === 'SUCCESS') return false;
  return r.verification === 'FAILURE' || r.http >= 400 || r.http === 0;
}

export type TamperVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

/** Verdict over all results; see the file comment. */
export function tamperVerdict(results: readonly CaseResult[]): TamperVerdict {
  const controls = results.filter((r) => r.case === 'control');
  const tampered = results.filter((r) => r.case !== 'control');
  if (controls.length === 0 || tampered.length === 0) return 'INCONCLUSIVE';
  if (controls.some((c) => c.verification !== 'SUCCESS')) return 'INCONCLUSIVE';
  return tampered.every(isRefusal) ? 'PASS' : 'FAIL';
}

/** Picks up to `max` deliveries, one per preferred event type first, restricted to this run. */
export function pickDeliveries(
  all: readonly Delivery[],
  runIds: RunIds | undefined,
  max: number,
): Delivery[] {
  const mine = all.filter((d) => {
    const s = summarizeEvent(d.rawBody);
    if (s === undefined) return false;
    const ids = runIds?.[s.eventType];
    return ids === undefined ? runIds === undefined : s.linkedIds.some((x) => ids.includes(x));
  });
  const out: Delivery[] = [];
  for (const t of PREFERRED_TYPES) {
    const hit = mine.find((d) => summarizeEvent(d.rawBody)?.eventType === t);
    if (hit !== undefined && out.length < max) out.push(hit);
  }
  for (const d of mine) if (out.length < max && !out.includes(d)) out.push(d);
  return out;
}

export function markdownSummary(verdict: TamperVerdict, results: readonly CaseResult[]): string {
  const lines = [
    `# G4 tamper run: ${verdict}`,
    '',
    '| event type | case | HTTP | verification_status |',
    '|------------|------|------|---------------------|',
  ];
  for (const r of results) {
    lines.push(`| ${r.eventType} | ${r.case} | ${r.http} | ${r.verification || '(none)'} |`);
  }
  return `${lines.join('\n')}\n`;
}

export interface TamperDeps {
  deliveries: readonly Delivery[];
  fake: boolean;
  runIds?: RunIds;
  fetch?: typeof fetch;
  /** Directory for tamper-summary.json and .md; none when undefined. */
  summaryDir?: string;
}

async function verifyOnce(
  ctx: GateContext,
  deps: TamperDeps,
  token: string,
  input: TamperInput,
): Promise<{ http: number; verification: string }> {
  const h = (n: string): string => input.headers[n] ?? '';
  const body = buildVerifyBody(
    input.rawEvent,
    {
      authAlgo: h(TRANSMISSION_HEADERS.authAlgo),
      certUrl: h(TRANSMISSION_HEADERS.certUrl),
      transmissionId: h(TRANSMISSION_HEADERS.transmissionId),
      transmissionSig: h(TRANSMISSION_HEADERS.transmissionSig),
      transmissionTime: h(TRANSMISSION_HEADERS.transmissionTime),
    },
    ctx.config.webhookId,
  );
  const url = `${ctx.config.baseUrl}${VERIFY_PATH}`;
  assertSandboxUrl(url, { fake: deps.fake });
  const res = await (deps.fetch ?? fetch)(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  let verification = '';
  try {
    const parsed = JSON.parse(text) as { verification_status?: unknown };
    if (typeof parsed.verification_status === 'string') verification = parsed.verification_status;
  } catch {
    verification = 'UNREADABLE';
  }
  return { http: res.status, verification };
}

export async function tamperGate(ctx: GateContext, deps: TamperDeps): Promise<TamperVerdict> {
  if (ctx.config.webhookId === '') throw new Error('G4 tamper: PAYPAL_WEBHOOK_ID is not set');
  const picked = pickDeliveries(deps.deliveries, deps.runIds, MAX_DELIVERIES);
  if (picked.length === 0) throw new Error('G4 tamper: no usable delivery in the receiver log');
  const token = await fetchAccessToken(
    ctx.http,
    'T4.0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  const results: CaseResult[] = [];
  for (const [i, d] of picked.entries()) {
    const other = picked[(i + 1) % picked.length] ?? d;
    const foreignId = other.headers[TRANSMISSION_HEADERS.transmissionId] ?? '';
    const cases = buildCases(d, foreignId);
    const eventType = summarizeEvent(d.rawBody)?.eventType ?? 'unknown';
    if ('error' in cases) {
      ctx.check(`T4.1 delivery ${i + 1}`, 'cases can be built', true, cases.error);
      continue;
    }
    for (const name of TAMPER_CASES) {
      const input = cases[name];
      if (input === undefined) {
        ctx.http.note(`T4.1 delivery ${i + 1}`, `case ${name} skipped: not applicable`, true);
        continue;
      }
      const v = await verifyOnce(ctx, deps, token, input);
      results.push({ eventType, case: name, http: v.http, verification: v.verification });
      ctx.http.note(`T4.1 delivery ${i + 1}`, `verify ${name}`, {
        eventType,
        http: v.http,
        verification: v.verification,
      });
    }
  }
  const verdict = tamperVerdict(results);
  for (const r of results) {
    if (r.case === 'control') {
      ctx.check(`T4.2 ${r.eventType}`, 'control verifies', 'SUCCESS', r.verification);
    } else {
      ctx.check(`T4.2 ${r.eventType}`, `${r.case} is refused`, true, isRefusal(r));
    }
  }
  const evidence = {
    v: 1,
    gate: 'G4-tamper',
    runId: ctx.runId,
    verdict,
    calls: results.length,
    results,
  };
  if (deps.summaryDir !== undefined) {
    const json = `${JSON.stringify(evidence, null, 2)}\n`;
    writeFileSync(join(deps.summaryDir, 'tamper-summary.json'), json, 'utf8');
    writeFileSync(
      join(deps.summaryDir, 'tamper-summary.md'),
      markdownSummary(verdict, results),
      'utf8',
    );
    writeFileSync(
      join(deps.summaryDir, 'tamper-summary.sha256'),
      `${createHash('sha256').update(json).digest('hex')}  tamper-summary.json\n`,
      'utf8',
    );
  }
  ctx.log(`G4 TAMPER VERDICT: ${verdict} (${results.length} verify calls)`);
  if (verdict === 'INCONCLUSIVE') {
    ctx.check('T4.3 verdict', 'control verified, so the run proves something', 'PASS', verdict);
  }
  return verdict;
}

export interface RunTamperOptions {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
}

export async function runTamper(opts: RunTamperOptions): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  let logFile: string | undefined;
  let runFile: string | undefined;
  const rest: string[] = [];
  let fake: boolean;
  try {
    for (let i = 0; i < opts.argv.length; i += 1) {
      const a = opts.argv[i] ?? '';
      if (a === '--log' || a === '--run-file') {
        const v = opts.argv[i + 1];
        if (v === undefined || v.startsWith('--')) throw new GateUsageError(`${a} needs a value`);
        if (a === '--log') logFile = v;
        else runFile = v;
        i += 1;
      } else rest.push(a);
    }
    fake = parseGateArgs(rest).fake;
    if (!fake && logFile === undefined) throw new GateUsageError('--log <file> is required');
  } catch (e) {
    if (e instanceof GateUsageError) {
      log(`refused: ${e.message}`);
      return EXIT_REFUSED;
    }
    throw e;
  }
  let server: FakePayPalServer | undefined;
  let env = { ...opts.env };
  let deliveries: Delivery[] = [];
  if (fake) {
    server = new FakePayPalServer();
    await server.start();
    env = {
      ...env,
      PAYPAL_ENV: env['PAYPAL_ENV'] ?? 'sandbox',
      PAYPAL_BASE_URL: server.url,
      PAYPAL_WEBHOOK_ID: DEFAULT_FAKE_WEBHOOK_ID,
    };
    deliveries = fakeDeliveries(server);
  } else {
    const file = logFile ?? '';
    if (!existsSync(file)) {
      log(`refused: receiver log not found: ${file}`);
      return EXIT_REFUSED;
    }
    deliveries = parseReceiverLog(readFileSync(file, 'utf8'));
  }
  const sha = env['GITHUB_SHA'];
  try {
    return await runGate({
      gate: 'G4-tamper',
      scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : TAMPER_SCRIPT_VERSION,
      argv: rest,
      env,
      log,
      main: async (ctx) => {
        const runIds = runFile !== undefined ? readRunIds(runFile) : undefined;
        await tamperGate(ctx, {
          deliveries,
          fake,
          summaryDir: dirname(ctx.evidencePath),
          ...(runIds !== undefined ? { runIds } : {}),
        });
      },
    });
  } finally {
    await server?.stop();
  }
}

const isEntry =
  /vite-node/.test(process.argv[1] ?? '') ||
  process.argv.slice(1).some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  runTamper({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
