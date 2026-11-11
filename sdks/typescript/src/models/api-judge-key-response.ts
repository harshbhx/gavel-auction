import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeKeyResponse = {
  /** @default "True" */
  ok?: "True";
  /** The id of the key (`legacy` for the shared host key). Never the secret. */
  keyId?: string;
  /** Most rooms this key may keep alive at once. */
  roomsMax: number;
  /** Rooms of this key alive now. */
  roomsLive: number;
  /** When the key stops working. Absent for the legacy shared key. */
  expiresAt?: Date;
};

export const apiJudgeKeyResponseSchema: Schema<ApiJudgeKeyResponse> = s.object<ApiJudgeKeyResponse>({
  ok: s.defaulted(s.literal("True"), "True"),
  keyId: s.optional(s.string()),
  roomsMax: s.int(),
  roomsLive: s.int(),
  expiresAt: s.optional(s.dateTime()),
});
