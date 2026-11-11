from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class JoinResponse(SdkBaseModel):
    session_token: str = Field(alias="sessionToken")
    """Session token for ``Authorization`` and for the WebSocket ``join`` frame."""

    bidder_id: str = Field(alias="bidderId")
    """26 character id (Crockford base 32)."""

    ws_url: str = Field(alias="wsUrl")
    """WebSocket address, ``wss://<host>/ws``."""


class JoinResponseDict(TypedDict):
    session_token: str
    bidder_id: str
    ws_url: str
