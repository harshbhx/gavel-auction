import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeJoinRequest = {
  /** The join code, in any case; spaces, dashes and a GVL- prefix are ignored. */
  code: string;
  /** Display name. Control characters, invisible direction marks and angle brackets are refused. */
  displayName: string;
};

export const apiJudgeJoinRequestSchema: Schema<ApiJudgeJoinRequest> = s.object<ApiJudgeJoinRequest>({
  code: s.string(),
  displayName: s.string(),
});
