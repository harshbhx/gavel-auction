import { verifyPublicExport, type PublicEntry, type PublicVerifyFailure } from '@gavel/engine';
import { isReplayBundle } from '@gavel/shared';

/** Outcome of checking a ledger export in the browser. */
export type ChainVerdict =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'verified'; count: number; headHash: string; closed: boolean }
  | { kind: 'broken'; entry: number; reason: PublicVerifyFailure };

/**
 * Verifies a replay bundle with the engine's own public-chain verifier: version, sequence,
 * links and every hash, then the head the bundle claims. Never throws. `undefined` or `null`
 * means no ledger was supplied; anything that is not a bundle is `invalid`.
 */
export function verifyLedger(raw: unknown): ChainVerdict {
  if (raw === undefined || raw === null) return { kind: 'none' };
  if (!isReplayBundle(raw) || raw.headHash === null) return { kind: 'invalid' };
  const entries = raw.events as unknown as readonly PublicEntry[];
  let result: ReturnType<typeof verifyPublicExport>;
  try {
    result = verifyPublicExport(entries, undefined, {
      expectedHead: { seq: raw.count, hash: raw.headHash },
    });
  } catch {
    return { kind: 'invalid' };
  }
  if (!result.ok) {
    // `truncated` reports the length of the file, which is the last entry that was present.
    const entry = result.reason === 'truncated' ? result.firstBadIndex : result.firstBadIndex + 1;
    return { kind: 'broken', entry, reason: result.reason };
  }
  return {
    kind: 'verified',
    count: result.count,
    headHash: result.headHash,
    closed: result.closed,
  };
}
