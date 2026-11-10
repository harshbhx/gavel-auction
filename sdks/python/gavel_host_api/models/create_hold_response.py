from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class CreateHoldResponse(SdkBaseModel):
    hold_id: str = Field(alias="holdId")
    """Id of the hold on this host."""

    order_id: str = Field(alias="orderId")
    """PayPal sandbox order id for the hold."""

    approve_url: Optional[str] = Field(default=UNSET, alias="approveUrl")
    """PayPal's own approval page, for when the popup cannot open."""


class CreateHoldResponseDict(TypedDict):
    hold_id: str
    order_id: str
    approve_url: NotRequired[str]
