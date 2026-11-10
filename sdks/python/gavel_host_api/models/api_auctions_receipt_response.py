from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .room_snapshot import RoomSnapshot, RoomSnapshotDict


class ApiAuctionsReceiptResponse(SdkBaseModel):
    bidder_id: str = Field(alias="bidderId")
    """26 character id (Crockford base 32)."""

    snapshot: RoomSnapshot
    """Room state for one viewer. Fields not listed here may appear; clients must ignore what they do not know. Private
    fields (``you``, ``yourHold``, ceilings) appear only for the bidder they belong to."""

    expires_at: int = Field(alias="expiresAt")
    """Milliseconds since the Unix epoch."""


class ApiAuctionsReceiptResponseDict(TypedDict):
    bidder_id: str
    snapshot: RoomSnapshotDict
    expires_at: int
