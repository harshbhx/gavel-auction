from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, RFC3339DateTime, SdkBaseModel


class Key(SdkBaseModel):
    id: str
    label: str
    max_rooms: int = Field(alias="maxRooms")
    per_hour: int = Field(alias="perHour")
    rooms_live: int = Field(alias="roomsLive")
    revoked: bool
    expired: bool
    expires_at: Optional[RFC3339DateTime] = Field(default=UNSET, alias="expiresAt")


class KeyDict(TypedDict):
    id: str
    label: str
    max_rooms: int
    per_hour: int
    rooms_live: int
    revoked: bool
    expired: bool
    expires_at: NotRequired[RFC3339DateTime]
