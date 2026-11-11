from __future__ import annotations

from typing import TypeAlias

from ..api_judge_rooms_bids_response2 import ApiJudgeRoomsBidsResponse2, ApiJudgeRoomsBidsResponse2Dict
from .error5 import Error5, Error5Dict

ApiJudgeRoomsBidsResponse21: TypeAlias = ApiJudgeRoomsBidsResponse2 | Error5

ApiJudgeRoomsBidsResponse21Dict: TypeAlias = ApiJudgeRoomsBidsResponse2Dict | Error5Dict
