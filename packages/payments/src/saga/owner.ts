import { randomUUID } from 'node:crypto';

/**
 * The lease owner used when a caller does not pass one (R-PAY-045). It is random
 * and fixed for the life of the process, so two processes with default settings
 * exclude each other, and a restarted run of the same process can still renew
 * its own lease. A literal shared by every caller would let them all in.
 */
const PROCESS_OWNER = `owner-${randomUUID()}`;

export function defaultLeaseOwner(role: string): string {
  return `${role}-${PROCESS_OWNER}`;
}
