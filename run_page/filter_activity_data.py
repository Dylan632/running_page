import argparse
import json
import shutil
import sqlite3
import tempfile
from pathlib import Path

from activity_snapshot import (
    SnapshotValidationError,
    load_database_run_ids,
    load_snapshot,
    publish_contents_atomically,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Filter generated running_page activity JSON and database data."
    )
    parser.add_argument(
        "--json-file",
        default="src/static/activities.json",
        help="Path to activities.json.",
    )
    parser.add_argument(
        "--db-file",
        default="run_page/data.db",
        help="Path to the generated SQLite database.",
    )
    parser.add_argument(
        "--types",
        nargs="+",
        required=True,
        help="Activity types to keep, for example: Ride cycling.",
    )
    parser.add_argument(
        "--min-distance",
        type=float,
        default=0,
        help="Keep activities with distance strictly greater than this many meters.",
    )
    parser.add_argument(
        "--exclude-run-ids",
        nargs="*",
        default=[],
        help="Activity run_id values to remove after normal filtering.",
    )
    return parser.parse_args()


def should_keep(activity, allowed_types, min_distance, exclude_run_ids):
    if str(activity.get("run_id")) in exclude_run_ids:
        return False

    try:
        distance = float(activity.get("distance") or 0)
    except (TypeError, ValueError):
        distance = 0

    return activity.get("type") in allowed_types and distance > min_distance


def filter_json(json_file, allowed_types, min_distance, exclude_run_ids):
    path = Path(json_file)
    activities = json.loads(path.read_text())
    filtered = [
        activity
        for activity in activities
        if should_keep(activity, allowed_types, min_distance, exclude_run_ids)
    ]
    path.write_text(json.dumps(filtered), encoding="utf-8")
    return len(activities), len(filtered)


def filter_db(db_file, allowed_types, min_distance, exclude_run_ids):
    path = Path(db_file)
    if not path.exists():
        return 0, 0

    connection = sqlite3.connect(path)
    try:
        cursor = connection.cursor()
        before = cursor.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
        placeholders = ",".join("?" for _ in allowed_types)
        exclude_ids = [int(run_id) for run_id in exclude_run_ids]
        exclude_clause = ""
        if exclude_ids:
            exclude_placeholders = ",".join("?" for _ in exclude_ids)
            exclude_clause = f" OR run_id IN ({exclude_placeholders})"
        cursor.execute(
            f"""
            DELETE FROM activities
            WHERE type NOT IN ({placeholders})
              OR COALESCE(distance, 0) <= ?
              {exclude_clause}
            """,
            [*allowed_types, min_distance, *exclude_ids],
        )
        connection.commit()
        after = cursor.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
        return before, after
    finally:
        connection.close()


def main():
    args = parse_args()
    allowed_types = set(args.types)
    exclude_run_ids = set(args.exclude_run_ids)
    json_path = Path(args.json_file)
    database_path = Path(args.db_file)
    with tempfile.TemporaryDirectory(prefix="activity-filter-") as temporary_directory:
        candidate_json_path = Path(temporary_directory) / "activities.json"
        candidate_database_path = Path(temporary_directory) / "data.db"
        shutil.copy2(json_path, candidate_json_path)
        if database_path.exists():
            shutil.copy2(database_path, candidate_database_path)

        json_before, json_after = filter_json(
            candidate_json_path,
            allowed_types,
            args.min_distance,
            exclude_run_ids,
        )
        db_before, db_after = filter_db(
            candidate_database_path,
            allowed_types,
            args.min_distance,
            exclude_run_ids,
        )

        candidate_snapshot = load_snapshot(candidate_json_path)
        publication = [(json_path, candidate_json_path.read_bytes())]
        if database_path.exists():
            database_run_ids = load_database_run_ids(candidate_database_path)
            if candidate_snapshot.run_ids != database_run_ids:
                raise SnapshotValidationError(
                    "filtered JSON and database contain different run_id values"
                )
            publication.append((database_path, candidate_database_path.read_bytes()))
        publish_contents_atomically(publication)

    print(
        "Filtered activities: "
        f"json {json_before}->{json_after}, "
        f"db {db_before}->{db_after}, "
        f"types={sorted(allowed_types)}, "
        f"min_distance>{args.min_distance}m, "
        f"excluded={sorted(exclude_run_ids)}"
    )


if __name__ == "__main__":
    main()
