from __future__ import annotations

from typing import Any

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .auction_config import AuctionConfig, AuctionConfigDict
from .enums.auction_status import AuctionStatusOrStr
from .fundraiser import Fundraiser, FundraiserDict
from .hammer import Hammer, HammerDict
from .roster import Roster, RosterDict


class RoomSnapshot(SdkBaseModel):
    """Room state for one viewer. Fields not listed here may appear; clients must ignore what they do not know. Private
    fields (``you``, ``yourHold``, ceilings) appear only for the bidder they belong to."""

    auction_id: str = Field(alias="auctionId")
    """26 character id (Crockford base 32)."""

    config: AuctionConfig
    """Settings of one auction. Amounts are in cents, durations in milliseconds."""

    status: AuctionStatusOrStr
    """Lifecycle state of the auction, from SCHEDULED to DONE."""

    price: int | None
    """Current price in cents, or null before the first accepted bid."""

    leader_id: str | None = Field(alias="leaderId")
    """Bidder id of the current leader, or null when there is none."""

    end_ts: int = Field(alias="endTs")
    """Milliseconds since the Unix epoch."""

    min_next: int = Field(alias="minNext")
    """Money in integer US cents. There are no decimals anywhere in the API."""

    paused: Optional[bool] = UNSET
    """True while the auctioneer has paused the lot."""

    remaining_ms: Optional[int] = Field(default=UNSET, alias="remainingMs")
    """Milliseconds left until the lot ends."""

    stopped: Optional[bool] = UNSET
    """True once the auctioneer used the Stop button."""

    registration_closed: Optional[bool] = Field(default=UNSET, alias="registrationClosed")
    """True once the room no longer takes registrations."""

    hammer: Optional[Hammer] = UNSET
    """Result of the lot, present once it was hammered."""

    lot_title: Optional[str] = Field(default=UNSET, alias="lotTitle")
    """Title of the lot."""

    join_code: Optional[str] = Field(default=UNSET, alias="joinCode")
    """Six letters and digits without look-alikes (no 0, O, 1, I, L)."""

    fundraiser: Optional[Fundraiser] = UNSET
    """Fundraiser goal, present only when one was set."""

    roster: list[Roster]
    """Registered bidders, at most 200."""

    recent_audit: list[Any] = Field(alias="recentAudit")
    """The most recent audit rows visible to this viewer, at most 50."""

    settlement: Optional[Any] = UNSET
    """Settlement progress, present once the lot ended."""

    you: Optional[Any] = UNSET
    """The viewing bidder's own ceiling and high bid. Bidder sessions only."""


class RoomSnapshotDict(TypedDict):
    auction_id: str
    config: AuctionConfigDict
    status: AuctionStatusOrStr
    price: int | None
    leader_id: str | None
    end_ts: int
    min_next: int
    paused: NotRequired[bool]
    remaining_ms: NotRequired[int]
    stopped: NotRequired[bool]
    registration_closed: NotRequired[bool]
    hammer: NotRequired[HammerDict]
    lot_title: NotRequired[str]
    join_code: NotRequired[str]
    fundraiser: NotRequired[FundraiserDict]
    roster: list[RosterDict]
    recent_audit: list[Any]
    settlement: NotRequired[Any]
    you: NotRequired[Any]
