from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class HoldErrorCode(str, Enum):
    """400 ceiling_out_of_range; 404 order_not_found; 409 hold_exists, order_not_approved; 503 paypal_unavailable,
    kill_switch_engaged, payments_not_sandbox."""

    CEILING_OUT_OF_RANGE = "ceiling_out_of_range"
    HOLD_EXISTS = "hold_exists"
    ORDER_NOT_FOUND = "order_not_found"
    ORDER_NOT_APPROVED = "order_not_approved"
    PAYPAL_UNAVAILABLE = "paypal_unavailable"
    KILL_SWITCH_ENGAGED = "kill_switch_engaged"
    PAYMENTS_NOT_SANDBOX = "payments_not_sandbox"

    __str__ = str.__str__


HoldErrorCodeOrStr: TypeAlias = Annotated[HoldErrorCode | str, open_enum_validator(HoldErrorCode)]
