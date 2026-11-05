import { randomUUID } from 'node:crypto';

/**
 * The process-wide id used as the prefix of every lease owner (R-PAY-045). It is random
 * and fixed for the life of the process, so two processes with default settings exclude
 * each other. A literal shared by every caller would let them all in.
 */
const PROCESS_OWNER = `owner-${randomUUID()}`;

export function defaultLeaseOwner(role: string): string {
  return `${role}-${PROCESS_OWNER}`;
}

/**
 * A lease owner for one run: the base owner plus a fresh random suffix. Two runs in one
 * process therefore exclude each other, and a run only releases the lease it acquired.
 */
export function runLeaseOwner(base: string): string {
  return `${base}-run-${randomUUID()}`;
}
