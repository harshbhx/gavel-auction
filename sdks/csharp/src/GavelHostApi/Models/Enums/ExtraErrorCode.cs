using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// Codes sent by the judge, operator, export and lookup routes that are not in <c>ErrorCode</c>: 429 code_locked, judge_join_locked, judge_key_locked, judge_room_full, judge_rate_limited; 401 judge_key_invalid, judge_key_expired, judge_key_revoked; 410 judge_room_ended, judge_room_expired; 409 ledger_unverified, busy, no_settlement, not_in_review; 405 method_not_allowed; 400 bad_auction_id, bad_kind; 500 export_failed; 501 payments_unsupported. The list may grow: do not fail on an unknown value.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<ExtraErrorCode>))]
public sealed record ExtraErrorCode : OpenStringEnum<ExtraErrorCode>
{
    private ExtraErrorCode(string value) : base(value)
    {
    }

    public static readonly ExtraErrorCode CodeLocked = new("code_locked");

    public static readonly ExtraErrorCode JudgeJoinLocked = new("judge_join_locked");

    public static readonly ExtraErrorCode JudgeKeyInvalid = new("judge_key_invalid");

    public static readonly ExtraErrorCode JudgeKeyExpired = new("judge_key_expired");

    public static readonly ExtraErrorCode JudgeKeyRevoked = new("judge_key_revoked");

    public static readonly ExtraErrorCode JudgeKeyLocked = new("judge_key_locked");

    public static readonly ExtraErrorCode JudgeRoomFull = new("judge_room_full");

    public static readonly ExtraErrorCode JudgeRoomEnded = new("judge_room_ended");

    public static readonly ExtraErrorCode JudgeRoomExpired = new("judge_room_expired");

    public static readonly ExtraErrorCode JudgeRateLimited = new("judge_rate_limited");

    public static readonly ExtraErrorCode LedgerUnverified = new("ledger_unverified");

    public static readonly ExtraErrorCode MethodNotAllowed = new("method_not_allowed");

    public static readonly ExtraErrorCode ExportFailed = new("export_failed");

    public static readonly ExtraErrorCode BadAuctionId = new("bad_auction_id");

    public static readonly ExtraErrorCode BadKind = new("bad_kind");

    public static readonly ExtraErrorCode NoSettlement = new("no_settlement");

    public static readonly ExtraErrorCode NotInReview = new("not_in_review");

    public static readonly ExtraErrorCode Busy = new("busy");

    public static readonly ExtraErrorCode PaymentsUnsupported = new("payments_unsupported");

    public TResult Match<TResult>(Func<TResult> onCodeLocked,
        Func<TResult> onJudgeJoinLocked,
        Func<TResult> onJudgeKeyInvalid,
        Func<TResult> onJudgeKeyExpired,
        Func<TResult> onJudgeKeyRevoked,
        Func<TResult> onJudgeKeyLocked,
        Func<TResult> onJudgeRoomFull,
        Func<TResult> onJudgeRoomEnded,
        Func<TResult> onJudgeRoomExpired,
        Func<TResult> onJudgeRateLimited,
        Func<TResult> onLedgerUnverified,
        Func<TResult> onMethodNotAllowed,
        Func<TResult> onExportFailed,
        Func<TResult> onBadAuctionId,
        Func<TResult> onBadKind,
        Func<TResult> onNoSettlement,
        Func<TResult> onNotInReview,
        Func<TResult> onBusy,
        Func<TResult> onPaymentsUnsupported,
        Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == CodeLocked => onCodeLocked(),
            _ when this == JudgeJoinLocked => onJudgeJoinLocked(),
            _ when this == JudgeKeyInvalid => onJudgeKeyInvalid(),
            _ when this == JudgeKeyExpired => onJudgeKeyExpired(),
            _ when this == JudgeKeyRevoked => onJudgeKeyRevoked(),
            _ when this == JudgeKeyLocked => onJudgeKeyLocked(),
            _ when this == JudgeRoomFull => onJudgeRoomFull(),
            _ when this == JudgeRoomEnded => onJudgeRoomEnded(),
            _ when this == JudgeRoomExpired => onJudgeRoomExpired(),
            _ when this == JudgeRateLimited => onJudgeRateLimited(),
            _ when this == LedgerUnverified => onLedgerUnverified(),
            _ when this == MethodNotAllowed => onMethodNotAllowed(),
            _ when this == ExportFailed => onExportFailed(),
            _ when this == BadAuctionId => onBadAuctionId(),
            _ when this == BadKind => onBadKind(),
            _ when this == NoSettlement => onNoSettlement(),
            _ when this == NotInReview => onNotInReview(),
            _ when this == Busy => onBusy(),
            _ when this == PaymentsUnsupported => onPaymentsUnsupported(),
            _ => otherwise(Value)
        };

    public void Match(Action onCodeLocked,
        Action onJudgeJoinLocked,
        Action onJudgeKeyInvalid,
        Action onJudgeKeyExpired,
        Action onJudgeKeyRevoked,
        Action onJudgeKeyLocked,
        Action onJudgeRoomFull,
        Action onJudgeRoomEnded,
        Action onJudgeRoomExpired,
        Action onJudgeRateLimited,
        Action onLedgerUnverified,
        Action onMethodNotAllowed,
        Action onExportFailed,
        Action onBadAuctionId,
        Action onBadKind,
        Action onNoSettlement,
        Action onNotInReview,
        Action onBusy,
        Action onPaymentsUnsupported,
        Action<string> otherwise)
    {
        if (this == CodeLocked) onCodeLocked();
        else if (this == JudgeJoinLocked) onJudgeJoinLocked();
        else if (this == JudgeKeyInvalid) onJudgeKeyInvalid();
        else if (this == JudgeKeyExpired) onJudgeKeyExpired();
        else if (this == JudgeKeyRevoked) onJudgeKeyRevoked();
        else if (this == JudgeKeyLocked) onJudgeKeyLocked();
        else if (this == JudgeRoomFull) onJudgeRoomFull();
        else if (this == JudgeRoomEnded) onJudgeRoomEnded();
        else if (this == JudgeRoomExpired) onJudgeRoomExpired();
        else if (this == JudgeRateLimited) onJudgeRateLimited();
        else if (this == LedgerUnverified) onLedgerUnverified();
        else if (this == MethodNotAllowed) onMethodNotAllowed();
        else if (this == ExportFailed) onExportFailed();
        else if (this == BadAuctionId) onBadAuctionId();
        else if (this == BadKind) onBadKind();
        else if (this == NoSettlement) onNoSettlement();
        else if (this == NotInReview) onNotInReview();
        else if (this == Busy) onBusy();
        else if (this == PaymentsUnsupported) onPaymentsUnsupported();
        else otherwise(Value);
    }
}
