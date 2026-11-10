import type { AuthSchemes } from "../auth-schemes.js";
import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import {
  apiAuctionsKillRequestSchema,
  type ApiAuctionsKillRequest,
} from "../models/api-auctions-kill-request.js";
import {
  apiAuctionsKillResponseSchema,
  type ApiAuctionsKillResponse,
} from "../models/api-auctions-kill-response.js";
import { controlRequestSchema, type ControlRequest } from "../models/control-request.js";
import { controlResponseSchema, type ControlResponse } from "../models/control-response.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import type { Servers } from "../servers.js";

/**
 * Auctioneer controls and the Stop button.
 */
export class Control {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(rawClient: RawClient, servers: Servers, auth: AuthSchemes) {
    this.#rawClient = rawClient;
    this.#servers = servers;
    this.#auth = auth;
  }

  /**
   * Run an auctioneer control
   *
   * @remarks
   * Auctioneer token only (a session or screen token authenticates but is refused with 403).
   * Idempotent by `controlId`: repeat the same id with the same action and you get the same answer.
   * A `hammer` needs `args.closeNow: 1` while the lot is still open; it is refused with 409 when
   * the price or leader changed since the console last looked.
   *
   * @returns The control was applied.
   *
   * @throws {@link Control.ControlAuctionError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  controlAuction(
    request: Control.ControlAuctionRequest,
    options?: RequestOptions,
  ): ApiPromise<ControlResponse, Control.ControlAuctionError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions/{id}/control"),
        auth: this.#auth.auctioneerAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: controlRequestSchema },
      },
      {
        success: { kind: "json", schema: controlResponseSchema },
        errorFactory: Control.ControlAuctionError,
      },
      options,
    );
  }

  /**
   * Stop the lot (unsold hammer)
   *
   * @remarks
   * Auctioneer token only. Ends the lot as an unsold hammer so settlement voids every hold. A
   * repeat, or a lot that is already over, is a no-op that answers 200 with the current state. The
   * body must carry `confirm: "STOP"`.
   *
   * @returns The lot is stopped.
   *
   * @throws {@link Control.KillAuctionError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  killAuction(
    request: Control.KillAuctionRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiAuctionsKillResponse, Control.KillAuctionError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions/{id}/kill"),
        auth: this.#auth.auctioneerAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiAuctionsKillRequestSchema },
      },
      {
        success: { kind: "json", schema: apiAuctionsKillResponseSchema },
        errorFactory: Control.KillAuctionError,
      },
      options,
    );
  }
}

export namespace Control {
  export type ControlAuctionRequest = {
    /** Auction id. */
    id: string;
    body: ControlRequest;
  };

  export class ControlAuctionError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Declared<"error57", Error5>
      | Declared<"error58", Error5>
      | Declared<"error59", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<ControlAuctionError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 403, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error57", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error58", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error59", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type KillAuctionRequest = {
    /** Auction id. */
    id: string;
    body: ApiAuctionsKillRequest;
  };

  export class KillAuctionError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Declared<"error57", Error5>
      | Declared<"error58", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<KillAuctionError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 403, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error57", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error58", decode: { kind: "json", schema: error5Schema } },
    ];
  }
}
