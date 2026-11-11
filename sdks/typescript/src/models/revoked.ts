import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Revoked = {
  /** @default "True" */
  revoked?: "True";
};

export const revokedSchema: Schema<Revoked> = s.object<Revoked>({
  revoked: s.defaulted(s.literal("True"), "True"),
});
