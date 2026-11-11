import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeKeysRevokeResponse = {
  id: string;
  /** @default "True" */
  revoked?: "True";
};

export const apiJudgeKeysRevokeResponseSchema: Schema<ApiJudgeKeysRevokeResponse> =
  s.object<ApiJudgeKeysRevokeResponse>({
    id: s.string(),
    revoked: s.defaulted(s.literal("True"), "True"),
  });
