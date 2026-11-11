using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// Stable codes. HTTP status per code: 400 bad_message, unsupported_version, not_joined, bad_amount; 401 unauthorized; 403 forbidden, unregistered, ceiling_revoked; 404 not_found; 409 invite_used, closed, already_leading, lot_not_open, unconfirmed, already_bid, auction_paused, conflict, host_fenced; 422 below_increment, over_ceiling, below_reserve, not_higher_than_own_max, limit_exceeded (these arise on the socket, in <c>bid_rejected</c>); 429 rate_limited; 500 internal; 503 room_full, auction_full, room_cap, store_unavailable.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<ErrorCode>))]
public sealed record ErrorCode : OpenStringEnum<ErrorCode>
{
    private ErrorCode(string value) : base(value)
    {
    }

    public static readonly ErrorCode BadMessage = new("bad_message");

    public static readonly ErrorCode UnsupportedVersion = new("unsupported_version");

    public static readonly ErrorCode NotJoined = new("not_joined");

    public static readonly ErrorCode Unauthorized = new("unauthorized");

    public static readonly ErrorCode Forbidden = new("forbidden");

    public static readonly ErrorCode InviteUsed = new("invite_used");

    public static readonly ErrorCode RateLimited = new("rate_limited");

    public static readonly ErrorCode RoomFull = new("room_full");

    public static readonly ErrorCode AuctionFull = new("auction_full");

    public static readonly ErrorCode RoomCap = new("room_cap");

    public static readonly ErrorCode Unregistered = new("unregistered");

    public static readonly ErrorCode BelowIncrement = new("below_increment");

    public static readonly ErrorCode OverCeiling = new("over_ceiling");

    public static readonly ErrorCode BelowReserve = new("below_reserve");

    public static readonly ErrorCode Closed = new("closed");

    public static readonly ErrorCode AlreadyLeading = new("already_leading");

    public static readonly ErrorCode BadAmount = new("bad_amount");

    public static readonly ErrorCode LotNotOpen = new("lot_not_open");

    public static readonly ErrorCode CeilingRevoked = new("ceiling_revoked");

    public static readonly ErrorCode Unconfirmed = new("unconfirmed");

    public static readonly ErrorCode NotHigherThanOwnMax = new("not_higher_than_own_max");

    public static readonly ErrorCode AlreadyBid = new("already_bid");

    public static readonly ErrorCode LimitExceeded = new("limit_exceeded");

    public static readonly ErrorCode AuctionPaused = new("auction_paused");

    public static readonly ErrorCode StoreUnavailable = new("store_unavailable");

    public static readonly ErrorCode Conflict = new("conflict");

    public static readonly ErrorCode HostFenced = new("host_fenced");

    public static readonly ErrorCode NotFound = new("not_found");

    public static readonly ErrorCode Internal = new("internal");

