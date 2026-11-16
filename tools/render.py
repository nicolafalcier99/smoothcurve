#!/usr/bin/env python3
"""Draw a ScriptUI window to a PNG from its control tree, without the app's window.

`scriptui.get` returns every control with its bounds and, for controls with an onDraw handler,
the list of paint operations the script recorded. This file paints that list the way
EffectCraft's own frontend does (crates/ui-egui/src/panels/scriptui_view.rs, v0.24.1): fills,
strokes as polylines, ellipses as 48-sided polygons, text in Inter Regular anchored top-left,
everything clipped to the control. Text fields are drawn as plain dark boxes with their text.
It is a preview for working on the layout: the real app is the reference.

    python3 tools/render.py TREE.json OUT.png [--scale 2] [--bg 232323]

Needs Pillow and the app's UI font, Inter-Regular.ttf ($SMOOTHCURVE_FONT, or
tools/fonts/Inter-Regular.ttf; the app embeds the same file).
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.environ.get("SMOOTHCURVE_FONT") or os.path.join(HERE, "fonts", "Inter-Regular.ttf")
SS = 2                      # supersampling on top of the output scale, for smooth edges
THEME_TEXT = (0xDC, 0xDC, 0xDC, 255)
FIELD_BG = (0x17, 0x17, 0x17, 255)
FIELD_BORDER = (0x3A, 0x3A, 0x3A, 255)

_fonts = {}


def font(px):
    key = round(px * 4) / 4
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(FONT, key)
    return _fonts[key]


def rgba(c, fallback):
    if not c:
        return fallback
    return tuple(int(round(max(0.0, min(1.0, v)) * 255)) for v in (list(c) + [1.0])[:4])


def subpaths(path):
    """The path as a list of (points, closed) polylines; rects and ellipses are closed."""
    out, cur = [], []
    for seg in path:
        k = seg["k"]
        if k == "M":
            if len(cur) > 1:
                out.append((cur, False))
            cur = [(seg["x"], seg["y"])]
        elif k == "L":
            cur.append((seg["x"], seg["y"]))
        elif k == "Z":
            if len(cur) > 1:
                out.append((cur, True))
            cur = []
        elif k == "R":
            x, y, w, h = seg["x"], seg["y"], seg["w"], seg["h"]
            out.append(([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], True))
        elif k == "E":
            x, y, w, h = seg["x"], seg["y"], seg["w"], seg["h"]
            pts = [(x + w / 2 + w / 2 * math.cos(2 * math.pi * i / 48), y + h / 2 + h / 2 * math.sin(2 * math.pi * i / 48)) for i in range(48)]
            out.append((pts, True))
    if len(cur) > 1:
        out.append((cur, False))
    return out


def paint(img, rect, ops, k):
    """Paint a draw list into `rect` (x, y, w, h in points) of `img`; k = pixels per point."""
    x0, y0, w, h = rect
    layer = Image.new("RGBA", (max(1, int(math.ceil(w * k))), max(1, int(math.ceil(h * k)))), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    for op in ops:
        kind = op["op"]
        if kind == "fill":
            col = rgba(op.get("color"), FIELD_BG)
            for pts, _closed in subpaths(op["path"]):
                if len(pts) >= 3:
                    d.polygon([(px * k, py * k) for px, py in pts], fill=col)
        elif kind == "stroke":
            col = rgba(op.get("color"), THEME_TEXT)
            width = max(1, int(round(op.get("width", 1) * k)))
            for pts, closed in subpaths(op["path"]):
                line = [(px * k, py * k) for px, py in pts]
                if closed:
                    line.append(line[0])
                d.line(line, fill=col, width=width, joint="curve")
        elif kind == "text":
            col = rgba(op.get("color"), THEME_TEXT)
            d.text((op["x"] * k, op["y"] * k), op["text"], font=font(op.get("size", 12) * k), fill=col, anchor="la")
    img.alpha_composite(layer, (int(round(x0 * k)), int(round(y0 * k))))


def native(img, node, k):
    """A stand-in for the controls the app draws itself."""
    x, y, w, h = node["bounds"]
    d = ImageDraw.Draw(img, "RGBA")
    box = [x * k, y * k, (x + w) * k, (y + h) * k]
    t = node["type"]
    if t == "edittext":
        d.rounded_rectangle(box, radius=2 * k, fill=FIELD_BG, outline=FIELD_BORDER, width=max(1, int(k / 2)))
        text = node.get("text", "")
        if node.get("multiline"):
            text = text[:400]
        clip = Image.new("RGBA", (max(1, int((w - 8) * k)), max(1, int(h * k))), (0, 0, 0, 0))
        ImageDraw.Draw(clip).text((0, (h - 12 * 1.21) / 2 * k), text, font=font(12 * k), fill=THEME_TEXT, anchor="la")
        img.alpha_composite(clip, (int((x + 4) * k), int(y * k)))
    elif t == "statictext":
        d.text((x * k, (y + 1) * k), node.get("text", ""), font=font(12 * k), fill=THEME_TEXT, anchor="la")
    elif t in ("button", "iconbutton", "dropdownlist", "checkbox", "radiobutton"):
        d.rounded_rectangle(box, radius=3 * k, fill=(0x3A, 0x3A, 0x3A, 255))
        d.text(((x + w / 2) * k, (y + h / 2) * k), node.get("text", ""), font=font(12 * k), fill=THEME_TEXT, anchor="mm")


def walk(img, node, k):
    if not node.get("visible", True):
        return
    custom = "onDraw" in node.get("handlers", [])
    if custom:
        paint(img, node["bounds"], node.get("draw", []), k)
    elif node["type"] not in ("window", "panel", "group", "tab", "tabbedpanel"):
        native(img, node, k)
    for child in node.get("children", []):
        walk(img, child, k)


def render(tree, out, scale=2.0, bg="232323"):
    root = tree["root"] if "root" in tree else tree
    k = scale * SS
    w, h = root["bounds"][2], root["bounds"][3]
    img = Image.new("RGBA", (int(math.ceil(w * k)), int(math.ceil(h * k))), tuple(int(bg[i:i + 2], 16) for i in (0, 2, 4)) + (255,))
    walk(img, root, k)
    img = img.resize((int(math.ceil(w * scale)), int(math.ceil(h * scale))), Image.LANCZOS)
    img.convert("RGB").save(out)
    return img.size


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if len(args) < 2:
        raise SystemExit(__doc__)
    scale = float(argv[argv.index("--scale") + 1]) if "--scale" in argv else 2.0
    bg = argv[argv.index("--bg") + 1] if "--bg" in argv else "232323"
    tree = json.load(open(args[0]))
    if isinstance(tree, list):                       # the output of `effectcraft-cli run ... --json`
        tree = [s["result"] for s in tree if s.get("command") == "scriptui.get"][-1]
    print("%dx%d" % render(tree, args[1], scale, bg), args[1])


if __name__ == "__main__":
    main(sys.argv[1:])
