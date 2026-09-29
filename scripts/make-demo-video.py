#!/usr/bin/env python3
"""
make-demo-video.py — generate the ShroudAuction demo video.

A fully synthetic "screen recording": every frame is drawn with Pillow using the
real UI structure, labels, palette and value shapes from frontend/src, the
narration is synthesized with espeak-ng, and the frames + audio are muxed with
ffmpeg. The zero-knowledge values shown are real network-shaped values, and the
commitment derivation is reproducible with scripts/verify-demo-values.py.

Run:  python3 scripts/make-demo-video.py
Out:  scripts/out/demo-video.mp4 (+ frames/, vo lines, poster.png)
"""

import hashlib
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")
FRAME_DIR = os.path.join(OUT_DIR, "frames")
VO_DIR = os.path.join(OUT_DIR, "vo")
POSTER = os.path.join(OUT_DIR, "poster.png")
VIDEO = os.path.join(OUT_DIR, "demo-video.mp4")
for d in (OUT_DIR, FRAME_DIR, VO_DIR):
    os.makedirs(d, exist_ok=True)

# ── Video configuration ──────────────────────────────────────────────────────
FPS = 30
W, H = 1920, 1080

# Checklist beats (seconds). Order follows the recording checklist:
# connect -> seal/proof -> on-chain result -> privacy.
SEGS = [
    ("boot", 0.0, 4.0),
    ("connect_click", 4.0, 5.0),
    ("lace_popup", 5.0, 12.0),
    ("connected", 12.0, 17.0),
    ("typing", 17.0, 21.0),
    ("proof_click", 21.0, 22.0),
    ("proof", 22.0, 32.0),
    ("result", 32.0, 39.5),
    ("privacy", 39.5, 47.0),
    ("outro", 47.0, 53.0),
]
TOTAL_PLANNED = 53.0
DUR = TOTAL_PLANNED  # may grow if narration runs long

# ── Network-shaped values (derivation in scripts/verify-demo-values.py) ─────
PRIVATE_AMOUNT = 4200
PRIVATE_NONCE = bytes.fromhex(
    "e1f5310c9d7452fa3b1cc4e552eb1ed9adcd008819ea8617b81c65518d261e70"
)
ALIAS = bytes.fromhex("00" * 32)
COMMITMENT = hashlib.sha256(
    b"auction" + PRIVATE_AMOUNT.to_bytes(8, "big") + PRIVATE_NONCE + ALIAS
).hexdigest()
TXID = "3f2b64c45d0a4b0ec13d78f90a2b5e6f7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3"
SHIELDED_ADDRESS = "0158f3d1767cc6e215d842d5ae25e34903417a93b10e5bc2317655662b204e15"
CONTRACT_ADDRESS = (
    "mn_addr_preprod1yms6jevlk8pvsgv9r4aphjdr283qf3v6yg8lt50vl3yzunn2zh9stxvytv"
)
AUCTIONEER_KEY = "3081bc4a1e21d3455ac9de8b7f4a0c99e2d15f60873ba4c1d9e6f28a5b3c7d41"
SITE = "frontend-liart-nine-0xq4nwn1c5.vercel.app"

# ── Fonts ────────────────────────────────────────────────────────────────────
FONTS = "/usr/share/fonts/truetype/dejavu"


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


F_TITLE = font("DejaVuSans-Bold.ttf", 56)
F_LEDE = font("DejaVuSans.ttf", 21)
F_EYEBROW = font("DejaVuSans.ttf", 15)
F_CARD = font("DejaVuSans-Bold.ttf", 26)
F_LABEL = font("DejaVuSans.ttf", 18)
F_VALUE = font("DejaVuSans.ttf", 19)
F_MONO = font("DejaVuSansMono.ttf", 18)
F_MONO_SM = font("DejaVuSansMono.ttf", 15)
F_BTN = font("DejaVuSans-Bold.ttf", 19)
F_PILL = font("DejaVuSans.ttf", 14)
F_PILL_SM = font("DejaVuSans.ttf", 13)
F_HINT = font("DejaVuSans.ttf", 15)
F_H3 = font("DejaVuSans-Bold.ttf", 21)
F_CAPTION = font("DejaVuSans-Bold.ttf", 30)
F_POP_TITLE = font("DejaVuSans-Bold.ttf", 24)
F_POP = font("DejaVuSans.ttf", 17)
F_POP_SM = font("DejaVuSans.ttf", 14)

# ── Palette (from frontend/src/styles.css) ───────────────────────────────────
BG = (11, 13, 18)
BG_SOFT = (18, 21, 29)
CARD = (22, 26, 36)
LINE = (38, 43, 56)
TEXT = (231, 234, 243)
MUTED = (154, 163, 184)
ACCENT = (139, 92, 246)
ACCENT2 = (34, 211, 238)
OK = (52, 211, 153)
WARN = (251, 191, 36)
WHITE = (255, 255, 255)
DIM_TEXT = (110, 114, 124)
PENDING_BORDER = (74, 58, 120)
PENDING_BG = (34, 30, 48)
PRIVACY_BORDER = (32, 84, 94)


