import type { AuthSchemes } from "../auth-schemes.js";
import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import {
  apiAuctionsReceiptLinkResponseSchema,
  type ApiAuctionsReceiptLinkResponse,
} from "../models/api-auctions-receipt-link-response.js";
import {
  apiAuctionsReceiptResponseSchema,
  type ApiAuctionsReceiptResponse,
} from "../models/api-auctions-receipt-response.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import type { Servers } from "../servers.js";

/**
 * Shareable read-only receipts.
 */
export class Receipts {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(rawClient: RawClient, servers: Servers, auth: AuthSchemes) {
    this.#rawClient = rawClient;
    this.#servers = servers;
    this.#auth = auth;
  }

  /**
   * Make a shareable receipt link
   *
   * @remarks
   * Session token only. Returns a receipt token (valid 4 hours) that opens exactly one read-only
   * route, `GET /api/auctions/{id}/receipt`, for this bidder.
   *
   * @returns Receipt link.
   *
   * @throws {@link Receipts.CreateReceiptLinkError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  createReceiptLink(
    request: Receipts.CreateReceiptLinkRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiAuctionsReceiptLinkResponse, Receipts.CreateReceiptLinkError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/auctions/{id}/receipt-link"),
        auth: this.#auth.sessionAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiAuctionsReceiptLinkResponseSchema },
        errorFactory: Receipts.CreateReceiptLinkError,
      },
      options,
    );
  }

  /**
   * Read a receipt
   *
   * @remarks
   * Receipt token only. A cut-down snapshot: the lot, the hammer outcome, the viewer's own roster
   * row and own hold. The winner keeps a paddle but loses the name, every other bidder is dropped,
   * and the ceiling, the join code and the audit rows are removed.
   *
   * @returns The receipt.
   *
   * @throws {@link Receipts.GetReceiptError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getReceipt(
    request: Receipts.GetReceiptRequest,
    options?: RequestOptions,
  ): ApiPromise<ApiAuctionsReceiptResponse, Receipts.GetReceiptError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/auctions/{id}/receipt"),
        auth: this.#auth.receiptAuth,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: apiAuctionsReceiptResponseSchema },
        errorFactory: Receipts.GetReceiptError,
      },
      options,
    );
  }
}

export namespace Receipts {
  export type CreateReceiptLinkRequest = {
    /** Auction id. */
    id: string;
  };

  export class CreateReceiptLinkError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Declared<"error55", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<CreateReceiptLinkError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 403, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error54", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error55", decode: { kind: "json", schema: error5Schema } },
    ];
  }

  export type GetReceiptRequest = {
    /** Auction id. */
    id: string;
  };

  export class GetReceiptError extends ApiError {
    declare readonly payload:
      | Declared<"error5", Error5>
      | Declared<"error52", Error5>
      | Declared<"error53", Error5>
      | Declared<"error54", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetReceiptError> = [
      { on: 401, kind: "error5", decode: { kind: "json", schema: error5Schema } },
      { on: 404, kind: "error52", decode: { kind: "json", schema: error5Schema } },
      { on: 429, kind: "error53", decode: { kind: "json", schema: error5Schema } },
      { on: 500, kind: "error54", decode: { kind: "json", schema: error5Schema } },
    ];
  }
}
