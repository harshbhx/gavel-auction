import type { AuthSchemes } from "../auth-schemes.js";
import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import { apiJudgeKeysResponseSchema, type ApiJudgeKeysResponse } from "../models/api-judge-keys-response.js";
import {
  apiJudgeKeysRevokeResponseSchema,
  type ApiJudgeKeysRevokeResponse,
} from "../models/api-judge-keys-revoke-response.js";
import { apiJudgePauseRequestSchema, type ApiJudgePauseRequest } from "../models/api-judge-pause-request.js";
import {
  apiJudgePauseResponseSchema,
  type ApiJudgePauseResponse,
} from "../models/api-judge-pause-response.js";
import { kindSchema, type Kind } from "../models/kind.js";
import { listSchema, type List } from "../models/list.js";
import {
  opsAuctionsReleaseReviewResponseSchema,
  type OpsAuctionsReleaseReviewResponse,
} from "../models/ops-auctions-release-review-response.js";
import {
  opsAuctionsVoidAllResponseSchema,
  type OpsAuctionsVoidAllResponse,
} from "../models/ops-auctions-void-all-response.js";
import { opsRoomsResponseSchema, type OpsRoomsResponse } from "../models/ops-rooms-response.js";
import { opsSummaryResponseSchema, type OpsSummaryResponse } from "../models/ops-summary-response.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import type { Servers } from "../servers.js";

/**
 * Routes that need the operator key.
 */
