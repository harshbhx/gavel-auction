import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { auctionStatusSchema, type AuctionStatus } from "./auction-status.js";

export type AuctionPublic = {
  /** 26 character id (Crockford base 32). */
  auctionId: string;
  /** Lot title. */
  title: string;
  /** Six letters and digits without look-alikes (no 0, O, 1, I, L). */
  joinCode?: string;
  /** Present and true for a judge room. */
  judgeRoom?: boolean;
  /** Present and true once the room no longer takes registrations. */
  registrationClosed?: boolean;
  /** Present and true once the auctioneer ended the lot. */
  stopped?: boolean;
  /** Lifecycle state of the auction, from SCHEDULED to DONE. */
  status: AuctionStatus;
  /** Milliseconds since the Unix epoch. */
  endTs: number;
  /** Number of registered bidders. */
  bidderCount: number;
  /** Current price in cents; absent until the first accepted bid. */
  currentCents?: number;
  /** Paddle number of the current leader; absent when there is none. */
  leaderPaddle?: number;
};

export const auctionPublicSchema: Schema<AuctionPublic> = s.object<AuctionPublic>({
  auctionId: s.string(),
  title: s.string(),
  joinCode: s.optional(s.string()),
  judgeRoom: s.optional(s.boolean()),
  registrationClosed: s.optional(s.boolean()),
  stopped: s.optional(s.boolean()),
  status: auctionStatusSchema,
  endTs: s.int(),
  bidderCount: s.int(),
  currentCents: s.optional(s.int()),
  leaderPaddle: s.optional(s.int()),
});
