import argparse
import json
import sqlite3
from pathlib import Path


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
    return parser.parse_args()


def should_keep(activity, allowed_types, min_distance):
    try:
        distance = float(activity.get("distance") or 0)
    except (TypeError, ValueError):
        distance = 0

    return activity.get("type") in allowed_types and distance > min_distance


def filter_json(json_file, allowed_types, min_distance):
    path = Path(json_file)
    activities = json.loads(path.read_text())
    filtered = [
        activity
        for activity in activities
        if should_keep(activity, allowed_types, min_distance)
    ]
    path.write_text(json.dumps(filtered), encoding="utf-8")
    return len(activities), len(filtered)


def filter_db(db_file, allowed_types, min_distance):
    path = Path(db_file)
    if not path.exists():
        return 0, 0

    connection = sqlite3.connect(path)
    try:
        cursor = connection.cursor()
        before = cursor.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
        placeholders = ",".join("?" for _ in allowed_types)
        cursor.execute(
            f"""
            DELETE FROM activities
            WHERE type NOT IN ({placeholders})
              OR COALESCE(distance, 0) <= ?
            """,
            [*allowed_types, min_distance],
        )
        connection.commit()
        after = cursor.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
        return before, after
    finally:
        connection.close()


def main():
    args = parse_args()
    allowed_types = set(args.types)
    json_before, json_after = filter_json(
        args.json_file, allowed_types, args.min_distance
    )
    db_before, db_after = filter_db(args.db_file, allowed_types, args.min_distance)
    print(
        "Filtered activities: "
        f"json {json_before}->{json_after}, "
        f"db {db_before}->{db_after}, "
        f"types={sorted(allowed_types)}, "
        f"min_distance>{args.min_distance}m"
    )


if __name__ == "__main__":
    main()
