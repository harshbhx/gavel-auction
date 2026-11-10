from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiAuctionsAuctioneerRevokeRequest(SdkBaseModel):
    jti: str
    """26 character id (Crockford base 32)."""


class ApiAuctionsAuctioneerRevokeRequestDict(TypedDict):
    jti: str
