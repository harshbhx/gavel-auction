import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type CreateAuctionResponse = {
  /** 26 character id (Crockford base 32). */
  auctionId: string;
  /** Six letters and digits without look-alikes (no 0, O, 1, I, L). */
  joinCode: string;
  /** Title of the lot, as given in the request. */
  lotTitle: string;
  /** Link to the auctioneer console. The auctioneer token is in the URL fragment. */
  auctioneerLink: string;
  /** Link to the projector screen. The screen token is in the URL fragment. */
  screenLink: string;
};

export const createAuctionResponseSchema: Schema<CreateAuctionResponse> = s.object<CreateAuctionResponse>({
  auctionId: s.string(),
  joinCode: s.string(),
  lotTitle: s.string(),
  auctioneerLink: s.string(),
  screenLink: s.string(),
});
