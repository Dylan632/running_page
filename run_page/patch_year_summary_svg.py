"""Post-process generated year summary SVGs for cycling pages.

The upstream year summary drawer uses a compact footer designed for running.
With cycling distances, the bottom-left status text can overlap. This script
parses each generated year-summary SVG, removes the old bottom-left footer text,
and replaces it with a three-line cycling legend.
"""

from pathlib import Path
import re
import xml.etree.ElementTree as ET


ASSETS_DIR = Path("assets")
YEAR_SUMMARY_GLOB = "year_summary*.svg"
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


LEGEND_LINES = [
    ("Heatmap: Blue <20km", "#4DD2FF", 250),
    ("Orange 20-50 / Red >50", "#ffa400", 262),
    ("Routes: Over 10km", "#FFFFFF", 274),
]


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def number_attr(element: ET.Element, attr: str) -> float | None:
    value = element.get(attr)
    if value is None:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", value)
    return float(match.group(0)) if match else None


def replace_text_attr(fragment: str, attr: str, value: str) -> str:
    if re.search(rf'{attr}="[^"]*"', fragment):
        return re.sub(rf'{attr}="[^"]*"', f'{attr}="{value}"', fragment, count=1)
    return fragment


def patch_units(svg: str) -> str:
    """Move fixed-position unit labels away from longer cycling values."""
    unit_moves = {
        ("km", "114"): "42",
        ("h", "170"): "36",
        ("d", "142"): "80",
    }

    def move_unit(match: re.Match[str]) -> str:
        tag_attrs = match.group(1)
        text = match.group(2)
        y_match = re.search(r'y="([^"]+)"', tag_attrs)
        y = y_match.group(1) if y_match else ""
        new_x = unit_moves.get((text, y))
        if not new_x:
            return match.group(0)
        return f"<text{replace_text_attr(tag_attrs, 'x', new_x)}>{text}</text>"

    return re.sub(r"<text([^>]*)>(km|h|d)</text>", move_unit, svg)


def is_bottom_left_footer_text(element: ET.Element) -> bool:
    if local_name(element.tag) != "text":
        return False

    x = number_attr(element, "x")
    y = number_attr(element, "y")
    if x is None or y is None:
        return False

    text = "".join(element.itertext()).strip()
    if not text:
        return False

    if text.startswith(("Heatmap:", "Orange ", "Routes:")):
        return True

    # Remove only the compact footer/status area on the lower-left side.
    # This catches Runner/Cyclist, Dylan, and cycling_page/year labels even if
    # the upstream drawer slightly changes the exact coordinates.
    return x <= 180 and 225 <= y <= 292


def remove_footer_texts(root: ET.Element) -> None:
    for parent in root.iter():
        for child in list(parent):
            if is_bottom_left_footer_text(child):
                parent.remove(child)


def add_legend(root: ET.Element) -> None:
    for text, fill, y in LEGEND_LINES:
        element = ET.Element(f"{{{SVG_NS}}}text")
        element.set("x", "11")
        element.set("y", str(y))
        element.set("fill", fill)
        element.set("style", "font-size:5px; font-family:Arial;")
        element.text = text
        root.append(element)


def replace_bottom_status_with_legend(svg: str) -> str:
    try:
        root = ET.fromstring(svg)
    except ET.ParseError:
        # Fallback: keep build working, but still try a simple text cleanup.
        svg = re.sub(
            r'<text[^>]*x="(?:\d+(?:\.\d+)?)"[^>]*y="(?:22[5-9]|2[3-8][0-9]|29[0-2])(?:\.[^"]*)?"[^>]*>[^<]*</text>',
            "",
            svg,
        )
        legend = "".join(
            f'<text fill="{fill}" style="font-size:5px; font-family:Arial;" x="11" y="{y}">{text.replace("<", "&lt;").replace(">", "&gt;")}</text>'
            for text, fill, y in LEGEND_LINES
        )
        return svg.replace("</svg>", legend + "</svg>")

    remove_footer_texts(root)
    add_legend(root)
    return ET.tostring(root, encoding="unicode")


def patch_svg_text(svg: str) -> str:
    svg = svg.replace(">Running for ", ">Cycling for ")
    svg = svg.replace(">Runs<", ">Rides<")
    svg = svg.replace(">Avg Pace<", ">Avg Speed<")
    svg = patch_units(svg)
    svg = replace_bottom_status_with_legend(svg)
    return svg


def main() -> None:
    files = sorted(ASSETS_DIR.glob(YEAR_SUMMARY_GLOB))
    if not files:
        print("No year summary SVGs found to patch.")
        return

    for path in files:
        original = path.read_text(encoding="utf-8")
        patched = patch_svg_text(original)
        path.write_text(patched, encoding="utf-8")
        print(f"Patched {path}")


if __name__ == "__main__":
    main()
