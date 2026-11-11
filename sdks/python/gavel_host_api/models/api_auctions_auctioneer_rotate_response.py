from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiAuctionsAuctioneerRotateResponse(SdkBaseModel):
    auctioneer_link: str = Field(alias="auctioneerLink")


class ApiAuctionsAuctioneerRotateResponseDict(TypedDict):
    auctioneer_link: str