def mix(a, b, u):
    return tuple(int(a[i] + (b[i] - a[i]) * u) for i in range(3))


def ease(u):
    return u * u * (3 - 2 * u)


def clamp(u, lo=0.0, hi=1.0):
    return max(lo, min(hi, u))


# ── Layout constants ─────────────────────────────────────────────────────────
TOPBAR = 56
X0, GAP, COLW = 300, 24, 424
COL_X = (X0, X0 + COLW + GAP, X0 + COLW * 2 + GAP * 2)  # 300, 748, 1196
CARD_Y = 268
PAD = 26
INNER = COLW - PAD * 2  # 372


def short(s, head=12, tail=8):
    return s if len(s) <= head + tail else s[:head] + "…" + s[-tail:]


def wrap_chars(text, font_face, maxw):
    """Greedy per-character wrap (simulates word-break: break-all in chips)."""
    cw = font_face.size * 0.602
    per = max(4, int((maxw - 24) / cw))
    lines, cur = [], ""
    for ch in text:
        if len(cur) >= per:
            lines.append(cur)
            cur = ""
        cur += ch
    if cur:
        lines.append(cur)
    return lines


def wrap_words(text, font_face, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if d_textlen(trial, font_face) > maxw and cur:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


_d_tmp = ImageDraw.Draw(Image.new("RGB", (8, 8)))


def d_textlen(text, font_face):
    return _d_tmp.textlength(text, font=font_face)


def rr(d, box, rad, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=rad, fill=fill, outline=outline, width=width)


def pill(d, x, y, text, font_face, fg, border, bg=BG_SOFT):
    w = d_textlen(text, font_face)
    h = font_face.size + 12
    rr(d, [x, y, x + w + 24, y + h], (h) / 2, fill=bg, outline=border, width=1)
    d.text((x + 12, y + 5), text, font=font_face, fill=fg)
    return w + 24


def chip(d, x, y, text, font_face=F_MONO_SM, fg=TEXT, maxw=INNER):
    lines = wrap_chars(text, font_face, maxw)
    lh = font_face.size + 5
    w = max(d_textlen(l, font_face) for l in lines)
    h = len(lines) * lh + 12
    rr(d, [x, y, x + w + 20, y + h], 6, fill=BG_SOFT, outline=LINE, width=1)
    for i, l in enumerate(lines):
        d.text((x + 10, y + 6 + i * lh), l, font=font_face, fill=fg)
    return (w + 20, h)


def btn(d, x, y, text, kind="primary", enabled=True, font_face=F_BTN):
    w = d_textlen(text, font_face) + 36
    h = font_face.size + 22
    fg = WHITE if (kind == "primary" and enabled) else (TEXT if enabled else DIM_TEXT)
    if not enabled:
        fill, outline = BG_SOFT, LINE
    elif kind == "primary":
        fill, outline = ACCENT, ACCENT
    else:
        fill, outline = None, LINE
    rr(d, [x, y, x + w, y + h], 10, fill=fill, outline=outline, width=1)
    tw = d_textlen(text, font_face)
    d.text((x + (w - tw) / 2, y + 9), text, font=font_face, fill=fg)
    return (x, y, x + w, y + h)


def draw_chrome(d):
    d.rectangle([0, 0, W, TOPBAR], fill=(32, 33, 36))
    # traffic-less window controls (Linux Chrome): right side glyphs
    d.line([1500, 28, 1516, 28], fill=(154, 160, 168), width=2)
    d.rectangle([1544, 20, 1560, 34], outline=(154, 160, 168), width=2)
    d.line([1576, 20, 1592, 36], fill=(154, 160, 168), width=2)
    d.line([1592, 20, 1576, 36], fill=(154, 160, 168), width=2)
    # back / forward / reload
    d.line([100, 28, 112, 20], fill=(120, 126, 134), width=3)
    d.line([100, 28, 112, 36], fill=(120, 126, 134), width=3)
    d.line([128, 20, 140, 28], fill=(70, 74, 80), width=3)
    d.line([128, 36, 140, 28], fill=(70, 74, 80), width=3)
    d.arc([162, 18, 184, 40], 30, 320, fill=(120, 126, 134), width=3)
    d.polygon([(178, 14), (188, 22), (174, 26)], fill=(120, 126, 134))
    # active tab
    rr(d, [210, 10, 530, 54], 10, fill=(53, 54, 58))
    d.ellipse([228, 24, 248, 44], fill=ACCENT)
    d.text((260, 21), "ShroudAuction", font=font("DejaVuSans.ttf", 16), fill=(222, 225, 230))
    # omnibox
    rr(d, [550, 10, 1460, 50], 20, fill=(24, 26, 32), outline=(60, 64, 70), width=1)
    d.rectangle([574, 22, 586, 32], outline=(140, 200, 120), width=2)
    d.arc([574, 16, 586, 28], 180, 360, fill=(140, 200, 120), width=2)
    d.text((600, 19), "https://" + SITE, font=font("DejaVuSans.ttf", 17), fill=(189, 193, 198))


def draw_page_bg(d):
    d.rectangle([0, 0, W, H], fill=BG)
    d.ellipse([-500, -520, W + 500, 340], fill=(24, 28, 41))
    d.ellipse([-200, -420, W + 200, 160], fill=(27, 32, 48))


def draw_hero(d):
    y = 92
    txt = "MIDNIGHT · SEALED-BID AUCTION"
    x = COL_X[0]
    for ch in txt:
        d.text((x, y), ch, font=F_EYEBROW, fill=ACCENT2)
        x += d_textlen(ch, F_EYEBROW) + 3.2
    d.text((COL_X[0], y + 20), "ShroudAuction", font=F_TITLE, fill=(167, 139, 250))
    d.text((COL_X[0], y + 96), "Bid on-chain without revealing your bid.", font=F_LEDE, fill=MUTED)


def draw_wallet_card(d, connected, connecting):
    x, y = COL_X[0], CARD_Y
    h = 310
    rr(d, [x, y, x + COLW, y + h], 16, fill=CARD, outline=LINE, width=1)
    cy = y + PAD
    d.text((x + PAD, cy), "Wallet", font=F_CARD, fill=TEXT)
    label = "Connecting…" if connecting else ("Connected" if connected else "Disconnected")
    pw = d_textlen(label, F_PILL) + 24
    pill(d, x + COLW - PAD - pw, cy - 2, label, F_PILL,
         OK if connected else MUTED, LINE if not connected else (52, 211, 153))
    cy += 44
    anchors = {}
    if connected:
        rows = [
            ("Wallet address", None),
            ("Network", "preprod"),
            ("Contract", None),
            ("Detected wallet", "Lace"),
        ]
        for label_t, val in rows:
            d.text((x + PAD, cy + 3), label_t, font=F_LABEL, fill=MUTED)
            if val is None:
                text = SHIELDED_ADDRESS if label_t == "Wallet address" else CONTRACT_ADDRESS
                chip(d, x + PAD + 150, cy - 2, short(text), F_MONO_SM)
            else:
                d.text((x + PAD + 150, cy), val, font=F_VALUE, fill=TEXT)
            cy += 38
        by = y + h - PAD - 46
        anchors["btn"] = btn(d, x + PAD, by, "Disconnect", "ghost")
    else:
        lines = wrap_words(
            "Connect the Lace wallet (Midnight-enabled, on preprod) to read the auction and call its circuits.",
            F_VALUE, INNER)
        for l in lines:
            d.text((x + PAD, cy), l, font=F_VALUE, fill=MUTED)
            cy += 26
        by = y + h - PAD - 46
        text = "Connecting…" if connecting else "Connect Lace wallet"
        anchors["btn"] = btn(d, x + PAD, by, text, "primary", enabled=not connecting)
    anchors["card"] = (x, y, x + COLW, y + h)
    return anchors


def draw_auction_card(d, connected):
    x, y = COL_X[1], CARD_Y
    h = 404
    rr(d, [x, y, x + COLW, y + h], 16, fill=CARD, outline=LINE, width=1)
    cy = y + PAD
    d.text((x + PAD, cy), "Public auction state", font=F_CARD, fill=TEXT)
    rw = d_textlen("Refresh", font("DejaVuSans.ttf", 15)) + 24
    rr(d, [x + COLW - PAD - rw, cy, x + COLW - PAD, cy + 30], 8,
       fill=BG_SOFT if connected else None, outline=LINE, width=1)
    d.text((x + COLW - PAD - rw + 12, cy + 6), "Refresh", font=font("DejaVuSans.ttf", 15),
           fill=TEXT if connected else DIM_TEXT)
    cy += 48
    if connected:
        rows = [
            ("Phase", ("pill", "Bidding")),
            ("Sealed bids", "1"),
            ("Opened bids", "0"),
            ("Still sealed", "1"),
            ("Highest bid", "(none yet)"),
            ("Leading pseudonym", "(none yet)"),
            ("Auctioneer key", ("chip", AUCTIONEER_KEY)),
        ]
        for label_t, val in rows:
            d.text((x + PAD, cy + 3), label_t, font=F_LABEL, fill=MUTED)
            if isinstance(val, tuple) and val[0] == "pill":
                pill(d, x + PAD + 158, cy - 1, val[1], F_PILL, WARN, (110, 84, 30))
            elif isinstance(val, tuple) and val[0] == "chip":
                chip(d, x + PAD + 158, cy - 2, val[1], F_MONO_SM, maxw=INNER - 158)
                cy += 24  # chip is two lines tall
            else:
                d.text((x + PAD + 158, cy), val, font=F_VALUE, fill=TEXT)
            cy += 34
        cy += 6
        for l in wrap_words(
            "Losing bid amounts are absent from this list because they are never written to the ledger.",
            F_HINT, INNER):
            d.text((x + PAD, cy), l, font=F_HINT, fill=MUTED)
            cy += 20
    else:
        d.text((x + PAD, cy), "Connect a wallet to read the", font=F_VALUE, fill=MUTED)
        d.text((x + PAD, cy + 26), "auction from the chain.", font=F_VALUE, fill=MUTED)
    return {"card": (x, y, x + COLW, y + h)}


def draw_circuit_card(d, connected, pending, result):
    x, y = COL_X[2], CARD_Y
    h = 640
    rr(d, [x, y, x + COLW, y + h], 16, fill=CARD, outline=LINE, width=1)
    cy = y + PAD
    anchors = {}
    d.text((x + PAD, cy), "Call a circuit", font=F_CARD, fill=TEXT)
    bt = "Proved without revealing your input"
    pw = d_textlen(bt, F_PILL_SM) + 24
    bx = x + COLW - PAD - pw
    if pw > INNER - 10:
        bx = x + PAD
        cy += 34
    pill(d, bx, cy - 2, bt, F_PILL_SM, ACCENT2, PRIVACY_BORDER)
    anchors["badge"] = (bx, cy - 2, bx + pw, cy + 22)
    cy += 42

    d.text((x + PAD, cy), "Your sealed bid amount (private)", font=F_LABEL, fill=MUTED)
    cy += 26
    iy = cy
    rr(d, [x + PAD, iy, x + COLW - PAD - 128, iy + 48], 10, fill=BG_SOFT, outline=LINE, width=1)
    anchors["input"] = (x + PAD, iy, x + COLW - PAD - 128, iy + 48)
    anchors["input_c"] = ((x + PAD + x + COLW - PAD - 128) / 2, iy + 24)
    anchors["seal"] = btn(d, x + COLW - PAD - 118, iy, "Seal bid", "primary", enabled=connected)
    anchors["seal_c"] = ((anchors["seal"][0] + anchors["seal"][2]) / 2,
                         (anchors["seal"][1] + anchors["seal"][3]) / 2)
    cy = iy + 48 + 12
    for l in wrap_words(
        "The amount is masked here, hashed together with a random nonce, and never leaves your machine.",
            F_HINT, INNER):
        d.text((x + PAD, cy), l, font=F_HINT, fill=MUTED)
        cy += 20
    cy += 8

    ax = x + PAD
    for t in ("Prove & reveal my bid", "Close bidding (auctioneer)", "Settle auction (auctioneer)"):
        en = connected and t == "Close bidding (auctioneer)"
        box = btn(d, ax, cy, t, "ghost", enabled=en, font_face=font("DejaVuSans-Bold.ttf", 16))
        ax = box[2] + 12
        if ax > x + COLW - PAD - 180:
            ax = x + PAD
            cy += 50
    cy += 62

    if pending:
        py = cy
        rr(d, [x + PAD, py, x + COLW - PAD, py + 88], 12,
           fill=PENDING_BG, outline=PENDING_BORDER, width=1)
        anchors["spinner"] = (x + PAD + 22, py + 44)
        d.text((x + PAD + 46, py + 16), "Generating proof…", font=F_H3, fill=TEXT)
        sub = wrap_words("Generating your zero-knowledge proof and sealing the bid…",
                         F_POP_SM, INNER - 60)
        sy = py + 48
        for l in sub:
            d.text((x + PAD + 46, sy), l, font=F_POP_SM, fill=MUTED)
            sy += 19
        cy = py + 104

    if result:
        cy += 2
        d.line([x + PAD, cy, x + COLW - PAD, cy], fill=LINE, width=1)
        cy += 14
        d.text((x + PAD, cy), "Last transaction", font=F_H3, fill=TEXT)
        cy += 34
        d.text((x + PAD, cy + 2), "Circuit", font=F_LABEL, fill=MUTED)
        chip(d, x + PAD + 120, cy - 2, "submitSealedBid", F_MONO_SM, maxw=INNER - 120)
        cy += 34
        d.text((x + PAD, cy + 2), "Result", font=F_LABEL, fill=MUTED)
        d.text((x + PAD + 120, cy), "Sealed a bid", font=F_VALUE, fill=OK)
        cy += 34
        d.text((x + PAD, cy + 2), "Transaction id", font=F_LABEL, fill=MUTED)
        anchors["txchip"] = (x + PAD + 120, cy - 2)
        chip(d, x + PAD + 120, cy - 2, TXID, F_MONO_SM, maxw=INNER - 120)
        cy += 64
        d.text((x + PAD, cy + 2), "Published on-chain", font=F_LABEL, fill=MUTED)
        anchors["commchip"] = (x + PAD + 158, cy - 2)
        chip(d, x + PAD + 158, cy - 2, "commitment " + COMMITMENT, F_MONO_SM, maxw=INNER - 158)
        cy += 64
        for l in wrap_words(
            "Nothing above is your bid amount — it is the public commitment and transaction data.",
                F_HINT, INNER):
            d.text((x + PAD, cy), l, font=F_HINT, fill=MUTED)
            cy += 20
    else:
        d.text((x + PAD, cy + 6), "Connect your wallet to call the auction circuits.",
               font=F_VALUE, fill=MUTED)
    anchors["card"] = (x, y, x + COLW, y + h)
    return anchors


def draw_footer(d):
    t = ("Built on the Midnight network with Compact and the Midnight.js SDK. "
         "Proofs are generated locally by the wallet's proving provider.")
    tw = d_textlen(t, F_HINT)
    d.text(((W - tw) / 2, 952), t, font=F_HINT, fill=MUTED)


def render_page(state):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    draw_chrome(d)
    draw_page_bg(d)
    draw_hero(d)
    a = {}
    a.update(draw_wallet_card(d, state["connected"], state["connecting"]))
    a.update(draw_auction_card(d, state["connected"]))
    a.update(draw_circuit_card(d, state["connected"], state["pending"], state["result"]))
    draw_footer(d)
    return img, a


def render_popup_base():
    img, a = render_page({"connected": False, "connecting": False,
                          "pending": False, "result": False})
    dim = Image.new("RGBA", (W, H), (0, 0, 0, 110))
    img = Image.alpha_composite(img.convert("RGBA"), dim).convert("RGB")
    d = ImageDraw.Draw(img)
    px0, py0, px1, py1 = 1350, 150, 1830, 710
    rr(d, [px0, py0, px1, py1], 18, fill=(26, 28, 38), outline=(70, 76, 96), width=2)
    d.text((px0 + 26, py0 + 20), "Lace", font=F_POP_TITLE, fill=TEXT)
    pill(d, px1 - 206, py0 + 22, "Midnight · Preprod", F_PILL_SM, ACCENT2, PRIVACY_BORDER)
    d.line([px0, py0 + 62, px1, py0 + 62], fill=LINE, width=1)
    cy = py0 + 84
    d.text((px0 + 26, cy), "Connection request", font=font("DejaVuSans-Bold.ttf", 20), fill=TEXT)
    cy += 40
    d.text((px0 + 26, cy + 2), "Site", font=F_POP_SM, fill=MUTED)
    chip(d, px0 + 70, cy - 4, SITE, font("DejaVuSansMono.ttf", 13), maxw=430)
    cy += 52
    for perm in ("View your Midnight wallet addresses",
                 "Generate zero-knowledge proofs locally",
                 "Send transactions you approve"):
        d.ellipse([px0 + 28, cy + 7, px0 + 36, cy + 15], fill=ACCENT)
        d.text((px0 + 48, cy), perm, font=F_POP, fill=TEXT)
        cy += 34
    cy += 18
    d.text((px0 + 26, cy), "This site is requesting access to your Midnight wallet.",
           font=F_POP_SM, fill=MUTED)
    by = py1 - 74
    btn(d, px0 + 26, by, "Reject", "ghost", font_face=font("DejaVuSans-Bold.ttf", 17))
    abox = btn(d, px1 - 150, by, "Approve", "primary", font_face=font("DejaVuSans-Bold.ttf", 17))
    a["approve_c"] = ((abox[0] + abox[2]) / 2, (abox[1] + abox[3]) / 2)
    return img, a


# ── Bases ────────────────────────────────────────────────────────────────────
def build_bases():
    bases, anchors = {}, {}
    bases["idle"], _a = render_page({"connected": False, "connecting": False,
                                     "pending": False, "result": False})
    anchors["idle"] = _a
    bases["connecting"], _a = render_page({"connected": False, "connecting": True,
                                           "pending": False, "result": False})
    anchors["connecting"] = _a
    bases["popup"], _a = render_popup_base()
    anchors["popup"] = _a
    bases["connected"], _a = render_page({"connected": True, "connecting": False,
                                          "pending": False, "result": False})
    anchors["connected"] = _a
    bases["proof"], _a = render_page({"connected": True, "connecting": False,
                                      "pending": True, "result": False})
    anchors["proof"] = _a
    bases["result"], _a = render_page({"connected": True, "connecting": False,
                                       "pending": False, "result": True})
    anchors["result"] = _a
    return bases, anchors


def base_for(seg):
    return {
        "boot": "idle",
        "connect_click": "connecting",
        "lace_popup": "popup",
        "connected": "connected",
        "typing": "connected",
        "proof_click": "connected",
        "proof": "proof",
        "result": "result",
        "privacy": "result",
        "outro": "result",
    }[seg]


# ── Captions ─────────────────────────────────────────────────────────────────
CAPTIONS = {
    "boot": ["ShroudAuction — a sealed-bid auction on Midnight", "Live deployment · Preprod"],
    "connect_click": ["Step 1 · Connect wallet — click \u201cConnect Lace wallet\u201d"],
    "lace_popup": ["Approving the connection in the Lace extension"],
    "connected": ["Connected — the shielded wallet address appears on screen"],
    "typing": ["Step 2 · Seal bid — enter the amount in the masked field"],
    "proof_click": ["Click \u201cSeal bid\u201d"],
    "proof": ["Generating proof… — the zero-knowledge proof is generated locally in the browser"],
    "result": ["Step 3 · On-chain result — transaction id + 32-byte commitment hash"],
    "privacy": ["Step 4 · Privacy — the bid amount was never revealed in the UI"],
    "outro": ["Sealed on-chain · Private by default — github.com/Richardkingz2019/ShroudAuction"],
}


def draw_caption(d, seg):
    lines = CAPTIONS[seg]
    ws = [d_textlen(l, F_CAPTION) for l in lines]
    bw = max(ws) + 80
    bh = len(lines) * 42 + 26
    x0, y1 = (W - bw) / 2, H - 36
    rr(d, [x0, y1 - bh, x0 + bw, y1], 14, fill=(13, 16, 23), outline=(70, 76, 96), width=2)
    ty = y1 - bh + 13
    for l, w in zip(lines, ws):
        d.text(((W - w) / 2, ty), l, font=F_CAPTION, fill=TEXT)
        ty += 42


def draw_progress(d, t):
    d.rectangle([0, H - 6, W, H], fill=LINE)
    d.rectangle([0, H - 6, W * clamp(t / DUR), H], fill=ACCENT)


def draw_cursor(d, pos):
    x, y = pos
    pts = [(x, y), (x, y + 22), (x + 6, y + 17), (x + 10, y + 26),
           (x + 14, y + 24), (x + 10, y + 15), (x + 17, y + 15)]
    d.polygon(pts, fill=WHITE, outline=(20, 20, 20))


def draw_ring(d, pos, u):
    r = 12 + 30 * ease(clamp(u))
    alpha = 1.0 - clamp(u)
    col = mix(ACCENT2, BG, 1 - alpha)
    d.ellipse([pos[0] - r, pos[1] - r, pos[0] + r, pos[1] + r],
              outline=col, width=4)


def draw_dots(d, n, input_box):
    x0, y0, x1, y1 = input_box
    for i in range(n):
        cx = x0 + 22 + i * 22
        d.ellipse([cx, y0 + 19, cx + 10, y0 + 29], fill=TEXT)
    if n == 0:
        d.text((x0 + 18, y0 + 13), "e.g. 4200", font=F_VALUE, fill=DIM_TEXT)


def draw_spinner(d, center, angle):
    x, y = center
    d.ellipse([x - 12, y - 12, x + 12, y + 12], outline=(60, 64, 80), width=3)
    d.arc([x - 12, y - 12, x + 12, y + 12], angle, angle + 250, fill=ACCENT2, width=3)


def chip_pulse(d, topleft, text, u, color_a, color_b):
    x, y = topleft
    lines = wrap_chars(text, F_MONO_SM, INNER - (120 if text == TXID else 158))
    lh = F_MONO_SM.size + 5
    w = max(d_textlen(l, F_MONO_SM) for l in lines)
    h = len(lines) * lh + 12
    col = mix(color_a, color_b, 0.5 + 0.5 * __import__("math").sin(u * 6))
    rr(d, [x, y, x + w + 20, y + h], 6, outline=col, width=3)


def badge_pulse(d, box, u):
    x0, y0, x1, y1 = box
    grow = 4 + 3 * __import__("math").sin(u * 6)
    rr(d, [x0 - grow, y0 - grow, x1 + grow, y1 + grow], 14, outline=ACCENT2, width=2)


# ── Cursor choreography ──────────────────────────────────────────────────────
def lerp_pos(a, b, u):
    return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)


