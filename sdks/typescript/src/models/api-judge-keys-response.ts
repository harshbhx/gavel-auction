import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { keySchema, type Key } from "./key.js";

export type ApiJudgeKeysResponse = {
  keys: Key[];
};

export const apiJudgeKeysResponseSchema: Schema<ApiJudgeKeysResponse> = s.object<ApiJudgeKeysResponse>({
  keys: s.array(s.lazy(() => keySchema)),
});
