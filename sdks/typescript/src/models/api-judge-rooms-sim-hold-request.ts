import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeRoomsSimHoldRequest = {
  /** Whole cents, at least 100 and at most the room's ceiling cap. */
  ceilingCents: number;
  /** Display name. Control characters, invisible direction marks and angle brackets are refused. */
  name: string;
};

export const apiJudgeRoomsSimHoldRequestSchema: Schema<ApiJudgeRoomsSimHoldRequest> =
  s.object<ApiJudgeRoomsSimHoldRequest>({
    ceilingCents: s.int(),
    name: s.string(),
  });