    public TResult Match<TResult>(Func<TResult> onBadMessage,
        Func<TResult> onUnsupportedVersion,
        Func<TResult> onNotJoined,
        Func<TResult> onUnauthorized,
        Func<TResult> onForbidden,
        Func<TResult> onInviteUsed,
        Func<TResult> onRateLimited,
        Func<TResult> onRoomFull,
        Func<TResult> onAuctionFull,
        Func<TResult> onRoomCap,
        Func<TResult> onUnregistered,
        Func<TResult> onBelowIncrement,
        Func<TResult> onOverCeiling,
        Func<TResult> onBelowReserve,
        Func<TResult> onClosed,
        Func<TResult> onAlreadyLeading,
        Func<TResult> onBadAmount,
        Func<TResult> onLotNotOpen,
        Func<TResult> onCeilingRevoked,
        Func<TResult> onUnconfirmed,
        Func<TResult> onNotHigherThanOwnMax,
        Func<TResult> onAlreadyBid,
        Func<TResult> onLimitExceeded,
        Func<TResult> onAuctionPaused,
        Func<TResult> onStoreUnavailable,
        Func<TResult> onConflict,
        Func<TResult> onHostFenced,
        Func<TResult> onNotFound,
        Func<TResult> onInternal,
        Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == BadMessage => onBadMessage(),
            _ when this == UnsupportedVersion => onUnsupportedVersion(),
            _ when this == NotJoined => onNotJoined(),
            _ when this == Unauthorized => onUnauthorized(),
            _ when this == Forbidden => onForbidden(),
            _ when this == InviteUsed => onInviteUsed(),
            _ when this == RateLimited => onRateLimited(),
            _ when this == RoomFull => onRoomFull(),
            _ when this == AuctionFull => onAuctionFull(),
            _ when this == RoomCap => onRoomCap(),
            _ when this == Unregistered => onUnregistered(),
            _ when this == BelowIncrement => onBelowIncrement(),
            _ when this == OverCeiling => onOverCeiling(),
            _ when this == BelowReserve => onBelowReserve(),
            _ when this == Closed => onClosed(),
            _ when this == AlreadyLeading => onAlreadyLeading(),
            _ when this == BadAmount => onBadAmount(),
            _ when this == LotNotOpen => onLotNotOpen(),
            _ when this == CeilingRevoked => onCeilingRevoked(),
            _ when this == Unconfirmed => onUnconfirmed(),
            _ when this == NotHigherThanOwnMax => onNotHigherThanOwnMax(),
            _ when this == AlreadyBid => onAlreadyBid(),
            _ when this == LimitExceeded => onLimitExceeded(),
            _ when this == AuctionPaused => onAuctionPaused(),
            _ when this == StoreUnavailable => onStoreUnavailable(),
            _ when this == Conflict => onConflict(),
            _ when this == HostFenced => onHostFenced(),
            _ when this == NotFound => onNotFound(),
            _ when this == Internal => onInternal(),
            _ => otherwise(Value)
        };

    public void Match(Action onBadMessage,
        Action onUnsupportedVersion,
        Action onNotJoined,
        Action onUnauthorized,
        Action onForbidden,
        Action onInviteUsed,
        Action onRateLimited,
        Action onRoomFull,
        Action onAuctionFull,
        Action onRoomCap,
        Action onUnregistered,
        Action onBelowIncrement,
        Action onOverCeiling,
        Action onBelowReserve,
        Action onClosed,
        Action onAlreadyLeading,
        Action onBadAmount,
        Action onLotNotOpen,
        Action onCeilingRevoked,
        Action onUnconfirmed,
        Action onNotHigherThanOwnMax,
        Action onAlreadyBid,
        Action onLimitExceeded,
        Action onAuctionPaused,
        Action onStoreUnavailable,
        Action onConflict,
        Action onHostFenced,
        Action onNotFound,
        Action onInternal,
        Action<string> otherwise)
    {
        if (this == BadMessage) onBadMessage();
        else if (this == UnsupportedVersion) onUnsupportedVersion();
        else if (this == NotJoined) onNotJoined();
        else if (this == Unauthorized) onUnauthorized();
        else if (this == Forbidden) onForbidden();
        else if (this == InviteUsed) onInviteUsed();
        else if (this == RateLimited) onRateLimited();
        else if (this == RoomFull) onRoomFull();
        else if (this == AuctionFull) onAuctionFull();
        else if (this == RoomCap) onRoomCap();
        else if (this == Unregistered) onUnregistered();
        else if (this == BelowIncrement) onBelowIncrement();
        else if (this == OverCeiling) onOverCeiling();
        else if (this == BelowReserve) onBelowReserve();
        else if (this == Closed) onClosed();
        else if (this == AlreadyLeading) onAlreadyLeading();
        else if (this == BadAmount) onBadAmount();
        else if (this == LotNotOpen) onLotNotOpen();
        else if (this == CeilingRevoked) onCeilingRevoked();
        else if (this == Unconfirmed) onUnconfirmed();
        else if (this == NotHigherThanOwnMax) onNotHigherThanOwnMax();
        else if (this == AlreadyBid) onAlreadyBid();
        else if (this == LimitExceeded) onLimitExceeded();
        else if (this == AuctionPaused) onAuctionPaused();
        else if (this == StoreUnavailable) onStoreUnavailable();
        else if (this == Conflict) onConflict();
        else if (this == HostFenced) onHostFenced();
        else if (this == NotFound) onNotFound();
        else if (this == Internal) onInternal();
        else otherwise(Value);
    }
}
