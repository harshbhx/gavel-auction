import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { stateSchema, type State } from "./state.js";

export type ApiAuctionsKillResponse = {
  /** @default "True" */
  ok?: "True";
  controlId?: string;
  state: State;
};

export const apiAuctionsKillResponseSchema: Schema<ApiAuctionsKillResponse> =
  s.object<ApiAuctionsKillResponse>({
    ok: s.defaulted(s.literal("True"), "True"),
    controlId: s.optional(s.string()),
    state: stateSchema,
  });
