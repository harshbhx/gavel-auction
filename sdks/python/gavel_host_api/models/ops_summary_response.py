from __future__ import annotations

from typing import Any

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .saga import Saga, SagaDict


class OpsSummaryResponse(SdkBaseModel):
    logs: list[str]
    sagas: list[Saga]
    paypal: dict[str, int]
    metrics: Any


class OpsSummaryResponseDict(TypedDict):
    logs: list[str]
    sagas: list[SagaDict]
    paypal: dict[str, int]
    metrics: Any
