import os
from collections import namedtuple

# getting content root directory
current = os.path.dirname(os.path.realpath(__file__))
parent = os.path.dirname(current)

OUTPUT_DIR = os.path.join(parent, "activities")
GPX_FOLDER = os.path.join(parent, "GPX_OUT")
TCX_FOLDER = os.path.join(parent, "TCX_OUT")
FIT_FOLDER = os.path.join(parent, "FIT_OUT")
PNG_FOLDER = os.path.join(parent, "PNG_OUT")
ENDOMONDO_FILE_DIR = os.path.join(parent, "Workouts")
FOLDER_DICT = {
    "gpx": GPX_FOLDER,
    "tcx": TCX_FOLDER,
    "fit": FIT_FOLDER,
}
SQL_FILE = os.path.join(parent, "run_page", "data.db")
JSON_FILE = os.path.join(parent, "src", "static", "activities.json")
SYNCED_FILE = os.path.join(parent, "imported.json")


def _prepare_manual_taihu_gpx():
    route_file = os.path.join(parent, "manual_gpx", "taihu_route.polyline.b64")
    if not os.path.exists(route_file):
        return
    try:
        from write_taihu_manual_gpx import main as write_taihu_manual_gpx

        write_taihu_manual_gpx()
    except Exception as exc:
        print(f"Skip manual Taihu GPX generation: {exc}")


_prepare_manual_taihu_gpx()

BASE_TIMEZONE = "Asia/Shanghai"
UTC_TIMEZONE = "UTC"

start_point = namedtuple("start_point", "lat lon")
run_map = namedtuple("polyline", "summary_polyline")
