import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeCapabilitiesResponse = {
  /** Judge rooms are switched on for this host. */
  judgeRooms: boolean;
  /** Rooms are on, not paused and under the live-room cap. */
  accepting: boolean;
  /** The simulated-hold route is available. */
  simHolds: boolean;
  /** Present and true only when the host has a judge key set. */
  keyed?: boolean;
};

export const apiJudgeCapabilitiesResponseSchema: Schema<ApiJudgeCapabilitiesResponse> =
  s.object<ApiJudgeCapabilitiesResponse>({
    judgeRooms: s.boolean(),
    accepting: s.boolean(),
    simHolds: s.boolean(),
    keyed: s.optional(s.boolean()),
  });
