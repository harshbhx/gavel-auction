from __future__ import annotations

from typing import Literal

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .enums.error_code import ErrorCodeOrStr


class ApiJudgeRoomsBidsResponse2(SdkBaseModel):
    accepted: Literal["False"] = "False"
    error: Literal["bid_rejected"] = "bid_rejected"
    mid: str
    reason: ErrorCodeOrStr
    """Stable codes. HTTP status per code: 400 bad_message, unsupported_version, not_joined, bad_amount; 401
    unauthorized; 403 forbidden, unregistered, ceiling_revoked; 404 not_found; 409 invite_used, closed, already_leading,
    lot_not_open, unconfirmed, already_bid, auction_paused, conflict, host_fenced; 422 below_increment, over_ceiling,
    below_reserve, not_higher_than_own_max, limit_exceeded (these arise on the socket, in ``bid_rejected``); 429
    rate_limited; 500 internal; 503 room_full, auction_full, room_cap, store_unavailable."""

    retryable: bool


class ApiJudgeRoomsBidsResponse2Dict(TypedDict):
    accepted: Literal["False"]
    error: Literal["bid_rejected"]
    mid: str
    reason: ErrorCodeOrStr
    retryable: bool
