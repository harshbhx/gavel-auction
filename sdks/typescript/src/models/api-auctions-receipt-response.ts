import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { roomSnapshotSchema, type RoomSnapshot } from "./room-snapshot.js";

export type ApiAuctionsReceiptResponse = {
  /** 26 character id (Crockford base 32). */
  bidderId: string;
  /**
   * Room state for one viewer. Fields not listed here may appear; clients must ignore what they do
   * not know. Private fields (`you`, `yourHold`, ceilings) appear only for the bidder they belong
   * to.
   */
  snapshot: RoomSnapshot;
  /** Milliseconds since the Unix epoch. */
  expiresAt: number;
};

export const apiAuctionsReceiptResponseSchema: Schema<ApiAuctionsReceiptResponse> =
  s.object<ApiAuctionsReceiptResponse>({
    bidderId: s.string(),
    snapshot: roomSnapshotSchema,
    expiresAt: s.int(),
  });
