from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiHoldsRequest(SdkBaseModel):
    auction_id: str = Field(alias="auctionId")
    """26 character id (Crockford base 32)."""

    ceiling_cents: int = Field(alias="ceilingCents")
    """Highest amount this bidder allows, in cents."""


class ApiHoldsRequestDict(TypedDict):
    auction_id: str
    ceiling_cents: int
