import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { holdScopeSchema, type HoldScope } from "./hold-scope.js";
import { incrementLadderSchema, type IncrementLadder } from "./increment-ladder.js";
import { Mode, modeSchema } from "./mode.js";

/** Settings of one auction. Amounts are in cents, durations in milliseconds. */
export type AuctionConfig = {
  /** Bidding mode. Defaults to english. @default Mode.English */
  mode?: Mode;
  /** Currency of every amount. Only USD is accepted. @default "USD" */
  currency?: "USD";
  /** Reserve price in cents (at least 100). */
  reserve: number;
  /** Smallest raise in cents. */
  minIncrement: number;
  /** Milliseconds since the Unix epoch. */
  endTs: number;
  /** A bid this close to the end extends the lot. */
  softCloseWindowMs: number;
  /** How long a soft close extends the lot, in milliseconds. */
  softCloseExtensionMs: number;
  /** Most times the lot can be extended by soft close. */
  maxExtensions: number;
  /** Strictly ascending ceiling amounts in cents, none below the reserve. */
  ceilingPresets: number[];
  /** Spoken bids below this confidence need the bidder to confirm. */
  confirmConfidenceThreshold: number;
  /**
   * Milliseconds after closing begins before the host hammers the lot by itself. When absent, the
   * auctioneer hammers by hand.
   */
  autoHammerDelayMs?: number;
  /** Whether one hold covers the whole event or a single lot. The engine default is event. */
  holdScope?: HoldScope;
  /** Tiered increments. Must start at fromCents 0 and strictly ascend. */
  incrementLadder?: IncrementLadder[];
};

export const auctionConfigSchema: Schema<AuctionConfig> = s.object<AuctionConfig>({
  mode: s.defaulted(modeSchema, Mode.English),
  currency: s.defaulted(s.literal("USD"), "USD"),
  reserve: s.int(),
  minIncrement: s.int(),
  endTs: s.int(),
  softCloseWindowMs: s.int(),
  softCloseExtensionMs: s.int(),
  maxExtensions: s.int(),
  ceilingPresets: s.array(s.int()),
  confirmConfidenceThreshold: s.float64(),
  autoHammerDelayMs: s.optional(s.int()),
  holdScope: s.optional(s.lazy(() => holdScopeSchema)),
  incrementLadder: s.optional(s.array(s.lazy(() => incrementLadderSchema))),
});
