#!/usr/bin/env python3
"""GFX-20: trim film v3.1 (184 s) to film v3.2 (under 3:00) by cutting still pauses between captions.

No speed change, no re-record. Each cut removes a span that holds no spoken word, no caption and no animation
(checked on the v3.1 render: frame difference under 0.1 percent inside every span). Video and audio are cut
together with a 0.2 s crossfade, the burned-in captions move with the picture, the SRT is re-timed to match.

usage: trim.py SRC_DIR OUT_DIR
"""
import json, os, re, subprocess, sys

D = 0.2  # crossfade at every cut, seconds
# (start, end) in v3.1 seconds. Every span sits inside a gap between two captions.
CUTS = [
    (38.0, 39.0),    # join -> hold: empty phone shot after the QR line
    (45.0, 46.0),    # hold: after "press and hold", before "money is held"
    (49.5, 50.0),    # hold: after "not charged", before the bid scene
    (63.0, 64.0),    # bid: after "price only moves up"
    (96.6, 98.1),    # settle: after "every other hold is voided"
    (103.1, 104.1),  # receipt: still receipt before the ledger line
    (136.0, 136.5),  # speed: after the Lighthouse line
    (146.3, 146.8),  # judges: before "try page needs no key"
    (159.2, 160.2),  # docs: after "typed SDKs"
]

def sh(*a):
    subprocess.run(list(a), check=True)

def out_pos(t):
    return t - sum(b - a for a, b in CUTS if b <= t)

def keep_segments(total):
    segs, prev = [], 0.0
    for a, b in CUTS:
        segs.append((prev, a + D))
        prev = b
    segs.append((prev, total))
    return segs

def filt(total, video, audio, fps):
    segs = keep_segments(total)
    parts, vlab, alab = [], [], []
    for i, (s, e) in enumerate(segs):
        if video:
            parts.append(f"[0:v]trim={s:.3f}:{e:.3f},setpts=PTS-STARTPTS[v{i}]")
        if audio:
            parts.append(f"[0:a]atrim={s:.3f}:{e:.3f},asetpts=PTS-STARTPTS[a{i}]")
    lens = [e - s for s, e in segs]
    if video:
        cur, acc = "v0", lens[0]
        for i in range(1, len(segs)):
            parts.append(f"[{cur}][v{i}]xfade=transition=fade:duration={D}:offset={acc - D:.3f}[x{i}]")
            cur, acc = f"x{i}", acc + lens[i] - D
        parts.append(f"[{cur}]fps={fps},format=yuv420p[vout]")
    if audio:
        cur = "a0"
        for i in range(1, len(segs)):
            parts.append(f"[{cur}][a{i}]acrossfade=d={D}:c1=tri:c2=tri[y{i}]")
            cur = f"y{i}"
        parts.append(f"[{cur}]anull[aout]")
    return ";".join(parts)

def probe(path, key):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", f"format={key}", "-of", "csv=p=0", path],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())

def has_audio(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type",
                        "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    return bool(r.stdout.strip())

def encode(src, dst, fps, hd):
    total = probe(src, "duration")
    aud = has_audio(src)
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
            "-filter_complex", filt(total, True, aud, fps), "-map", "[vout]"]
    if aud:
        args += ["-map", "[aout]", "-c:a", "aac", "-b:a", "160k"]
    args += ["-c:v", "libx264", "-preset", "slow" if hd else "medium", "-crf", "19" if hd else "22",
             "-maxrate", "3500k" if hd else "1800k", "-bufsize", "7000k" if hd else "3600k",
             "-movflags", "+faststart", dst]
    sh(*args)

def ts(t):
    t = max(t, 0)
    h, r = divmod(int(round(t * 1000)), 3600000)
    m, r = divmod(r, 60000)
    s, ms = divmod(r, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def untime(s):
    h, m, r = s.split(":")
    sec, ms = r.split(",")
    return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000

def retime_srt(src, dst):
    txt = open(src, encoding="utf-8").read()
    def f(mo):
        a, b = untime(mo.group(1)), untime(mo.group(2))
        for ca, cb in CUTS:  # a caption must never touch a cut
            assert b <= ca or a >= cb, f"caption {a}-{b} overlaps cut {ca}-{cb}"
        return f"{ts(out_pos(a))} --> {ts(out_pos(b))}"
    open(dst, "w", encoding="utf-8").write(
        re.sub(r"(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)", f, txt))

def sheet(src, out):
    """One row per cut: frames at -0.4 -0.2 0 +0.2 +0.4 s around the cut, from the new film."""
    rows = []
    for i, (a, b) in enumerate(CUTS):
        p = out_pos(a)
        for k, dt in enumerate((-0.4, -0.2, 0.0, 0.2, 0.4)):
            sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{max(p + dt, 0):.3f}", "-i", src,
               "-frames:v", "1", "-vf", "scale=384:216", f"{out}.{i}.{k}.png")
    sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-pattern_type", "glob", "-framerate", "1",
       "-i", f"{out}.*.png", "-vf", f"tile=5x{len(CUTS)}:padding=4:color=0x1d1712", "-frames:v", "1", "-q:v", "3",
       f"{out}.jpg")
    for f in os.listdir(os.path.dirname(out) or "."):
        if f.startswith(os.path.basename(out) + ".") and f.endswith(".png"):
            os.remove(os.path.join(os.path.dirname(out) or ".", f))

