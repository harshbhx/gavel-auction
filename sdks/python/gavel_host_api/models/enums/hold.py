from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class Hold(str, Enum):
    """HELD when the bidder has a hold, otherwise NONE."""

    HELD = "HELD"
    NONE = "NONE"

    __str__ = str.__str__


HoldOrStr: TypeAlias = Annotated[Hold | str, open_enum_validator(Hold)]
