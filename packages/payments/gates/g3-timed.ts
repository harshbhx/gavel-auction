import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FakePayPalServer } from '../src/fake/server.js';
import { fetchAccessToken } from './http.js';
import {
  DAY_MS,
  G3_SCRIPT_VERSION,
  dueEntries,
  loadState,
  probeReauthorize,
  saveState,
  type ReauthObservation,
} from './g3.js';
import {
  EXIT_REFUSED,
  GateUsageError,
  parseGateArgs,
  runGate,
  type GateContext,
} from './runner.js';

/**
 * G3 timed checks (SPEC R-PAY-145, T-PAY-092).
 *
 * Reads the state file that g3.ts saved on day 0 and, for every authorization whose
 * time has come (3.5, 4 and 5 days after creation), tries to reauthorize it and
 * reads it back. Each authorization is probed once; run the script again after the
 * next time mark. Answers are recorded as evidence, never judged here.
 *
 * Flags besides the shared ones: --state <file> (default: docs/evidence/G3/state.json).
 *
 * Run with: npx vite-node gates/g3-timed.ts -- [--state <file>] [--out <dir>]
 */

export interface G3TimedDeps {
  statePath: string;
  /** Current time in ms. Default Date.now. */
  now?: () => number;
}

/** Gate body. */
export async function g3TimedGate(ctx: GateContext, deps: G3TimedDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const state = loadState(deps.statePath);
  const nowMs = now();
  const due = dueEntries(state, nowMs);
  const ageDays = (nowMs - state.createdAtMs) / DAY_MS;
  if (due.length === 0) {
    ctx.log(`G3 timed: nothing due yet (authorizations are ${ageDays.toFixed(2)} days old)`);
    return;
  }
  const token = await fetchAccessToken(
    ctx.http,
    'G3.T0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-14);
  for (const entry of due) {
    ctx.http.setBuyer('wallet');
    const o: ReauthObservation = await probeReauthorize(
      ctx.http,
      token,
      `G3.T ${entry.label}`,
      entry.authId,
      `g3-${run}-${entry.label}-reauth`,
    );
    ctx.http.note(`G3.T ${entry.label}`, `reauthorize after ${entry.dueDays} days`, {
      ageDays: Math.round(ageDays * 100) / 100,
      http: o.http,
      name: o.name,
      accepted: o.accepted,
      authStatusAfter: o.authStatusAfter,
    });
    ctx.log(
      `G3 ${entry.label} (${entry.dueDays} days): reauthorize HTTP ${o.http}${o.name === '' ? '' : ` ${o.name}`}, authorization ${o.authStatusAfter}`,
    );
    entry.doneAtMs = nowMs;
    saveState(deps.statePath, state);
  }
  ctx.http.setBuyer(undefined);
}

export interface RunG3TimedOptions {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
  now?: () => number;
  /** Fake mode: the server that holds the day-0 authorizations. */
  fakeServer?: FakePayPalServer;
}

/** Entry point. */
export async function runG3Timed(opts: RunG3TimedOptions): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  let statePath: string | undefined;
  const rest: string[] = [];
  let fake: boolean;
  let out: string | undefined;
  try {
    for (let i = 0; i < opts.argv.length; i += 1) {
      const a = opts.argv[i] ?? '';
      if (a === '--state') {
        const v = opts.argv[i + 1];
        if (v === undefined || v.startsWith('--'))
          throw new GateUsageError('--state needs a value');
        statePath = v;
        i += 1;
      } else rest.push(a);
    }
    const parsed = parseGateArgs(rest);
    fake = parsed.fake;
    out = parsed.out;
  } catch (e) {
    if (e instanceof GateUsageError) {
      log(`refused: ${e.message}`);
      return EXIT_REFUSED;
    }
    throw e;
  }
  let env = { ...opts.env };
  if (fake) {
    if (opts.fakeServer === undefined) {
      log('refused: fake mode needs the fake server of the day-0 run');
      return EXIT_REFUSED;
    }
    env = {
      ...env,
      PAYPAL_ENV: env['PAYPAL_ENV'] ?? 'sandbox',
      PAYPAL_BASE_URL: opts.fakeServer.url,
    };
  }
  const sha = env['GITHUB_SHA'];
  return runGate({
    gate: 'G3',
    scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G3_SCRIPT_VERSION,
    argv: rest,
    env,
    log,
    main: async (ctx) => {
      const path = statePath ?? join(dirname(ctx.evidencePath), 'state.json');
      const deps: G3TimedDeps = { statePath: path };
      if (opts.now !== undefined) deps.now = opts.now;
      await g3TimedGate(ctx, deps);
    },
  });
}

const isEntry = process.argv
  .slice(1)
  .some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  runG3Timed({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
