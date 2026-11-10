import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiAuctionsReceiptLinkResponse = {
  token: string;
  link: string;
  /** Milliseconds since the Unix epoch. */
  expiresAt: number;
};

export const apiAuctionsReceiptLinkResponseSchema: Schema<ApiAuctionsReceiptLinkResponse> =
  s.object<ApiAuctionsReceiptLinkResponse>({
    token: s.string(),
    link: s.string(),
    expiresAt: s.int(),
  });
