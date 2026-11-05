import { fileURLToPath } from 'node:url';
import { gatesResult } from '../../../payments/src/gatesResult.js';
import { decimalToCents } from '../../../payments/src/money.js';
import {
  isTransientStatus,
  RESULT_DIR,
  sandboxAvailability,
  settle,
  writeSpecResult,
  writeTranscript,
  type Availability,
  type GateFlags,
  type GateId,
  type SandboxSpecId,
  type SandboxStatus,
} from './harness.js';
import { openSession, type SandboxSession } from './session.js';

// Glue for the spec files: environment, gate flags, one session per spec, one result per spec.

export const env: Readonly<Record<string, string | undefined>> = process.env;
export const availability: Availability = sandboxAvailability(env);
export const flags: GateFlags = gatesResult;

const packageDir = fileURLToPath(new URL('../../', import.meta.url));
export const resultDir = `${packageDir}${RESULT_DIR}`;
export const transcriptDir = `${packageDir}report/sandbox/transcripts`;

/** A run id that is unique per process start; the clock is read here, not in the harness. */
export function newRunId(spec: string): string {
  return `${spec.toLowerCase()}-${new Date().toISOString().replace(/[-:.]/g, '').slice(2, 15)}`;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function begin(spec: SandboxSpecId): Promise<SandboxSession> {
  return openSession({
    env,
    runId: newRunId(spec),
    gate: `QA-${spec}`,
    now: () => Date.now(),
    sleep,
  });
}

export function centsOf(json: unknown): number {
  const amount = (json as { amount?: { value?: unknown } } | undefined)?.amount;
  return typeof amount?.value === 'string' ? decimalToCents(amount.value) : -1;
}

export function anyTransient(...statuses: number[]): boolean {
  return statuses.some(isTransientStatus);
}

export interface Outcome {
  gate: GateId;
  met: boolean;
  transient?: boolean;
  observed: string;
  facts?: Record<string, string | number | boolean>;
}

/** Writes the transcript and the result of one spec and returns its status. */
export function finish(spec: SandboxSpecId, session: SandboxSession, o: Outcome): SandboxStatus {
  const status: SandboxStatus =
    o.transient === true ? 'inconclusive' : settle(o.gate, o.met, flags);
  writeTranscript(transcriptDir, spec, session.lines);
  writeSpecResult(resultDir, {
    spec,
    gate: o.gate,
    status,
    observed: o.observed,
    facts: o.facts ?? {},
    finishedAt: new Date().toISOString(),
  });
  return status;
}
