from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, RFC3339DateTime, SdkBaseModel


class ApiJudgeKeyResponse(SdkBaseModel):
    ok: Literal["True"] = "True"
    key_id: Optional[str] = Field(default=UNSET, alias="keyId")
    """The id of the key (``legacy`` for the shared host key). Never the secret."""

    rooms_max: int = Field(alias="roomsMax")
    """Most rooms this key may keep alive at once."""

    rooms_live: int = Field(alias="roomsLive")
    """Rooms of this key alive now."""

    expires_at: Optional[RFC3339DateTime] = Field(default=UNSET, alias="expiresAt")
    """When the key stops working. Absent for the legacy shared key."""


class ApiJudgeKeyResponseDict(TypedDict):
    ok: Literal["True"]
    key_id: NotRequired[str]
    rooms_max: int
    rooms_live: int
    expires_at: NotRequired[RFC3339DateTime]
