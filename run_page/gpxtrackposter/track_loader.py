"""Handle parsing of GPX files"""

# Copyright 2016-2019 Florian Pigorsch & Contributors. All rights reserved.
# 2019-now Yihong0618
#
# Use of this source code is governed by a MIT-style
# license that can be found in the LICENSE file.

import logging
import os
import sys
import datetime
import json
from types import SimpleNamespace

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
import concurrent.futures

from generator.db import Activity, init_db

from .exceptions import ParameterError, TrackLoadError
from .track import Track
from .year_range import YearRange

from synced_data_file_logger import load_synced_file_list

log = logging.getLogger(__name__)


def load_gpx_file(file_name, activity_title_dict={}):
    """Load an individual GPX file as a track by using Track.load_gpx()"""
    t = Track()
    t.load_gpx(file_name)
    file_id = os.path.basename(file_name).split(".")[0]
    if activity_title_dict:
        t.track_name = activity_title_dict.get(file_id, t.track_name)
    return t


def load_tcx_file(file_name, activity_title_dict={}):
    """Load an individual TCX file as a track by using Track.load_tcx()"""
    t = Track()
    t.load_tcx(file_name)
    file_id = os.path.basename(file_name).split(".")[0]
    if activity_title_dict:
        t.track_name = activity_title_dict.get(file_id, t.track_name)
    return t


def load_fit_file(file_name, activity_title_dict={}):
    """Load an individual FIT file as a track by using Track.load_fit()"""
    t = Track()
    t.load_fit(file_name)
    file_id = os.path.basename(file_name).split(".")[0]
    if activity_title_dict:
        t.track_name = activity_title_dict.get(file_id, t.track_name)
    return t


