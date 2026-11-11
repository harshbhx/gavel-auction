import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeJoinResponse = {
  /** 26 character id (Crockford base 32). */
  auctionId: string;
  sessionToken: string;
  /** 26 character id (Crockford base 32). */
  bidderId: string;
  displayName: string;
  wsUrl: string;
};

export const apiJudgeJoinResponseSchema: Schema<ApiJudgeJoinResponse> = s.object<ApiJudgeJoinResponse>({
  auctionId: s.string(),
  sessionToken: s.string(),
  bidderId: s.string(),
  displayName: s.string(),
  wsUrl: s.string(),
});
