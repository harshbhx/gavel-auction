from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class Invite(SdkBaseModel):
    bidder_id: str = Field(alias="bidderId")
    """26 character id (Crockford base 32)."""

    expires_at: int = Field(alias="expiresAt")
    """Milliseconds since the Unix epoch."""

    link: str
    """Registration link with the invite token in the fragment."""


class InviteDict(TypedDict):
    bidder_id: str
    expires_at: int
    link: str
