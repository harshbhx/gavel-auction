from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .room_event import RoomEvent, RoomEventDict


class ApiAuctionsEventsResponse(SdkBaseModel):
    events: list[RoomEvent]
    next: int


class ApiAuctionsEventsResponseDict(TypedDict):
    events: list[RoomEventDict]
    next: int
