"""
Generates 8 directional arrow PNGs as placeholders for the digital-dog
sprite. Each arrow is a single asymmetric shape rotated by 45° steps so
all 8 directions are visually distinct.

Usage: python3 _generate_arrows.py
Re-run any time the design changes; outputs are checked into the repo.
"""
from __future__ import annotations

import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).parent
SIZE = 64           # final PNG size in px
SUPER = 4           # supersample factor for antialiasing
COLOR = (220, 38, 38, 255)   # #DC2626 (matches existing red palette)

# Compass bearings (0 = N, 90 = E, ...)
DIRECTIONS = [
    ("n",  0),
    ("ne", 45),
    ("e",  90),
    ("se", 135),
    ("s",  180),
    ("sw", 225),
    ("w",  270),
    ("nw", 315),
]


def draw_arrow(bearing_deg: float) -> Image.Image:
    """Draw a single arrow at the given compass bearing.

    Shape is an asymmetric chevron (tip + two wings + indented tail) so
    rotation produces 8 visually distinct silhouettes — particularly the
    intercardinals can't be confused with the cardinals.
    """
    canvas = SIZE * SUPER
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx = cy = canvas / 2
    # In screen coordinates Y points down. A bearing of 0 (N) means the
    # tip points up, so dy is negative.
    rad = math.radians(bearing_deg)
    fwd = (math.sin(rad), -math.cos(rad))           # forward unit vector
    side = (-fwd[1], fwd[0])                         # 90° clockwise of fwd

    tip_r   = canvas * 0.42       # tip distance from center
    wing_r  = canvas * 0.28       # wing distance from center, along fwd (back from tip)
    wing_w  = canvas * 0.32       # wing half-width perpendicular to fwd
    tail_r  = canvas * 0.04       # tail indent depth (positive = indented inward)

    def pt(forward: float, lateral: float) -> tuple[float, float]:
        return (
            cx + fwd[0] * forward + side[0] * lateral,
            cy + fwd[1] * forward + side[1] * lateral,
        )

    polygon = [
        pt(tip_r, 0),                # tip
        pt(-wing_r, wing_w),          # right wing
        pt(-wing_r + tail_r * 4, 0),  # tail notch (indented forward → chevron)
        pt(-wing_r, -wing_w),         # left wing
    ]

    draw.polygon(polygon, fill=COLOR)

    # Downsample for antialiasing
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    for name, bearing in DIRECTIONS:
        out = OUT_DIR / f"arrow-{name}.png"
        draw_arrow(bearing).save(out)
        print(f"wrote {out.name}")


if __name__ == "__main__":
    main()
