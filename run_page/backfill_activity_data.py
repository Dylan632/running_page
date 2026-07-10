import argparse
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

ACTIVITY_COLUMNS = [
    "run_id",
    "name",
    "distance",
    "moving_time",
    "elapsed_time",
    "type",
    "subtype",
    "start_date",
    "start_date_local",
    "location_country",
    "summary_polyline",
    "average_heartrate",
    "average_speed",
    "elevation_gain",
]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("backfill_files", nargs="+", help="JSON files with activities.")
    parser.add_argument(
        "--json-file",
        default="src/static/activities.json",
        help="Path to generated activities.json.",
    )
    parser.add_argument(
        "--db-file",
        default="run_page/data.db",
        help="Path to generated activities SQLite database.",
    )
    return parser.parse_args()


def load_backfill(files):
    activities = []
    for file_name in files:
        activities.extend(json.loads(Path(file_name).read_text()))
    return activities


def duration_to_sqlite(value):
    if value is None:
        value = "0:00:00"
    if isinstance(value, (int, float)):
        delta = timedelta(seconds=float(value))
    else:
        text = str(value)
        days = 0
        if " day" in text:
            day_part, text = text.split(",", 1)
            days = int(day_part.split()[0])
            text = text.strip()
        hours, minutes, seconds = text.split(":")
        delta = timedelta(
            days=days,
            hours=int(hours),
            minutes=int(minutes),
            seconds=float(seconds),
        )
    return (datetime(1970, 1, 1) + delta).strftime("%Y-%m-%d %H:%M:%S.%f")


def merge_json(json_file, backfill):
    path = Path(json_file)
    activities = json.loads(path.read_text()) if path.exists() else []
    known_ids = {str(activity.get("run_id")) for activity in activities}
    additions = [
        activity
        for activity in backfill
        if str(activity.get("run_id")) not in known_ids
    ]
    if additions:
        activities.extend(additions)
        activities.sort(key=lambda activity: activity.get("start_date_local") or "")
        path.write_text(json.dumps(activities))
    return len(additions)


def db_values(activity):
    moving_time = duration_to_sqlite(activity.get("moving_time"))
    elapsed_time = duration_to_sqlite(
        activity.get("elapsed_time") or activity.get("moving_time")
    )
    summary_polyline = activity.get("summary_polyline") or ""
    if summary_polyline:
        try:
            import polyline

            polyline.decode(summary_polyline)
        except Exception:
            summary_polyline = ""
    return {
        "run_id": int(activity["run_id"]),
        "name": activity.get("name"),
        "distance": activity.get("distance"),
        "moving_time": moving_time,
        "elapsed_time": elapsed_time,
        "type": activity.get("type"),
        "subtype": activity.get("subtype"),
        "start_date": activity.get("start_date"),
        "start_date_local": activity.get("start_date_local"),
        "location_country": activity.get("location_country"),
        "summary_polyline": summary_polyline,
        "average_heartrate": activity.get("average_heartrate"),
        "average_speed": activity.get("average_speed"),
        "elevation_gain": activity.get("elevation_gain"),
    }


def merge_db(db_file, backfill):
    path = Path(db_file)
    if not path.exists():
        return 0
    placeholders = ", ".join(f":{column}" for column in ACTIVITY_COLUMNS)
    columns = ", ".join(ACTIVITY_COLUMNS)
    connection = sqlite3.connect(path)
    try:
        cursor = connection.cursor()
        before = cursor.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
        cursor.executemany(
            f"INSERT OR IGNORE INTO activities ({columns}) VALUES ({placeholders})",
            [db_values(activity) for activity in backfill],
        )
        connection.commit()
        after = cursor.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
    finally:
        connection.close()
    return after - before


def main():
    args = parse_args()
    backfill = load_backfill(args.backfill_files)
    json_added = merge_json(args.json_file, backfill)
    db_added = merge_db(args.db_file, backfill)
    print(f"Backfilled activities: json +{json_added}, db +{db_added}")


if __name__ == "__main__":
    main()
