from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class JudgeRoom(SdkBaseModel):
    auction_id: str = Field(alias="auctionId")
    """26 character id (Crockford base 32)."""

    join_code: str = Field(alias="joinCode")
    """Six letters and digits without look-alikes (no 0, O, 1, I, L)."""

    lot_title: str = Field(alias="lotTitle")
    """Title of the lot in the room."""

    auctioneer_token: str = Field(alias="auctioneerToken")
    """Auctioneer token for this room (12 hours). Send it as a bearer token."""

    screen_token: str = Field(alias="screenToken")
    """Screen token for this room (12 hours). Read only."""

    auctioneer_link: str = Field(alias="auctioneerLink")
    """Link to the auctioneer console with the token in the URL fragment."""

    screen_link: str = Field(alias="screenLink")
    """Link to the projector screen with the token in the URL fragment."""

    reviewer_token: Optional[str] = Field(default=UNSET, alias="reviewerToken")
    """Read-only reviewer token for this room (12 hours)."""

    reviewer_link: Optional[str] = Field(default=UNSET, alias="reviewerLink")
    """Audit page link with the reviewer token in the fragment."""

    expires_at: int = Field(alias="expiresAt")
    """Milliseconds since the Unix epoch."""

    bidding_ends_at: int = Field(alias="biddingEndsAt")
    """Milliseconds since the Unix epoch."""

    unlocked: Optional[bool] = UNSET
    """Present and true when the room was made with a valid judge key."""


class JudgeRoomDict(TypedDict):
    auction_id: str
    join_code: str
    lot_title: str
    auctioneer_token: str
    screen_token: str
    auctioneer_link: str
    screen_link: str
    reviewer_token: NotRequired[str]
    reviewer_link: NotRequired[str]
    expires_at: int
    bidding_ends_at: int
    unlocked: NotRequired[bool]
