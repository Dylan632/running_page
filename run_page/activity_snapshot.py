"""Validate and safely publish generated activity snapshots."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


class SnapshotValidationError(ValueError):
    """Raised when generated activity data is unsafe to publish."""


@dataclass(frozen=True)
class Snapshot:
    count: int
    latest_date: datetime
    run_ids: frozenset[str]
    sha256: str


def load_snapshot(json_path: Path) -> Snapshot:
    raw_bytes = json_path.read_bytes()
    try:
        activities = json.loads(raw_bytes)
    except json.JSONDecodeError as error:
        raise SnapshotValidationError(
            f"{json_path} is not valid JSON: {error}"
        ) from error
    if not isinstance(activities, list) or not activities:
        raise SnapshotValidationError("activity snapshot must be a non-empty list")

    run_ids: set[str] = set()
    latest_date: datetime | None = None
    for index, activity in enumerate(activities):
        if not isinstance(activity, dict):
            raise SnapshotValidationError(f"activity {index} is not an object")

        run_id = activity.get("run_id")
        if run_id is None or isinstance(run_id, bool):
            raise SnapshotValidationError(f"activity {index} has no run_id")
        normalized_run_id = str(run_id)
        if normalized_run_id in run_ids:
            raise SnapshotValidationError(f"duplicate run_id {normalized_run_id}")
        run_ids.add(normalized_run_id)

        try:
            distance = float(activity["distance"])
        except (KeyError, TypeError, ValueError) as error:
            raise SnapshotValidationError(
                f"activity {normalized_run_id} has an invalid distance"
            ) from error
        if not math.isfinite(distance) or distance < 0:
            raise SnapshotValidationError(
                f"activity {normalized_run_id} has an invalid distance"
            )

        # Use the same local timeline before and after publication. Published
        # metadata deliberately omits the redundant UTC start_date field.
        date_value = activity.get("start_date_local") or activity.get("start_date")
        try:
            start_date = datetime.fromisoformat(str(date_value))
        except (TypeError, ValueError) as error:
            raise SnapshotValidationError(
                f"activity {normalized_run_id} has an invalid activity date"
            ) from error
        if latest_date is None or start_date > latest_date:
            latest_date = start_date

    if latest_date is None:
        raise SnapshotValidationError("activity snapshot has no dates")
    return Snapshot(
        count=len(activities),
        latest_date=latest_date,
        run_ids=frozenset(run_ids),
        sha256=hashlib.sha256(raw_bytes).hexdigest(),
    )


def validate_no_regression(candidate: Snapshot, previous: Snapshot) -> None:
    if candidate.count < previous.count:
        raise SnapshotValidationError(
            f"activity count regressed from {previous.count} to {candidate.count}"
        )
    if candidate.latest_date < previous.latest_date:
        raise SnapshotValidationError(
            "latest activity date regressed from "
            f"{previous.latest_date.isoformat(sep=' ')} to "
            f"{candidate.latest_date.isoformat(sep=' ')}"
        )


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "wb") as temporary_file:
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def publish_contents_atomically(contents: list[tuple[Path, bytes]]) -> None:
    """Replace a related set of files and roll back if any replacement fails."""
    originals = {
        path: path.read_bytes() if path.exists() else None for path, _ in contents
    }
    published: list[Path] = []
    try:
        for path, content in contents:
            atomic_write(path, content)
            published.append(path)
    except Exception:
        for path in reversed(published):
            original = originals[path]
            if original is None:
                path.unlink(missing_ok=True)
            else:
                atomic_write(path, original)
        raise


def snapshot_metadata(snapshot: Snapshot) -> bytes:
    metadata: dict[str, Any] = {
        "count": snapshot.count,
        "latest_date": snapshot.latest_date.isoformat(sep=" "),
        "sha256": snapshot.sha256,
    }
    return (json.dumps(metadata, sort_keys=True) + "\n").encode()


def load_database_run_ids(database_path: Path) -> frozenset[str]:
    try:
        connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    except sqlite3.Error as error:
        raise SnapshotValidationError(
            f"could not open activity database {database_path}: {error}"
        ) from error
    try:
        rows = connection.execute("SELECT run_id FROM activities").fetchall()
    except sqlite3.Error as error:
        raise SnapshotValidationError(
            f"could not read activities from {database_path}: {error}"
        ) from error
    finally:
        connection.close()
    return frozenset(str(row[0]) for row in rows)


def validate_snapshot(
    json_path: Path,
    database_path: Path | None,
    previous_json_path: Path | None,
    metadata_path: Path,
) -> None:
    snapshot = load_snapshot(json_path)
    if database_path is not None:
        database_run_ids = load_database_run_ids(database_path)
        if snapshot.run_ids != database_run_ids:
            missing_from_database = sorted(snapshot.run_ids - database_run_ids)
            missing_from_json = sorted(database_run_ids - snapshot.run_ids)
            raise SnapshotValidationError(
                "JSON/DB run_id mismatch: "
                f"missing from DB={missing_from_database}, "
                f"missing from JSON={missing_from_json}"
            )
    if previous_json_path is not None and previous_json_path.exists():
        validate_no_regression(snapshot, load_snapshot(previous_json_path))
    atomic_write(metadata_path, snapshot_metadata(snapshot))


def publish_json(candidate_path: Path, target_path: Path, metadata_path: Path) -> None:
    candidate = load_snapshot(candidate_path)
    previous = load_snapshot(target_path)
    validate_no_regression(candidate, previous)

    candidate_bytes = candidate_path.read_bytes()
    publish_contents_atomically(
        [
            (target_path, candidate_bytes),
            (metadata_path, snapshot_metadata(candidate)),
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and safely publish generated activity data."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--json", required=True, type=Path)
    validate_parser.add_argument("--db", type=Path)
    validate_parser.add_argument("--previous-json", type=Path)
    validate_parser.add_argument("--metadata", required=True, type=Path)
    publish_parser = subparsers.add_parser("publish")
    publish_parser.add_argument("--candidate-json", required=True, type=Path)
    publish_parser.add_argument("--target-json", required=True, type=Path)
    publish_parser.add_argument("--metadata", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "validate":
            validate_snapshot(
                args.json,
                args.db,
                args.previous_json,
                args.metadata,
            )
        elif args.command == "publish":
            publish_json(args.candidate_json, args.target_json, args.metadata)
    except (OSError, SnapshotValidationError) as error:
        print(f"Snapshot rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
