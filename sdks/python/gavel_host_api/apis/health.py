from __future__ import annotations

from ..core import (
    ApiResult,
    AsyncRawClient,
    BaseRawResponse,
    RawClient,
    RawError,
    RequestOptionsOrDict,
    async_json_decoder,
    json_decoder,
    raw_error_response,
    unwrap,
)
from ..errors.get_readiness_error import GetReadinessErrorBody, get_readiness_error_mapper
from ..errors.warmup_error import WarmupErrorBody, warmup_error_mapper
from ..models.status import Status
from ..models.version_response import VersionResponse
from ..models.warmup_report import WarmupReport
from ..server.server import Server


class Health:
    def __init__(self, client: RawClient, server: Server) -> None:
        self._with_raw_response = HealthWithRawResponse(client, server)

    def get_health(self, *, request_options: RequestOptionsOrDict | None = None) -> Status:
        """Always 200 while the process runs. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Alive.

        Raises:
            ApiError: If the API responds with an error status code. ``error`` is ``RawError``."""
        return unwrap(self._with_raw_response.get_health(request_options=request_options))

    def get_readiness(self, *, request_options: RequestOptionsOrDict | None = None) -> Status:
        """200 when every migration is applied and the store answers; 503 otherwise. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Ready.

        Raises:
            ApiError: Not ready. ``error`` is ``Readyz503Error1 | RawError``."""
        return unwrap(self._with_raw_response.get_readiness(request_options=request_options))

    def get_version(self, *, request_options: RequestOptionsOrDict | None = None) -> VersionResponse:
        """The commit the running build was made from, or ``unknown``. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Build sha.

        Raises:
            ApiError: If the API responds with an error status code. ``error`` is ``RawError``."""
        return unwrap(self._with_raw_response.get_version(request_options=request_options))

    def warmup(self, *, request_options: RequestOptionsOrDict | None = None) -> WarmupReport:
        """No credential. Runs the warm-up steps in parallel within a 3 second budget; 200 when all are warm, 503
        otherwise.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            All steps warm.

        Raises:
            ApiError: A step failed or the budget ran out. Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. ``error`` is ``Error5 | WarmupReport | RawError``."""
        return unwrap(self._with_raw_response.warmup(request_options=request_options))

    @property
    def with_raw_response(self) -> HealthWithRawResponse:
        return self._with_raw_response


class AsyncHealth:
    def __init__(self, client: AsyncRawClient, server: Server) -> None:
        self._with_raw_response = AsyncHealthWithRawResponse(client, server)

    async def get_health(self, *, request_options: RequestOptionsOrDict | None = None) -> Status:
        """Always 200 while the process runs. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Alive.

        Raises:
            ApiError: If the API responds with an error status code. ``error`` is ``RawError``."""
        return unwrap(await self._with_raw_response.get_health(request_options=request_options))

    async def get_readiness(self, *, request_options: RequestOptionsOrDict | None = None) -> Status:
        """200 when every migration is applied and the store answers; 503 otherwise. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Ready.

        Raises:
            ApiError: Not ready. ``error`` is ``Readyz503Error1 | RawError``."""
        return unwrap(await self._with_raw_response.get_readiness(request_options=request_options))

    async def get_version(self, *, request_options: RequestOptionsOrDict | None = None) -> VersionResponse:
        """The commit the running build was made from, or ``unknown``. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Build sha.

        Raises:
            ApiError: If the API responds with an error status code. ``error`` is ``RawError``."""
        return unwrap(await self._with_raw_response.get_version(request_options=request_options))

    async def warmup(self, *, request_options: RequestOptionsOrDict | None = None) -> WarmupReport:
        """No credential. Runs the warm-up steps in parallel within a 3 second budget; 200 when all are warm, 503
        otherwise.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            All steps warm.

        Raises:
            ApiError: A step failed or the budget ran out. Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. ``error`` is ``Error5 | WarmupReport | RawError``."""
        return unwrap(await self._with_raw_response.warmup(request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncHealthWithRawResponse:
        return self._with_raw_response


class HealthWithRawResponse(BaseRawResponse[RawClient, Server]):
    def get_health(self, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Status, RawError]:
        """Always 200 while the process runs. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/healthz"),
            decoder=json_decoder[Status],
            error_mapper=raw_error_response,
            request_options=request_options,
        )

    def get_readiness(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Status, GetReadinessErrorBody]:
        """200 when every migration is applied and the store answers; 503 otherwise. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/readyz"),
            decoder=json_decoder[Status],
            error_mapper=get_readiness_error_mapper,
            request_options=request_options,
        )

    def get_version(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[VersionResponse, RawError]:
        """The commit the running build was made from, or ``unknown``. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/version"),
            decoder=json_decoder[VersionResponse],
            error_mapper=raw_error_response,
            request_options=request_options,
        )

    def warmup(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[WarmupReport, WarmupErrorBody]:
        """No credential. Runs the warm-up steps in parallel within a 3 second budget; 200 when all are warm, 503
        otherwise.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/warmup"),
            decoder=json_decoder[WarmupReport],
            error_mapper=warmup_error_mapper,
            request_options=request_options,
        )


class AsyncHealthWithRawResponse(BaseRawResponse[AsyncRawClient, Server]):
    async def get_health(self, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Status, RawError]:
        """Always 200 while the process runs. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/healthz"),
            decoder=async_json_decoder[Status],
            error_mapper=raw_error_response,
            request_options=request_options,
        )

    async def get_readiness(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Status, GetReadinessErrorBody]:
        """200 when every migration is applied and the store answers; 503 otherwise. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/readyz"),
            decoder=async_json_decoder[Status],
            error_mapper=get_readiness_error_mapper,
            request_options=request_options,
        )

    async def get_version(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[VersionResponse, RawError]:
        """The commit the running build was made from, or ``unknown``. Never rate limited.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/version"),
            decoder=async_json_decoder[VersionResponse],
            error_mapper=raw_error_response,
            request_options=request_options,
        )

    async def warmup(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[WarmupReport, WarmupErrorBody]:
        """No credential. Runs the warm-up steps in parallel within a 3 second budget; 200 when all are warm, 503
        otherwise.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/warmup"),
            decoder=async_json_decoder[WarmupReport],
            error_mapper=warmup_error_mapper,
            request_options=request_options,
        )
