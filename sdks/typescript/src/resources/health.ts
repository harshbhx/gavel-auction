import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { readyz503Error1Schema, type Readyz503Error1 } from "../models/readyz503-error1.js";
import { statusSchema, type Status } from "../models/status.js";
import { error5Schema, type Error5 } from "../models/unions/error5.js";
import { versionResponseSchema, type VersionResponse } from "../models/version-response.js";
import { warmupReportSchema, type WarmupReport } from "../models/warmup-report.js";
import type { Servers } from "../servers.js";

/**
 * Liveness, readiness and build version.
 */
export class Health {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * Liveness
   *
   * @remarks
   * Always 200 while the process runs. Never rate limited.
   *
   * @returns Alive.
   *
   * @throws {@link ApiError} when the API answers with an error status
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getHealth(options?: RequestOptions): ApiPromise<Status, ApiError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/healthz"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: statusSchema },
        errorFactory: ApiError,
      },
      options,
    );
  }

  /**
   * Readiness
   *
   * @remarks
   * 200 when every migration is applied and the store answers; 503 otherwise. Never rate limited.
   *
   * @returns Ready.
   *
   * @throws {@link Health.GetReadinessError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getReadiness(options?: RequestOptions): ApiPromise<Status, Health.GetReadinessError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/readyz"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: statusSchema },
        errorFactory: Health.GetReadinessError,
      },
      options,
    );
  }

  /**
   * Deployed build
   *
   * @remarks
   * The commit the running build was made from, or `unknown`. Never rate limited.
   *
   * @returns Build sha.
   *
   * @throws {@link ApiError} when the API answers with an error status
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getVersion(options?: RequestOptions): ApiPromise<VersionResponse, ApiError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/version"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: versionResponseSchema },
        errorFactory: ApiError,
      },
      options,
    );
  }

  /**
   * Warm the host's dependencies
   *
   * @remarks
   * No credential. Runs the warm-up steps in parallel within a 3 second budget; 200 when all are
   * warm, 503 otherwise.
   *
   * @returns All steps warm.
   *
   * @throws {@link Health.WarmupError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link GavelHostApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  warmup(options?: RequestOptions): ApiPromise<WarmupReport, Health.WarmupError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/warmup"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: warmupReportSchema },
        errorFactory: Health.WarmupError,
      },
      options,
    );
  }
}

export namespace Health {
  export class GetReadinessError extends ApiError {
    declare readonly payload: Declared<"readyz503Error1", Readyz503Error1> | Undeclared;

    static readonly errors: ErrorDecoders<GetReadinessError> = [
      { on: 503, kind: "readyz503Error1", decode: { kind: "json", schema: readyz503Error1Schema } },
    ];
  }

  export class WarmupError extends ApiError {
    declare readonly payload:
      | Declared<"warmupReport", WarmupReport>
      | Declared<"error5", Error5>
      | Undeclared;

    static readonly errors: ErrorDecoders<WarmupError> = [
      { on: 503, kind: "warmupReport", decode: { kind: "json", schema: warmupReportSchema } },
      { on: 429, kind: "error5", decode: { kind: "json", schema: error5Schema } },
    ];
  }
}
