from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class Saga(SdkBaseModel):
    auction_id: str = Field(alias="auctionId")
    lot_id: str = Field(alias="lotId")
    state: str


class SagaDict(TypedDict):
    auction_id: str
    lot_id: str
    state: str
