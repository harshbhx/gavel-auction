"""Turns deck-raw.pptx into the finished judge deck.

- Writes the GAVEL colours into the theme (pptxgenjs ships Office's palette).
- Adds a transition to every slide: Fade, or Morph with a Fade fallback for the logo glides.
- Adds the build animations listed in motion.json: entrance effects that start on their own after
  the slide appears (no clicks), one after another or together, with delays in milliseconds.

The slide XML is edited as text, never re-serialised, so namespace prefixes stay as written.
Usage: python3 finalize.py OUT_DIR TARGET.pptx
"""

import json
import re
import sys
import zipfile
from pathlib import Path

THEME = {
    "dk1": "1D1712",
    "lt1": "EFE6D3",
    "dk2": "2A231D",
    "lt2": "F7F1E4",
    "accent1": "FF6A1F",
    "accent2": "D2500F",
    "accent3": "A89C8A",
    "accent4": "6B5F52",
    "accent5": "3D342B",
    "accent6": "D8CCB5",
    "hlink": "FF6A1F",
    "folHlink": "D2500F",
}
SLOTS = list(THEME)

TRANSITIONS = {
    None: "",
    "fade": '<p:transition spd="med"><p:fade/></p:transition>',
    "morph": (
        '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
        '<mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" '
        'xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p159">'
        '<p:transition spd="slow" p14:dur="1600"><p159:morph option="byObject"/></p:transition>'
        "</mc:Choice>"
        '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback>'
        "</mc:AlternateContent>"
    ),
}

# effect -> (presetID, presetClass, presetSubtype)
PRESETS = {
    "fade": (10, "entr", 0),
    "float": (42, "entr", 0),
    "wipe": (22, "entr", None),
    "zoom": (53, "entr", 16),
    "zoomTurn": (31, "entr", 0),
    "wheel": (21, "entr", 1),
    "path": (0, "path", 0),
    "exitFade": (10, "exit", 0),
    "exitRight": (2, "exit", 2),
    "pulse": (26, "emph", 0),
}
WIPE = {"left": (8, "wipe(left)"), "right": (2, "wipe(right)"), "up": (1, "wipe(up)"), "down": (4, "wipe(down)")}


class Ids:
    def __init__(self):
        self.n = 0

    def __call__(self):
        self.n += 1
        return self.n


def val(v):
    if isinstance(v, (int, float)):
        return f'<p:fltVal val="{v}"/>'
    return f'<p:strVal val="{v}"/>'


def tgt(spid):
    return f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'


def set_vis(ids, spid, value, delay=0):
    return (
        f'<p:set><p:cBhvr><p:cTn id="{ids()}" dur="1" fill="hold"><p:stCondLst>'
        f'<p:cond delay="{delay}"/></p:stCondLst></p:cTn>{tgt(spid)}<p:attrNameLst>'
        f"<p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>"
        f'<p:to><p:strVal val="{value}"/></p:to></p:set>'
    )


def anim(ids, spid, attr, frm, to, dur, ease=""):
    return (
        f'<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base">'
        f'<p:cTn id="{ids()}" dur="{dur}" fill="hold"{ease}/>{tgt(spid)}'
        f"<p:attrNameLst><p:attrName>{attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst>"
        f'<p:tav tm="0"><p:val>{val(frm)}</p:val></p:tav>'
        f'<p:tav tm="100000"><p:val>{val(to)}</p:val></p:tav></p:tavLst></p:anim>'
    )


def effect_filter(ids, spid, filt, dur, direction="in"):
    return (
        f'<p:animEffect transition="{direction}" filter="{filt}"><p:cBhvr>'
        f'<p:cTn id="{ids()}" dur="{dur}"/>{tgt(spid)}</p:cBhvr></p:animEffect>'
    )