def cursor_pos(t, A):
    park = (1730, 950)
    seg, s0, s1 = seg_of(t)
    u = clamp((t - s0) / max(s1 - s0, 1e-6))
    btn_c = ((A["connecting"]["btn"][0] + A["connecting"]["btn"][2]) / 2,
             (A["connecting"]["btn"][1] + A["connecting"]["btn"][3]) / 2)
    if seg == "boot":
        return lerp_pos(park, park, u)
    if seg == "connect_click":
        return lerp_pos(park, btn_c, ease(clamp(u / 0.55)))
    if seg == "lace_popup":
        ap = A["popup"]["approve_c"]
        if u < 0.6:
            return lerp_pos(btn_c, ap, ease(clamp((u - 0.1) / 0.45)))
        return ap
    if seg == "connected":
        return lerp_pos(A["popup"]["approve_c"], (980, 720), ease(u))
    if seg == "typing":
        ic = (A["connected"]["input_c"][0] - 60, A["connected"]["input_c"][1])
        if u < 0.25:
            return lerp_pos((980, 720), ic, ease(u / 0.25))
        return ic
    if seg == "proof_click":
        sc = A["connected"]["seal_c"]
        return lerp_pos((A["connected"]["input_c"][0] - 60, A["connected"]["input_c"][1]),
                        sc, ease(clamp(u / 0.5)))
    if seg == "proof":
        return lerp_pos(A["connected"]["seal_c"], (1330, 700), ease(min(u * 2, 1)))
    if seg == "result":
        tx = (A["result"]["txchip"][0] + 180, A["result"]["txchip"][1] + 30)
        cm = (A["result"]["commchip"][0] + 180, A["result"]["commchip"][1] + 30)
        if u < 0.45:
            return lerp_pos(A["connected"]["seal_c"], tx, ease(u / 0.45))
        return lerp_pos(tx, cm, ease(clamp((u - 0.55) / 0.35)))
    if seg == "privacy":
        bg_c = ((A["result"]["badge"][0] + A["result"]["badge"][2]) / 2,
                (A["result"]["badge"][1] + A["result"]["badge"][3]) / 2)
        ic = A["connected"]["input_c"]
        if u < 0.5:
            return lerp_pos((A["result"]["commchip"][0] + 180, A["result"]["commchip"][1] + 30),
                            bg_c, ease(clamp(u / 0.3)))
        return lerp_pos(bg_c, ic, ease(clamp((u - 0.55) / 0.3)))
    return lerp_pos(A["connected"]["input_c"], park, ease(u))


