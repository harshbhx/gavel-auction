from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiJudgeRoomsSimHoldRequest(SdkBaseModel):
    ceiling_cents: int = Field(alias="ceilingCents")
    """Whole cents, at least 100 and at most the room's ceiling cap."""

    name: str
    """Display name. Control characters, invisible direction marks and angle brackets are refused."""


class ApiJudgeRoomsSimHoldRequestDict(TypedDict):
    ceiling_cents: int
    name: str
