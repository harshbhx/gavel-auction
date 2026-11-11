from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class Room(SdkBaseModel):
    auction_id: str = Field(alias="auctionId")
    seq: int
    status: str
    connections: int
    mailbox_depth: int = Field(alias="mailboxDepth")


class RoomDict(TypedDict):
    auction_id: str
    seq: int
    status: str
    connections: int
    mailbox_depth: int
