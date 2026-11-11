import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { roomSnapshotSchema, type RoomSnapshot } from "./room-snapshot.js";

/** The `state` frame of the WebSocket protocol, returned over HTTP. */
export type StateFrame = {
  /** Protocol version of the frame. @default 1 */
  v?: 1;
  /** Frame type. Always state. @default "state" */
  t?: "state";
  /** Sequence number of the last event the snapshot includes. */
  seq?: number;
  /**
   * Room state for one viewer. Fields not listed here may appear; clients must ignore what they do
   * not know. Private fields (`you`, `yourHold`, ceilings) appear only for the bidder they belong
   * to.
   */
  snapshot: RoomSnapshot;
};

export const stateFrameSchema: Schema<StateFrame> = s.object<StateFrame>({
  v: s.defaulted(s.literal(1), 1),
  t: s.defaulted(s.literal("state"), "state"),
  seq: s.optional(s.int()),
  snapshot: roomSnapshotSchema,
});
