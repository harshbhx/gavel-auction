import type { AuthSchemes } from "../auth-schemes.js";
import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { anyAuth, noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import {
  apiJudgeCapabilitiesResponseSchema,
  type ApiJudgeCapabilitiesResponse,
} from "../models/api-judge-capabilities-response.js";
import { apiJudgeJoinRequestSchema, type ApiJudgeJoinRequest } from "../models/api-judge-join-request.js";
import { apiJudgeJoinResponseSchema, type ApiJudgeJoinResponse } from "../models/api-judge-join-response.js";
import { apiJudgeKeyResponseSchema, type ApiJudgeKeyResponse } from "../models/api-judge-key-response.js";
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
import {
  apiJudgeRoomsBidsRequestSchema,
  type ApiJudgeRoomsBidsRequest,
} from "../models/api-judge-rooms-bids-request.js";
import {
  apiJudgeRoomsBidsResponseSchema,
  type ApiJudgeRoomsBidsResponse,
} from "../models/api-judge-rooms-bids-response.js";
import { apiJudgeRoomsRequestSchema, type ApiJudgeRoomsRequest } from "../models/api-judge-rooms-request.js";
import {
  apiJudgeRoomsSimHoldRequestSchema,
  type ApiJudgeRoomsSimHoldRequest,
} from "../models/api-judge-rooms-sim-hold-request.js";
import {
  apiJudgeRoomsSimHoldResponseSchema,
  type ApiJudgeRoomsSimHoldResponse,
} from "../models/api-judge-rooms-sim-hold-response.js";
import { judgeRoomSchema, type JudgeRoom } from "../models/judge-room.js";
import { replayBundleSchema, type ReplayBundle } from "../models/replay-bundle.js";
import {
  apiJudgeRoomsBidsResponse21Schema,
  type ApiJudgeRoomsBidsResponse21,
} from "../models/unions/api-judge-rooms-bids-response21.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import type { Servers } from "../servers.js";

/**
 * Key-less sandbox rooms for reviewers.
 */
export class JudgeRooms {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(rawClient: RawClient, servers: Servers, auth: AuthSchemes) {
    this.#rawClient = rawClient;
    this.#servers = servers;
    this.#auth = auth;
  }

  /**
   * Check a judge key
   *
   * @remarks
   * Send the key in the `X-Judge-Key` header, with no body. Creates nothing; it lets a panel say
   * whether the key works. A wrong key is 401 `judge_key_invalid` and counts toward a lockout of
   * its own, separate from the room-code lockout (5 wrong keys, 15 minutes, per source address: 429
   * `judge_key_locked`, even with the right key; joins are not affected). A blank key is 401
   * without a strike. When the host has no judge key set, every key answers as wrong. Answers 404
   * when judge rooms are off.
   *
   * @returns The key is accepted.
   *
   * @throws {@link JudgeRooms.CheckJudgeKeyError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  checkJudgeKey(options?: RequestOptions): ApiPromise<ApiJudgeKeyResponse, JudgeRooms.CheckJudgeKeyError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/judge/key"),
        auth: this.#auth.judgeKey,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiJudgeKeyResponseSchema },
        errorFactory: JudgeRooms.CheckJudgeKeyError,
      },
      options,
    );
  }

  /**
   * Create a judge room
   *
   * @remarks
   * No credential needed. Creates a short sandbox auction (10 minute lot, small ceilings) that ends
   * after 30 minutes. The creator gets auctioneer, screen and reviewer tokens for that room only;
   * no operator route opens. Answers 404 when judge rooms are off.
   *
   * With the optional `X-Judge-Key` header the request is judged by the key alone: the public
   * limits do not apply, the room does not use a public slot, and a wrong key is 401
   * `judge_key_invalid` (it never falls back to the public path). An empty header is 401
   * `judge_key_invalid` without a strike. Wrong keys have a lockout of their own, separate from the
   * room-code lockout: 5 wrong keys, 15 minutes, per source address (429 `judge_key_locked`); it
   * has no effect on joins. The response then carries `unlocked: true`.
   *
   * @returns Room created.
   *
   * @throws {@link JudgeRooms.CreateJudgeRoomError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  createJudgeRoom(
    request: JudgeRooms.CreateJudgeRoomRequest = {},
    options?: RequestOptions,
  ): ApiPromise<JudgeRoom, JudgeRooms.CreateJudgeRoomError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/judge/rooms"),
        auth: this.#auth.judgeKey,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: {
          kind: "json",
          value: request.body,
          schema: s.optional(s.lazy(() => apiJudgeRoomsRequestSchema)),
        },
      },
      {
        success: { kind: "json", schema: judgeRoomSchema },
        errorFactory: JudgeRooms.CreateJudgeRoomError,
      },
      options,
    );
  }

  /**
   * Place a simulated hold in a judge room
   *
   * @remarks
   * Session token of a bidder in that judge room. Writes an already-authorized hold with no PayPal
   * call and puts the bidder in the room, so the whole path can be tried without a PayPal login.
   * The ceiling is any whole number of cents from 100 up to the room's ceiling cap (the top
   * preset); the presets are only quick picks, and a value outside the range is 400 `bad_message`.
   * Any other auction answers 404. Answers 404 when simulated holds are off.
   *
   * @returns Simulated hold placed.
   *
   * @throws {@link JudgeRooms.CreateSimulatedHoldError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  createSimulatedHold(
    request: JudgeRooms.CreateSimulatedHoldRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiJudgeRoomsSimHoldResponse, JudgeRooms.CreateSimulatedHoldError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/judge/rooms/{id}/sim-hold"),
        auth: this.#auth.sessionAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiJudgeRoomsSimHoldRequestSchema },
      },
      {
        success: { kind: "json", schema: apiJudgeRoomsSimHoldResponseSchema },
        errorFactory: JudgeRooms.CreateSimulatedHoldError,
      },
      options,
    );
  }

  /**
   * What judge rooms this host offers
   *
   * @remarks
   * No credential. Tells a client whether it can create a room right now.
   *
   * @returns Capabilities.
   *
   * @throws {@link JudgeRooms.GetJudgeCapabilitiesError} when the API answers with an error status
   * — narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getJudgeCapabilities(
    options?: RequestOptions,
  ): ApiPromise<ApiJudgeCapabilitiesResponse, JudgeRooms.GetJudgeCapabilitiesError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/judge/capabilities"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiJudgeCapabilitiesResponseSchema },
        errorFactory: JudgeRooms.GetJudgeCapabilitiesError,
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
   * @throws {@link JudgeRooms.GetJudgeRoomLedgerError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getJudgeRoomLedger(
    request: JudgeRooms.GetJudgeRoomLedgerRequest,
    options?: RequestOptions,
  ): ApiPromise<ReplayBundle, JudgeRooms.GetJudgeRoomLedgerError> {
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
        errorFactory: JudgeRooms.GetJudgeRoomLedgerError,
      },
      options,
    );
  }

  /**
   * Join a judge room with its code
   *
   * @remarks
   * No credential. A bidder joins a judge room with its 6 character code and a display name and
   * gets a session token. Only judge rooms: the code of any other auction answers exactly like an
   * unknown code (404). Wrong codes are counted; 5 wrong codes lock a source address out for 15
   * minutes (429 `judge_join_locked`). At most 20 bidders join one room (429 `judge_room_full`). An
   * ended room answers 410.
   *
   * @returns Joined.
   *
   * @throws {@link JudgeRooms.JoinJudgeRoomError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  joinJudgeRoom(
    request: JudgeRooms.JoinJudgeRoomRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiJudgeJoinResponse, JudgeRooms.JoinJudgeRoomError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/judge/join"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiJudgeJoinRequestSchema },
      },
      {
        success: { kind: "json", schema: apiJudgeJoinResponseSchema },
        errorFactory: JudgeRooms.JoinJudgeRoomError,
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
   * @throws {@link JudgeRooms.ListJudgeKeysError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  listJudgeKeys(options?: RequestOptions): ApiPromise<ApiJudgeKeysResponse, JudgeRooms.ListJudgeKeysError> {
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
        errorFactory: JudgeRooms.ListJudgeKeysError,
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
   * @throws {@link JudgeRooms.PauseJudgeRoomsError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  pauseJudgeRooms(
    request: JudgeRooms.PauseJudgeRoomsRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiJudgePauseResponse, JudgeRooms.PauseJudgeRoomsError> {
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
        errorFactory: JudgeRooms.PauseJudgeRoomsError,
      },
      options,
    );
  }

  /**
   * Place a bid in a judge room over HTTP
   *
   * @remarks
   * Bid with plain HTTP, for curl and generated clients that cannot open the WebSocket (the socket
   * needs a browser `Origin`; this route does not, and the socket rules are unchanged). Send the
   * session token from `POST /api/judge/join` as a bearer token, after the bidder has a hold (`POST
   * /api/judge/rooms/{id}/sim-hold`). The bid takes the same path as a socket bid: the per-bidder
   * bid limit, the registered check and the auction engine all apply. `amount` is whole cents.
   * `mid` is optional; send the same `mid` again to retry safely, the room answers with the
   * original result and records nothing twice.
   *
   * A bid the engine refuses (too low, over your ceiling, lot closed) is 409 with `accepted: false`
   * and a `reason`. Sending a `mid` again with a different `amount` is 409 `conflict` (`{error,
   * code, message}`). Bids sent too fast are 429 `rate_limited` with `Retry-After`. When the room
   * cannot take the bid (`auction_full`, `store_unavailable`, `room_full`) the answer is 503. Only
   * session tokens work here, and only for judge rooms: any other auction answers 404. A judge key
   * is not needed on this route.
   *
   * @returns The bid was accepted.
   *
   * @throws {@link JudgeRooms.PlaceJudgeBidError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  placeJudgeBid(
    request: JudgeRooms.PlaceJudgeBidRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiJudgeRoomsBidsResponse, JudgeRooms.PlaceJudgeBidError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/judge/rooms/{id}/bids"),
        auth: this.#auth.sessionAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: apiJudgeRoomsBidsRequestSchema },
      },
      {
        success: { kind: "json", schema: apiJudgeRoomsBidsResponseSchema },
        errorFactory: JudgeRooms.PlaceJudgeBidError,
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
   * @throws {@link JudgeRooms.RevokeJudgeKeyError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  revokeJudgeKey(
    request: JudgeRooms.RevokeJudgeKeyRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiJudgeKeysRevokeResponse, JudgeRooms.RevokeJudgeKeyError> {
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
        errorFactory: JudgeRooms.RevokeJudgeKeyError,
      },
      options,
    );
  }
}

export namespace JudgeRooms {
  export class CheckJudgeKeyError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<CheckJudgeKeyError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error54", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type CreateJudgeRoomRequest = {
    body?: ApiJudgeRoomsRequest;
  };

  export class CreateJudgeRoomError extends ApiError {
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

    static readonly errors: ErrorDecoders<CreateJudgeRoomError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error57", decode: { kind: "json", schema: error5Schema } },
      { on: 503, kind: "error58", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type CreateSimulatedHoldRequest = {
    /** Auction id. */
    id: string;
    body: ApiJudgeRoomsSimHoldRequest;
  };

  export class CreateSimulatedHoldError extends ApiError {
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
      | Declared<"error510", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<CreateSimulatedHoldError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 403, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 409, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 410, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error57", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error58", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error59", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error510", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export class GetJudgeCapabilitiesError extends ApiError {
    declare readonly payload: Declared<"error5", Error5> | Declared<"error52", Error5> | Undeclared;

    static readonly errors: ErrorDecoders<GetJudgeCapabilitiesError> = [
      { on: 429, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error52", decode: { kind: "json", schema: error5Schema } },
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

  export type JoinJudgeRoomRequest = {
    body: ApiJudgeJoinRequest;
  };

  export class JoinJudgeRoomError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Declared<"error57", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<JoinJudgeRoomError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 410, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error57", decode: { kind: "json", schema: error5Schema } },
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

  export type PlaceJudgeBidRequest = {
    /** Auction id. */
    id: string;
    body: ApiJudgeRoomsBidsRequest;
  };

  export class PlaceJudgeBidError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"apiJudgeRoomsBidsResponse21", ApiJudgeRoomsBidsResponse21>
      | Declared<"error55", Error5>
      | Declared<"error56", Error5>
      | Declared<"error57", Error5>
      | Declared<"error58", Error5>
      | Declared<"error59", Error5>
      | Declared<"error510", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<PlaceJudgeBidError> = [
      { on: 400, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 401, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 403, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      {
        on: 409,
        kind: "apiJudgeRoomsBidsResponse21",
        decode: { kind: "json", schema: apiJudgeRoomsBidsResponse21Schema },
      },
      { on: 410, kind: "error55", decode: { kind: "json", schema: error5Schema } },
      { on: 413, kind: "error56", decode: { kind: "json", schema: error5Schema } },
      { on: 415, kind: "error57", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error58", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error59", decode: { kind: "json", schema: error5Schema } },
      { on: 503, kind: "error510", decode: { kind: "json", schema: error5Schema } },
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
