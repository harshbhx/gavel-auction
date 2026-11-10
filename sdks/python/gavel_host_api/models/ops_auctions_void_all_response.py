from __future__ import annotations

from typing import Literal

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class OpsAuctionsVoidAllResponse(SdkBaseModel):
    status: Literal["done"] = "done"
    holds: dict[str, str]
    """Hold id to the outcome the payments package recorded."""


class OpsAuctionsVoidAllResponseDict(TypedDict):
    status: Literal["done"]
    holds: dict[str, str]
