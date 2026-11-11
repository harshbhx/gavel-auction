import type { AuthSchemes } from "../auth-schemes.js";
import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import {
  apiAuctionsAuctioneerRevokeRequestSchema,
  type ApiAuctionsAuctioneerRevokeRequest,
} from "../models/api-auctions-auctioneer-revoke-request.js";
import {
  apiAuctionsAuctioneerRotateResponseSchema,
  type ApiAuctionsAuctioneerRotateResponse,
} from "../models/api-auctions-auctioneer-rotate-response.js";
import { auctionPublicSchema, type AuctionPublic } from "../models/auction-public.js";
import { createAuctionRequestSchema, type CreateAuctionRequest } from "../models/create-auction-request.js";
import {
  createAuctionResponseSchema,
  type CreateAuctionResponse,
} from "../models/create-auction-response.js";
import { revokedSchema, type Revoked } from "../models/revoked.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import type { Servers } from "../servers.js";

/**
 * Create an auction and read its public facts.
 */
export class Auctions {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(rawClient: RawClient, servers: Servers, auth: AuthSchemes) {
    this.#rawClient = rawClient;
    this.#servers = servers;
    this.#auth = auth;
  }

  /**
   * Create an auction
   *
   * @remarks
   * Operator only. Creates the auction, reserves a 6 character join code, and returns links for the
   * auctioneer console and the projector screen. The tokens are inside the links (fragment
   * `#token=`), valid 12 hours.
   *
   * @returns Auction created.
   *
   * @throws {@link Auctions.CreateAuctionError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  createAuction(
    request: Auctions.CreateAuctionRequestParams,
    options?: RequestOptions,
  ): ApiPromise<CreateAuctionResponse, Auctions.CreateAuctionError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions"),
        auth: this.#auth.adminKey,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: createAuctionRequestSchema },
      },
      {
        success: { kind: "json", schema: createAuctionResponseSchema },
        errorFactory: Auctions.CreateAuctionError,
      },
      options,
    );
  }

  /**
   * Public facts of an auction
   *
   * @remarks
   * No credential. `id` is the auction id or its join code (any case; spaces, dashes and a `GVL-`
   * prefix are ignored). Looking up by code is guess-protected: after 5 wrong codes a source
   * address is locked out for 15 minutes (429 `code_locked`).
   *
   * @returns The auction.
   *
   * @throws {@link Auctions.GetAuctionError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getAuction(
    request: Auctions.GetAuctionRequest,
    options?: RequestOptions,
  ): ApiPromise<AuctionPublic, Auctions.GetAuctionError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/auctions/{id}"),
        auth: noneAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: auctionPublicSchema },
        errorFactory: Auctions.GetAuctionError,
      },
      options,
    );
  }

  /**
   * Revoke every auctioneer token
   *
   * @remarks
   * Operator only. Kills every auctioneer token of the auction and issues no new one.
   *
   * @returns Revoked.
   *
   * @throws {@link Auctions.RevokeAllAuctioneerTokensError} when the API answers with an error
   * status — narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  revokeAllAuctioneerTokens(
    request: Auctions.RevokeAllAuctioneerTokensRequest,
    options?: RequestOptions,
  ): ApiPromise<Revoked, Auctions.RevokeAllAuctioneerTokensError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions/{id}/auctioneer/revoke-all"),
        auth: this.#auth.adminKey,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: revokedSchema },
        errorFactory: Auctions.RevokeAllAuctioneerTokensError,
      },
      options,
    );
  }

  /**
   * Revoke one auctioneer token by jti
   *
   * @remarks
   * Operator only. For a lost or leaked link when you know its token id.
   *
   * @returns Revoked.
   *
   * @throws {@link Auctions.RevokeAuctioneerTokenError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  revokeAuctioneerToken(
    request: Auctions.RevokeAuctioneerTokenRequest,
    options?: RequestOptions,
  ): ApiPromise<Revoked, Auctions.RevokeAuctioneerTokenError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions/{id}/auctioneer/revoke"),
        auth: this.#auth.adminKey,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiAuctionsAuctioneerRevokeRequestSchema },
      },
      {
        success: { kind: "json", schema: revokedSchema },
        errorFactory: Auctions.RevokeAuctioneerTokenError,
      },
      options,
    );
  }

  /**
   * Rotate the auctioneer link
   *
   * @remarks
   * Operator only. Kills every auctioneer token issued before now and returns a fresh link. A
   * leaked auctioneer link cannot do this, by design.
   *
   * @returns New auctioneer link.
   *
   * @throws {@link Auctions.RotateAuctioneerTokenError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  rotateAuctioneerToken(
    request: Auctions.RotateAuctioneerTokenRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiAuctionsAuctioneerRotateResponse, Auctions.RotateAuctioneerTokenError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions/{id}/auctioneer/rotate"),
        auth: this.#auth.adminKey,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiAuctionsAuctioneerRotateResponseSchema },
        errorFactory: Auctions.RotateAuctioneerTokenError,
      },
      options,
    );
  }
}

export namespace Auctions {
  export type CreateAuctionRequestParams = {
    body: CreateAuctionRequest;
  };

  export class CreateAuctionError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<CreateAuctionError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error56", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type GetAuctionRequest = {
    /** Auction id, or its 6 character join code. */
    id: string;
  };

  export class GetAuctionError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetAuctionError> = [
      { on: 404, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error53", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type RevokeAllAuctioneerTokensRequest = {
    /** Auction id. */
    id: string;
  };

  export class RevokeAllAuctioneerTokensError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<RevokeAllAuctioneerTokensError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error54", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type RevokeAuctioneerTokenRequest = {
    /** Auction id. */
    id: string;
    body: ApiAuctionsAuctioneerRevokeRequest;
  };

  export class RevokeAuctioneerTokenError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Declared<"error57", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<RevokeAuctioneerTokenError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error57", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type RotateAuctioneerTokenRequest = {
    /** Auction id. */
    id: string;
  };

  export class RotateAuctioneerTokenError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<RotateAuctioneerTokenError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error54", decode: { kind: "json", schema: error5Schema } },
    ];
  }
}
