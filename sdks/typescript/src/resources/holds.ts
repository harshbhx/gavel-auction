import type { AuthSchemes } from "../auth-schemes.js";
import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import {
  apiHoldsApproveRequestSchema,
  type ApiHoldsApproveRequest,
} from "../models/api-holds-approve-request.js";
import {
  apiHoldsApproveResponseSchema,
  type ApiHoldsApproveResponse,
} from "../models/api-holds-approve-response.js";
import { apiHoldsRequestSchema, type ApiHoldsRequest } from "../models/api-holds-request.js";
import { apiHoldsResponseSchema, type ApiHoldsResponse } from "../models/api-holds-response.js";
import { apiHoldsResponse1Schema, type ApiHoldsResponse1 } from "../models/api-holds-response1.js";
import { createHoldResponseSchema, type CreateHoldResponse } from "../models/create-hold-response.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import type { Servers } from "../servers.js";

/**
 * PayPal hold orders for a bidder session.
 */
export class Holds {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(rawClient: RawClient, servers: Servers, auth: AuthSchemes) {
    this.#rawClient = rawClient;
    this.#servers = servers;
    this.#auth = auth;
  }

  /**
   * Abandon an unapproved hold
   *
   * @remarks
   * Session token of the hold's owner. Idempotent. A hold that is already authorized is not
   * released: it answers 409 `hold_exists`.
   *
   * @returns Released (now or before).
   *
   * @throws {@link Holds.AbandonHoldError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  abandonHold(
    request: Holds.AbandonHoldRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiHoldsResponse1, Holds.AbandonHoldError> {
    return this.#rawClient.execute(
      {
        method: "DELETE",
        urlTemplate: this.#servers.default("/api/holds/{holdId}"),
        auth: this.#auth.sessionAuth,
        pathParams: [{ name: "holdId", value: request.holdId, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiHoldsResponse1Schema },
        errorFactory: Holds.AbandonHoldError,
      },
      options,
    );
  }

  /**
   * Authorize an approved hold order
   *
   * @remarks
   * Session token of the hold's owner. Another bidder's hold answers 404, exactly like an unknown
   * hold. When `name` is sent, the bidder is also registered in the room once the hold is
   * authorized (idempotent).
   *
   * @returns Hold authorized.
   *
   * @throws {@link Holds.ApproveHoldError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  approveHold(
    request: Holds.ApproveHoldRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiHoldsApproveResponse, Holds.ApproveHoldError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/holds/{holdId}/approve"),
        auth: this.#auth.sessionAuth,
        pathParams: [{ name: "holdId", value: request.holdId, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiHoldsApproveRequestSchema },
      },
      {
        success: { kind: "json", schema: apiHoldsApproveResponseSchema },
        errorFactory: Holds.ApproveHoldError,
      },
      options,
    );
  }

  /**
   * Create a PayPal hold order
   *
   * @remarks
   * Session token only. The bidder is the one in the token; a body that names a bidder is rejected.
   * The ceiling must be one of the auction's offered presets. Errors on the hold routes are
   * `{error, message}` with the codes in `HoldErrorCode`.
   *
   * @returns Hold order created; approve it with PayPal, then call the approve route.
   *
   * @throws {@link Holds.CreateHoldError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  createHold(
    request: Holds.CreateHoldRequest,
    options?: RequestOptions,
  ): ApiPromise<CreateHoldResponse, Holds.CreateHoldError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/holds"),
        auth: this.#auth.sessionAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiHoldsRequestSchema },
      },
      {
        success: { kind: "json", schema: createHoldResponseSchema },
        errorFactory: Holds.CreateHoldError,
      },
      options,
    );
  }

  /**
   * Read your own hold
   *
   * @remarks
   * Session token of the hold's owner. Anyone else's hold answers 404.
   *
   * @returns The hold.
   *
   * @throws {@link Holds.GetHoldError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getHold(
    request: Holds.GetHoldRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiHoldsResponse, Holds.GetHoldError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/holds/{holdId}"),
        auth: this.#auth.sessionAuth,
        pathParams: [{ name: "holdId", value: request.holdId, schema: s.string() }],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiHoldsResponseSchema },
        errorFactory: Holds.GetHoldError,
      },
      options,
    );
  }
}

export namespace Holds {
  export type AbandonHoldRequest = {
    /** Id of the hold, as returned by the create-hold route. */
    holdId: string;
  };

  export class AbandonHoldError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<AbandonHoldError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error55", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type ApproveHoldRequest = {
    /** Id of the hold, as returned by the create-hold route. */
    holdId: string;
    body: ApiHoldsApproveRequest;
  };

  export class ApproveHoldError extends ApiError {
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

    static readonly errors: ErrorDecoders<ApproveHoldError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error57", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error58", decode: { kind: "json", schema: error5Schema } },
      { on: 503, kind: "error59", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type CreateHoldRequest = {
    body: ApiHoldsRequest;
  };

  export class CreateHoldError extends ApiError {
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

    static readonly errors: ErrorDecoders<CreateHoldError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error57", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error58", decode: { kind: "json", schema: error5Schema } },
      { on: 503, kind: "error59", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type GetHoldRequest = {
    /** Id of the hold, as returned by the create-hold route. */
    holdId: string;
  };

  export class GetHoldError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetHoldError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error54", decode: { kind: "json", schema: error5Schema } },
    ];
  }
}
