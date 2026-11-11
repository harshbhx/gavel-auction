from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiJudgePauseResponse(SdkBaseModel):
    paused: bool


class ApiJudgePauseResponseDict(TypedDict):
    paused: bool
