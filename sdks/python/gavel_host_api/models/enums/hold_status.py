from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class HoldStatus(str, Enum):
    PENDING_APPROVAL = "PENDING_APPROVAL"
    HELD = "HELD"
    CAPTURED = "CAPTURED"
    VOIDED = "VOIDED"
    EXPIRED = "EXPIRED"
    DENIED = "DENIED"
    UNKNOWN = "UNKNOWN"

    __str__ = str.__str__


HoldStatusOrStr: TypeAlias = Annotated[HoldStatus | str, open_enum_validator(HoldStatus)]
