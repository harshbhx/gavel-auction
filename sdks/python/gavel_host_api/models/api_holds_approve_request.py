from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class ApiHoldsApproveRequest(SdkBaseModel):
    order_id: str = Field(alias="orderId")
    name: Optional[str] = UNSET
    """Display name. Control characters, invisible direction marks and angle brackets are refused."""


class ApiHoldsApproveRequestDict(TypedDict):
    order_id: str
    name: NotRequired[str]
