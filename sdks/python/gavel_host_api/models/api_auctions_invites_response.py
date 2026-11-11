from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .invite import Invite, InviteDict


class ApiAuctionsInvitesResponse(SdkBaseModel):
    invites: list[Invite]


class ApiAuctionsInvitesResponseDict(TypedDict):
    invites: list[InviteDict]
