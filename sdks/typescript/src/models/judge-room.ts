import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type JudgeRoom = {
  /** 26 character id (Crockford base 32). */
  auctionId: string;
  /** Six letters and digits without look-alikes (no 0, O, 1, I, L). */
  joinCode: string;
  /** Title of the lot in the room. */
  lotTitle: string;
  /** Auctioneer token for this room (12 hours). Send it as a bearer token. */
  auctioneerToken: string;
  /** Screen token for this room (12 hours). Read only. */
  screenToken: string;
  /** Link to the auctioneer console with the token in the URL fragment. */
  auctioneerLink: string;
  /** Link to the projector screen with the token in the URL fragment. */
  screenLink: string;
  /** Read-only reviewer token for this room (12 hours). */
  reviewerToken?: string;
  /** Audit page link with the reviewer token in the fragment. */
  reviewerLink?: string;
  /** Milliseconds since the Unix epoch. */
  expiresAt: number;
  /** Milliseconds since the Unix epoch. */
  biddingEndsAt: number;
  /** Present and true when the room was made with a valid judge key. */
  unlocked?: boolean;
};

export const judgeRoomSchema: Schema<JudgeRoom> = s.object<JudgeRoom>({
  auctionId: s.string(),
  joinCode: s.string(),
  lotTitle: s.string(),
  auctioneerToken: s.string(),
  screenToken: s.string(),
  auctioneerLink: s.string(),
  screenLink: s.string(),
  reviewerToken: s.optional(s.string()),
  reviewerLink: s.optional(s.string()),
  expiresAt: s.int(),
  biddingEndsAt: s.int(),
  unlocked: s.optional(s.boolean()),
});
