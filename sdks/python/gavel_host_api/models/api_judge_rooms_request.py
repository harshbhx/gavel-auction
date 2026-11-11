from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class ApiJudgeRoomsRequest(SdkBaseModel):
    title: str = "Sandbox demo lot"
    fundraiser_goal_cents: Optional[int] = Field(default=UNSET, alias="fundraiserGoalCents")
    """Optional goal; the projector shows a thermometer only when it is set."""


class ApiJudgeRoomsRequestDict(TypedDict):
    title: NotRequired[str]
    fundraiser_goal_cents: NotRequired[int]
