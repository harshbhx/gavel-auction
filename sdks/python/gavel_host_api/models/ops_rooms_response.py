from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .room import Room, RoomDict


class OpsRoomsResponse(SdkBaseModel):
    rooms: list[Room]


class OpsRoomsResponseDict(TypedDict):
    rooms: list[RoomDict]
