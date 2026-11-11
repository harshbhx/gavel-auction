import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { sagaSchema, type Saga } from "./saga.js";

export type OpsSummaryResponse = {
  logs: string[];
  sagas: Saga[];
  paypal: Record<string, number>;
  metrics: Record<string, unknown>;
};

export const opsSummaryResponseSchema: Schema<OpsSummaryResponse> = s.object<OpsSummaryResponse>({
  logs: s.array(s.string()),
  sagas: s.array(s.lazy(() => sagaSchema)),
  paypal: s.record(s.string(), s.int()),
  metrics: s.record(s.string(), s.unknown()),
});
