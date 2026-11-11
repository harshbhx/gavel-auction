from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class ApiJudgeCapabilitiesResponse(SdkBaseModel):
    judge_rooms: bool = Field(alias="judgeRooms")
    """Judge rooms are switched on for this host."""

    accepting: bool
    """Rooms are on, not paused and under the live-room cap."""

    sim_holds: bool = Field(alias="simHolds")
    """The simulated-hold route is available."""

    keyed: Optional[bool] = UNSET
    """Present and true only when the host has a judge key set."""


class ApiJudgeCapabilitiesResponseDict(TypedDict):
    judge_rooms: bool
    accepting: bool
    sim_holds: bool
    keyed: NotRequired[bool]
