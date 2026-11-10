import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiAuctionsAuctioneerRevokeRequest = {
  /** 26 character id (Crockford base 32). */
  jti: string;
};

export const apiAuctionsAuctioneerRevokeRequestSchema: Schema<ApiAuctionsAuctioneerRevokeRequest> =
  s.object<ApiAuctionsAuctioneerRevokeRequest>({
    jti: s.string(),
  });
