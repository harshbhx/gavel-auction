import { buildAuthSchemes, type AuthSchemes } from "./auth-schemes.js";
import type { ClientOptions } from "./client-options.js";
import { buildCoreClientOptions } from "./core/client-options.js";
import { RawClient } from "./core/raw-client.js";
import * as host from "./core/runtime-environment.js";
import * as s from "./core/validation/index.js";
import { Auctions } from "./resources/auctions.js";
import { BiddingAccess } from "./resources/bidding-access.js";
import { Control } from "./resources/control.js";
import { Export } from "./resources/export.js";
import { Health } from "./resources/health.js";
import { Holds } from "./resources/holds.js";
import { JudgeRooms } from "./resources/judge-rooms.js";
import { Operator } from "./resources/operator.js";
import { Read } from "./resources/read.js";
import { Receipts } from "./resources/receipts.js";
import { buildServers, type Servers } from "./servers.js";

/**
 * GAVEL is an auction where every bid is backed by a PayPal hold and only the winner pays. This
 * document describes the public HTTP API of the host (`packages/server`). It is written by hand
 * from the route files in `packages/server/src/http/` and the schemas in `packages/shared/src/`,
 * and a test (`scripts/tests/openapi-routes.test.mjs`) fails when a route in the code is missing
 * here or a path here has no route in the code.
 *
 * **Sandbox only.** The host talks to the PayPal sandbox. No real money moves.
 *
 * ## Authentication
 *
 * Several kinds of credential exist. None of them is a real value in this document.
 *
 * | Credential | How it is sent | Who gets it |
 * | --- | --- | --- |
 * | Operator key | header `X-Admin-Key` | the operator who runs the host (environment setting `ADMIN_KEY`) |
 * | Auctioneer token | `Authorization: Bearer <token>`, valid 12 hours | returned as a link when an auction is created or rotated |
 * | Screen token | `Authorization: Bearer <token>`, valid 12 hours | returned as a link when an auction is created |
 * | Session (bidder) token | `Authorization: Bearer <token>`, valid 4 hours | returned by the join routes |
 * | Receipt token | `Authorization: Bearer <token>`, valid 4 hours | returned by the receipt-link route |
 * | Reviewer token | `Authorization: Bearer <token>`, valid 12 hours | returned as `reviewerToken` and `reviewerLink` when a judge room is created; read only, a screen's view plus the room ledger |
 * | Judge key | header `X-Judge-Key` | a limited key for judges, `gvl_judge_<id>_<secret>` (per-judge entries in `JUDGE_KEYS`, or the shared `JUDGE_KEY`; never the operator key); optional, only on the judge-room create and key-check routes |
 * | Invite token | field `invite` in the body of the join route, valid 24 hours, single use | minted by the auctioneer |
 *
 * Every token is bound to one auction (its `aud`) and to one kind. A token of the wrong kind or for
 * another auction answers 401. A token whose role may not do the thing answers 403. Tokens are
 * opaque strings: do not parse them. A reviewer token can read the snapshot, the event log and the
 * room ledger of its own judge room, and nothing else. Judge rooms need no key; the judge key only
 * lifts the public limits when a host has one set (see `POST /api/judge/key`). The judge key is
 * sent only in the `X-Judge-Key` header, never in a URL or body.
 *
 * Links the host returns carry the token in the URL fragment (`#token=`) so it never reaches a
 * server log.
 *
 * ## Errors
 *
 * Every error is JSON. The fields vary slightly by route family because the host grew in layers;
 * read them like this and you are safe on every route:
 *
 * - `message`: text for a person. Always present on `/api/**` errors.
 * - `code`: the stable error code (see `ErrorCode`). Present on the core routes (auctions, control,
 *   invites, read, receipts, auctioneer tokens) and on judge routes.
 * - `error`: the same stable code on the hold routes, the judge routes and the operator routes.
 *   Judge routes also send `code`. Operator routes send only `error`.
 * - `detail`: optional extra text, for example the field paths that failed validation.
 *
 * A client should read `code ?? error`. See the `Error` schema.
 *
 * Messages never contain tokens or stack traces (they are scrubbed on the server).
 *
 * Status codes in use: 400 bad request, 401 missing or bad credential, 403 not allowed, 404 not
 * found, 409 conflict, 410 gone (a judge room that ended), 413 body over 64 KiB, 415 body is not
 * `application/json`, 429 rate limited, 500 internal, 503 unavailable.
 *
 * ## Rate limits
 *
 * Limits are published as the vendor extension `x-rate-limit` on the operations they apply to, and
 * as `x-rate-limits` at the top of this document for the host-wide defaults. A 429 always carries a
 * `Retry-After` header in seconds. The numbers are the defaults and can be changed by the operator
 * through environment settings.
 *
 * ## Request ids and CORS
 *
 * Send `X-Request-Id` (1 to 64 characters of `A-Z a-z 0-9 _ -`) to correlate a request; every
 * response carries `X-Request-Id`, and the server mints one when you send none or an invalid one.
 * Browsers are allowed only from the origins the operator lists; other origins get no CORS headers.
 * Allowed request headers are `Authorization`, `Content-Type`, `X-Request-Id`, `X-Admin-Key` and
 * `X-Judge-Key`; readable response headers are `X-Request-Id` and `Retry-After` (also on early 429,
 * 404 and 500 answers).
 *
 * ## Not in this document
 *
 * - **WebSocket protocol.** Live bidding runs on `wss://<host>/ws` and OpenAPI cannot model it. See
 *   the section "WebSocket protocol" below and
 *   https://github.com/harshbhx/gavel-auction/blob/main/docs/API.md.
 * - **PayPal webhook.** `POST /webhooks/paypal` is called by PayPal only, is verified by PayPal's
 *   signature, and is not part of the client API.
 * - **Demo routes.** `/api/demo/reset`, `/api/demo/seed` and `/api/demo/rooms` exist only when the
 *   host runs with `DEMO_MODE=1` on the fake payments adapter and never in a production-like
 *   configuration. They answer 404 otherwise.
 *
 * ## WebSocket protocol
 *
 * Endpoint: `wss://<host>/ws`. The browser must send an `Origin` that the operator allows; a
 * request without one is refused. A plain HTTP request to `/ws` answers 426. Frames are JSON text,
 * at most 16 KiB from the client (a larger or binary frame closes the socket) and at most 256 KiB
 * from the server. Every frame is `{"v":1,"t":"<type>", ...}`; an unknown type, extra field or
 * wrong version is `bad_message` (a `join` with another version is `unsupported_version`).
 *
 * Client to server, the only three types accepted:
 *
 * | `t` | Purpose | Fields |
 * | --- | --- | --- |
 * | `join` | First frame. Opens the session. | `token` (session, auctioneer, screen or reviewer token; a reviewer joins with a screen's view), `auctionId`, optional `lastSeq` (resume after this sequence number), optional `client` ({name, version}) |
 * | `bid` | Place a bid. | `mid` (id you mint, for idempotency), `amount` (cents), `source` (`voice`, `qr` or `manual`), optional `bidderId`, `transcript`, `confidence`, `ambiguous`, `audioTsMs`, `audioEndMs`, `clientTs` |
 * | `confirm_response` | Answer a spoken-bid confirmation. | `confirmId`, `accept` |
 *
 * Server to client:
 *
 * | `t` | Purpose |
 * | --- | --- |
 * | `registered` | Your bidder id, paddle and role after `join`. |
 * | `state` | Full room snapshot (same shape as `RoomSnapshot`), sent after `join` and when resyncing. |
 * | `price` | New price, leader, end time and next minimum. |
 * | `bid_accepted` / `bid_rejected` | Result of your `bid` (match on `mid`); a rejection carries `reason` (an `ErrorCode`), `retryable` and optional `retryAfterMs`. |
 * | `confirm_request` | A spoken bid needs the bidder's yes or no. |
 * | `hammer` | Lot ended: winner, price, ranking. |
 * | `settlement_update` | Settlement progress (holds captured or released). |
 * | `audit_event` | One audit row, filtered by role. |
 * | `error` | `code`, `message`, optional `retryAfterMs`; may close the socket. |
 *
 * Socket close codes follow `ErrorCode`: 1008 bad message, 4002 unsupported version, 4003 not
 * joined, 4401 unauthorized, 4009 room or auction full, 4010 conflict or host fenced, 4429 rate
 * limited (frame flood), 1011 internal. Limits: bids 3 per second (burst 5), frames 20 per second
 * (burst 40), at most 20 open sockets per source address.
 *
 * The full protocol, with every field, is in the repository file
 * `docs/specs/realtime/SPEC-realtime.md` and on the docs site page "WebSocket protocol".
 */
