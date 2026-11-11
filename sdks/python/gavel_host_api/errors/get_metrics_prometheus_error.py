from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

GetMetricsPrometheusErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _GetMetricsPrometheusError:
    def map(self, status_code: int, content: bytes) -> GetMetricsPrometheusErrorBody:
        match status_code:
            case 401 | 405 | 429:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


get_metrics_prometheus_error_mapper: Final[ErrorMapper[GetMetricsPrometheusErrorBody]] = _GetMetricsPrometheusError()
