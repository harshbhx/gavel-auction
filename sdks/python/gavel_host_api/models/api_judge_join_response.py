from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiJudgeJoinResponse(SdkBaseModel):
    auction_id: str = Field(alias="auctionId")
    """26 character id (Crockford base 32)."""

    session_token: str = Field(alias="sessionToken")
    bidder_id: str = Field(alias="bidderId")
    """26 character id (Crockford base 32)."""

    display_name: str = Field(alias="displayName")
    ws_url: str = Field(alias="wsUrl")


class ApiJudgeJoinResponseDict(TypedDict):
    auction_id: str
    session_token: str
    bidder_id: str
    display_name: str
    ws_url: str
