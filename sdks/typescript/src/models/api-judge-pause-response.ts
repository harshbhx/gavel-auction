import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgePauseResponse = {
  paused: boolean;
};

export const apiJudgePauseResponseSchema: Schema<ApiJudgePauseResponse> = s.object<ApiJudgePauseResponse>({
  paused: s.boolean(),
});
