"""Builds the three app-screen clips of the judge deck from still frames of the current web app.

The frames in screens/frames/ are the desktop-light PNGs (1440x900, top of the page) of the
`ui-screens` workflow (packages/web/test/screens), scaled to 960x600, the size of the old
recordings. Each clip steps through two or three states with a short cross-fade and loops. Nothing is
mocked beyond what the screen tour already does (sandbox room, fake payments, example names).

Usage: python3 compose-screens.py [OUT_DIR]   (default: screens/)
"""

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
FRAMES = HERE / "screens" / "frames"
# clip -> [(frame, seconds on screen)]
CLIPS = {
    # The first frame is what a PDF export or LibreOffice shows, so it is the clearest state.
    "deck-hold": [("hold-2-limit-chosen", 2.2), ("hold-3-held", 2.4)],
    "deck-bids": [("bids-2-leading", 2.4), ("bids-3-outbid", 2.4)],
    "deck-hammer": [("hammer-1-live", 1.8), ("hammer-2-hold", 2.2), ("hammer-3-sold", 2.0)],
}
FADE_STEPS = 3
FADE_MS = 70


def clip(steps):
    imgs = [Image.open(FRAMES / f"{name}.png").convert("RGB") for name, _ in steps]
    frames, durations = [], []
    for i, ((_, secs), img) in enumerate(zip(steps, imgs)):
        frames.append(img)
        durations.append(int(secs * 1000))
        nxt = imgs[(i + 1) % len(imgs)]
        for k in range(1, FADE_STEPS + 1):
            frames.append(Image.blend(img, nxt, k / (FADE_STEPS + 1)))
            durations.append(FADE_MS)
    pal = [f.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
    return pal, durations


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "screens"
    out.mkdir(parents=True, exist_ok=True)
    for name, steps in CLIPS.items():
        pal, durations = clip(steps)
        path = out / f"{name}.gif"
        pal[0].save(path, save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True, disposal=1)
        print(f"{path} {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
