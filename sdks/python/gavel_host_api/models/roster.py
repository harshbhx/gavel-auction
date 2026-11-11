from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .enums.hold import HoldOrStr


class Roster(SdkBaseModel):
    bidder_id: str = Field(alias="bidderId")
    """26 character id (Crockford base 32)."""

    paddle: int
    """Paddle number of the bidder."""

    name: str
    """Display name of the bidder."""

    hold: HoldOrStr
    """HELD when the bidder has a hold, otherwise NONE."""


class RosterDict(TypedDict):
    bidder_id: str
    paddle: int
    name: str
    hold: HoldOrStr
