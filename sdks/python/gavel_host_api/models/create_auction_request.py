from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .auction_config import AuctionConfig, AuctionConfigDict


class CreateAuctionRequest(SdkBaseModel):
    title: str = "Untitled auction"
    """Lot title shown to bidders."""

    config: AuctionConfig
    """Settings of one auction. Amounts are in cents, durations in milliseconds."""

    fundraiser_goal_cents: Optional[int] = Field(default=UNSET, alias="fundraiserGoalCents")
    """Optional goal; the projector shows a thermometer only when it is set."""


class CreateAuctionRequestDict(TypedDict):
    title: NotRequired[str]
    config: AuctionConfigDict
    fundraiser_goal_cents: NotRequired[int]
