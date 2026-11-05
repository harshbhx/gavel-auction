import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadConfig, PaymentsConfigError, type PaymentsConfig } from '../src/config.js';
import { assertSandboxConfig } from '../src/guard.js';
import { redactString, registerSecret } from '../src/log.js';
import { redactUrlsInText, toJsonlLine, type EvidenceRecord } from './evidence.js';
import { RecordingHttp, type RawFetch } from './http.js';
import { gateCurrency } from './gateUtil.js';

/**
 * Gate runner base (SPEC 3.12, R-PAY-140, R-PAY-142).
 *
 * Shared CLI flags for every gate script:
 *   --fake            run against the fake PayPal on a loopback base URL (CI)
 *   --resume <file>   continue a paused run from its run file
 *   --out <dir>       evidence root (default docs/evidence; a temp dir with --fake)
 *
 * The sandbox guard runs before any HTTP object exists: a non-sandbox
 * environment or host ends the run with exit code 2 and nothing is sent.
 *
 * Steps are recorded in a run file, so a resumed run skips what is done. A gate
 * that needs a human (buyer approval in the sandbox UI) calls waitForApproval:
 * the first time it saves the run file, prints the link and ends the process with
 * exit code 3; after the approval the operator reruns with --resume <file>.
 *
 * Exit codes: 0 all assertions passed, 1 failed assertion or error, 2 refused
 * (guard or usage), 3 paused for approval.
 */

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_REFUSED = 2;
export const EXIT_PAUSED = 3;

export interface GateArgs {
  fake: boolean;
  resume?: string;
  out?: string;
}

export class GateUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateUsageError';
  }
}

/** Thrown by waitForApproval after the run file is saved; ends the run with EXIT_PAUSED. */
export class GatePaused extends Error {
  constructor(
    readonly step: string,
    readonly url: string,
    readonly runFile: string,
  ) {
    super(`paused at "${step}": approve ${url}, then rerun with --resume ${runFile}`);
    this.name = 'GatePaused';
  }
}

export function parseGateArgs(argv: readonly string[]): GateArgs {
  const args: GateArgs = { fake: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--fake') args.fake = true;
    else if (a === '--resume' || a === '--out') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new GateUsageError(`${a} needs a value`);
      if (a === '--resume') args.resume = v;
      else args.out = v;
      i += 1;
    } else {
      throw new GateUsageError(`unknown argument: ${String(a)}`);
    }
  }
  return args;
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface RunFile {
  v: 1;
  gate: string;
  runId: string;
  fake: boolean;
  startedAtMs: number;
  /** Step name -> value the step returned. */
  completed: Record<string, Json>;
  /** Approvals that were confirmed. */
  approved: string[];
  awaiting?: { step: string; url: string; note?: string };
}

export function loadRunFile(path: string): RunFile {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as RunFile;
  if (parsed.v !== 1 || typeof parsed.gate !== 'string' || typeof parsed.runId !== 'string') {
    throw new GateUsageError(`not a gate run file: ${path}`);
  }
  return parsed;
}

/** Redacts the query values of every URL in a run file (approve links carry the order token). */
export function redactRunValue(value: unknown): unknown {
  if (typeof value === 'string') return redactUrlsInText(value);
  if (Array.isArray(value)) return value.map(redactRunValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactRunValue(v);
    }
    return out;
  }
  return value;
}

