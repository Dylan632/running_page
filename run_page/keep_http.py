"""Reliable HTTP and record collection seams for the Keep importer."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable
from typing import Any, TypeVar

KEEP_REQUEST_TIMEOUT = (5.0, 30.0)
KEEP_REQUEST_ATTEMPTS = 3
RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})


class KeepRequestError(RuntimeError):
    """Raised when a Keep request cannot produce a valid JSON response."""


class KeepRecordError(RuntimeError):
    """Raised when one record would make a Keep import partial."""

    def __init__(self, record_id: str, error: Exception):
        self.record_id = record_id
        super().__init__(f"Keep record {record_id} could not be parsed: {error}")


RawRecord = TypeVar("RawRecord")
ParsedRecord = TypeVar("ParsedRecord")


def collect_keep_records(
    record_ids: Iterable[str],
    load_record: Callable[[str], RawRecord],
    parse_record: Callable[[RawRecord], ParsedRecord | None],
) -> list[ParsedRecord]:
    """Load a complete Keep batch, failing instead of returning partial data."""
    records: list[ParsedRecord] = []
    for record_id in record_ids:
        try:
            parsed = parse_record(load_record(record_id))
            if parsed is None:
                raise ValueError("parser returned no activity")
        except Exception as error:
            raise KeepRecordError(record_id, error) from error
        records.append(parsed)
    return records


def request_json(
    session: Any,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: dict[str, str] | None = None,
    timeout: tuple[float, float] = KEEP_REQUEST_TIMEOUT,
    max_attempts: int = KEEP_REQUEST_ATTEMPTS,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Return one Keep JSON response with bounded retries and explicit timeouts."""
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least one")

    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        response = None
        try:
            response = session.request(
                method,
                url,
                headers=headers,
                data=data,
                timeout=timeout,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("Keep returned a non-object JSON response")
            return payload
        except Exception as error:
            last_error = error
            status_code = getattr(response, "status_code", None)
            retryable = response is None or status_code in RETRYABLE_STATUS_CODES
            if not retryable or attempt == max_attempts:
                break
            sleep(float(2 ** (attempt - 1)))

    raise KeepRequestError(
        f"Keep {method.upper()} {url} failed after {max_attempts} attempts"
    ) from last_error
