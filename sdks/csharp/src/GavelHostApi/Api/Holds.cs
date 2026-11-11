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
using GavelHostApi.Requests.Holds;

namespace GavelHostApi.Api;

/// <summary>
/// PayPal hold orders for a bidder session.
/// </summary>
public sealed class Holds
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    internal Holds(RawClient rawClient, Server server, AuthSchemes auth)
    {
        _rawClient = rawClient;
        _server = server;
        _auth = auth;
    }

    /// <summary>
    /// Abandon an unapproved hold
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiHoldsResponse1"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="AbandonHoldError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Session token of the hold's owner. Idempotent. A hold that is already authorized is
    /// not released: it answers 409 <c>hold_exists</c>.
    /// </remarks>
    public Task<ApiHoldsResponse1> AbandonHold(AbandonHoldRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/holds/{holdId}"),
            [new TemplateParam("holdId", request.HoldId)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Delete,
            EmptyBody.Instance,
            JsonResponse.Create<ApiHoldsResponse1>(),
            AbandonHoldError.Response,
            _auth.SessionAuth,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Authorize an approved hold order
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiHoldsApproveResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="ApproveHoldError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Session token of the hold's owner. Another bidder's hold answers 404, exactly like an
    /// unknown hold. When <c>name</c> is sent, the bidder is also registered in the room once the
    /// hold is authorized (idempotent).
    /// </remarks>
    public Task<ApiHoldsApproveResponse> ApproveHold(ApproveHoldRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/holds/{holdId}/approve"),
            [new TemplateParam("holdId", request.HoldId)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<ApiHoldsApproveResponse>(),
            ApproveHoldError.Response,
            _auth.SessionAuth,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Create a PayPal hold order
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="CreateHoldResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="CreateHoldError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Session token only. The bidder is the one in the token; a body that names a bidder is
    /// rejected. The ceiling is any whole number of cents from 100 up to the host cap (the
    /// room's <c>maxCeilingCents</c>, setting <c>GAVEL_MAX_CEILING_CENTS</c>); the auction's preset
    /// ceilings are suggestions only. A ceiling below 100 or above the cap answers 400
    /// <c>ceiling_out_of_range</c>. Hold failures are <c>{error, message}</c> with the codes in
    /// <c>HoldErrorCode</c>; authentication and state failures (<c>unauthorized</c>, <c>closed</c>) are
    /// <c>{code, message}</c>.
    /// <para>
    /// &lt;!-- FEAT-61 begin: raise a limit --&gt;
    /// A bidder who already has a HELD hold can raise the limit with this same route: send a
    /// <c>ceilingCents</c> above the held one and up to the server cap. The answer is a new order
    /// that replaces the old hold once it is approved; the old authorization is voided only
    /// after the room has switched to the new one, so the bidder always has a hold. The same
    /// request twice returns the same order. A ceiling that is not higher answers 409
    /// <c>hold_exists</c>; one above the cap answers 400 <c>ceiling_out_of_range</c>; once the lot is
    /// hammered the route answers 409 <c>closed</c>. Still held, not charged (sandbox only).
    /// </para>
    /// <para>
    /// Raising is bounded (FIX-110). A bidder gets at most 5 raises per auction (abandoned
    /// orders count too, at three times that); the sixth answers 409 <c>raise_limit_reached</c>.
    /// A raise must add at least $1 or 5 percent of the current limit, whichever is larger;
    /// a smaller one answers 422 <c>raise_too_small</c> before any PayPal call. The write rate
    /// limit of the session token applies as for every other write. If a raise was approved
    /// but the room never took it (a failed registration), asking for the same amount again
    /// returns the same order and the approve route registers it; one that stays unregistered
    /// for ten minutes is voided by the server, so the bidder is never held twice for long.
    /// &lt;!-- FEAT-61 end --&gt;
    /// </para>
    /// <para>
    /// &lt;!-- FIX-118 begin: refuse early --&gt;
    /// A ceiling under the lot reserve answers 400 <c>ceiling_out_of_range</c> (the message names the
    /// reserve), and a bidder whose limit was revoked answers 403 <c>ceiling_revoked</c>. Both are
    /// refused before any PayPal order exists.
    /// &lt;!-- FIX-118 end --&gt;
    /// </para>
    /// </remarks>
    public Task<CreateHoldResponse> CreateHold(CreateHoldRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/holds"),
            [],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<CreateHoldResponse>(),
            CreateHoldError.Response,
            _auth.SessionAuth,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Read your own hold
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiHoldsResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetHoldError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Session token of the hold's owner. Anyone else's hold answers 404.
    /// </remarks>
    public Task<ApiHoldsResponse> GetHold(GetHoldRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/holds/{holdId}"),
            [new TemplateParam("holdId", request.HoldId)],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<ApiHoldsResponse>(),
            GetHoldError.Response,
            _auth.SessionAuth,
            requestOptions,
            cancellationToken);
}