export class GavelHostApiClient {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;
  #auctions?: Auctions;
  #biddingAccess?: BiddingAccess;
  #control?: Control;
  #read?: Read;
  #holds?: Holds;
  #judgeRooms?: JudgeRooms;
  #export?: Export;
  #operator?: Operator;
  #receipts?: Receipts;
  #health?: Health;

  constructor(options: ClientOptions = {}) {
    this.#rawClient = new RawClient({
      ...buildCoreClientOptions(options, "GAVEL_HOST_API_CLIENT_LOG"),
      defaultHeaders: [
        { name: "User-Agent", value: "GavelHostApiClient/0.0.5 TypeScript", schema: s.string() },
        { name: "X-APIMatic-Lang", value: "TypeScript", schema: s.string() },
        { name: "X-APIMatic-Package-Version", value: "0.0.5", schema: s.string() },
        { name: "X-APIMatic-Gen-Version", value: "4.0.0", schema: s.string() },
        { name: "X-APIMatic-OS", value: host.operatingSystem(), schema: s.optional(s.string()) },
        { name: "X-APIMatic-Runtime", value: host.runtimeDescription(), schema: s.optional(s.string()) },
      ],
      defaultQuery: [],
      defaultPathParams: [],
    });

    this.#servers = buildServers(options);

    this.#auth = buildAuthSchemes(options);
  }

  /**
   * Create an auction and read its public facts.
   */
  get auctions(): Auctions {
    return (this.#auctions ??= new Auctions(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * Invites, join and session tokens.
   */
  get biddingAccess(): BiddingAccess {
    return (this.#biddingAccess ??= new BiddingAccess(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * Auctioneer controls and the Stop button.
   */
  get control(): Control {
    return (this.#control ??= new Control(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * Snapshot and event log, filtered by the caller's role.
   */
  get read(): Read {
    return (this.#read ??= new Read(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * PayPal hold orders for a bidder session.
   */
  get holds(): Holds {
    return (this.#holds ??= new Holds(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * Key-less sandbox rooms for reviewers.
   */
  get judgeRooms(): JudgeRooms {
    return (this.#judgeRooms ??= new JudgeRooms(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * Event log and ledger export.
   */
  get export(): Export {
    return (this.#export ??= new Export(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * Routes that need the operator key.
   */
  get operator(): Operator {
    return (this.#operator ??= new Operator(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * Shareable read-only receipts.
   */
  get receipts(): Receipts {
    return (this.#receipts ??= new Receipts(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * Liveness, readiness and build version.
   */
  get health(): Health {
    return (this.#health ??= new Health(this.#rawClient, this.#servers));
  }
}
