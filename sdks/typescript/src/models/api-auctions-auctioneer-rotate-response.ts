import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiAuctionsAuctioneerRotateResponse = {
  auctioneerLink: string;
};

export const apiAuctionsAuctioneerRotateResponseSchema: Schema<ApiAuctionsAuctioneerRotateResponse> =
  s.object<ApiAuctionsAuctioneerRotateResponse>({
    auctioneerLink: s.string(),
  });
