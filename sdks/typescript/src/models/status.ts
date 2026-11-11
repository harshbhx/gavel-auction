import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Status = {
  /** Always `ok` when the host answers. @default "ok" */
  status?: "ok";
};

export const statusSchema: Schema<Status> = s.object<Status>({
  status: s.defaulted(s.literal("ok"), "ok"),
});
