from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import SdkBaseModel


class ApiAuctionsInvitesRequest(SdkBaseModel):
    count: int = 1


class ApiAuctionsInvitesRequestDict(TypedDict):
    count: NotRequired[int]
