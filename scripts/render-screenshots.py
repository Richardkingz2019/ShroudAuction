#!/usr/bin/env python3
"""Render the README screenshots from real command output.

Each session below runs the project's actual commands, captures stdout/stderr,
writes the transcript to docs/sessions/<slug>.txt, and renders the same text as
a terminal-style PNG at docs/img/<slug>.png. Nothing is hand-typed: the images
are a rendering of what the commands really printed, and the .txt files next to
them are the same bytes.

Requires Pillow:

    python3 -m pip install pillow

Run from anywhere (paths are resolved from this file):

    python3 scripts/render-screenshots.py                # run + render
    python3 scripts/render-screenshots.py --render-only   # re-render saved .txt
"""

from __future__ import annotations

import argparse
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - guidance beats a traceback
    sys.exit("Pillow is required: python3 -m pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "docs" / "img"
TXT_DIR = ROOT / "docs" / "sessions"

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
FONT_REGULAR = FONT_DIR / "DejaVuSansMono.ttf"
FONT_BOLD = FONT_DIR / "DejaVuSansMono-Bold.ttf"

SIZE = 16
LINE_H = 24
PAD = 18
BAR_H = 34

BG = (11, 14, 20)
BAR = (22, 27, 38)
BORDER = (42, 48, 64)
TEXT = (201, 209, 217)
DIM = (125, 133, 144)
GREEN = (126, 231, 135)
RED = (255, 123, 114)
YELLOW = (227, 179, 65)
CYAN = (121, 192, 255)

SESSIONS = [
    {
        "slug": "01-compile",
        "title": "ShroudAuction - npm run compile",
        "commands": [
            "rm -rf contracts/managed && npm run compile",
            "find contracts/managed/auction -type f | sort",
            "du -sh contracts/managed/auction/keys contracts/managed/auction/zkir",
        ],
    },
    {
        "slug": "02-tests",
        "title": "ShroudAuction - npm test",
        "commands": ["npm test"],
    },
    {
        "slug": "03-proof-server-and-wallet",
        "title": "ShroudAuction - proof server + wallet",
        "commands": [
            "docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}'",
            "curl -s http://localhost:6300/health",
            "npm run check-balance -- --network preview",
        ],
    },
]

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")

# Characters we will not find in DejaVu Sans Mono. Verified against the font's
# own cmap at runtime, so this only ever fires for something genuinely missing.
FALLBACK = {
    "\u274c": "x",
    "\u2705": "\u2713",
    "\u26a0": "!",
    "\u2139": "i",
    "\U0001f512": "",
    "\u2026": "...",
}


def load_cmap(path: Path) -> set[int]:
    """Return every codepoint the font has a real (non-zero) glyph for.

    Pillow exposes no cmap API, and a missing glyph still renders *something*
    (an empty .notdef box), so probing with getbbox() cannot tell the two
    apart. Parsing cmap directly is the only exact check.
    """
    data = path.read_bytes()
    num_tables = struct.unpack(">H", data[4:6])[0]
    cmap_off = None
    for i in range(num_tables):
        rec = 12 + i * 16
        if data[rec : rec + 4] == b"cmap":
            cmap_off = struct.unpack(">I", data[rec + 8 : rec + 12])[0]
            break
    if cmap_off is None:
        raise ValueError(f"no cmap table in {path}")

    chars: set[int] = set()
    n_sub = struct.unpack(">H", data[cmap_off + 2 : cmap_off + 4])[0]
    for i in range(n_sub):
        rec = cmap_off + 4 + i * 8
        off = struct.unpack(">I", data[rec + 4 : rec + 8])[0]
        p = cmap_off + off
        fmt = struct.unpack(">H", data[p : p + 2])[0]
        if fmt == 4:
            chars |= _cmap4(data, p)
        elif fmt == 12:
            chars |= _cmap12(data, p)
    return chars


def _cmap4(data: bytes, p: int) -> set[int]:
    seg_x2 = struct.unpack(">H", data[p + 6 : p + 8])[0]
    seg = seg_x2 // 2
    end = struct.unpack(f">{seg}H", data[p + 14 : p + 14 + seg_x2])
    q = p + 16 + seg_x2
    start = struct.unpack(f">{seg}H", data[q : q + seg_x2])
    delta_o = q + seg_x2
    deltas = struct.unpack(f">{seg}H", data[delta_o : delta_o + seg_x2])
    ro_o = delta_o + seg_x2
    ros = struct.unpack(f">{seg}H", data[ro_o : ro_o + seg_x2])

    out: set[int] = set()
    for i in range(seg):
        for cp in range(start[i], min(end[i], 0xFFFF) + 1):
            if cp == 0xFFFF:
                continue
            if ros[i] == 0:
                gid = (cp + deltas[i]) & 0xFFFF
            else:
                at = ro_o + i * 2 + ros[i] + (cp - start[i]) * 2
                if at + 2 > len(data):
                    continue
                gid = struct.unpack(">H", data[at : at + 2])[0]
                if gid:
                    gid = (gid + deltas[i]) & 0xFFFF
            if gid:
                out.add(cp)
    return out


def _cmap12(data: bytes, p: int) -> set[int]:
    n = struct.unpack(">I", data[p + 12 : p + 16])[0]
    out: set[int] = set()
    for i in range(n):
        q = p + 16 + i * 12
        start, end, gid = struct.unpack(">III", data[q : q + 12])
        if gid == 0:
            continue
        out.update(range(start, end + 1))
    return out


def strip_ansi(text: str) -> str:
    return ANSI.sub("", text)


def normalize(text: str) -> list[str]:
    """Split into lines, resolving in-place \\r progress overwrites to the last frame."""
    text = strip_ansi(text).replace("\r\n", "\n")
    lines = []
    for raw in text.split("\n"):
        if "\r" in raw:
            frames = [f for f in raw.split("\r") if f.strip()]
            raw = frames[-1] if frames else raw
        lines.append(raw.rstrip())
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def run(command: str) -> list[str]:
    env = dict(os.environ)
    local_bin = str(Path.home() / ".local" / "bin")
    env["PATH"] = env.get("PATH", "") + os.pathsep + local_bin
    proc = subprocess.run(
        ["bash", "-lc", command],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )
    lines = normalize(proc.stdout)
    if proc.returncode != 0:
        lines.append(f"[exit {proc.returncode}]")
    return lines


def capture(session: dict) -> list[str]:
    transcript: list[str] = []
    for i, command in enumerate(session["commands"]):
        if i:
            transcript.append("")
        transcript.append(f"$ {command}")
        transcript.extend(run(command))
    return transcript


def color_for(line: str) -> tuple[int, int, int]:
    s = line.strip()
    if s.startswith("$ "):
        return GREEN
    if s.startswith("> "):
        return DIM
    if "mn_addr_" in s or "http" in s:
        return CYAN
    if "\u2713" in s or "passed" in s:
        return GREEN
    if "\u274c" in s or "\u2717" in s or "error" in s.lower() or "fail" in s.lower():
        return RED
    if "\u26a0" in s:
        return YELLOW
    return TEXT


def substitute(text: str, cmap: set[int], missing: set[str]) -> str:
    out = []
    for ch in text:
        if ch in ("\n", "\t") or ord(ch) in cmap:
            out.append(ch)
        else:
            missing.add(ch)
            out.append(FALLBACK.get(ch, "?"))
    return "".join(out)


def render(lines: list[str], title: str, dest: Path, cmap: set[int]) -> None:
    font = ImageFont.truetype(str(FONT_REGULAR), SIZE)
    bold = ImageFont.truetype(str(FONT_BOLD), SIZE)
    char_w = font.getlength("M")

    widest = max((len(line) for line in lines), default=1)
    width = int(max(char_w * widest, char_w * len(title)) + PAD * 2)
    height = BAR_H + PAD + LINE_H * len(lines) + PAD

    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, width - 1, BAR_H - 1], fill=BAR)
    for i, dot in enumerate(((255, 95, 86), (255, 189, 46), (39, 201, 63))):
        cx = PAD + i * 18
        draw.ellipse([cx - 6, BAR_H // 2 - 6, cx + 6, BAR_H // 2 + 6], fill=dot)
    draw.text((PAD + 3 * 18 + 8, BAR_H // 2), title, font=bold, fill=TEXT, anchor="lm")

    y = BAR_H + PAD
    for line in lines:
        if line.strip():
            draw.text((PAD, y), line, font=font, fill=color_for(line))
        y += LINE_H

    draw.rectangle([0, 0, width - 1, height - 1], outline=BORDER)
    img.save(dest)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--render-only",
        action="store_true",
        help="re-render docs/sessions/*.txt instead of running the commands",
    )
    ap.add_argument(
        "--only",
        action="append",
        metavar="SLUG",
        help="only process these session slugs (repeatable); needed to refresh one "
        "capture without re-running the others",
    )
    args = ap.parse_args()

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    TXT_DIR.mkdir(parents=True, exist_ok=True)
    cmap = load_cmap(FONT_REGULAR)
    all_missing: set[str] = set()

    for session in SESSIONS:
        slug, title = session["slug"], session["title"]
        if args.only and slug not in args.only:
            continue
        txt = TXT_DIR / f"{slug}.txt"
        missing: set[str] = set()
        if args.render_only:
            lines = normalize(txt.read_text(encoding="utf-8"))
        else:
            print(f"$ {slug}: capturing…", flush=True)
            lines = capture(session)
        # Substitute font gaps once, so the .txt is exactly what the .png shows.
        lines = [substitute(line.expandtabs(4), cmap, missing) for line in lines]
        all_missing |= missing
        if not args.render_only:
            txt.write_text("\n".join(lines) + "\n", encoding="utf-8")

        dest = IMG_DIR / f"{slug}.png"
        title = substitute(title, cmap, missing)
        render(lines, title, dest, cmap)
        with Image.open(dest) as check:
            print(f"  {dest.relative_to(ROOT)}  {check.width}x{check.height}  ({len(lines)} lines)")

    if all_missing:
        print(f"\nsubstituted (absent from the font): {' '.join(sorted(all_missing))}")
    if args.only:
        unknown = [s for s in args.only if s not in {x["slug"] for x in SESSIONS}]
        if unknown:
            print(f"\nunknown session slug(s): {', '.join(unknown)}")
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