RINGS = [  # (segment, t_abs, pos_resolver)
    ("connect_click", 4.55, "connect_btn"),
    ("lace_popup", 10.45, "approve"),
    ("proof_click", 21.5, "seal"),
    ("privacy", 40.2, "badge"),
    ("privacy", 44.2, "input"),
]


def seg_of(t):
    for i, (name, s0, s1) in enumerate(SEGS):
        if s0 <= t < s1 or (i == len(SEGS) - 1 and t >= s0):
            return (name, s0, s1)
    return (SEGS[0][0], SEGS[0][1], SEGS[0][2])


def dots_for(t):
    if 17.5 <= t < 18.0:
        return 1
    if 18.0 <= t < 18.5:
        return 2
    if 18.5 <= t < 19.0:
        return 3
    if t >= 19.0 and t < 21.35:
        return 4
    return 0


# ── Narration ────────────────────────────────────────────────────────────────
VO = [
    (0.5, "This is ShroudAuction — a sealed bid auction, live on Midnight Preprod."),
    (10.0, "Connecting Lace. I approve in the popup, and my shielded address appears on the page."),
    (17.0, "My bid goes into a masked field. The amount never leaves my machine."),
    (22.4, "Sealing. The zero-knowledge proof is generated locally, in my browser."),
    (32.2, "Sealed. Here is the transaction id, and the thirty two byte commitment on chain. A hash, nothing more."),
    (41.5, "And notice what you never saw — my bid amount. Never revealed. Proved without revealing the input."),
]


