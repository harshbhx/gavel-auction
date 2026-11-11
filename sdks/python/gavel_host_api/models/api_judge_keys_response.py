from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .key import Key, KeyDict


class ApiJudgeKeysResponse(SdkBaseModel):
    keys: list[Key]


class ApiJudgeKeysResponseDict(TypedDict):
    keys: list[KeyDict]
