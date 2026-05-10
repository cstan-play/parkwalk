"""
Extract per-frame PNGs from the directional dog GIFs in ./source/.

Input layout (one GIF per direction, animated walk cycle):
    source/sprite_walk-4-frames_<long-direction>.gif

Output layout (one PNG per frame):
    dog-<short-direction>-<frame_index>.png

`<short-direction>` matches the existing `SpriteDirection` enum in
mobile/src/companion/direction.ts: n, ne, e, se, s, sw, w, nw. Same
naming convention used by the original arrow placeholders so the
runtime sprite-id pattern stays consistent.

The script is idempotent and safe to re-run: it reads whatever sources
are currently in source/ and overwrites matching outputs. Sources
not yet uploaded are skipped with a warning, NOT errored. This lets
you upload the 8 directions incrementally without breaking the build.

Usage:
    cd mobile/src/assets/companion
    python3 _extract_dog_frames.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

LONG_TO_SHORT = {
    "north": "n",
    "north-east": "ne",
    "east": "e",
    "south-east": "se",
    "south": "s",
    "south-west": "sw",
    "west": "w",
    "north-west": "nw",
}

SOURCE_PATTERN = "sprite_walk-4-frames_{long}.gif"


def extract(source_path: Path, output_dir: Path, short_dir: str) -> int:
    """Write one PNG per frame; return number of frames written."""
    written = 0
    with Image.open(source_path) as im:
        try:
            while True:
                frame_idx = im.tell()
                # Convert to RGBA so transparency is preserved across modes.
                rgba = im.convert("RGBA")
                out = output_dir / f"dog-{short_dir}-{frame_idx}.png"
                rgba.save(out, format="PNG")
                written += 1
                im.seek(frame_idx + 1)
        except EOFError:
            pass
    return written


def main() -> None:
    here = Path(__file__).resolve().parent
    src_dir = here / "source"
    if not src_dir.is_dir():
        raise SystemExit(f"Missing source dir: {src_dir}")

    written_total = 0
    skipped: list[str] = []
    for long_name, short_name in LONG_TO_SHORT.items():
        src = src_dir / SOURCE_PATTERN.format(long=long_name)
        if not src.is_file():
            skipped.append(long_name)
            continue
        n = extract(src, here, short_name)
        print(f"  {long_name:<11} -> dog-{short_name}-[0..{n-1}].png  ({n} frames)")
        written_total += n

    if skipped:
        print()
        print("Skipped (source GIF not present yet):")
        for s in skipped:
            print(f"  - {s} (expected: source/{SOURCE_PATTERN.format(long=s)})")

    print()
    print(f"Wrote {written_total} frames across {len(LONG_TO_SHORT) - len(skipped)} directions.")


if __name__ == "__main__":
    main()
