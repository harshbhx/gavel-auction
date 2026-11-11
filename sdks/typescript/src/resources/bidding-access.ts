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
  apiAuctionsInvitesRequestSchema,
  type ApiAuctionsInvitesRequest,
} from "../models/api-auctions-invites-request.js";
import {
  apiAuctionsInvitesResponseSchema,
  type ApiAuctionsInvitesResponse,
} from "../models/api-auctions-invites-response.js";
import {
  apiAuctionsJoinRequestSchema,
  type ApiAuctionsJoinRequest,
} from "../models/api-auctions-join-request.js";
import { inviteSchema, type Invite } from "../models/invite.js";
import { joinResponseSchema, type JoinResponse } from "../models/join-response.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import type { Servers } from "../servers.js";

/**
 * Invites, join and session tokens.
 */
export class BiddingAccess {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(rawClient: RawClient, servers: Servers, auth: AuthSchemes) {
    this.#rawClient = rawClient;
    this.#servers = servers;
    this.#auth = auth;
  }

  /**
   * Mint bidder invites
   *
   * @remarks
   * Auctioneer token only. Each invite is a single-use link, valid 24 hours, for one new bidder id.
   * Between 1 and 50 per call.
   *
   * @returns Invites minted.
   *
   * @throws {@link BiddingAccess.CreateInvitesError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  createInvites(
    request: BiddingAccess.CreateInvitesRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiAuctionsInvitesResponse, BiddingAccess.CreateInvitesError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions/{id}/invites"),
        auth: this.#auth.auctioneerAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: {
          kind: "json",
          value: request.body,
          schema: s.optional(s.lazy(() => apiAuctionsInvitesRequestSchema)),
        },
      },
      {
        success: { kind: "json", schema: apiAuctionsInvitesResponseSchema },
        errorFactory: BiddingAccess.CreateInvitesError,
      },
      options,
    );
  }

  /**
   * Exchange an invite for a session token
   *
   * @remarks
   * No header credential: the invite token goes in the body. `id` may be the auction id or its join
   * code. The invite is burned on use; a second use answers 409 `invite_used`. Returns the session
   * token for bidding and the WebSocket address.
   *
   * @returns Session created.
   *
   * @throws {@link BiddingAccess.JoinAuctionError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  joinAuction(
    request: BiddingAccess.JoinAuctionRequest,
    options?: RequestOptions,
  ): ApiPromise<JoinResponse, BiddingAccess.JoinAuctionError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions/{id}/join"),
        auth: noneAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiAuctionsJoinRequestSchema },
      },
      {
        success: { kind: "json", schema: joinResponseSchema },
        errorFactory: BiddingAccess.JoinAuctionError,
      },
      options,
    );
  }

  /**
   * Re-issue an invite for an existing bidder
   *
   * @remarks
   * Auctioneer token only. A bidder who lost their tab gets a fresh single-use invite for the same
   * bidder id, so their hold and bids stay theirs. Answers 404 for a bidder who has no hold in the
   * room.
   *
   * @returns New invite.
   *
   * @throws {@link BiddingAccess.ReissueInviteError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  reissueInvite(
    request: BiddingAccess.ReissueInviteRequest,
    options?: RequestOptions,
  ): ApiPromise<Invite, BiddingAccess.ReissueInviteError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions/{id}/bidders/{bidderId}/invite"),
        auth: this.#auth.auctioneerAuth,
        pathParams: [
          { name: "id", value: request.id, schema: s.string() },
          { name: "bidderId", value: request.bidderId, schema: s.string() },
        ],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: inviteSchema },
        errorFactory: BiddingAccess.ReissueInviteError,
      },
      options,
    );
  }
}

export namespace BiddingAccess {
  export type CreateInvitesRequest = {
    /** Auction id. */
    id: string;
    body?: ApiAuctionsInvitesRequest;
  };

  export class CreateInvitesError extends ApiError {
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

    static readonly errors: ErrorDecoders<CreateInvitesError> = [
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

  export type JoinAuctionRequest = {
    /** Auction id, or its 6 character join code. */
    id: string;
    body: ApiAuctionsJoinRequest;
  };

  export class JoinAuctionError extends ApiError {
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

    static readonly errors: ErrorDecoders<JoinAuctionError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error57", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error58", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type ReissueInviteRequest = {
    /** Auction id. */
    id: string;
    /** Id of the registered bidder to re-invite. */
    bidderId: string;
  };

  export class ReissueInviteError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<ReissueInviteError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 403, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error55", decode: { kind: "json", schema: error5Schema } },
    ];
  }
}
