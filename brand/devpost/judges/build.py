#!/usr/bin/env python3
"""Build the confidential judge guide PDF from judge-guide.html.

Usage (from the repository root):

    python3 brand/devpost/judges/build.py
        Writes brand/devpost/judges/GAVEL-judge-guide.pdf with every placeholder left as a
        visible marked box. This is the only version that may be committed.

    python3 brand/devpost/judges/build.py --fill ~/secure/judge-fill.json --out ~/judge.pdf
        Replaces the placeholders with the values in the JSON file (keys as in
        placeholders.example.json). A filled PDF holds sandbox logins and the judge key, so the
        script refuses to write it anywhere inside the repository.

    --png DIR   also renders every page as a PNG into DIR (needs pdftoppm from poppler-utils).

Needs: pip install weasyprint brotli (fontTools and Pillow come with WeasyPrint).
The brand fonts are variable WOFF2 files in packages/web/src/design/fonts; the script cuts
static instances of the weights the guide uses into a temporary folder, because a static
instance renders the same in every PDF reader.
"""

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
FONT_DIR = ROOT / "packages" / "web" / "src" / "design" / "fonts"
SOURCE = HERE / "judge-guide.html"
STYLE = HERE / "judge-guide.css"
DEFAULT_OUT = HERE / "GAVEL-judge-guide.pdf"

# family name used in the CSS -> (variable font file, weights to cut)
FONTS = {
    "GV Display": ("big-shoulders-display-latin-wght-normal.woff2", [700, 800, 900]),
    "GV Sans": ("public-sans-latin-wght-normal.woff2", [400, 500, 600, 700, 800]),
    "GV Mono": ("jetbrains-mono-latin-wght-normal.woff2", [400, 500, 700]),
}

# Tolerates the line breaks a formatter puts inside the tag and around the text.
PLACEHOLDER = re.compile(r'<span\s+class="ph"\s+data-key="([A-Z0-9_]+)"\s*>([^<]*)</span\s*>')


def cut_fonts(tmp: Path) -> str:
    """Writes static TTF instances and returns the @font-face CSS for them."""
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    rules = []
    for family, (file_name, weights) in FONTS.items():
        for weight in weights:
            font = TTFont(FONT_DIR / file_name)
            static = instancer.instantiateVariableFont(font, {"wght": weight})
            static.flavor = None
            target = tmp / f"{family.replace(' ', '-')}-{weight}.ttf"
            static.save(target)
            rules.append(
                "@font-face { font-family: '%s'; font-weight: %d; font-style: normal; "
                "src: url('%s'); }" % (family, weight, target.as_uri())
            )
    return "\n".join(rules)


def fill(source: str, values: dict) -> str:
    missing = []

    def swap(match: re.Match) -> str:
        key = match.group(1)
        value = values.get(key, "")
        if not isinstance(value, str) or value.strip() == "":
            missing.append(key)
            return match.group(0)
        return '<span class="ph filled" data-key="%s">%s</span>' % (key, html.escape(value))

    out = PLACEHOLDER.sub(swap, source)
    if missing:
        print("not filled (left as placeholders): " + ", ".join(sorted(set(missing))))
    return out


def inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(ROOT)
        return True
    except ValueError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--fill", type=Path, help="JSON file with placeholder values")
    parser.add_argument("--out", type=Path, help="output PDF path")
    parser.add_argument("--png", type=Path, help="folder for one PNG per page")
    args = parser.parse_args()

    out = args.out or DEFAULT_OUT
    source = SOURCE.read_text(encoding="utf-8")
    keys = sorted(set(m.group(1) for m in PLACEHOLDER.finditer(source)))

    if args.fill:
        if inside_repo(out):
            print("refusing: a filled guide holds logins; write it outside the repository")
            return 2
        values = json.loads(args.fill.expanduser().read_text(encoding="utf-8"))
        source = fill(source, values)

    from weasyprint import CSS, HTML
    from weasyprint.text.fonts import FontConfiguration

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        font_config = FontConfiguration()
        fonts_css = CSS(string=cut_fonts(tmp), font_config=font_config)
        style_css = CSS(filename=str(STYLE), font_config=font_config)
        document = HTML(string=source, base_url=str(HERE) + "/")
        document.write_pdf(out, stylesheets=[fonts_css, style_css], font_config=font_config)

    print(f"wrote {out} ({out.stat().st_size // 1024} KB), placeholders: {', '.join(keys)}")

    if args.png:
        if shutil.which("pdftoppm") is None:
            print("pdftoppm not found, skipped the PNG pages")
            return 0
        args.png.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["pdftoppm", "-png", "-r", "80", str(out), str(args.png / "page")], check=True
        )
        print(f"pages rendered to {args.png}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
