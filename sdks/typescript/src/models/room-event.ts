import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/**
 * One logged event. `seq` is always there. The other fields depend on `type` (`auction_created`,
 * `bidder_registered`, `bid_accepted`, `control`, `state_changed`, `hammered` and others); a screen
 * sees only `seq` for non-public types.
 */
export type RoomEvent = {
  /** Position of the event in the ledger, starting at 1. */
  seq: number;
  /**
   * Event type, for example auction_created or bid_accepted. Absent for non-public events seen by a
   * screen.
   */
  type?: string;
};

export const roomEventSchema: Schema<RoomEvent> = s.object<RoomEvent>({
  seq: s.int(),
  type: s.optional(s.string()),
});
