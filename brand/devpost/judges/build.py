#!/usr/bin/env python3
"""Build the judge guide PDF from judge-guide.html.

Usage (from the repository root):

    python3 brand/devpost/judges/build.py
        Writes brand/devpost/judges/GAVEL-judge-guide.pdf. The guide has no placeholders and no
        secrets: the judge key and the sandbox logins live only in the Devpost Testing
        instructions.

    --out FILE  writes the PDF somewhere else.
    --png DIR   also renders every page as a PNG into DIR (needs pdftoppm from poppler-utils).

Needs: pip install weasyprint brotli (fontTools and Pillow come with WeasyPrint).
The brand fonts are variable WOFF2 files in packages/web/src/design/fonts; the script cuts
static instances of the weights the guide uses into a temporary folder, because a static
instance renders the same in every PDF reader.
"""

import argparse
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


def inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(ROOT)
        return True
    except ValueError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", type=Path, help="output PDF path")
    parser.add_argument("--png", type=Path, help="folder for one PNG per page")
    args = parser.parse_args()

    out = args.out or DEFAULT_OUT
    source = SOURCE.read_text(encoding="utf-8")

    from weasyprint import CSS, HTML
    from weasyprint.text.fonts import FontConfiguration

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        font_config = FontConfiguration()
        fonts_css = CSS(string=cut_fonts(tmp), font_config=font_config)
        style_css = CSS(filename=str(STYLE), font_config=font_config)
        document = HTML(string=source, base_url=str(HERE) + "/")
        document.write_pdf(out, stylesheets=[fonts_css, style_css], font_config=font_config)

    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")

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
