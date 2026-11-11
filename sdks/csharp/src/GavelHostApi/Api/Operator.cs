using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using GavelHostApi.Core;
using GavelHostApi.Core.Exceptions;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Request;
using GavelHostApi.Core.Response;
using GavelHostApi.Errors;
using GavelHostApi.Models;
using GavelHostApi.Requests.JudgeRooms;
using GavelHostApi.Requests.Operator;

namespace GavelHostApi.Api;

/// <summary>
/// Routes that need the operator key.
/// </summary>
public sealed class Operator
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    internal Operator(RawClient rawClient, Server server, AuthSchemes auth)
    {
        _rawClient = rawClient;
        _server = server;
        _auth = auth;
    }

    /// <summary>
    /// Private ledger and payment state export
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="AdminExportError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. Output carries every bidder's ceiling, hold reference and bid
    /// transcript: never publish it. Modes by query: <c>auction=&lt;id&gt;</c> (the hash-chained ledger
    /// as NDJSON, last line <c>{head}</c>); <c>list=1</c> (all auction ids); <c>kind=payments&amp;auction=&lt;id&gt;</c>
    /// (settlement journal and holds); <c>kind=payments-global</c> (webhook event ids and kill
    /// switch); <c>kind=roomlog&amp;auction=&lt;id&gt;</c> (room events as NDJSON, last line <c>{end}</c>).
    /// Secret-looking keys are replaced with <c>[redacted]</c> and webhook bodies are dropped.
    /// Errors are <c>{"error": "&lt;code&gt;"}</c>.
    /// </remarks>
    public Task AdminExport(AdminExportRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/admin/export"),
            [],
            [new Param("auction", request.Auction), new Param("list", request.List), new Param("kind", request.Kind)],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            VoidResponse.Instance,
            AdminExportError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Replay bundle of one auction
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ReplayBundle"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="AdminReplayBundleError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. A self-contained bundle of the auction's ledger for replay and
    /// verification. Query <c>auctionId</c> is required. 404 when the ledger has no entry, 409
    /// <c>ledger_unverified</c> when the hash chain is broken, 500 <c>export_failed</c> when it cannot
    /// be read.
    /// </remarks>
    public Task<ReplayBundle> AdminReplayBundle(AdminReplayBundleRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/admin/replay-bundle"),
            [],
            [new Param("auctionId", request.AuctionId)],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<ReplayBundle>(),
            AdminReplayBundleError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Metrics snapshot (JSON)
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="object"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetMetricsError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only: this route is not public. Own limit of 60 requests per minute on top of
    /// the host-wide limit.
    /// </remarks>
    public Task<object> GetMetrics(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/metrics"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<object>(),
            GetMetricsError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Metrics in Prometheus text format
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="string"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetMetricsPrometheusError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only.
    /// </remarks>
    public Task<string> GetMetricsPrometheus(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/metrics/prometheus"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            PlainTextResponse.CreateString(),
            GetMetricsPrometheusError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Operator summary
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="OpsSummaryResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetOpsSummaryError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. Recent logs, settlement sagas, PayPal webhook outcomes and metrics.
    /// </remarks>
    public Task<OpsSummaryResponse> GetOpsSummary(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/ops/summary"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<OpsSummaryResponse>(),
            GetOpsSummaryError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// List judge keys
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiJudgeKeysResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="ListJudgeKeysError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only (<c>X-Admin-Key</c>). Lists every judge key by id with its label, limits and
    /// state. The secret and its hash are never returned. A judge key on this route is 401.
    /// </remarks>
    public Task<ApiJudgeKeysResponse> ListJudgeKeys(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/keys"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<ApiJudgeKeysResponse>(),
            ListJudgeKeysError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Rooms the host has loaded
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="OpsRoomsResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="ListOpsRoomsError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only.
    /// </remarks>
    public Task<OpsRoomsResponse> ListOpsRooms(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/ops/rooms"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<OpsRoomsResponse>(),
            ListOpsRoomsError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Release the holds a settlement review keeps
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="OpsAuctionsReleaseReviewResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="OpsReleaseReviewError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. Releases the fallback candidates' holds of a settlement in review.
    /// 409 with <c>busy</c>, <c>no_settlement</c> or <c>not_in_review</c>.
    /// </remarks>
    public Task<OpsAuctionsReleaseReviewResponse> OpsReleaseReview(OpsReleaseReviewRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/ops/auctions/{id}/release-review"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            EmptyBody.Instance,
            JsonResponse.Create<OpsAuctionsReleaseReviewResponse>(),
            OpsReleaseReviewError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Void every uncaptured hold of a hammered auction
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="OpsAuctionsVoidAllResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="OpsVoidAllError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. For example while the kill switch keeps a capture waiting. Audited with
    /// the actor <c>admin</c>. 409 <c>busy</c> while a settlement run holds the lease, 409
    /// <c>no_settlement</c> before the lot was hammered.
    /// </remarks>
    public Task<OpsAuctionsVoidAllResponse> OpsVoidAll(OpsVoidAllRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/ops/auctions/{id}/void-all"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            EmptyBody.Instance,
            JsonResponse.Create<OpsAuctionsVoidAllResponse>(),
            OpsVoidAllError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Pause or resume judge-room creation
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiJudgePauseResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="PauseJudgeRoomsError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. A global kill switch for the create route; the flag survives a restart.
    /// </remarks>
    public Task<ApiJudgePauseResponse> PauseJudgeRooms(PauseJudgeRoomsRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/pause"),
            [],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<ApiJudgePauseResponse>(),
            PauseJudgeRoomsError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Revoke a judge key
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiJudgeKeysRevokeResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="RevokeJudgeKeyError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only (<c>X-Admin-Key</c>). The key is refused from now on (401 <c>judge_key_revoked</c>)
    /// and stays revoked after a restart. Rooms it already opened run until they end. A judge
    /// key on this route is 401.
    /// </remarks>
    public Task<ApiJudgeKeysRevokeResponse> RevokeJudgeKey(RevokeJudgeKeyRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/keys/{keyId}/revoke"),
            [new TemplateParam("keyId", request.KeyId)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            EmptyBody.Instance,
            JsonResponse.Create<ApiJudgeKeysRevokeResponse>(),
            RevokeJudgeKeyError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);
}
