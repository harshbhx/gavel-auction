from __future__ import annotations

from typing import Literal

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiJudgeKeysRevokeResponse(SdkBaseModel):
    id: str
    revoked: Literal["True"] = "True"


class ApiJudgeKeysRevokeResponseDict(TypedDict):
    id: str
    revoked: Literal["True"]
