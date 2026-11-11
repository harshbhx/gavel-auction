from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiAuctionsReceiptLinkResponse(SdkBaseModel):
    token: str
    link: str
    expires_at: int = Field(alias="expiresAt")
    """Milliseconds since the Unix epoch."""


class ApiAuctionsReceiptLinkResponseDict(TypedDict):
    token: str
    link: str
    expires_at: int
