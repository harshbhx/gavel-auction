#!/usr/bin/env python3
"""Build the judge guide PDF from judge-guide.html.

Usage (from the repository root):

    python3 brand/devpost/judges/build.py
        Writes brand/devpost/judges/GAVEL-judge-guide.pdf. The guide has no placeholders and no
        secrets: the judge key and the sandbox logins live only in the Devpost Testing
        instructions.

    --out FILE  writes the PDF somewhere else.

    python3 brand/devpost/judges/build.py --fill FILE.json --out ~/judge-guide-FINAL.pdf
        Fills the Credentials page from a JSON file kept outside the repository (keys
        JUDGE_KEY and BUYER_A..D_EMAIL / BUYER_A..D_PASSWORD). The script refuses to write a
        filled PDF inside the repository. People run this at the last moment; it is never
        committed and no automated job passes a fill file.
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


FILL_KEYS = ["JUDGE_KEY"] + [f"BUYER_{r}_{f}" for r in "ABCD" for f in ("EMAIL", "PASSWORD")]
ROLES = {"A": "wallet, wins", "B": "wallet, spare", "C": "wallet, test card", "D": "wallet, loses"}


def credentials_html(values: dict) -> str:
    missing = [k for k in FILL_KEYS if not str(values.get(k, "")).strip()]
    if missing:
        raise SystemExit("fill file is missing: " + ", ".join(missing))
    e = lambda k: html.escape(str(values[k]).strip())
    rows = "".join(
        f'<tr><td class="key">{r} &middot; {ROLES[r]}</td><td>{e(f"BUYER_{r}_EMAIL")}</td>'
        f'<td>{e(f"BUYER_{r}_PASSWORD")}</td></tr>'
        for r in "ABCD"
    )
    return (
        '<div class="card card--ink"><p class="card__label">Shared judge key</p>'
        f'<p style="margin: 0"><code style="background: #3a2f26; color: #efe6d3">{e("JUDGE_KEY")}</code></p></div>'
        '<table class="access"><thead><tr><th class="key">Role</th><th>Email</th><th>Password</th></tr></thead>'
        f"<tbody>{rows}</tbody></table>"
    )


def inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(ROOT)
        return True
    except ValueError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--fill", type=Path, help="JSON file with the credentials (kept outside the repo)")
    parser.add_argument("--out", type=Path, help="output PDF path")
    parser.add_argument("--png", type=Path, help="folder for one PNG per page")
    args = parser.parse_args()

    out = args.out or DEFAULT_OUT
    source = SOURCE.read_text(encoding="utf-8")

    if args.fill:
        if inside_repo(out):
            print("refusing: a filled guide holds logins; write it outside the repository")
            return 2
        values = json.loads(args.fill.expanduser().read_text(encoding="utf-8"))
        source, n = re.subn(
            r"<!--CREDENTIALS-->.*?<!--/CREDENTIALS-->",
            lambda _m: credentials_html(values),
            source,
            flags=re.S,
        )
        if n != 1:
            raise SystemExit("credentials markers not found in judge-guide.html")

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
