from datetime import datetime, timezone, timedelta
from pathlib import Path
import base64

# Generate a route-preserving Taihu GPX from the encoded route data.
# Source: user's uploaded original Taihu GPX.
# Original track: 66,430 points, about 317.4 km.
# Encoded track: 1,566 points, about 307.7 km when decoded.
ROUTE_FILE = Path("manual_gpx") / "taihu_route.polyline.b64"
OUTPUT_FILE = Path("GPX_OUT") / "环太湖.gpx"
PRECISION = 5
START_TIME = datetime(2025, 6, 16, 0, 57, 3, tzinfo=timezone.utc)
DURATION = timedelta(hours=18)


def decode_polyline(polyline: str, precision: int = 5):
    coordinates = []
    index = 0
    lat = 0
    lng = 0
    factor = 10**precision

    while index < len(polyline):
        result = 0
        shift = 0
        while True:
            byte = ord(polyline[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        delta_lat = ~(result >> 1) if result & 1 else result >> 1
        lat += delta_lat

        result = 0
        shift = 0
        while True:
            byte = ord(polyline[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        delta_lng = ~(result >> 1) if result & 1 else result >> 1
        lng += delta_lng

        coordinates.append((lat / factor, lng / factor))

    return coordinates


def main():
    polyline = base64.b64decode(ROUTE_FILE.read_text(encoding="utf-8").strip()).decode(
        "utf-8"
    )
    points = decode_polyline(polyline, PRECISION)
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx creator="ChatGPT generated from original Taihu GPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
        "  <metadata>",
        "    <name>环太湖</name>",
        "    <desc>Route-preserving decimation from the original uploaded GPX; marked as cycling and compressed into one calendar day.</desc>",
        "    <time>2025-06-16T00:57:03Z</time>",
        "  </metadata>",
        "  <trk>",
        "    <name>环太湖</name>",
        "    <type>cycling</type>",
        "    <trkseg>",
    ]

    last_index = max(len(points) - 1, 1)
    for index, (lat, lon) in enumerate(points):
        timestamp = START_TIME + DURATION * index / last_index
        lines.append(
            f'      <trkpt lat="{lat:.5f}" lon="{lon:.5f}"><ele>0</ele><time>{timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")}</time></trkpt>'
        )

    lines.extend(["    </trkseg>", "  </trk>", "</gpx>", ""])
    OUTPUT_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUTPUT_FILE} with {len(points)} points.")


if __name__ == "__main__":
    main()