def behaviours(ids, a, spid):
    kind, dur = a["fx"], a["dur"]
    decel = ' decel="100000"'
    if kind == "fade":
        return set_vis(ids, spid, "visible") + effect_filter(ids, spid, "fade", dur)
    if kind == "float":
        rise = a.get("rise", 0.06)
        return (
            set_vis(ids, spid, "visible")
            + effect_filter(ids, spid, "fade", dur)
            + anim(ids, spid, "ppt_x", "#ppt_x", "#ppt_x", dur, decel)
            + anim(ids, spid, "ppt_y", f"#ppt_y+{rise}", "#ppt_y", dur, decel)
        )
    if kind == "wipe":
        return set_vis(ids, spid, "visible") + effect_filter(ids, spid, WIPE[a["dir"]][1], dur)
    if kind in ("zoom", "zoomTurn"):
        f = a.get("from", 0.5)
        out = (
            set_vis(ids, spid, "visible")
            + anim(ids, spid, "ppt_w", f"#ppt_w*{f}", "#ppt_w", dur, decel)
            + anim(ids, spid, "ppt_h", f"#ppt_h*{f}", "#ppt_h", dur, decel)
        )
        if a.get("rotate"):
            out += anim(ids, spid, "style.rotation", a["rotate"], 0, dur, decel)
        return out + effect_filter(ids, spid, "fade", max(1, int(dur * 0.7)))
    if kind == "wheel":
        return set_vis(ids, spid, "visible") + effect_filter(ids, spid, "wheel(1)", dur)
    if kind == "path":
        (x0, y0), (x1, y1) = a["path"]
        p = f"M {x0:.5f} {y0:.5f} L {x1:.5f} {y1:.5f} E"
        return (
            f'<p:animMotion origin="layout" path="{p}" pathEditMode="relative" rAng="0" ptsTypes="AA">'
            f'<p:cBhvr><p:cTn id="{ids()}" dur="{dur}" fill="hold"/>{tgt(spid)}'
            f"<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName>"
            f'</p:attrNameLst></p:cBhvr><p:rCtr x="0" y="0"/></p:animMotion>'
        )
    if kind == "exitFade":
        return effect_filter(ids, spid, "fade", dur, "out") + set_vis(ids, spid, "hidden", dur - 1)
    if kind == "exitRight":
        accel = ' accel="100000"'
        return (
            anim(ids, spid, "ppt_x", "ppt_x", "1+ppt_w/2", dur, accel)
            + anim(ids, spid, "ppt_y", "ppt_y", "ppt_y", dur, accel)
            + set_vis(ids, spid, "hidden", dur - 1)
        )
    if kind == "pulse":
        half = dur // 2
        return (
            f'<p:animScale><p:cBhvr><p:cTn id="{ids()}" dur="{half}" autoRev="1" fill="hold"/>'
            f'{tgt(spid)}</p:cBhvr><p:by x="108000" y="108000"/></p:animScale>'
        )
    raise ValueError(f"unknown effect {kind}")


def shapes(xml):
    """Maps shape name -> (id, 'sp' or 'pic') from the slide XML."""
    found = {}
    for m in re.finditer(r"<p:(sp|pic)>\s*<p:nv(?:Sp|Pic)Pr>\s*<p:cNvPr id=\"(\d+)\" name=\"([^\"]*)\"", xml):
        kind, spid, name = m.groups()
        name = name.replace("&amp;", "&")
        if name in found:
            raise ValueError(f"duplicate shape name {name}")
        found[name] = (int(spid), kind)
    return found


