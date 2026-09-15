"""Generate strictly-monochrome Algorith Voice icons (black/white/gray only).

Run:  python icons/generate.py   (from apps/desktop/src-tauri/)
Outputs the Tauri-expected set: 32x32.png, 128x128.png, 128x128@2x.png,
icon.png (512), icon.ico (multi-size), icon.icns, plus tray states.
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


def _bars(d: ImageDraw.ImageDraw, size: int, heights: list[float], fill: tuple) -> None:
    """Waveform glyph: 3 vertical bars of varying height, monochrome."""
    cx, cy = size / 2, size / 2
    gap = size / 5
    w = max(2, size // 11)
    for i, h in enumerate(heights):
        x = cx + (i - 1) * gap
        bh = (size / 2 - size // 8) * h
        d.rounded_rectangle([x - w / 2, cy - bh, x + w / 2, cy + bh], radius=w // 2, fill=fill)


def tray(state: str, size: int = 32) -> Image.Image:
    img = Image.new("RGBA", (size, size), CLEAR)
    d = ImageDraw.Draw(img)
    if state == "idle":
        _bars(d, size, [0.45, 1.0, 0.65], BLACK)
    elif state == "recording":
        # Emphasized amplitude frame (Rust swaps frames for the pulse in Phase 2)
        _bars(d, size, [0.7, 1.0, 0.85], BLACK)
    elif state == "processing":
        # Single bar loader
        _bars(d, size, [0.0, 1.0, 0.0], BLACK)
    else:
        raise ValueError(state)
    return img


def main() -> None:
    app_icon(512).save(os.path.join(HERE, "icon.png"))
    app_icon(32).save(os.path.join(HERE, "32x32.png"))
    app_icon(128).save(os.path.join(HERE, "128x128.png"))
    app_icon(256).save(os.path.join(HERE, "128x128@2x.png"))
    app_icon(256).save(os.path.join(HERE, "icon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    try:
        app_icon(512).save(os.path.join(HERE, "icon.icns"))
    except Exception as exc:  # Pillow icns writer may be unavailable; bundler needs it on macOS CI
        print(f"icns skipped: {exc}")
    for state in ("idle", "recording", "processing"):
        tray(state).save(os.path.join(HERE, f"tray-{state}.png"))
    print("icons written to", HERE)


if __name__ == "__main__":
    main()