export class Operator {
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
   * @throws {@link Operator.AdminExportError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  adminExport(
    request: Operator.AdminExportRequest = {},
    options?: RequestOptions,
  ): ApiPromise<undefined, Operator.AdminExportError> {
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
        errorFactory: Operator.AdminExportError,
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
   * @throws {@link Operator.AdminReplayBundleError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  adminReplayBundle(
    request: Operator.AdminReplayBundleRequest,
    options?: RequestOptions,
  ): ApiPromise<Record<string, unknown>, Operator.AdminReplayBundleError> {
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
        errorFactory: Operator.AdminReplayBundleError,
      },
      options,
    );
  }

  /**
   * Metrics snapshot (JSON)
   *
   * @remarks
   * Operator only: this route is not public. Own limit of 60 requests per minute on top of the
   * host-wide limit.
   *
   * @returns The collector snapshot.
   *
   * @throws {@link Operator.GetMetricsError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getMetrics(options?: RequestOptions): ApiPromise<Record<string, unknown>, Operator.GetMetricsError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/metrics"),
        auth: this.#auth.adminKey,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: s.record(s.string(), s.unknown()) },
        errorFactory: Operator.GetMetricsError,
      },
      options,
    );
  }

  /**
   * Metrics in Prometheus text format
   *
   * @remarks
   * Operator only.
   *
   * @returns Prometheus exposition text.
   *
   * @throws {@link Operator.GetMetricsPrometheusError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getMetricsPrometheus(options?: RequestOptions): ApiPromise<string, Operator.GetMetricsPrometheusError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/metrics/prometheus"),
        auth: this.#auth.adminKey,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "text", schema: s.string() },
        errorFactory: Operator.GetMetricsPrometheusError,
      },
      options,
    );
  }

  /**
   * Operator summary
   *
   * @remarks
   * Operator only. Recent logs, settlement sagas, PayPal webhook outcomes and metrics.
   *
   * @returns Summary.
   *
   * @throws {@link Operator.GetOpsSummaryError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getOpsSummary(options?: RequestOptions): ApiPromise<OpsSummaryResponse, Operator.GetOpsSummaryError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/ops/summary"),
        auth: this.#auth.adminKey,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: opsSummaryResponseSchema },
        errorFactory: Operator.GetOpsSummaryError,
      },
      options,
    );
  }

  /**
   * List judge keys
   *
   * @remarks
   * Operator only (`X-Admin-Key`). Lists every judge key by id with its label, limits and state.
   * The secret and its hash are never returned. A judge key on this route is 401.
   *
   * @returns The keys.
   *
   * @throws {@link Operator.ListJudgeKeysError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  listJudgeKeys(options?: RequestOptions): ApiPromise<ApiJudgeKeysResponse, Operator.ListJudgeKeysError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/judge/keys"),
        auth: this.#auth.adminKey,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiJudgeKeysResponseSchema },
        errorFactory: Operator.ListJudgeKeysError,
      },
      options,
    );
  }

  /**
   * Rooms the host has loaded
   *
   * @remarks
   * Operator only.
   *
   * @returns Loaded rooms.
   *
   * @throws {@link Operator.ListOpsRoomsError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  listOpsRooms(options?: RequestOptions): ApiPromise<OpsRoomsResponse, Operator.ListOpsRoomsError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/ops/rooms"),
        auth: this.#auth.adminKey,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: opsRoomsResponseSchema },
        errorFactory: Operator.ListOpsRoomsError,
      },
      options,
    );
  }

  /**
   * Release the holds a settlement review keeps
   *
   * @remarks
   * Operator only. Releases the fallback candidates' holds of a settlement in review. 409 with
   * `busy`, `no_settlement` or `not_in_review`.
   *
   * @returns Released.
   *
   * @throws {@link Operator.OpsReleaseReviewError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  opsReleaseReview(
    request: Operator.OpsReleaseReviewRequest,
    options?: RequestOptions,
  ): ApiPromise<OpsAuctionsReleaseReviewResponse, Operator.OpsReleaseReviewError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/ops/auctions/{id}/release-review"),
        auth: this.#auth.adminKey,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: opsAuctionsReleaseReviewResponseSchema },
        errorFactory: Operator.OpsReleaseReviewError,
      },
      options,
    );
  }

  /**
   * Void every uncaptured hold of a hammered auction
   *
   * @remarks
   * Operator only. For example while the kill switch keeps a capture waiting. Audited with the
   * actor `admin`. 409 `busy` while a settlement run holds the lease, 409 `no_settlement` before
   * the lot was hammered.
   *
   * @returns Done.
   *
   * @throws {@link Operator.OpsVoidAllError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  opsVoidAll(
    request: Operator.OpsVoidAllRequest,
    options?: RequestOptions,
  ): ApiPromise<OpsAuctionsVoidAllResponse, Operator.OpsVoidAllError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/ops/auctions/{id}/void-all"),
        auth: this.#auth.adminKey,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: opsAuctionsVoidAllResponseSchema },
        errorFactory: Operator.OpsVoidAllError,
      },
      options,
    );
  }

  /**
   * Pause or resume judge-room creation
   *
   * @remarks
   * Operator only. A global kill switch for the create route; the flag survives a restart.
   *
   * @returns New state.
   *
   * @throws {@link Operator.PauseJudgeRoomsError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  pauseJudgeRooms(
    request: Operator.PauseJudgeRoomsRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiJudgePauseResponse, Operator.PauseJudgeRoomsError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/judge/pause"),
        auth: this.#auth.adminKey,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiJudgePauseRequestSchema },
      },
      {
        success: { kind: "json", schema: apiJudgePauseResponseSchema },
        errorFactory: Operator.PauseJudgeRoomsError,
      },
      options,
    );
  }

  /**
   * Revoke a judge key
   *
   * @remarks
   * Operator only (`X-Admin-Key`). The key is refused from now on (401 `judge_key_revoked`) and
   * stays revoked after a restart. Rooms it already opened run until they end. A judge key on this
   * route is 401.
   *
   * @returns The key is revoked.
   *
   * @throws {@link Operator.RevokeJudgeKeyError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  revokeJudgeKey(
    request: Operator.RevokeJudgeKeyRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiJudgeKeysRevokeResponse, Operator.RevokeJudgeKeyError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/judge/keys/{keyId}/revoke"),
        auth: this.#auth.adminKey,
        pathParams: [{ name: "keyId", value: request.keyId, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiJudgeKeysRevokeResponseSchema },
        errorFactory: Operator.RevokeJudgeKeyError,
      },
      options,
    );
  }
}

export namespace Operator {
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

  export class GetMetricsError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetMetricsError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 405, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export class GetMetricsPrometheusError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetMetricsPrometheusError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 405, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export class GetOpsSummaryError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetOpsSummaryError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 405, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export class ListJudgeKeysError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<ListJudgeKeysError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error53", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export class ListOpsRoomsError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<ListOpsRoomsError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 405, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type OpsReleaseReviewRequest = {
    /** Auction id. */
    id: string;
  };

  export class OpsReleaseReviewError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<OpsReleaseReviewError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 405, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error55", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type OpsVoidAllRequest = {
    /** Auction id. */
    id: string;
  };

  export class OpsVoidAllError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<OpsVoidAllError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 405, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error55", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type PauseJudgeRoomsRequest = {
    body: ApiJudgePauseRequest;
  };

  export class PauseJudgeRoomsError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<PauseJudgeRoomsError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error56", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type RevokeJudgeKeyRequest = {
    /** The 8 character id inside the key (`gvl_judge_<id>_<secret>`), or `legacy`. */
    keyId: string;
  };

  export class RevokeJudgeKeyError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<RevokeJudgeKeyError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 503, kind: "error55", decode: { kind: "json", schema: error5Schema } },
    ];
  }
}
