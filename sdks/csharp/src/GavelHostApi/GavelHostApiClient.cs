using System.Net.Http;
using GavelHostApi.Api;
using GavelHostApi.Core;
using GavelHostApi.Core.Configuration;
using GavelHostApi.Core.Logging;
using GavelHostApi.Core.Models;

namespace GavelHostApi;

/// <summary>
/// GAVEL is an auction where every bid is backed by a PayPal hold and only the winner pays.
/// This document describes the public HTTP API of the host (<c>packages/server</c>). It is written
/// by hand from the route files in <c>packages/server/src/http/</c> and the schemas in
/// <c>packages/shared/src/</c>, and a test (<c>scripts/tests/openapi-routes.test.mjs</c>) fails when a
/// route in the code is missing here or a path here has no route in the code.
/// <para>
/// <b>Sandbox only.</b> The host talks to the PayPal sandbox. No real money moves.
/// </para>
/// <para>
/// ## Authentication
/// </para>
/// <para>
/// Several kinds of credential exist. None of them is a real value in this document.
/// </para>
/// <para>
/// | Credential | How it is sent | Who gets it |
/// | --- | --- | --- |
/// | Operator key | header <c>X-Admin-Key</c> | the operator who runs the host (environment setting <c>ADMIN_KEY</c>) |
/// | Auctioneer token | <c>Authorization: Bearer &lt;token&gt;</c>, valid 12 hours | returned as a link when an auction is created or rotated |
/// | Screen token | <c>Authorization: Bearer &lt;token&gt;</c>, valid 12 hours | returned as a link when an auction is created |
/// | Session (bidder) token | <c>Authorization: Bearer &lt;token&gt;</c>, valid 4 hours | returned by the join routes |
/// | Receipt token | <c>Authorization: Bearer &lt;token&gt;</c>, valid 4 hours | returned by the receipt-link route |
/// | Reviewer token | <c>Authorization: Bearer &lt;token&gt;</c>, valid 12 hours | returned as <c>reviewerToken</c> and <c>reviewerLink</c> when a judge room is created; read only, a screen's view plus the room ledger |
/// | Judge key | header <c>X-Judge-Key</c> | a limited key for judges, <c>gvl_judge_&lt;id&gt;_&lt;secret&gt;</c> (per-judge entries in <c>JUDGE_KEYS</c>, or the shared <c>JUDGE_KEY</c>; never the operator key); optional, only on the judge-room create and key-check routes |
/// | Invite token | field <c>invite</c> in the body of the join route, valid 24 hours, single use | minted by the auctioneer |
/// </para>
/// <para>
/// Every token is bound to one auction (its <c>aud</c>) and to one kind. A token of the wrong kind
/// or for another auction answers 401. A token whose role may not do the thing answers 403.
/// Tokens are opaque strings: do not parse them. A reviewer token can read the snapshot, the
/// event log and the room ledger of its own judge room, and nothing else. Judge rooms need no
/// key; the judge key only lifts the public limits when a host has one set (see
/// <c>POST /api/judge/key</c>). The judge key is sent only in the <c>X-Judge-Key</c> header, never in a
/// URL or body.
/// </para>
/// <para>
/// Links the host returns carry the token in the URL fragment (<c>#token=</c>) so it never reaches
/// a server log.
/// </para>
/// <para>
/// ## Errors
/// </para>
/// <para>
/// Every error is JSON. The fields vary by route family because the host grew in layers.
/// One rule is true everywhere: read <c>code ?? error</c> for the stable code. The fields each
/// family sends:
/// </para>
/// <para>
/// | Family | Fields | Notes |
/// | --- | --- | --- |
/// | Core <c>/api/auctions/**</c> (create, token routes, control, kill, invites, join, read, receipts) | <c>code</c>, <c>message</c>, optional <c>detail</c> | Exceptions: the 429 of the code lookup <c>GET /api/auctions/{id}</c> (<c>rate_limited</c>, <c>code_locked</c>) and of <c>POST /api/auctions/{id}/join</c> (<c>rate_limited</c>) send <c>error</c> and <c>message</c>, no <c>code</c>. |
/// | Hold routes <c>/api/holds/**</c> | hold failures: <c>error</c>, <c>message</c>; auth, body and state failures (<c>unauthorized</c>, <c>bad_message</c>, <c>closed</c>): <c>code</c>, <c>message</c> | The hold codes are in <c>HoldErrorCode</c>. |
/// | Judge routes <c>/api/judge/**</c> | <c>error</c>, <c>code</c> and <c>message</c> | Same value in <c>error</c> and <c>code</c> on the judge-specific failures; errors raised by shared code (for example <c>bad_message</c>, <c>forbidden</c>) carry <c>code</c> and <c>message</c> only. |
/// | Operator routes (<c>/admin/<b></c>, <c>/metrics</c>, <c>/ops/</b></c>) and the export route | <c>error</c> only | No <c>message</c>, no <c>code</c>. |
/// | Host-level answers before any route runs: the per-address limiter 429, the unknown-route 404, the catch-all 500 | <c>error</c> only (<c>rate_limited</c>, <c>not_found</c>, <c>internal</c>) | Also on <c>/api/**</c> paths. The 429 carries <c>Retry-After</c>. |
/// </para>
/// <para>
/// <c>message</c> is therefore present on every error of the core, hold and judge routes, but not
/// on the operator routes and the host-level answers above. <c>detail</c> is optional extra text,
/// for example the field paths that failed validation.
/// </para>
/// <para>
/// <c>ErrorCode</c> lists the codes of the realtime protocol and the core routes. Some routes
/// send further codes that are not in it (<c>ExtraErrorCode</c>, the hold codes in
/// <c>HoldErrorCode</c>); treat <c>code</c> and <c>error</c> as plain strings and do not fail on a value you
/// do not know. See the <c>Error</c> schema.
/// </para>
/// <para>
/// Messages never contain tokens or stack traces (they are scrubbed on the server).
/// </para>
/// <para>
/// Status codes in use: 400 bad request, 401 missing or bad credential, 403 not allowed,
/// 404 not found, 409 conflict, 410 gone (a judge room that ended), 413 body over 64 KiB,
/// 415 body is not <c>application/json</c>, 429 rate limited, 500 internal, 503 unavailable.
/// </para>
/// <para>
/// ## Rate limits
/// </para>
/// <para>
/// Limits are published as the vendor extension <c>x-rate-limit</c> on the operations they apply
/// to, and as <c>x-rate-limits</c> at the top of this document for the host-wide defaults. A 429
/// always carries a <c>Retry-After</c> header in seconds. The numbers are the defaults and can be
/// changed by the operator through environment settings.
/// </para>
/// <para>
/// ## Request ids and CORS
/// </para>
/// <para>
/// Send <c>X-Request-Id</c> (1 to 64 characters of <c>A-Z a-z 0-9 _ -</c>) to correlate a request;
/// every response carries <c>X-Request-Id</c>, and the server mints one when you send none or an
/// invalid one. Browsers are allowed only from the origins the operator lists; other origins
/// get no CORS headers. Allowed request headers are <c>Authorization</c>, <c>Content-Type</c>,
/// <c>X-Request-Id</c>, <c>X-Admin-Key</c> and <c>X-Judge-Key</c>; readable response headers are
/// <c>X-Request-Id</c> and <c>Retry-After</c> (also on the early 429, 404 and 500 answers, for the
/// allowed origins and for the docs origin on its routes).
/// </para>
/// <para>
/// A cross-origin write (POST or DELETE with an <c>Origin</c> header) from an origin that is not
/// allowed is refused with <c>403 {"code":"forbidden","message":"origin not allowed"}</c> before
/// any handler runs; see the <c>OriginForbidden</c> response. Callers that send no <c>Origin</c>
/// (curl, server to server) are not affected. The docs site origin
/// (<c>https://docs.gavel.dualmindlab.tech</c>, setting <c>JUDGE_DOCS_ORIGINS</c>) may call only these
/// routes from a browser: <c>/api/judge/capabilities</c>, <c>/api/judge/key</c>, <c>/api/judge/join</c>,
/// <c>/api/judge/rooms</c>, <c>/api/judge/rooms/{id}/sim-hold</c>, <c>/api/judge/rooms/{id}/bids</c>,
/// <c>/api/judge/rooms/{id}/ledger</c>, <c>/api/auctions/{id}/control</c>,
/// <c>/api/auctions/{id}/receipt-link</c> and <c>/api/auctions/{id}/receipt</c>. Every other route
/// (the snapshot, the event log, <c>GET /api/auctions/{id}</c>, kill, invites, holds and all
/// operator routes) gets no CORS headers for the docs origin, and a write from it is 403.
/// </para>
/// <para>
/// ## Not in this document
/// </para>
/// <para>
/// - <b>WebSocket protocol.</b> Live bidding runs on <c>wss://&lt;host&gt;/ws</c> and OpenAPI cannot model
///   it. See the section "WebSocket protocol" below and
///   https://github.com/harshbhx/gavel-auction/blob/main/docs/API.md.
/// - <b>Method on the health routes.</b> <c>/healthz</c>, <c>/readyz</c> and <c>/version</c> answer on any HTTP
///   method (the host matches them by path only), so a <c>POST</c> to them also returns 200. The
///   document lists <c>GET</c>, the method to use. Every other operator route answers 405 with an
///   <c>Allow</c> header for a wrong method.
/// - <b>PayPal webhook.</b> <c>POST /webhooks/paypal</c> is called by PayPal only, is verified by
///   PayPal's signature, and is not part of the client API.
/// - <b>Demo routes.</b> <c>/api/demo/reset</c>, <c>/api/demo/seed</c> and <c>/api/demo/rooms</c> exist only
///   when the host runs with <c>DEMO_MODE=1</c> on the fake payments adapter and never in a
///   production-like configuration. They answer 404 otherwise.
/// </para>
/// <para>
/// ## WebSocket protocol
/// </para>
/// <para>
/// Endpoint: <c>wss://&lt;host&gt;/ws</c>. The browser must send an <c>Origin</c> that the operator allows;
/// a request without one is refused. A plain HTTP request to <c>/ws</c> answers 426. Frames are
/// JSON text, at most 16 KiB from the client (a larger or binary frame closes the socket) and
/// at most 256 KiB from the server. Every frame is <c>{"v":1,"t":"&lt;type&gt;", ...}</c>; an unknown
/// type, extra field or wrong version is <c>bad_message</c> (a <c>join</c> with another version is
/// <c>unsupported_version</c>).
/// </para>
/// <para>
/// Client to server, the only three types accepted:
/// </para>
/// <para>
/// | <c>t</c> | Purpose | Fields |
/// | --- | --- | --- |
/// | <c>join</c> | First frame. Opens the session. | <c>token</c> (session, auctioneer, screen or reviewer token; a reviewer joins with a screen's view), <c>auctionId</c>, optional <c>lastSeq</c> (resume after this sequence number), optional <c>client</c> ({name, version}) |
/// | <c>bid</c> | Place a bid. | <c>mid</c> (id you mint, for idempotency), <c>amount</c> (cents), <c>source</c> (<c>voice</c>, <c>qr</c> or <c>manual</c>), optional <c>bidderId</c>, <c>transcript</c>, <c>confidence</c>, <c>ambiguous</c>, <c>audioTsMs</c>, <c>audioEndMs</c>, <c>clientTs</c> |
/// | <c>confirm_response</c> | Answer a spoken-bid confirmation. | <c>confirmId</c>, <c>accept</c> |
/// </para>
/// <para>
/// Server to client:
/// </para>
/// <para>
/// | <c>t</c> | Purpose |
/// | --- | --- |
/// | <c>registered</c> | Your bidder id, paddle and role after <c>join</c>. |
/// | <c>state</c> | Full room snapshot (same shape as <c>RoomSnapshot</c>), sent after <c>join</c> and when resyncing. |
/// | <c>price</c> | New price, leader, end time and next minimum. |
/// | <c>bid_accepted</c> / <c>bid_rejected</c> | Result of your <c>bid</c> (match on <c>mid</c>); a rejection carries <c>reason</c> (an <c>ErrorCode</c>), <c>retryable</c> and optional <c>retryAfterMs</c>. |
/// | <c>confirm_request</c> | A spoken bid needs the bidder's yes or no. |
/// | <c>hammer</c> | Lot ended: winner, price, ranking. |
/// | <c>settlement_update</c> | Settlement progress (holds captured or released). |
/// | <c>audit_event</c> | One audit row, filtered by role. |
/// | <c>error</c> | <c>code</c>, <c>message</c>, optional <c>retryAfterMs</c>; may close the socket. |
/// </para>
/// <para>
/// Socket close codes follow <c>ErrorCode</c>: 1008 bad message, 4002 unsupported version,
/// 4003 not joined, 4401 unauthorized, 4009 room or auction full, 4010 conflict or host
/// fenced, 4429 rate limited (frame flood), 1011 internal. Limits: bids 3 per second (burst
/// 5), frames 20 per second (burst 40), at most 20 open sockets per source address.
/// </para>
/// <para>
/// The full protocol, with every field, is in the repository file
/// <c>docs/specs/realtime/SPEC-realtime.md</c> and on the docs site page "WebSocket protocol".
/// </para>
/// </summary>
public sealed class GavelHostApiClient
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    public GavelHostApiClient(HttpClient httpClient, GavelHostApiClientOptions options)
    {
        _server = new Server(options.Environment, options.Server);
        var queryParameterFactory = new QueryParameterFactory([]);
        var templateParamsFactory = new TemplateParamsFactory([]);
        var urlFactory = new UriFactory(queryParameterFactory, templateParamsFactory);
        var httpStatusPolicy = new HttpStatusPolicy([]);
        var headersFactory = new HeadersFactory([
            new HeaderParam("User-Agent", "GavelHostApiClient/0.0.5 CSharp"),
            new HeaderParam("X-APIMatic-Lang", "CSharp"),
            new HeaderParam("X-APIMatic-Package-Version", "0.0.5"),
            new HeaderParam("X-APIMatic-Gen-Version", "4.0.0"),
            new HeaderParam("X-APIMatic-OS", RuntimeEnvironment.Os),
            new HeaderParam("X-APIMatic-Runtime", RuntimeEnvironment.Runtime),
        ]);
        var resiliencePipelineFactory = new ResiliencePipelineFactory(options.Retry, options.TimeProvider);
        var httpLogger = new HttpLogger(
            options.Logging.WithEnvironmentDefaults("GAVEL_HOST_API_LOG"),
            "GavelHostApiClient",
            options.TimeProvider);
        var responseContexts = new ResponseContextFactory(options.TimeProvider, options.StreamReadTimeout);
        _rawClient =
            new RawClient(
                httpClient,
                urlFactory,
                httpStatusPolicy,
                headersFactory,
                resiliencePipelineFactory,
                httpLogger,
                options.Hooks,
                responseContexts);
        _auth = new AuthSchemes(options);
    }

    /// <summary>
    /// Create an auction and read its public facts.
    /// </summary>
    public Auctions Auctions => field ??= new Auctions(_rawClient, _server, _auth);

    /// <summary>
    /// Invites, join and session tokens.
    /// </summary>
    public BiddingAccess BiddingAccess => field ??= new BiddingAccess(_rawClient, _server, _auth);

    /// <summary>
    /// Auctioneer controls and the Stop button.
    /// </summary>
    public Control Control => field ??= new Control(_rawClient, _server, _auth);

    /// <summary>
    /// Event log and ledger export.
    /// </summary>
    public Export Export => field ??= new Export(_rawClient, _server, _auth);

    /// <summary>
    /// Liveness, readiness and build version.
    /// </summary>
    public Health Health => field ??= new Health(_rawClient, _server);

    /// <summary>
    /// PayPal hold orders for a bidder session.
    /// </summary>
    public Holds Holds => field ??= new Holds(_rawClient, _server, _auth);

    /// <summary>
    /// Key-less sandbox rooms for reviewers.
    /// </summary>
    public JudgeRooms JudgeRooms => field ??= new JudgeRooms(_rawClient, _server, _auth);

    /// <summary>
    /// Routes that need the operator key.
    /// </summary>
    public Operator Operator => field ??= new Operator(_rawClient, _server, _auth);

    /// <summary>
    /// Snapshot and event log, filtered by the caller's role.
    /// </summary>
    public Read Read => field ??= new Read(_rawClient, _server, _auth);

    /// <summary>
    /// Shareable read-only receipts.
    /// </summary>
    public Receipts Receipts => field ??= new Receipts(_rawClient, _server, _auth);
}
