from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class List(str, Enum):
    _1 = "1"

    __str__ = str.__str__


ListOrStr: TypeAlias = Annotated[List | str, open_enum_validator(List)]
