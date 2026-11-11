from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .enums.auction_status import AuctionStatusOrStr


class AuctionPublic(SdkBaseModel):
    auction_id: str = Field(alias="auctionId")
    """26 character id (Crockford base 32)."""

    title: str
    """Lot title."""

    join_code: Optional[str] = Field(default=UNSET, alias="joinCode")
    """Six letters and digits without look-alikes (no 0, O, 1, I, L)."""

    judge_room: Optional[bool] = Field(default=UNSET, alias="judgeRoom")
    """Present and true for a judge room."""

    registration_closed: Optional[bool] = Field(default=UNSET, alias="registrationClosed")
    """Present and true once the room no longer takes registrations."""

    stopped: Optional[bool] = UNSET
    """Present and true once the auctioneer ended the lot."""

    status: AuctionStatusOrStr
    """Lifecycle state of the auction, from SCHEDULED to DONE."""

    end_ts: int = Field(alias="endTs")
    """Milliseconds since the Unix epoch."""

    bidder_count: int = Field(alias="bidderCount")
    """Number of registered bidders."""

    current_cents: Optional[int] = Field(default=UNSET, alias="currentCents")
    """Current price in cents; absent until the first accepted bid."""

    leader_paddle: Optional[int] = Field(default=UNSET, alias="leaderPaddle")
    """Paddle number of the current leader; absent when there is none."""


class AuctionPublicDict(TypedDict):
    auction_id: str
    title: str
    join_code: NotRequired[str]
    judge_room: NotRequired[bool]
    registration_closed: NotRequired[bool]
    stopped: NotRequired[bool]
    status: AuctionStatusOrStr
    end_ts: int
    bidder_count: int
    current_cents: NotRequired[int]
    leader_paddle: NotRequired[int]
