from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class CreateAuctionResponse(SdkBaseModel):
    auction_id: str = Field(alias="auctionId")
    """26 character id (Crockford base 32)."""

    join_code: str = Field(alias="joinCode")
    """Six letters and digits without look-alikes (no 0, O, 1, I, L)."""

    lot_title: str = Field(alias="lotTitle")
    """Title of the lot, as given in the request."""

    auctioneer_link: str = Field(alias="auctioneerLink")
    """Link to the auctioneer console. The auctioneer token is in the URL fragment."""

    screen_link: str = Field(alias="screenLink")
    """Link to the projector screen. The screen token is in the URL fragment."""


class CreateAuctionResponseDict(TypedDict):
    auction_id: str
    join_code: str
    lot_title: str
    auctioneer_link: str
    screen_link: str
