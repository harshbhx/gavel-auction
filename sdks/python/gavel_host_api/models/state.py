from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .enums.auction_status import AuctionStatusOrStr


class State(SdkBaseModel):
    status: AuctionStatusOrStr
    """Lifecycle state of the auction, from SCHEDULED to DONE."""

    stopped: bool
    registration_closed: bool = Field(alias="registrationClosed")


class StateDict(TypedDict):
    status: AuctionStatusOrStr
    stopped: bool
    registration_closed: bool
