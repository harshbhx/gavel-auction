"""Renders the raster assets of the judge deck into an output folder.

Display type is set in the brand display face (Big Shoulders Display, weight 800) and saved as
transparent PNG at 300 dpi, so the deck shows the brand type in PowerPoint, Keynote and Google
Slides without the font installed. Every image carries its text as alt text in the deck.
Also draws the logo mark, the problem icons, the auction paddles, the hatched hold bar and the
voice waveform. Writes manifest.json (id -> file, size in inches, cap top offset, text).

Usage: python3 assets.py OUT_DIR
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
FONT = REPO / "packages/web/src/design/fonts/big-shoulders-display-latin-wght-normal.woff2"
DPI = 300

COLORS = {
    "ink": (0x1D, 0x17, 0x12, 255),
    "paper": (0xEF, 0xE6, 0xD3, 255),
    "orange": (0xFF, 0x6A, 0x1F, 255),
    # Orange for display type on paper: 3.5:1 on the paper colour (large text needs 3:1).
    "deep": (0xD2, 0x50, 0x0F, 255),
    "muted": (0xA8, 0x9C, 0x8A, 255),
}

# Display copy. Each item: size in points, lines of (text, colour) runs, optional line height.
DISPLAY = {
    # 1 cover
    "hero_l1": {"size": 132, "lines": [[("EVERY BID", "paper")]]},
    "hero_l2a": {"size": 132, "lines": [[("IS A", "paper")]]},
    "hero_l2b": {"size": 132, "lines": [[("HOLD.", "orange")]]},
    "hero_tag": {"size": 40, "lines": [[("THE HAMMER IS THE PAYMENT.", "paper")]]},
    # 2 hook
    "hook_200": {"size": 200, "lines": [[("$200", "paper")]]},
    "hook_400": {"size": 56, "lines": [[("$400", "orange")]]},
    # 3 problem
    "prob_h": {
        "size": 60,
        "lines": [[("PAY FIRST, OR TRUST LATER.", "ink")], [("BOTH LOSE THE ROOM.", "deep")]],
    },
    "prob_w1": {"size": 36, "lines": [[("CHARGE FIRST", "ink")]]},
    "prob_w2": {"size": 36, "lines": [[("PAY LATER", "ink")]]},
    "prob_w3": {"size": 36, "lines": [[("PAPER SHEET", "ink")]]},
    # 4 idea
    "idea_h": {"size": 80, "lines": [[("HOLD,", "orange"), (" NOT CHARGE.", "paper")]]},
    "idea_500": {"size": 48, "lines": [[("$500", "paper")]]},
    "idea_350": {"size": 48, "lines": [[("$350", "orange")]]},
    # 5 how it works
    "how_h": {"size": 60, "lines": [[("FOUR MOVES. ", "ink"), ("ONE MONEY RULE.", "deep")]]},
    "how_w1": {"size": 54, "lines": [[("HOLD", "ink")]]},
    "how_w2": {"size": 54, "lines": [[("BID", "ink")]]},
    "how_w3": {"size": 54, "lines": [[("HAMMER", "ink")]]},
    "how_w4": {"size": 54, "lines": [[("RECEIPT", "ink")]]},
    # 6 how it feels
    "feel_h": {"size": 60, "lines": [[("PICK A CEILING. ", "paper"), ("THEN BID.", "orange")]]},
    # 7 voice
    "voice_h": {"size": 60, "lines": [[("SAY IT. ", "ink"), ("THEN CONFIRM.", "deep")]]},
    "voice_q": {
        "size": 40,
        "lines": [[("DID YOU MEAN $350", "ink")], [("FOR PADDLE 12?", "ink")]],
    },
    # 8 hammer
    "ham_h": {"size": 60, "lines": [[("HOLD THE ", "paper"), ("HAMMER.", "orange")]]},
    "ham_sold": {"size": 84, "lines": [[("SOLD.", "orange")]]},
    # 9 verify
    "ver_h": {"size": 60, "lines": [[("DO NOT TRUST. ", "ink"), ("VERIFY.", "deep")]]},
    "ver_e1": {"size": 32, "lines": [[("HOLD", "ink")]]},
    "ver_e2": {"size": 32, "lines": [[("BID $300", "ink")]]},
    "ver_e3": {"size": 32, "lines": [[("BID $350", "ink")]]},
    "ver_e4": {"size": 32, "lines": [[("HAMMER", "ink")]]},
    # 10 under the hood
    "arch_h": {"size": 60, "lines": [[("ONE BID. ", "paper"), ("FOUR STOPS.", "orange")]]},
    "arch_w1": {"size": 34, "lines": [[("BROWSER", "paper")]]},
    "arch_w2": {"size": 34, "lines": [[("CLOUDFLARE", "paper")]]},
    "arch_w3": {"size": 34, "lines": [[("RENDER", "paper")]]},
    "arch_w4": {"size": 34, "lines": [[("PAYPAL", "paper")]]},
    # 11 proof
    "proof_h": {"size": 60, "lines": [[("BUILT. THEN ", "paper"), ("PROVEN.", "orange")]]},
    "proof_n1": {"size": 80, "lines": [[("1", "orange")]]},
    "proof_n2": {"size": 80, "lines": [[("24/24", "orange")]]},
    "proof_n3": {"size": 80, "lines": [[("17/17", "orange")]]},
    "proof_n4": {"size": 80, "lines": [[("4,500+", "orange")]]},
    "proof_u1": {"size": 26, "lines": [[("CAPTURE", "paper")]]},
    "proof_u2": {"size": 26, "lines": [[("VOICE CLIPS", "paper")]]},
    "proof_u3": {"size": 26, "lines": [[("JUDGE STEPS", "paper")]]},
    "proof_u4": {"size": 26, "lines": [[("TEST CASES", "paper")]]},
    # 12 performance
    "ps_h": {
        "size": 60,
        "lines": [[("A ", "ink"), ("PERFECT", "deep"), (" LANDING.", "ink")]],
    },
    "ps_100": {"size": 60, "lines": [[("100", "ink")]]},
    # 13 team
    "team_h": {"size": 60, "lines": [[("TWO ", "orange"), ("BUILDERS.", "paper")]]},
    "team_hb": {"size": 54, "lines": [[("HB", "paper")]]},
    "team_dp": {"size": 54, "lines": [[("DP", "paper")]]},
    "team_n1": {"size": 40, "lines": [[("HARSH BHANUSHALI", "paper")]]},
    "team_n2": {"size": 40, "lines": [[("DHAIRYA PATEL", "paper")]]},
    # 14 close
    "close_tag": {"size": 36, "lines": [[("THE HAMMER IS THE PAYMENT.", "paper")]]},
}


def px(inches):
    return int(round(inches * DPI))


def load_font(size_px, weight=800):
    font = ImageFont.truetype(str(FONT), size_px, layout_engine=ImageFont.Layout.RAQM)
    font.set_variation_by_axes([weight])
    return font


def render_display(spec):
    size_px = int(round(spec["size"] * DPI / 72))
    font = load_font(size_px, spec.get("weight", 800))
    line_h = spec.get("lh", 0.94) * size_px
    cap_h = -font.getbbox("H", anchor="ls")[1]
    lines = spec["lines"]
    widths = [sum(font.getlength(t) for t, _ in line) for line in lines]
    pad = size_px
    width = int(max(widths) + 2 * pad)
    height = int(cap_h + line_h * (len(lines) - 1) + 2 * pad)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        base = pad + cap_h + i * line_h
        x = pad
        for text, colour in line:
            draw.text((x, base), text, font=font, fill=COLORS[colour], anchor="ls")
            x += font.getlength(text)
    box = img.getbbox()
    cap_top = (pad - box[1]) / DPI
    img = img.crop(box)
    text = " ".join("".join(t for t, _ in line).strip() for line in lines)
    return img, cap_top, text


def supersampled(w_in, h_in, draw_fn, scale=4):
    big = Image.new("RGBA", (px(w_in) * scale, px(h_in) * scale), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(big), big.size, scale)
    return big.resize((px(w_in), px(h_in)), Image.LANCZOS)


def mark(colour_g, size_in=2.0):
    """The GAVEL mark from brand/logo/*/mark.svg (viewBox 100): an open G, a bar, the mallet."""

    def draw(d, size, _s):
        u = size[0] / 100.0
        # Arc: centre 50,50, radius 39, stroke 22, open between -42 and 0 degrees.
        d.arc([0, 0, 100 * u, 100 * u], start=0, end=318, fill=COLORS[colour_g], width=int(22 * u))
        d.rectangle([40 * u, 43.5 * u, 100 * u, 56.5 * u], fill=COLORS[colour_g])
        d.rounded_rectangle([32 * u, 33 * u, 48 * u, 67 * u], radius=3 * u, fill=COLORS["orange"])

    return supersampled(size_in, size_in, draw)


def icon(kind, size_in=1.0):
    """A paper line icon on an ink disc, for the problem slide."""

    def draw(d, size, _s):
        s = size[0]
        d.ellipse([0, 0, s - 1, s - 1], fill=COLORS["ink"])
        w = int(s * 0.045)
        c = COLORS["paper"]
        if kind == "card":
            d.rounded_rectangle([s * 0.24, s * 0.33, s * 0.76, s * 0.67], radius=s * 0.04, outline=c, width=w)
            d.rectangle([s * 0.24, s * 0.41, s * 0.76, s * 0.47], fill=c)
            d.rectangle([s * 0.31, s * 0.55, s * 0.43, s * 0.6], fill=c)
        elif kind == "door":
            d.line([s * 0.52, s * 0.28, s * 0.3, s * 0.28, s * 0.3, s * 0.72, s * 0.52, s * 0.72], fill=c, width=w, joint="curve")
            d.line([s * 0.42, s * 0.5, s * 0.74, s * 0.5], fill=c, width=w)
            d.line([s * 0.64, s * 0.4, s * 0.75, s * 0.5, s * 0.64, s * 0.6], fill=c, width=w, joint="curve")
        elif kind == "sheet":
            d.line([s * 0.33, s * 0.25, s * 0.57, s * 0.25, s * 0.68, s * 0.36, s * 0.68, s * 0.75, s * 0.33, s * 0.75, s * 0.33, s * 0.25], fill=c, width=w, joint="curve")
            for y in (0.45, 0.55, 0.65):
                d.line([s * 0.41, s * y, s * 0.6, s * y], fill=c, width=int(w * 0.8))

    return supersampled(size_in, size_in, draw)


def paddle(number):
    """An auction paddle: a paper disc with the paddle number, on a handle."""
    w_in, h_in = 1.6, 3.0

    def draw(d, size, s):
        w = size[0]
        d.rounded_rectangle([w * 0.42, w * 0.9, w * 0.58, size[1]], radius=w * 0.05, fill=COLORS["muted"])
        d.ellipse([0, 0, w - 1, w - 1], fill=COLORS["paper"])
        font = load_font(int(0.8 * DPI * s))
        d.text((w / 2, w / 2), str(number), font=font, fill=COLORS["ink"], anchor="mm")

    return supersampled(w_in, h_in, draw)


def hatch(w_in=9.0, h_in=0.62):
    """The brand's held pattern: orange diagonal hatching in an orange outline."""

    def draw(d, size, s):
        w, h = size
        step = int(0.16 * DPI * s)
        lw = int(0.045 * DPI * s)
        for x in range(-h, w + h, step):
            d.line([x, h, x + h, 0], fill=COLORS["orange"], width=lw)
        b = int(0.018 * DPI * s)
        d.rectangle([0, 0, w - 1, h - 1], outline=COLORS["orange"], width=b)

    img = supersampled(w_in, h_in, draw)
    return img


def wave(w_in=5.8, h_in=1.3, bars=58):
    """A speech waveform: bars of varying height, centred on the mid line."""

    def draw(d, size, _s):
        w, h = size
        slot = w / bars
        bw = slot * 0.55
        for i in range(bars):
            env = math.sin(math.pi * (i + 0.5) / bars) ** 0.6
            amp = 0.18 + 0.82 * env * abs(math.sin(i * 0.62) * math.cos(i * 0.21 + 0.4))
            amp = max(amp, 0.08)
            bh = h * amp
            x = i * slot + (slot - bw) / 2
            colour = COLORS["deep"] if 18 <= i <= 36 else COLORS["ink"]
            d.rounded_rectangle([x, (h - bh) / 2, x + bw, (h + bh) / 2], radius=bw / 2, fill=colour)

    return supersampled(w_in, h_in, draw)


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else HERE.parent / ".build")
    img_dir = out / "img"
    img_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}

    def save(key, img, text, cap_top=0.0):
        path = img_dir / f"{key}.png"
        img.save(path, optimize=True)
        manifest[key] = {
            "file": str(path),
            "w": round(img.size[0] / DPI, 4),
            "h": round(img.size[1] / DPI, 4),
            "cap": round(cap_top, 4),
            "text": text,
        }

    for key, spec in DISPLAY.items():
        img, cap_top, text = render_display(spec)
        save(key, img, text, cap_top)

    save("mark_dark", mark("paper"), "GAVEL logo mark")
    save("mark_paper", mark("ink"), "GAVEL logo mark")
    save("icon_card", icon("card"), "Card icon")
    save("icon_door", icon("door"), "Walking away icon")
    save("icon_sheet", icon("sheet"), "Paper sheet icon")
    save("paddle_23", paddle(23), "Auction paddle 23")
    save("paddle_41", paddle(41), "Auction paddle 41")
    save("hatch", hatch(), "Hatched bar: the full ceiling is held")
    save("wave", wave(), "Speech waveform")

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"{len(manifest)} assets in {img_dir}")


if __name__ == "__main__":
    main()
