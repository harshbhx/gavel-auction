from __future__ import annotations

from typing import TypeAlias

from ..error import Error, ErrorDict
from ..error1 import Error1, Error1Dict
from ..error2 import Error2, Error2Dict

Error5: TypeAlias = Error | Error1 | Error2
"""The error body. ``message`` is always there. The stable code is in ``code`` on the core and judge routes and in
``error`` on the hold, judge and operator routes: read ``code ?? error``. 413 and 415 use ``bad_message``."""

Error5Dict: TypeAlias = ErrorDict | Error1Dict | Error2Dict
