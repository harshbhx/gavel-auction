using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using GavelHostApi.Core;
using GavelHostApi.Core.Authentication;
using GavelHostApi.Core.Exceptions;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Request;
using GavelHostApi.Core.Response;
using GavelHostApi.Errors;
using GavelHostApi.Models;
using GavelHostApi.Requests.JudgeRooms;

namespace GavelHostApi.Api;

/// <summary>
/// Key-less sandbox rooms for reviewers.
/// </summary>
public sealed class JudgeRooms
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    internal JudgeRooms(RawClient rawClient, Server server, AuthSchemes auth)
    {
        _rawClient = rawClient;
        _server = server;
        _auth = auth;
    }

    /// <summary>
    /// Check a judge key
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiJudgeKeyResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="CheckJudgeKeyError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Send the key in the <c>X-Judge-Key</c> header, with no body. Creates nothing; it lets a
    /// panel say whether the key works. A wrong key is 401 <c>judge_key_invalid</c> and counts
    /// toward a lockout of its own, separate from the room-code lockout (5 wrong keys, 15
    /// minutes, per source address: 429 <c>judge_key_locked</c>, even with the right key; joins are
    /// not affected). A blank key is 401 without a strike. When the host has no judge key set,
    /// every key answers as wrong. Answers 404 when judge rooms are off.
    /// </remarks>
    public Task<ApiJudgeKeyResponse> CheckJudgeKey(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/key"),
            [],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            EmptyBody.Instance,
            JsonResponse.Create<ApiJudgeKeyResponse>(),
            CheckJudgeKeyError.Response,
            _auth.JudgeKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Close a judge room now
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiJudgeRoomsCloseResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="CloseJudgeRoomError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// The creator ends a judge room before its normal end. Send the room's auctioneer token as a
    /// bearer token. A running lot is stopped first (an unsold hammer, as the console Stop button
    /// does), then the room is marked ended: new joins, simulated holds and bids are refused with
    /// 410. Nothing is deleted, so the ledger, the audit trail and the receipt stay readable.
    /// Safe to repeat: a room that is already closed answers 200 with <c>alreadyClosed: true</c>.
    /// </remarks>
    public Task<ApiJudgeRoomsCloseResponse> CloseJudgeRoom(CloseJudgeRoomRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/rooms/{id}/close"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            EmptyBody.Instance,
            JsonResponse.Create<ApiJudgeRoomsCloseResponse>(),
            CloseJudgeRoomError.Response,
            _auth.AuctioneerAuth,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Create a judge room
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="JudgeRoom"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="CreateJudgeRoomError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// No credential needed. Creates a short sandbox auction (10 minute lot, small ceilings)
    /// that ends after 30 minutes. The creator gets auctioneer, screen and reviewer tokens for
    /// that room only; no operator route opens. Answers 404 when judge rooms are off.
    /// <para>
    /// With the optional <c>X-Judge-Key</c> header the request is judged by the key alone: the
    /// public limits do not apply, the room does not use a public slot, and a wrong key is
    /// 401 <c>judge_key_invalid</c> (it never falls back to the public path). An empty header is
    /// 401 <c>judge_key_invalid</c> without a strike. Wrong keys have a lockout of their own, separate from the room-code lockout:
    /// 5 wrong keys, 15 minutes, per source address (429 <c>judge_key_locked</c>); it has no effect
    /// on joins. The response then carries <c>unlocked: true</c>.
    /// </para>
    /// </remarks>
    public Task<JudgeRoom> CreateJudgeRoom(CreateJudgeRoomRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/rooms"),
            [],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<JudgeRoom>(),
            CreateJudgeRoomError.Response,
            _auth.JudgeKey.OrAnonymous(),
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Place a simulated hold in a judge room
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiJudgeRoomsSimHoldResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="CreateSimulatedHoldError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Session token of a bidder in that judge room. Writes an already-authorized hold with
    /// no PayPal call and puts the bidder in the room, so the whole path can be tried without
    /// a PayPal login. The ceiling is any whole number of cents from 100 up to the room's
    /// ceiling cap (the top preset); the presets are only quick picks, and a value outside the
    /// range is 400 <c>bad_message</c>. A ceiling under the lot reserve is also 400 <c>bad_message</c>
    /// (the message names the reserve), and a bidder whose limit was revoked is 403
    /// <c>ceiling_revoked</c>; both are refused before any hold is written. Any other auction
    /// answers 404. Answers 404 when simulated holds are off. A larger ceiling for a bidder who
    /// already has a hold is a raise, bounded like <c>POST /api/holds</c>: at most 5 raises per
    /// bidder (409 <c>raise_limit_reached</c>) and each at least $1 or 5 percent more than the
    /// current limit (422 <c>raise_too_small</c>).
    /// </remarks>
    public Task<ApiJudgeRoomsSimHoldResponse> CreateSimulatedHold(CreateSimulatedHoldRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/rooms/{id}/sim-hold"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<ApiJudgeRoomsSimHoldResponse>(),
            CreateSimulatedHoldError.Response,
            _auth.SessionAuth,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// What judge rooms this host offers
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiJudgeCapabilitiesResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetJudgeCapabilitiesError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// No credential. Tells a client whether it can create a room right now.
    /// </remarks>
    public Task<ApiJudgeCapabilitiesResponse> GetJudgeCapabilities(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/capabilities"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<ApiJudgeCapabilitiesResponse>(),
            GetJudgeCapabilitiesError.Response,
            AuthScheme.None,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Verifiable ledger of a judge room
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ReplayBundle"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetJudgeRoomLedgerError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Reviewer or auctioneer token of that room. The room's hash-chained ledger as a replay
    /// bundle with the private fields removed. The private chain and the public chain are
    /// both checked before anything is sent: a broken chain answers 409 <c>ledger_unverified</c>
    /// instead of a bundle that looks fine. 404 before the ledger has any entry, for an id
    /// that is not a judge room, or when judge rooms are off.
    /// </remarks>
    public Task<ReplayBundle> GetJudgeRoomLedger(GetJudgeRoomLedgerRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/rooms/{id}/ledger"),
            [new TemplateParam("id", request.Id)],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<ReplayBundle>(),
            GetJudgeRoomLedgerError.Response,
            AuthScheme.Any(_auth.ReviewerAuth, _auth.AuctioneerAuth),
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Join a judge room with its code
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiJudgeJoinResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="JoinJudgeRoomError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// No credential. A bidder joins a judge room with its 6 character code and a display
    /// name and gets a session token. Only judge rooms: the code of any other auction answers
    /// exactly like an unknown code (404). Wrong codes are counted; 5 wrong codes lock a
    /// source address out for 15 minutes (429 <c>judge_join_locked</c>). At most 20 bidders join
    /// one room (429 <c>judge_room_full</c>). An ended room answers 410.
    /// </remarks>
    public Task<ApiJudgeJoinResponse> JoinJudgeRoom(JoinJudgeRoomRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/join"),
            [],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<ApiJudgeJoinResponse>(),
            JoinJudgeRoomError.Response,
            AuthScheme.None,
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
    /// Place a bid in a judge room over HTTP
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiJudgeRoomsBidsResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="PlaceJudgeBidError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Bid with plain HTTP, for curl and generated clients that cannot open the WebSocket (the
    /// socket needs a browser <c>Origin</c>; this route does not, and the socket rules are
    /// unchanged). Send the session token from <c>POST /api/judge/join</c> as a bearer token, after
    /// the bidder has a hold (<c>POST /api/judge/rooms/{id}/sim-hold</c>). The bid takes the same
    /// path as a socket bid: the per-bidder bid limit, the registered check and the auction
    /// engine all apply. <c>amount</c> is whole cents. <c>mid</c> is optional; send the same <c>mid</c> again
    /// to retry safely, the room answers with the original result and records nothing twice.
    /// <para>
    /// A bid the engine refuses (too low, over your ceiling, lot closed) is 409 with
    /// <c>accepted: false</c> and a <c>reason</c>. Sending a <c>mid</c> again with a different <c>amount</c> is 409
    /// <c>conflict</c> (<c>{error, code, message}</c>). Bids sent too fast are 429 <c>rate_limited</c> with
    /// <c>Retry-After</c>. When the room cannot take the bid (<c>auction_full</c>, <c>store_unavailable</c>,
    /// <c>room_full</c>) the answer is 503. Only session tokens work here, and only for judge
    /// rooms: any other auction answers 404. A judge key is not needed on this route.
    /// </para>
    /// </remarks>
    public Task<ApiJudgeRoomsBidsResponse> PlaceJudgeBid(PlaceJudgeBidRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/rooms/{id}/bids"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<ApiJudgeRoomsBidsResponse>(),
            PlaceJudgeBidError.Response,
            _auth.SessionAuth,
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
