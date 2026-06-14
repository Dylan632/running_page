"""Post-process generated year summary SVGs for cycling pages.

The upstream year summary drawer uses fixed x positions that work for short
running stats, but cycling stats often have longer values. This script adds
more horizontal room for units and replaces the cramped bottom-left status area
with a compact three-line legend for the cycling heatmap and route map.
"""

from pathlib import Path
import re


ASSETS_DIR = Path("assets")
YEAR_SUMMARY_GLOB = "year_summary*.svg"


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


def replace_bottom_status_with_legend(svg: str) -> str:
    """Replace cramped bottom-left status strings with a three-line legend."""
    # Remove the original bottom-left status labels such as
    # Runner/Cyclist, Dylan, and running_page/2025 or cycling_page/2025.
    svg = re.sub(
        r'<text[^>]*x="11"[^>]*y="(?:24[0-9]|25[0-9]|26[0-9]|27[0-9]|28[0-9])(?:\.[^"]*)?"[^>]*>[^<]*</text>',
        "",
        svg,
    )

    legend = (
        '<text fill="#4DD2FF" style="font-size:5px; font-family:Arial;" x="11" y="250">'
        'Heatmap: Blue &lt;20km</text>'
        '<text fill="#ffa400" style="font-size:5px; font-family:Arial;" x="11" y="262">'
        'Orange 20-50 / Red &gt;50</text>'
        '<text fill="#FFFFFF" style="font-size:5px; font-family:Arial;" x="11" y="274">'
        'Routes: Over 10km</text>'
    )

    # Insert the legend before the first calendar circle so it remains in the
    # left metadata area without affecting the heatmap itself.
    if legend not in svg:
        svg = svg.replace("<circle", legend + "<circle", 1)
    return svg


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
