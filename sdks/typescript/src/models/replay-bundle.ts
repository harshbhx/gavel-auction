import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/**
 * A verifiable export of the ledger (`packages/shared/src/replay-bundle.ts`). Hash with
 * `verifyPublicExport` and compare `headHash`.
 */
export type ReplayBundle = {
  /** Version of the bundle format. */
  version: number;
  /** Version of the export rules used to build the bundle. */
  exportVersion: number;
  /** Id of the exported auction. */
  auctionId: string;
  /** Milliseconds since the Unix epoch. */
  generatedAt: number;
  /** Number of events; equals the last event seq. */
  count: number;
  /** Hash of the last public event, or null for an empty ledger. */
  headHash: string | null;
  /** True when the last event closes the auction and names the event before it. */
  closed?: boolean;
  /** The public events in order, one object per event. */
  events: Record<string, unknown>[];
};

export const replayBundleSchema: Schema<ReplayBundle> = s.object<ReplayBundle>({
  version: s.int(),
  exportVersion: s.int(),
  auctionId: s.string(),
  generatedAt: s.int(),
  count: s.int(),
  headHash: s.nullable(s.string()),
  closed: s.optional(s.boolean()),
  events: s.array(s.record(s.string(), s.unknown())),
});
