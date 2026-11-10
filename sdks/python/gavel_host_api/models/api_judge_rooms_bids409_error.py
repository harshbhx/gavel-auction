from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .enums.error4 import Error4OrStr
from .enums.error_code import ErrorCodeOrStr


class ApiJudgeRoomsBids409Error(SdkBaseModel):
    accepted: Optional[bool] = UNSET
    error: Optional[Error4OrStr] = UNSET
    """Stable code (hold, judge and operator routes)."""

    mid: Optional[str] = UNSET
    reason: Optional[ErrorCodeOrStr] = UNSET
    """Stable codes. HTTP status per code: 400 bad_message, unsupported_version, not_joined, bad_amount; 401
    unauthorized; 403 forbidden, unregistered, ceiling_revoked; 404 not_found; 409 invite_used, closed, already_leading,
    lot_not_open, unconfirmed, already_bid, auction_paused, conflict, host_fenced; 422 below_increment, over_ceiling,
    below_reserve, not_higher_than_own_max, limit_exceeded (these arise on the socket, in ``bid_rejected``); 429
    rate_limited; 500 internal; 503 room_full, auction_full, room_cap, store_unavailable."""

    retryable: Optional[bool] = UNSET
    code: Optional[str] = UNSET
    """Stable code (core and judge routes). One of ErrorCode."""

    message: Optional[str] = UNSET
    """Text for a person. Never contains a token or a stack trace."""

    detail: Optional[str] = UNSET
    """Optional extra text, for example the failing field path and reason."""


class ApiJudgeRoomsBids409ErrorDict(TypedDict):
    accepted: NotRequired[bool]
    error: NotRequired[Error4OrStr]
    mid: NotRequired[str]
    reason: NotRequired[ErrorCodeOrStr]
    retryable: NotRequired[bool]
    code: NotRequired[str]
    message: NotRequired[str]
    detail: NotRequired[str]
