// Node-only helpers (R-ENG-120). Not part of the core entry point; import from '@gavel/engine/node'.
// eslint-disable-next-line no-restricted-imports -- src/node is the one place allowed Node I/O (R-ENG-120)
import { readFileSync, writeFileSync } from 'node:fs';
import { exportJsonl, verifyJsonl } from '../ledger/export.js';
import type { VerifyResult } from '../ledger/chain.js';
import type { LedgerEntry } from '../events.js';

/** Writes a ledger as a JSON Lines file. */
export function writeLedgerFile(path: string, entries: readonly LedgerEntry[]): void {
  writeFileSync(path, exportJsonl(entries), 'utf8');
}

/** Verifies a JSON Lines ledger file from disk. */
export function verifyLedgerFile(path: string): VerifyResult {
  return verifyJsonl(readFileSync(path, 'utf8'));
}