def sync_check(old, new, label):
    """Compare the new film with v3.1 at 5 spots after the cuts: picture (frame diff) and audio (rms)."""
    import numpy as np
    spots = [(41.0, "join/hold"), (66.0, "bid/voice"), (100.0, "receipt"), (150.0, "judges"), (170.0, "built-with")]
    lines = []
    for t_old, name in spots:
        t_new = out_pos(t_old)
        def fr(path, t):
            r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-vf",
                                "scale=160:90,format=gray", "-f", "rawvideo", "-"], capture_output=True)
            return np.frombuffer(r.stdout, dtype=np.uint8).astype(float)
        diff = float(np.abs(fr(old, t_old) - fr(new, t_new)).mean()) / 2.55
        res = f"{name}: v3.1 {t_old:.2f}s = v3.2 {t_new:.2f}s, picture diff {diff:.2f}%"
        if has_audio(new):
            def au(path, t):
                r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-t", "3", "-i", path, "-vn", "-ac", "1",
                                    "-ar", "8000", "-f", "s16le", "-"], capture_output=True)
                return np.frombuffer(r.stdout, dtype=np.int16).astype(float)
            x, y = au(old, t_old), au(new, t_new)
            n = min(len(x), len(y))
            c = float(np.corrcoef(x[:n], y[:n])[0, 1])
            res += f", audio correlation {c:.3f}"
        lines.append(res)
    print("\n".join(lines))
    return lines

def main(src_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    names = {
        "gavel-launch-film-v3-1.mp4": ("gavel-launch-film-v3-2.mp4", 60, True),
        "gavel-launch-film-v3-1-voiceover.mp4": ("gavel-launch-film-v3-2-voiceover.mp4", 60, True),
        "gavel-launch-film-v3-1-720p30.mp4": ("gavel-launch-film-v3-2-720p30.mp4", 30, False),
        "gavel-launch-film-v3-1-720p30-voiceover.mp4": ("gavel-launch-film-v3-2-720p30-voiceover.mp4", 30, False),
    }
    for s, (d, fps, hd) in names.items():
        encode(os.path.join(src_dir, s), os.path.join(out_dir, d), fps, hd)
    retime_srt(os.path.join(src_dir, "gavel-launch-film-v3-1.en.srt"), os.path.join(out_dir, "gavel-launch-film-v3-2.en.srt"))
    sheet(os.path.join(out_dir, "gavel-launch-film-v3-2-720p30.mp4"), os.path.join(out_dir, "contact-cuts"))
    rep = [f"film v3.2: cuts {len(CUTS)}, removed {sum(b - a for a, b in CUTS):.2f} s"]
    for a, b in CUTS:
        rep.append(f"  v3.1 {a:.2f}-{b:.2f} s ({b - a:.1f} s) -> v3.2 {out_pos(a):.2f} s")
    for d in names.values():
        p = os.path.join(out_dir, d[0])
        rep.append(f"{d[0]}: {probe(p, 'duration'):.2f} s, {probe(p, 'size') / 1e6:.1f} MB")
    rep += sync_check(os.path.join(src_dir, "gavel-launch-film-v3-1-720p30-voiceover.mp4"),
                      os.path.join(out_dir, "gavel-launch-film-v3-2-720p30-voiceover.mp4"), "vo")
    rep += sync_check(os.path.join(src_dir, "gavel-launch-film-v3-1.mp4"),
                      os.path.join(out_dir, "gavel-launch-film-v3-2.mp4"), "silent")
    open(os.path.join(out_dir, "report.txt"), "w").write("\n".join(rep) + "\n")
    print("\n".join(rep))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