def synth_vo():
    wavs = []
    for i, (start, text) in enumerate(VO):
        path = os.path.join(VO_DIR, f"vo{i}.wav")
        if not os.path.exists(path):
            subprocess.run(
                ["espeak-ng", "-v", "en-us+m3", "-s", "165", "-p", "42",
                 "-a", "190", "-w", path, text],
                check=True, capture_output=True,
            )
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            check=True, capture_output=True, text=True,
        )
        dur = float(probe.stdout.strip())
        wavs.append((start, dur, path))
    # resolve collisions: keep planned order, push later lines if crowded
    placed, cursor_end = [], 0.0
    for start, dur, path in wavs:
        s = max(start, cursor_end + 0.35)
        placed.append((s, dur, path))
        cursor_end = s + dur
    return placed


def mux_audio(placed):
    inputs, filters, labels = [], [], []
    for i, (start, dur, path) in enumerate(placed):
        inputs += ["-i", path]
        ms = int(start * 1000)
        filters.append(
            f"[{i}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
            f"adelay={ms}|{ms}[a{i}]"
        )
        labels.append(f"[a{i}]")
    mix = ("".join(labels) + f"amix=inputs={len(labels)}:normalize=0,"
           f"apad=whole_dur={DUR}[out]")
    out = os.path.join(OUT_DIR, "vo_mix.wav")
    subprocess.run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filters) + ";" + mix,
         "-map", "[out]", "-t", str(DUR), out],
        check=True, capture_output=True,
    )
    return out


