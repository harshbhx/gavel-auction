import { canonicalize } from '../canonical.js';
import type { JsonValue } from '../canonical.js';
import type { LedgerEntry } from '../events.js';
import { verifyChain } from './chain.js';
import type { VerifyResult } from './chain.js';
import type { Hasher } from '../hasher.js';

/** One canonical-JSON entry per line, each line ending in a newline (R-ENG-078). */
export function exportJsonl(entries: readonly LedgerEntry[]): string {
  let out = '';
  for (const e of entries) out += canonicalize(e as unknown as JsonValue) + '\n';
  return out;
}

/**
 * Verifies a JSON Lines export without any server (R-ENG-078). Trailing blank
 * lines are tolerated; a blank or unparsable line elsewhere fails at its index.
 */
export function verifyJsonl(
  text: string,
  o: { expectedHead?: { seq: number; hash: string }; hasher?: Hasher } = {},
): VerifyResult {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop();
  const entries: LedgerEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push(JSON.parse(lines[i] as string) as LedgerEntry);
    } catch {
      return { ok: false, firstBadIndex: i, reason: 'bad_hash' };
    }
  }
  return verifyChain(entries, o);
}

/**
 * Test and demo helper: returns the export with entry `index` altered so the
 * chain no longer verifies. By default it moves the entry's `at` by one ms.
 */
export function tamperAt(
  text: string,
  index: number,
  edit: (entry: Record<string, unknown>) => void = (e) => {
    e['at'] = (e['at'] as number) + 1;
  },
): string {
  const lines = text.split('\n');
  const line = lines[index];
  if (line === undefined || line.trim() === '') throw new RangeError(`no entry at index ${index}`);
  const entry = JSON.parse(line) as Record<string, unknown>;
  edit(entry);
  lines[index] = canonicalize(entry as JsonValue);
  return lines.join('\n');
}
