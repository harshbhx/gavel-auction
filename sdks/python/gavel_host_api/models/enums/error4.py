from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class Error4(str, Enum):
    """Stable code (hold, judge and operator routes)."""

    BID_REJECTED = "bid_rejected"

    __str__ = str.__str__


Error4OrStr: TypeAlias = Annotated[Error4 | str, open_enum_validator(Error4)]
