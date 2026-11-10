from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiJudgeJoinRequest(SdkBaseModel):
    code: str
    """The join code, in any case; spaces, dashes and a GVL- prefix are ignored."""

    display_name: str = Field(alias="displayName")
    """Display name. Control characters, invisible direction marks and angle brackets are refused."""


class ApiJudgeJoinRequestDict(TypedDict):
    code: str
    display_name: str
