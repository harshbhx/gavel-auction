import type { TokenProvider } from "./core/auth/credentials.js";
import type { CoreClientOptions } from "./core/client-options.js";
import { ServerEnvironment } from "./servers.js";

export type ClientOptions = SdkClientOptions & CoreClientOptions;

type SdkClientOptions = ServerOptions & {
  /**
   * The operator key, set by the person who runs the host. Compared in constant time. Never put it
   * in a browser or a public repository. No real value appears in this document.
   */
  readonly adminKey?: TokenProvider | undefined;
  /**
   * Auctioneer token (12 hours), carried in the auctioneer link fragment. Bound to one auction.
   * Revoked by rotation.
   */
  readonly auctioneerAuth?: TokenProvider | undefined;
  /** Screen token (12 hours) for the projector page. Read only, no private fields. */
  readonly screenAuth?: TokenProvider | undefined;
  /**
   * Reviewer token (12 hours), returned by judge-room creation. Read only: the screen's view of the
   * snapshot and event log, and the room ledger. Bound to one judge room.
   */
  readonly reviewerAuth?: TokenProvider | undefined;
  /**
   * A limited per-judge key, `gvl_judge_<id>_<secret>` (set by the host operator, never the
   * operator key). Only the judge-room create and key-check routes read it; it never opens an
   * operator route. It has an expiry, a room cap and an hourly cap of its own. No real value
   * appears in this document.
   */
  readonly judgeKey?: TokenProvider | undefined;
  /**
   * Session (bidder) token (4 hours) returned by the join routes. Names one bidder in one auction.
   */
  readonly sessionAuth?: TokenProvider | undefined;
  /**
   * Receipt token (4 hours) returned by the receipt-link route. Opens only GET
   * /api/auctions/{id}/receipt.
   */
  readonly receiptAuth?: TokenProvider | undefined;
};

type ServerOptions =
  | {
      readonly serverEnvironment?: typeof ServerEnvironment.Production;
      /** Live sandbox host (PayPal sandbox only). */
      readonly serverOptions?: {
        baseUrl?: string;
      };
    }
  | {
      readonly serverEnvironment: typeof ServerEnvironment.Environment2;
      /** Live sandbox host (PayPal sandbox only). */
      readonly serverOptions?: {
        baseUrl?: string;
      };
    };
