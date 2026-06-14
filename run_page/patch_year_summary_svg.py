"""Post-process generated year summary SVGs for cycling pages.

The upstream year summary drawer uses fixed x positions that work for short
running stats, but cycling stats often have longer values. This script adds
more horizontal room for units and shortens the footer so labels do not overlap
in the left status area of the SVG.
"""

from pathlib import Path
import re


ASSETS_DIR = Path("assets")
YEAR_SUMMARY_GLOB = "year_summary*.svg"


def replace_text_attr(fragment: str, attr: str, value: str) -> str:
    if re.search(rf'{attr}="[^"]*"', fragment):
        return re.sub(rf'{attr}="[^"]*"', f'{attr}="{value}"', fragment, count=1)
    return fragment


def patch_svg_text(svg: str) -> str:
    # Keep the footer compact. The original text can be long after the repo was
    # renamed from running_page to cycling_page.
    svg = re.sub(r">(?:running_page|cycling_page)/(\d{4})<", r">cycling / \1<", svg)
    svg = svg.replace(">Running for ", ">Cycling for ")
    svg = svg.replace(">Runs<", ">Rides<")
    svg = svg.replace(">Runner<", ">Cyclist<")
    svg = svg.replace(">Avg Pace<", ">Avg Speed<")

    # Unit labels in the status block are emitted with fixed positions. Move
    # them to the right so larger cycling totals such as 1000+ km / 100+ h do
    # not collide with the numeric value.
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

    svg = re.sub(r"<text([^>]*)>(km|h|d)</text>", move_unit, svg)

    # Make the bottom footer slightly smaller and keep it away from the athlete
    # name. This prevents the last status text from looking cramped.
    def patch_footer(match: re.Match[str]) -> str:
        attrs = match.group(1)
        text = match.group(2)
        attrs = replace_text_attr(attrs, "y", "288")
        attrs = re.sub(r"font-size:[0-9.]+px", "font-size:5.5px", attrs)
        return f"<text{attrs}>{text}</text>"

    svg = re.sub(
        r"<text([^>]*y=\"285\.[^>]*?)>(cycling / \d{4})</text>",
        patch_footer,
        svg,
    )

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