def timing(anims, found):
    if not anims:
        return ""
    groups = []
    for a in anims:
        if a["start"] == "after" or not groups:
            groups.append([])
        groups[-1].append(a)
    ids = Ids()
    root, main, click = ids(), ids(), ids()
    body = []
    grp_ids = {}
    builds = []
    t = 0
    for g in groups:
        gid = ids()
        effects = []
        for i, a in enumerate(g):
            if a["name"] not in found:
                raise KeyError(f"no shape named {a['name']}")
            spid, kind = found[a["name"]]
            grp = grp_ids.get(spid, -1) + 1
            grp_ids[spid] = grp
            preset_name = "zoomTurn" if a["fx"] == "zoom" and a.get("rotate") else a["fx"]
            pid, pclass, psub = PRESETS[preset_name]
            if a["fx"] == "wipe":
                psub = WIPE[a["dir"]][0]
            node = "afterEffect" if i == 0 else "withEffect"
            ease = ' accel="50000" decel="50000"' if a["fx"] == "path" else ""
            eid = ids()
            inner = behaviours(ids, a, spid)
            effects.append(
                f'<p:par><p:cTn id="{eid}" presetID="{pid}" presetClass="{pclass}" '
                f'presetSubtype="{psub}"{ease} fill="hold" grpId="{grp}" nodeType="{node}">'
                f'<p:stCondLst><p:cond delay="{a["delay"]}"/></p:stCondLst>'
                f"<p:childTnLst>{inner}</p:childTnLst></p:cTn></p:par>"
            )
            if kind == "sp":
                builds.append(f'<p:bldP spid="{spid}" grpId="{grp}" animBg="1"/>')
        body.append(
            f'<p:par><p:cTn id="{gid}" fill="hold"><p:stCondLst><p:cond delay="{t}"/>'
            f'</p:stCondLst><p:childTnLst>{"".join(effects)}</p:childTnLst></p:cTn></p:par>'
        )
        t += max(a["delay"] + a["dur"] for a in g)
    bld = f'<p:bldLst>{"".join(builds)}</p:bldLst>' if builds else ""
    return (
        f'<p:timing><p:tnLst><p:par><p:cTn id="{root}" dur="indefinite" restart="never" '
        f'nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek">'
        f'<p:cTn id="{main}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
        f'<p:par><p:cTn id="{click}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>'
        f'<p:cond evt="onBegin" delay="0"><p:tn val="{main}"/></p:cond></p:stCondLst>'
        f'<p:childTnLst>{"".join(body)}</p:childTnLst></p:cTn></p:par>'
        f"</p:childTnLst></p:cTn>"
        f'<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl>'
        f"</p:cond></p:prevCondLst>"
        f'<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl>'
        f"</p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>"
        f"{bld}</p:timing>"
    ), t


def theme_xml(xml):
    scheme = '<a:clrScheme name="GAVEL">' + "".join(
        f'<a:{k}><a:srgbClr val="{THEME[k]}"/></a:{k}>' for k in SLOTS
    ) + "</a:clrScheme>"
    out, n = re.subn(r"<a:clrScheme\b[\s\S]*?</a:clrScheme>", lambda _m: scheme, xml, count=1)
    if n != 1:
        raise ValueError("theme has no colour scheme")
    return re.sub(r'(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"', r'\1GAVEL"', out)


def main():
    out = Path(sys.argv[1])
    target = Path(sys.argv[2])
    motion = json.loads((out / "motion.json").read_text())
    src = zipfile.ZipFile(out / "deck-raw.pptx")
    report = []
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            if info.is_dir():
                continue
            data = src.read(info.filename)
            m = re.fullmatch(r"ppt/slides/slide(\d+)\.xml", info.filename)
            if info.filename == "ppt/theme/theme1.xml":
                data = theme_xml(data.decode("utf-8")).encode("utf-8")
            elif m:
                n = int(m.group(1))
                spec = motion[n - 1]
                xml = data.decode("utf-8")
                found = shapes(xml)
                tim, total = timing(spec["anims"], found)
                add = TRANSITIONS[spec["transition"] if n > 1 else "fade"] + tim
                if "</p:clrMapOvr>" not in xml or "<p:timing" in xml or "<p:transition" in xml:
                    raise ValueError(f"slide {n}: unexpected structure")
                xml = xml.replace("</p:clrMapOvr>", "</p:clrMapOvr>" + add, 1)
                data = xml.encode("utf-8")
                report.append(f"slide {n}: {len(spec['anims'])} effects, builds run {total / 1000:.1f} s")
            if info.filename.endswith(".xml"):
                bad = re.search(rb'<a:srgbClr val="((?![0-9A-Fa-f]{6}")[^"]*)"', data)
                if bad:
                    raise ValueError(f"{info.filename}: colour {bad.group(1)!r} is not hex")
            zi = zipfile.ZipInfo(info.filename, date_time=(2026, 11, 10, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            dst.writestr(zi, data)
    print("\n".join(report))
    print(f"wrote {target} ({target.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
