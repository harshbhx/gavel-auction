from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class VersionResponse(SdkBaseModel):
    sha: str


class VersionResponseDict(TypedDict):
    sha: str
