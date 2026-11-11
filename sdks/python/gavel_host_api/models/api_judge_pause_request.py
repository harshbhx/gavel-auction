from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiJudgePauseRequest(SdkBaseModel):
    paused: bool


class ApiJudgePauseRequestDict(TypedDict):
    paused: bool
