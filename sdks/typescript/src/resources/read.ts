import type { AuthSchemes } from "../auth-schemes.js";
import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { anyAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import * as s from "../core/validation/index.js";
import {
  apiAuctionsEventsResponseSchema,
  type ApiAuctionsEventsResponse,
} from "../models/api-auctions-events-response.js";
import { stateFrameSchema, type StateFrame } from "../models/state-frame.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import type { Servers } from "../servers.js";

/**
 * Snapshot and event log, filtered by the caller's role.
 */
export class Read {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(rawClient: RawClient, servers: Servers, auth: AuthSchemes) {
    this.#rawClient = rawClient;
    this.#servers = servers;
    this.#auth = auth;
  }

  /**
   * Room snapshot for the caller's role
   *
   * @remarks
   * The same snapshot the WebSocket sends in a `state` frame, filtered by role: a bidder sees only
   * their own ceiling and hold, a screen sees no private fields, the auctioneer sees the full audit
   * rows. A reviewer token gets the screen's view.
   *
   * @returns The state frame.
   *
   * @throws {@link Read.GetSnapshotError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getSnapshot(
    request: Read.GetSnapshotRequest,
    options?: RequestOptions,
  ): ApiPromise<StateFrame, Read.GetSnapshotError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/auctions/{id}/snapshot"),
        auth: anyAuth(
          this.#auth.auctioneerAuth,
          this.#auth.screenAuth,
          this.#auth.sessionAuth,
          this.#auth.reviewerAuth,
        ),
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: stateFrameSchema },
        errorFactory: Read.GetSnapshotError,
      },
      options,
    );
  }

  /**
   * Page through the event log
   *
   * @remarks
   * Auctioneer, screen or reviewer token (a reviewer sees what a screen sees). Events after
   * sequence `after`, at most `limit`. A screen sees full rows only for public event types; every
   * other event is a bare `{seq}` so the log stays whole. Ceilings, transcripts, hold references
   * and the auctioneer subject are never returned. Pass `next` back as `after` to continue.
   *
   * @returns A page of events.
   *
   * @throws {@link Read.ListEventsError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  listEvents(
    request: Read.ListEventsRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiAuctionsEventsResponse, Read.ListEventsError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/auctions/{id}/events"),
        auth: anyAuth(this.#auth.auctioneerAuth, this.#auth.screenAuth, this.#auth.reviewerAuth),
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [
          { name: "after", value: request.after, schema: s.defaulted(s.int(), 0) },
          { name: "limit", value: request.limit, schema: s.defaulted(s.int(), 100) },
        ],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiAuctionsEventsResponseSchema },
        errorFactory: Read.ListEventsError,
      },
      options,
    );
  }
}

export namespace Read {
  export type GetSnapshotRequest = {
    /** Auction id. */
    id: string;
  };

  export class GetSnapshotError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetSnapshotError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 403, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error55", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type ListEventsRequest = {
    /** Auction id. */
    id: string;
    /**
     * Return events after this sequence number. Pass the `next` of the previous page to continue.
     *
     * @default 0
     */
    after?: number;
    /** Most events to return in one page. @default 100 */
    limit?: number;
  };

  export class ListEventsError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<ListEventsError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error55", decode: { kind: "json", schema: error5Schema } },
    ];
  }
}
