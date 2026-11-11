import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** Lifecycle state of the auction, from SCHEDULED to DONE. */
export const AuctionStatus = {
  Scheduled: "SCHEDULED",
  Open: "OPEN",
  Paused: "PAUSED",
  Closing: "CLOSING",
  Settling: "SETTLING",
  Done: "DONE",
} as const;
export type AuctionStatus = (typeof AuctionStatus)[keyof typeof AuctionStatus] | (string & {});

export const auctionStatusSchema: EnumSchema<AuctionStatus> = s.enumOf<AuctionStatus>(AuctionStatus);
