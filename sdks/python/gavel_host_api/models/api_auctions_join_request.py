from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiAuctionsJoinRequest(SdkBaseModel):
    invite: str
    """The invite token from an invite link."""


class ApiAuctionsJoinRequestDict(TypedDict):
    invite: str
