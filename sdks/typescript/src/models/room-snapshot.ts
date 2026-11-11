import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { auctionConfigSchema, type AuctionConfig } from "./auction-config.js";
import { auctionStatusSchema, type AuctionStatus } from "./auction-status.js";
import { fundraiserSchema, type Fundraiser } from "./fundraiser.js";
import { hammerSchema, type Hammer } from "./hammer.js";
import { rosterSchema, type Roster } from "./roster.js";

/**
 * Room state for one viewer. Fields not listed here may appear; clients must ignore what they do
 * not know. Private fields (`you`, `yourHold`, ceilings) appear only for the bidder they belong to.
 */
export type RoomSnapshot = {
  /** 26 character id (Crockford base 32). */
  auctionId: string;
  /** Settings of one auction. Amounts are in cents, durations in milliseconds. */
  config: AuctionConfig;
  /** Lifecycle state of the auction, from SCHEDULED to DONE. */
  status: AuctionStatus;
  /** Current price in cents, or null before the first accepted bid. */
  price: number | null;
  /** Bidder id of the current leader, or null when there is none. */
  leaderId: string | null;
  /** Milliseconds since the Unix epoch. */
  endTs: number;
  /** Money in integer US cents. There are no decimals anywhere in the API. */
  minNext: number;
  /** True while the auctioneer has paused the lot. */
  paused?: boolean;
  /** Milliseconds left until the lot ends. */
  remainingMs?: number;
  /** True once the auctioneer used the Stop button. */
  stopped?: boolean;
  /** True once the room no longer takes registrations. */
  registrationClosed?: boolean;
  /** Result of the lot, present once it was hammered. */
  hammer?: Hammer;
  /** Title of the lot. */
  lotTitle?: string;
  /** Six letters and digits without look-alikes (no 0, O, 1, I, L). */
  joinCode?: string;
  /** Fundraiser goal, present only when one was set. */
  fundraiser?: Fundraiser;
  /** Registered bidders, at most 200. */
  roster: Roster[];
  /** The most recent audit rows visible to this viewer, at most 50. */
  recentAudit: Record<string, unknown>[];
  /** Settlement progress, present once the lot ended. */
  settlement?: Record<string, unknown>;
  /** The viewing bidder's own ceiling and high bid. Bidder sessions only. */
  you?: Record<string, unknown>;
};

export const roomSnapshotSchema: Schema<RoomSnapshot> = s.object<RoomSnapshot>({
  auctionId: s.string(),
  config: auctionConfigSchema,
  status: auctionStatusSchema,
  price: s.nullable(s.int()),
  leaderId: s.nullable(s.string()),
  endTs: s.int(),
  minNext: s.int(),
  paused: s.optional(s.boolean()),
  remainingMs: s.optional(s.int()),
  stopped: s.optional(s.boolean()),
  registrationClosed: s.optional(s.boolean()),
  hammer: s.optional(s.lazy(() => hammerSchema)),
  lotTitle: s.optional(s.string()),
  joinCode: s.optional(s.string()),
  fundraiser: s.optional(s.lazy(() => fundraiserSchema)),
  roster: s.array(s.lazy(() => rosterSchema)),
  recentAudit: s.array(s.record(s.string(), s.unknown())),
  settlement: s.optional(s.record(s.string(), s.unknown())),
  you: s.optional(s.record(s.string(), s.unknown())),
});
