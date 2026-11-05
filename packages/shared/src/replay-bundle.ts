/**
 * Replay bundle: the redacted public export (version 3) of one auction ledger, plus the head
 * hash of that public chain. The server builds it from the real hash-chained ledger; a client
 * verifies `events` with the engine's `verifyPublicExport` and compares the result's
 * `headHash` with `headHash` here. Playback frames are derived from `events`, never stored
 * beside them. Private ledger hashes and ceilings are not part of a bundle.
 */
export const REPLAY_BUNDLE_VERSION = 1;
export const REPLAY_EXPORT_VERSION = 3;

/** Structural shape of the engine's `PublicEntry` (the engine type is assignable to this). */
export interface ReplayEvent {
  v: 3;
  auctionId: string;
  seq: number;
  at: number;
  type: string;
  cmd: string | null;
  payload: Record<string, unknown>;
  redacted: string[];
  fullHash: string | null;
  prev: string;
  hash: string;
}

export interface ReplayBundle {
  version: typeof REPLAY_BUNDLE_VERSION;
  exportVersion: typeof REPLAY_EXPORT_VERSION;
  auctionId: string;
  /** Epoch ms from the server clock when the bundle was built. */
  generatedAt: number;
  /** Number of events; equals the last event seq. */
  count: number;
  /** Hash of the last public event, or null for an empty ledger. */
  headHash: string | null;
  events: ReplayEvent[];
}

/** Shape check only; it does not verify any hash. Use `verifyPublicExport` for that. */
export function isReplayBundle(x: unknown): x is ReplayBundle {
  if (typeof x !== 'object' || x === null) return false;
  const b = x as Record<string, unknown>;
  if (b.version !== REPLAY_BUNDLE_VERSION || b.exportVersion !== REPLAY_EXPORT_VERSION)
    return false;
  if (typeof b.auctionId !== 'string' || typeof b.generatedAt !== 'number') return false;
  if (!Array.isArray(b.events) || b.count !== b.events.length) return false;
  if (b.headHash !== null && typeof b.headHash !== 'string') return false;
  return (b.headHash === null) === (b.events.length === 0);
}