class TrackLoader:
    """
    Attributes:
        min_length: All tracks shorter than this value are filtered out.
        special_file_names: Tracks marked as special in command line args
        year_range: All tracks outside of this range will be filtered out.

    Methods:
        load_tracks: Load all data from GPX files
    """

    def __init__(self):
        self.min_length = 100
        self.special_file_names = []
        self.year_range = YearRange()
        self.load_func_dict = {
            "gpx": load_gpx_file,
            "tcx": load_tcx_file,
            "fit": load_fit_file,
        }

    def load_tracks(self, data_dir, file_suffix="gpx", activity_title_dict={}):
        """Load tracks data_dir and return as a List of tracks"""
        file_names = [x for x in self._list_data_files(data_dir, file_suffix)]
        print(f"{file_suffix.upper()} files: {len(file_names)}")

        tracks = []

        loaded_tracks = self._load_data_tracks(
            file_names,
            self.load_func_dict.get(file_suffix, load_gpx_file),
            activity_title_dict,
        )

        tracks.extend(loaded_tracks.values())
        log.info(f"Conventionally loaded tracks: {len(loaded_tracks)}")

        tracks = self._filter_tracks(tracks)
        # filter out tracks with length < min_length
        return [t for t in tracks if t.length >= self.min_length]

    def load_tracks_from_db(self, sql_file, is_grid=False):
        session = init_db(sql_file)
        if is_grid:
            activities = (
                session.query(Activity)
                .filter(Activity.summary_polyline != "")
                .order_by(Activity.start_date_local)
            )
        else:
            activities = session.query(Activity).order_by(Activity.start_date_local)
        tracks = []
        for activity in activities:
            t = Track()
            t.load_from_db(activity)
            tracks.append(t)
        print(f"All tracks: {len(tracks)}")
        tracks = self._filter_tracks(tracks)
        print(f"After filter tracks: {len(tracks)}")
        return [t for t in tracks if t.length >= self.min_length]

    @staticmethod
    def _parse_duration(value):
        if isinstance(value, (int, float)):
            return datetime.timedelta(seconds=float(value))
        if value is None:
            return datetime.timedelta()

        raw = str(value).strip()
        days = 0
        if "day" in raw:
            day_text, raw = raw.split(",", 1)
            days = int(day_text.split()[0])
            raw = raw.strip()
        parts = raw.split(":")
        if len(parts) != 3:
            raise ValueError(f"Invalid activity duration: {value}")
        hours, minutes, seconds = parts
        return datetime.timedelta(
            days=days,
            hours=int(hours),
            minutes=int(minutes),
            seconds=float(seconds),
        )

    @staticmethod
    def _normalize_local_datetime(value):
        raw = str(value).strip()
        parsed = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")

    def load_tracks_from_json(
        self,
        json_file,
        is_grid=False,
        activity_types=None,
        exclude_run_ids=None,
    ):
        """Load poster tracks from the exact validated publication snapshot."""
        with open(json_file, "r", encoding="utf-8") as source:
            activities = json.load(source)
        if not isinstance(activities, list):
            raise ValueError("Activity snapshot must be a JSON array")

        accepted_types = set(activity_types or [])
        excluded_ids = {str(run_id) for run_id in (exclude_run_ids or [])}
        tracks = []
        for record in activities:
            if not isinstance(record, dict):
                raise ValueError("Every activity snapshot item must be an object")
            if accepted_types and record.get("type") not in accepted_types:
                continue
            if str(record.get("run_id")) in excluded_ids:
                continue
            summary_polyline = record.get("summary_polyline") or ""
            if is_grid and not summary_polyline:
                continue

            moving_time = self._parse_duration(record.get("moving_time"))
            elapsed_time = self._parse_duration(
                record.get("elapsed_time") or record.get("moving_time")
            )
            activity = SimpleNamespace(
                run_id=record.get("run_id"),
                start_date_local=self._normalize_local_datetime(
                    record.get("start_date_local")
                ),
                elapsed_time=elapsed_time,
                moving_time=moving_time,
                distance=float(record.get("distance") or 0),
                summary_polyline=summary_polyline,
                type=record.get("type") or "",
                subtype=record.get("subtype"),
                average_speed=float(record.get("average_speed") or 0),
            )
            track = Track()
            track.load_from_db(activity)
            tracks.append(track)

        tracks.sort(key=lambda track: (track.start_time_local, str(track.run_id)))
        tracks = self._filter_tracks(tracks)
        return [track for track in tracks if track.length >= self.min_length]

    def _filter_tracks(self, tracks):
        filtered_tracks = []
        for t in tracks:
            file_name = t.file_names[0]
            if int(t.length) == 0:
                log.info(f"{file_name}: skipping empty track")
            elif not t.start_time_local:
                log.info(f"{file_name}: skipping track without start time")
            elif not self.year_range.contains(t.start_time_local):
                log.info(
                    f"{file_name}: skipping track with wrong year {t.start_time_local.year}"
                )
            else:
                t.special = file_name in self.special_file_names
                filtered_tracks.append(t)
        return filtered_tracks

    @staticmethod
    def _load_data_tracks(file_names, load_func=load_gpx_file, activity_title_dict={}):
        """
        TODO refactor with _load_tcx_tracks
        """
        tracks = {}
        with concurrent.futures.ProcessPoolExecutor() as executor:
            future_to_file_name = {
                executor.submit(load_func, file_name, activity_title_dict): file_name
                for file_name in file_names
            }
        for future in concurrent.futures.as_completed(future_to_file_name):
            file_name = future_to_file_name[future]
            try:
                t = future.result()
            except TrackLoadError as e:
                log.error(f"Error while loading {file_name}: {e}")
            else:
                tracks[file_name] = t
        return tracks

    @staticmethod
    def _list_data_files(data_dir, file_suffix):
        synced_files = load_synced_file_list()
        data_dir = os.path.abspath(data_dir)
        if not os.path.isdir(data_dir):
            raise ParameterError(f"Not a directory: {data_dir}")
        for name in os.listdir(data_dir):
            if name.startswith("."):
                continue
            if name in synced_files:
                continue
            path_name = os.path.join(data_dir, name)
            if name.endswith(f".{file_suffix}") and os.path.isfile(path_name):
                yield path_name
