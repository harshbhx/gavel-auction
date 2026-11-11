import type { ClientOptions } from "./client-options.js";
import type { AuthScheme } from "./core/api-request.js";
import { apiKeyHeaderAuth, bearerAuth } from "./core/auth/schemes.js";

export type AuthSchemes = {
  readonly adminKey: AuthScheme;
  readonly auctioneerAuth: AuthScheme;
  readonly screenAuth: AuthScheme;
  readonly reviewerAuth: AuthScheme;
  readonly judgeKey: AuthScheme;
  readonly sessionAuth: AuthScheme;
  readonly receiptAuth: AuthScheme;
};

export function buildAuthSchemes(options: ClientOptions): AuthSchemes {
  return {
    adminKey: apiKeyHeaderAuth({ name: "X-Admin-Key", token: options.adminKey }),
    auctioneerAuth: bearerAuth(options.auctioneerAuth),
    screenAuth: bearerAuth(options.screenAuth),
    reviewerAuth: bearerAuth(options.reviewerAuth),
    judgeKey: apiKeyHeaderAuth({ name: "X-Judge-Key", token: options.judgeKey }),
    sessionAuth: bearerAuth(options.sessionAuth),
    receiptAuth: bearerAuth(options.receiptAuth),
  };
}
