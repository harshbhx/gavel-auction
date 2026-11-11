import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiAuctionsInvitesRequest = {
  /** @default 1 */
  count?: number;
};

export const apiAuctionsInvitesRequestSchema: Schema<ApiAuctionsInvitesRequest> =
  s.object<ApiAuctionsInvitesRequest>({
    count: s.defaulted(s.int(), 1),
  });
