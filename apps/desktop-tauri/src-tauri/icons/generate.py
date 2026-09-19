"""Generate strictly-monochrome Algorith Voice icons (black/white/gray only).

WARNING: the shipped bundle icons (32x32.png, 64x64.png, 128x128.png,
128x128@2x.png, icon.png, icon.ico) are generated from the real
product artwork via `tauri icon`, NOT by this script:
  source : assets/transparent_logo_1024x1024.png (1024x1024, alpha)
  master : assets/app-icon-tile-1024.png (black rounded tile + alpha
           corners, composited for light-taskbar contrast)
  command: pnpm exec tauri icon ../../assets/app-icon-tile-1024.png
Re-running this script OVERWRITES the bundle icons with the monochrome
placeholder — only re-run it if you intend to revert to that design.
Safe use: `python icons/generate.py` solely to refresh tray-*.png glyphs
(then `git checkout` the bundle icons if they were clobbered).

Run:  python icons/generate.py   (from apps/desktop-tauri/src-tauri/)
Outputs the Windows-expected set: 32x32.png, 128x128.png, 128x128@2x.png,
icon.png (512), icon.ico (multi-size), plus tray states.
"""
from PIL import Image, ImageDraw

import os

HERE = os.path.dirname(os.path.abspath(__file__))
BLACK = (0, 0, 0, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)


def app_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), CLEAR)
    d = ImageDraw.Draw(img)
    pad = size // 8
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=size // 8, fill=BLACK)
    # brand mark: 4 sharp vertical bars, logo proportions [0.46, 1.0, 0.75, 0.39]
    cx, cy = size / 2, size / 2
    heights = [0.46, 1.0, 0.75, 0.39]
    span = size * 0.58
    w = span * 0.2
    gap = span * 0.1067
    max_h = size * 0.5
    for i, h in enumerate(heights):
        x = cx + (i - 1.5) * (w + gap)
        bh = max_h * h / 2
        d.rectangle([x - w / 2, cy - bh, x + w / 2, cy + bh], fill=WHITE)
    return img


def _white_bars(d: ImageDraw.ImageDraw, size: int, heights: list[float]) -> None:
    """White waveform bars on the black tile (sharp rects stay crisp at 16px)."""
    cx, cy = size / 2, size / 2
    span = size * 0.58
    w = span * 0.2
    gap = span * 0.1067
    max_h = size * 0.62
    n = len(heights)
    for i, h in enumerate(heights):
        if h <= 0:
            continue
        x = cx + (i - (n - 1) / 2) * (w + gap)
        bh = max_h * h / 2
        d.rectangle(
            [round(x - w / 2), round(cy - bh), round(x + w / 2), round(cy + bh)],
            fill=WHITE,
        )


def tray(state: str, size: int = 32) -> Image.Image:
    # Full-bleed black tile: transparent glyphs vanish on dark Windows
    # taskbars, so every state carries its own black background.
    img = Image.new("RGBA", (size, size), BLACK)
    d = ImageDraw.Draw(img)
    if state == "idle":
        # Product mark proportions, cf. assets/logo.png
        _white_bars(d, size, [0.46, 1.0, 0.75, 0.39])
    elif state == "recording":
        # Emphasized amplitude frame (Rust swaps frames for the pulse in Phase 2)
        _white_bars(d, size, [0.7, 1.0, 0.85, 0.6])
    elif state == "processing":
        # Single bar loader
        _white_bars(d, size, [1.0])
    else:
        raise ValueError(state)
    return img


def main() -> None:
    app_icon(512).save(os.path.join(HERE, "icon.png"))
    app_icon(32).save(os.path.join(HERE, "32x32.png"))
    app_icon(128).save(os.path.join(HERE, "128x128.png"))
    app_icon(256).save(os.path.join(HERE, "128x128@2x.png"))
    app_icon(256).save(os.path.join(HERE, "icon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    for state in ("idle", "recording", "processing"):
        tray(state).save(os.path.join(HERE, f"tray-{state}.png"))
    print("icons written to", HERE)


if __name__ == "__main__":
    main()