export function saveRunFile(path: string, run: RunFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  // The run file travels as a public workflow artifact: no URL query values on disk.
  writeFileSync(tmp, `${JSON.stringify(redactRunValue(run), null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export interface GateContext {
  gate: string;
  runId: string;
  args: GateArgs;
  config: PaymentsConfig;
  /** Currency of the gate orders, read from the env passed to runGate. */
  currency: string;
  http: RecordingHttp;
  evidencePath: string;
  runFile: string;
  /** Runs fn once; on resume the stored result is returned instead. */
  step<T extends Json>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Records an assertion; a failed one makes the run exit with 1. */
  check(step: string, name: string, expected: unknown, actual: unknown): boolean;
  /** Pauses until the operator has approved `url` and reruns with --resume. */
  waitForApproval(step: string, url: string, note?: string): Promise<void>;
  log(message: string): void;
}

export interface RunGateOptions {
  gate: string;
  scriptVersion: string;
  argv: readonly string[];
  env: Record<string, string | undefined>;
  main(ctx: GateContext): Promise<void>;
  /** Defaults: global fetch, Date.now, console.log. */
  fetch?: RawFetch;
  now?: () => number;
  log?: (message: string) => void;
}

function stamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

/** Runs one gate script. Returns the process exit code; never calls process.exit itself. */
export async function runGate(opts: RunGateOptions): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const now = opts.now ?? Date.now;

  let args: GateArgs;
  let config: PaymentsConfig;
  try {
    args = parseGateArgs(opts.argv);
    // The flag decides fake mode; GAVEL_PAYMENTS_FAKE in the environment never does.
    config = loadConfig(
      { ...opts.env, GAVEL_PAYMENTS_FAKE: args.fake ? '1' : '0' },
      { requireWebhookId: false },
    );
    assertSandboxConfig({
      env: opts.env['PAYPAL_ENV'] ?? '',
      baseUrl: config.baseUrl,
      fake: args.fake,
    });
  } catch (e) {
    if (e instanceof PaymentsConfigError || e instanceof GateUsageError) {
      log(`refused: ${e.message}`);
      return EXIT_REFUSED;
    }
    throw e;
  }
  if (config.clientSecret !== '') registerSecret(config.clientSecret);

  let run: RunFile;
  let runFile: string;
  const outRoot = args.out ?? (args.fake ? join(tmpdir(), 'gavel-gates') : 'docs/evidence');
  if (args.resume !== undefined) {
    if (!existsSync(args.resume)) {
      log(`refused: run file not found: ${args.resume}`);
      return EXIT_REFUSED;
    }
    run = loadRunFile(args.resume);
    runFile = args.resume;
    if (run.gate !== opts.gate || run.fake !== args.fake) {
      log(`refused: run file belongs to ${run.gate}${run.fake ? ' (fake)' : ''}`);
      return EXIT_REFUSED;
    }
  } else {
    const startedAtMs = now();
    const runId = `${opts.gate}-${stamp(startedAtMs)}${args.fake ? '-fake' : ''}`;
    run = {
      v: 1,
      gate: opts.gate,
      runId,
      fake: args.fake,
      startedAtMs,
      completed: {},
      approved: [],
    };
    runFile = join(outRoot, opts.gate, `${runId}.run.json`);
    saveRunFile(runFile, run);
  }
  const evidencePath = join(outRoot, opts.gate, `${run.runId}.jsonl`);
  mkdirSync(dirname(evidencePath), { recursive: true });

  const record = (r: EvidenceRecord): void => {
    // Fails closed: a token-shaped value stops the run instead of reaching disk.
    appendFileSync(evidencePath, `${toJsonlLine(r)}\n`, 'utf8');
  };
  const http = new RecordingHttp({
    baseUrl: config.baseUrl,
    fake: args.fake,
    gate: opts.gate,
    runId: run.runId,
    scriptVersion: opts.scriptVersion,
    record,
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    now,
  });

  let failed = 0;
  const ctx: GateContext = {
    gate: opts.gate,
    runId: run.runId,
    args,
    config,
    currency: gateCurrency(opts.env),
    http,
    evidencePath,
    runFile,
    async step<T extends Json>(name: string, fn: () => Promise<T>): Promise<T> {
      if (Object.prototype.hasOwnProperty.call(run.completed, name)) {
        log(`skip (done): ${name}`);
        return run.completed[name] as T;
      }
      const value = await fn();
      run.completed[name] = value;
      saveRunFile(runFile, run);
      return value;
    },
    check(step, name, expected, actual) {
      const pass = http.assert(step, name, expected, actual);
      if (!pass) failed += 1;
      log(`${pass ? 'pass' : 'FAIL'}: ${step} ${name}`);
      return pass;
    },
    async waitForApproval(step, url, note) {
      if (run.approved.includes(step)) return;
      if (args.resume !== undefined && run.awaiting?.step === step) {
        run.approved.push(step);
        delete run.awaiting;
        saveRunFile(runFile, run);
        http.note(step, 'approval confirmed by operator', run.approved.length);
        return;
      }
      run.awaiting = note === undefined ? { step, url } : { step, url, note };
      saveRunFile(runFile, run);
      throw new GatePaused(step, url, runFile);
    },
    log,
  };

  try {
    await opts.main(ctx);
  } catch (e) {
    if (e instanceof GatePaused) {
      log(e.message);
      return EXIT_PAUSED;
    }
    log(redactString(`error: ${e instanceof Error ? e.message : String(e)}`));
    return EXIT_FAILED;
  }
  log(`evidence: ${evidencePath}`);
  return failed === 0 ? EXIT_OK : EXIT_FAILED;
}
