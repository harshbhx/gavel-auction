from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiJudgeRoomsBidsResponse(SdkBaseModel):
    accepted: Literal["True"] = "True"
    mid: str
    bid_id: str = Field(alias="bidId")
    amount: int
    """The accepted bid in cents."""

    seq: int
    """Position of the bid in the room's event log."""


class ApiJudgeRoomsBidsResponseDict(TypedDict):
    accepted: Literal["True"]
    mid: str
    bid_id: str
    amount: int
    seq: int