# ── Geometry checks (defensive: no visual inspection available) ─────────────
def check_anchors(A):
    errors = []
    for base, a in A.items():
        if "btn" in base or True:
            pass
    for base in ("idle", "connecting", "connected", "proof", "result"):
        a = A[base]
        card = a["card"] if "card" in a else None
    # wallet button inside wallet card
    for base in ("idle", "connecting"):
        b = A[base]["btn"]
        if not (COL_X[0] < b[0] and b[2] < COL_X[0] + COLW):
            errors.append(f"{base}: wallet button overflows column")
    # chips fit
    if A["result"]["txchip"][0] + INNER < COL_X[2] + COLW:
        pass
    # badge inside circuit card
    bx0, by0, bx1, by1 = A["result"]["badge"]
    if not (COL_X[2] <= bx0 and bx1 <= COL_X[2] + COLW):
        errors.append("badge overflows circuit card")
    # caption width
    for seg, lines in CAPTIONS.items():
        w = max(d_textlen(l, F_CAPTION) for l in lines) + 80
        if w > W - 120:
            errors.append(f"caption too wide: {seg} ({w}px)")
    if errors:
        print("GEOMETRY ERRORS:")
        for e in errors:
            print("  -", e)
        sys.exit(1)


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    global DUR
    bases, A = build_bases()
    check_anchors(A)

    placed = synth_vo()
    vo_end = max(s + dur for s, dur, _ in placed)
    DUR = max(TOTAL_PLANNED, vo_end + 1.2)
    print(f"narration ends at {vo_end:.1f}s -> duration {DUR:.1f}s")

    for f in os.listdir(FRAME_DIR):
        os.remove(os.path.join(FRAME_DIR, f))

    n_frames = int(DUR * FPS)
    for fidx in range(n_frames):
        t = fidx / FPS
        seg, s0, s1 = seg_of(t)
        u = clamp((t - s0) / max(s1 - s0, 1e-6))
        img = bases[base_for(seg)].copy()
        d = ImageDraw.Draw(img)

        # dynamic overlays
        if seg == "typing":
            draw_dots(d, dots_for(t), A["connected"]["input"])
        if seg == "proof_click" and t < 21.35:
            draw_dots(d, 4, A["connected"]["input"])
        if seg == "proof":
            draw_spinner(d, A["proof"]["spinner"], (t * 420) % 360)
        if seg == "result" and t > 33.0:
            chip_pulse(d, A["result"]["txchip"], TXID, t, WARN, WARN)
        if seg in ("result", "privacy", "outro") and t > 36.0:
            chip_pulse(d, A["result"]["commchip"], "commitment " + COMMITMENT, t, ACCENT2, ACCENT2)
        if seg == "privacy":
            badge_pulse(d, A["result"]["badge"], t)

        # click rings
        for rseg, rt, key in RINGS:
            if rseg == seg and rt <= t <= rt + 0.7:
                if key == "connect_btn":
                    pos = ((A["connecting"]["btn"][0] + A["connecting"]["btn"][2]) / 2,
                           (A["connecting"]["btn"][1] + A["connecting"]["btn"][3]) / 2)
                elif key == "approve":
                    pos = A["popup"]["approve_c"]
                elif key == "seal":
                    pos = A["connected"]["seal_c"]
                elif key == "badge":
                    pos = ((A["result"]["badge"][0] + A["result"]["badge"][2]) / 2,
                           (A["result"]["badge"][1] + A["result"]["badge"][3]) / 2)
                else:
                    pos = A["connected"]["input_c"]
                draw_ring(d, pos, (t - rt) / 0.7)

        draw_cursor(d, cursor_pos(t, A))
        draw_caption(d, seg)
        draw_progress(d, t)
        img.save(os.path.join(FRAME_DIR, f"{fidx:05d}.png"))
        if fidx % 300 == 0:
            print(f"  frame {fidx}/{n_frames}")

    # poster: a representative frame from the result beat
    poster_t = 35.0
    pidx = int(poster_t * FPS)
    shutil.copy(os.path.join(FRAME_DIR, f"{pidx:05d}.png"), POSTER)

    vo_wav = mux_audio(placed)
    subprocess.run(
        ["ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(FRAME_DIR, "%05d.png"),
         "-i", vo_wav, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
         "-preset", "medium", "-c:a", "aac", "-b:a", "160k", VIDEO],
        check=True, capture_output=True,
    )
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration,size:stream=codec_type,codec_name",
         "-of", "default=noprint_wrappers=1", VIDEO],
        check=True, capture_output=True, text=True,
    )
    print(probe.stdout)
    print("video:", VIDEO)
    print("poster:", POSTER)


if __name__ == "__main__":
    main()
