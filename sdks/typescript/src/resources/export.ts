import type { AuthSchemes } from "../auth-schemes.js";
import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { anyAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import * as s from "../core/validation/index.js";
import { kindSchema, type Kind } from "../models/kind.js";
import { listSchema, type List } from "../models/list.js";
import { replayBundleSchema, type ReplayBundle } from "../models/replay-bundle.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import type { Servers } from "../servers.js";

/**
 * Event log and ledger export.
 */
export class Export {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(rawClient: RawClient, servers: Servers, auth: AuthSchemes) {
    this.#rawClient = rawClient;
    this.#servers = servers;
    this.#auth = auth;
  }

  /**
   * Private ledger and payment state export
   *
   * @remarks
   * Operator only. Output carries every bidder's ceiling, hold reference and bid transcript: never
   * publish it. Modes by query: `auction=<id>` (the hash-chained ledger as NDJSON, last line
   * `{head}`); `list=1` (all auction ids); `kind=payments&auction=<id>` (settlement journal and
   * holds); `kind=payments-global` (webhook event ids and kill switch); `kind=roomlog&auction=<id>`
   * (room events as NDJSON, last line `{end}`). Secret-looking keys are replaced with `[redacted]`
   * and webhook bodies are dropped. Errors are `{"error": "<code>"}`.
   *
   * @returns JSON or NDJSON depending on the mode.
   *
   * @throws {@link Export.AdminExportError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  adminExport(
    request: Export.AdminExportRequest = {},
    options?: RequestOptions,
  ): ApiPromise<undefined, Export.AdminExportError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/admin/export"),
        auth: this.#auth.adminKey,
        pathParams: [],
        query: [
          { name: "auction", value: request.auction, schema: s.optional(s.string()) },
          { name: "list", value: request.list, schema: s.optional(s.lazy(() => listSchema)) },
          { name: "kind", value: request.kind, schema: s.optional(s.lazy(() => kindSchema)) },
        ],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "empty" },
        errorFactory: Export.AdminExportError,
      },
      options,
    );
  }

  /**
   * Replay bundle of one auction
   *
   * @remarks
   * Operator only. A self-contained bundle of the auction's ledger for replay and verification.
   * Query `auctionId` is required. 409 when the hash chain is broken.
   *
   * @returns The bundle (format defined in `packages/shared/src/replay-bundle.ts`).
   *
   * @throws {@link Export.AdminReplayBundleError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  adminReplayBundle(
    request: Export.AdminReplayBundleRequest,
    options?: RequestOptions,
  ): ApiPromise<Record<string, unknown>, Export.AdminReplayBundleError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/admin/replay-bundle"),
        auth: this.#auth.adminKey,
        pathParams: [],
        query: [{ name: "auctionId", value: request.auctionId, schema: s.string() }],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: s.record(s.string(), s.unknown()) },
        errorFactory: Export.AdminReplayBundleError,
      },
      options,
    );
  }

  /**
   * Stream the event log as NDJSON
   *
   * @remarks
   * Auctioneer token or operator key. One JSON object per line, in sequence order, with personal
   * fields removed for everyone but the operator. If the store has a gap the connection is cut
   * instead of ending quietly, so a short file never looks complete. This route is served by the
   * host directly: its errors are `{"error": "<code>"}` only.
   *
   * @returns NDJSON stream.
   *
   * @throws {@link Export.ExportEventsError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  exportEvents(
    request: Export.ExportEventsRequest,
    options?: RequestOptions,
  ): ApiPromise<undefined, Export.ExportEventsError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/auctions/{id}/export"),
        auth: anyAuth(this.#auth.auctioneerAuth, this.#auth.adminKey),
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "empty" },
        errorFactory: Export.ExportEventsError,
      },
      options,
    );
  }

  /**
   * Verifiable ledger of a judge room
   *
   * @remarks
   * Reviewer or auctioneer token of that room. The room's hash-chained ledger as a replay bundle
   * with the private fields removed. The private chain and the public chain are both checked before
   * anything is sent: a broken chain answers 409 `ledger_unverified` instead of a bundle that looks
   * fine. 404 before the ledger has any entry, for an id that is not a judge room, or when judge
   * rooms are off.
   *
   * @returns The bundle.
   *
   * @throws {@link Export.GetJudgeRoomLedgerError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getJudgeRoomLedger(
    request: Export.GetJudgeRoomLedgerRequest,
    options?: RequestOptions,
  ): ApiPromise<ReplayBundle, Export.GetJudgeRoomLedgerError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/judge/rooms/{id}/ledger"),
        auth: anyAuth(this.#auth.reviewerAuth, this.#auth.auctioneerAuth),
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: replayBundleSchema },
        errorFactory: Export.GetJudgeRoomLedgerError,
      },
      options,
    );
  }
}

export namespace Export {
  export type AdminExportRequest = {
    /** Auction id (`auctionId` is accepted as an alias). */
    auction?: string;
    /** Send `1` to list every auction id instead of exporting one auction. */
    list?: List;
    /** Which export to return. Without it, `auction` returns the ledger. */
    kind?: Kind;
  };

  export class AdminExportError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Declared<"error57", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<AdminExportError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 405, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 501, kind: "error57", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type AdminReplayBundleRequest = {
    /** Id of the auction to bundle. */
    auctionId: string;
  };

  export class AdminReplayBundleError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Declared<"error57", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<AdminReplayBundleError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 405, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error57", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type ExportEventsRequest = {
    /** Auction id. */
    id: string;
  };

  export class ExportEventsError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<ExportEventsError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 403, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 405, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error56", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type GetJudgeRoomLedgerRequest = {
    /** Auction id. */
    id: string;
  };

  export class GetJudgeRoomLedgerError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetJudgeRoomLedgerError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error55", decode: { kind: "json", schema: error5Schema } },
    ];
  }
}
