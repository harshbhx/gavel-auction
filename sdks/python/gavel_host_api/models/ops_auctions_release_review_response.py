from __future__ import annotations

from typing import Literal

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class OpsAuctionsReleaseReviewResponse(SdkBaseModel):
    status: Literal["released"] = "released"


class OpsAuctionsReleaseReviewResponseDict(TypedDict):
    status: Literal["released"]
