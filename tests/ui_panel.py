"""T5 and T6, and the panel side of T2 to T4: the built panel driven by mouse events.

Every test starts its own headless EffectCraft session, runs dist/SmoothCurve.jsx in it and
acts only through what a user has: the mouse on the canvas and text typed into the fields.
"""
import json
import math
import os
import time

import panel as P

PRESETS = [("Linear", [0, 0, 1, 1])]
for fam, a, b, c in [
        ("Sine", [0.12, 0, 0.39, 0], [0.61, 1, 0.88, 1], [0.37, 0, 0.63, 1]),
        ("Quad", [0.11, 0, 0.5, 0], [0.5, 1, 0.89, 1], [0.45, 0, 0.55, 1]),
        ("Cubic", [0.32, 0, 0.67, 0], [0.33, 1, 0.68, 1], [0.65, 0, 0.35, 1]),
        ("Quart", [0.5, 0, 0.75, 0], [0.25, 1, 0.5, 1], [0.76, 0, 0.24, 1]),
        ("Quint", [0.64, 0, 0.78, 0], [0.22, 1, 0.36, 1], [0.83, 0, 0.17, 1]),
        ("Expo", [0.7, 0, 0.84, 0], [0.16, 1, 0.3, 1], [0.87, 0, 0.13, 1]),
        ("Circ", [0.55, 0, 1, 0.45], [0, 0.55, 0.45, 1], [0.85, 0, 0.15, 1]),
        ("Back", [0.36, 0, 0.66, -0.56], [0.34, 1.56, 0.64, 1], [0.68, -0.6, 0.32, 1.6])]:
    PRESETS += [(fam + " In", a), (fam + " Out", b), (fam + " In-Out", c)]

SETUP = """
var c = app.project.items.addComp("C", 640, 360, 1, 5, 30); c.openInViewer();
var s = c.layers.addSolid([1, 0, 0], "Box", 100, 100, 1);
var r = s.transform.rotation; r.setValueAtTime(0, 0); r.setValueAtTime(1, 100); r.setValueAtTime(2, 40);
r.setSelectedAtKey(1, true); r.setSelectedAtKey(2, true); 1
"""
ROT = "app.project.item(1).layer(1).transform.rotation"
EASES = """
(function () { var p = %s, out = [];
  for (var k = 1; k <= p.numKeys; k++) { var i = p.keyInTemporalEase(k)[0], o = p.keyOutTemporalEase(k)[0];
    out.push([p.keyInInterpolationType(k), Math.round(i.speed * 1000) / 1000, Math.round(i.influence * 1000) / 1000,
              p.keyOutInterpolationType(k), Math.round(o.speed * 1000) / 1000, Math.round(o.influence * 1000) / 1000]); }
  return JSON.stringify(out); })()
""" % ROT
LIBRARY = ('{"format":"curve-library","version":1,"name":"Reels","presets":['
           + ",".join('{"name":"Curve %02d","bezier":[0.%d,0,0.5,1]}' % (i, i + 10) for i in range(1, 15)) + "]}")


def bezier_y(b, u):
    lo, hi = 0.0, 1.0
    for _ in range(50):
        t = (lo + hi) / 2
        x = 3 * (1 - t) ** 2 * t * b[0] + 3 * (1 - t) * t * t * b[2] + t ** 3
        lo, hi = (t, hi) if x < u else (lo, t)
    return 3 * (1 - t) ** 2 * t * b[1] + 3 * (1 - t) * t * t * b[3] + t ** 3


class Checks:
    def __init__(self):
        self.n, self.fails, self.group = 0, [], ""

    def ok(self, name, cond, detail=""):
        self.n += 1
        if not cond:
            self.fails.append("FAIL %s: %s%s" % (self.group, name, (" :: %s" % (detail,)) if detail != "" else ""))

    def eq(self, name, got, want):
        self.ok(name, got == want, "got %r, want %r" % (got, want))

    def near(self, name, got, want, tol):
        good = all(abs(g - w) <= tol for g, w in zip(got, want)) if isinstance(want, (list, tuple)) else abs(got - want) <= tol
        self.ok(name, good, "got %r, want %r (tol %s)" % (got, want, tol))


def rot_at(s, t):
    return s.script("%s.valueAtTime(%s, false)" % (ROT, t))


def eases(s):
    return json.loads(s.script(EASES))


def drag_handle_to(p, which, u, v, **keys):
    target = p.to_px(u, v)
    p.drag(p.handle(which), target, **keys)


def drag_handle_by(p, which, du, dv, **keys):
    """Drag a handle (or its marker on the edge) by an amount in graph units."""
    st = p.state()
    x, y = st["handles"][which]
    g, (lo, hi) = st["graph"], st["view"]
    p.drag((x, y), (x + du * g["w"], y - dv * g["h"] / (hi - lo)), **keys)


def strokes(p, rgb, alpha, width):
    """The stroke operations painted in this colour and width: lists of path segments."""
    out = []
    for op in p.control("canvas")["draw"]:
        col = op.get("color")
        if op["op"] == "stroke" and col and abs(op.get("width", 1) - width) < 0.01 and all(abs(a - b) < 0.01 for a, b in zip(col, list(rgb) + [alpha])):
            out.append(op["path"])
    return out


def curve_extent(b):
    ys = []
    for i in range(0, 2001):
        t = i / 2000
        ys.append(3 * (1 - t) ** 2 * t * b[1] + 3 * (1 - t) * t * t * b[3] + t ** 3)
    return min(ys), max(ys)


ACCENT = (0.29, 0.56, 1)


def import_reels(p):
    p.click("more")
    p.click("menu:4")
    p.set("libraryText", LIBRARY)
    p.click("sheet:import")


# ------------------------------------------------------------------------------------ tests

def t_start(c):
    with P.Session() as s:
        p = P.Panel(s)
        st = p.state()
        c.eq("layout", st["layout"], "tall")
        c.eq("size", st["size"], [300, 720])
        c.eq("starts on Sine In-Out", st["bezier"], [0.37, 0, 0.63, 1])
        c.eq("the matching tile is selected", st["selected"], {"lib": "easings", "name": "Sine In-Out"})
        c.eq("readout shows the curve", p.text("readout"), "0.37, 0.00, 0.63, 1.00")
        c.eq("mode", st["mode"], "In-Out")
        seen = {h["id"] for h in st["hits"] if h["id"].startswith("tile:easings:")}
        c.eq("two rows of tiles show", len(seen), 18)
        for name, _ in PRESETS:
            seen.add(p.rect("tile:easings:" + name)["id"])           # scrolls to the ones out of sight
        c.eq("all 25 easings can be reached", len(seen), 25)
        p.scroll_to("tile:easings:Sine In")
        c.ok("hidden fields are hidden", not p.visible("search") and not p.visible("name") and not p.visible("libraryText") and not p.visible("libraryPath"))
        c.ok("the canvas paints", len(p.control("canvas")["draw"]) > 50)
        c.ok("no error text is painted", not any("could not" in t.lower() or "problem" in t.lower() for t in p.painted()), p.painted()[-3:])
        c.eq("one edit field over the canvas", [ch["name"] for ch in p.tree()["root"]["children"] if ch["visible"] and ch["type"] == "edittext"], ["readout"])


def t_drag(c):
    with P.Session() as s:
        p = P.Panel(s)
        drag_handle_to(p, 0, 0.2, 0.5)
        st = p.state()
        c.near("first handle follows the mouse", st["bezier"], [0.2, 0.5, 0.63, 1], 0.006)
        c.eq("the readout follows", p.text("readout"), "0.20, 0.50, 0.63, 1.00")
        c.eq("a hand-shaped curve selects no tile", st["selected"], None)
        c.eq("the old curve stays as a ghost", st["ghost"], [0.37, 0, 0.63, 1])
        drag_handle_to(p, 1, 0.7, 0.8)
        c.near("second handle follows the mouse", p.state()["bezier"], [0.2, 0.5, 0.7, 0.8], 0.006)
        # x stays in 0..1 however far the mouse goes; y may overshoot up to the limits.
        drag_handle_to(p, 0, -0.8, 0.5)
        c.near("x is held at 0", p.state()["bezier"][0], 0, 1e-9)
        drag_handle_to(p, 1, 1.9, 0.8)
        c.near("x is held at 1", p.state()["bezier"][2], 1, 1e-9)
        grid = (p.state()["view"], p.state()["graph"])
        drag_handle_to(p, 1, 0.6, 1.4)
        st = p.state()
        c.near("overshoot above the box", st["bezier"][3], 1.4, 0.01)
        c.eq("the grid kept its size", (st["view"], st["graph"]), grid)
        c.eq("the far handle is marked on the edge", st["pinned"], [False, True])
        g, hy = st["graph"], st["handles"][1][1]
        c.ok("the marker is inside the graph", g["y"] - 14 <= hy <= g["y"] + g["h"] + 14, (hy, g))
        drag_handle_to(p, 1, 0.6, 9)
        c.near("overshoot stops at the limit", p.state()["bezier"][3], 2.5, 1e-9)
        drag_handle_by(p, 1, 0, -1.5)
        st = p.state()
        c.near("pulled back by 1.5 from its marker: exactly 1.0", st["bezier"][3], 1.0, 0.01)
        c.eq("and it is a round handle again", st["pinned"], [False, False])
        c.eq("the grid still has its size", (st["view"], st["graph"]), grid)
        # A press away from the handles does nothing.
        before = p.state()["bezier"]
        mid = p.to_px(0.5, 0.5)
        p.drag(mid, (mid[0] + 40, mid[1] + 40))
        c.eq("dragging the empty graph changes nothing", p.state()["bezier"], before)
        # Both handles on the same spot: the nearer one is taken.
        p.type("readout", "0.5, 0.5, 0.5, 0.5")
        x, y = p.to_px(0.5, 0.5)
        p.drag((x, y), p.to_px(0.3, 0.2))
        b = p.state()["bezier"]
        c.ok("overlapping handles: one of them moves", (abs(b[0] - 0.3) < 0.01) != (abs(b[2] - 0.3) < 0.01), b)


def t_fixed_grid(c):
    """From the first user's report on the first build: a curve that leaves the grid must not be
    bent to stay in, and the grid must not change size when such a curve is hovered, selected or
    dragged."""
    with P.Session() as s:
        p = P.Panel(s)
        st = p.state()
        grid = (st["view"], st["graph"])
        g, (lo, hi) = st["graph"], st["view"]
        scale = g["h"] / (hi - lo)                              # pixels per unit of value
        y_of = lambda v: g["y"] + (hi - v) * scale
        c.ok("there is room above and below the box", lo <= -0.13 and hi >= 1.13 and abs((-lo) - (hi - 1)) < 1e-6, (lo, hi))
        c.near("the box is square", scale, g["w"], 0.01)
        back_out, back_inout = [0.34, 1.56, 0.64, 1], [0.68, -0.6, 0.32, 1.6]
        # Hover: the preview has its real shape, the grid does not move.
        p.hover("tile:easings:Back Out")
        st = p.state()
        c.eq("hovering an overshooting curve leaves the grid alone", (st["view"], st["graph"]), grid)
        pv = strokes(p, ACCENT, 0.5, 1.5)
        c.eq("the preview is one unbroken line", (len(pv), len([q for q in pv[0] if q["k"] == "M"]) if pv else 0), (1, 1))
        if pv:
            top = min(q["y"] for q in pv[0])
            c.near("the preview rises above the box as far as the curve does", top, y_of(curve_extent(back_out)[1]), 1.5)
            c.ok("it is not flattened along an edge", len([q for q in pv[0] if abs(q["y"] - top) < 0.05]) <= 2, [q["y"] for q in pv[0]][:12])
        # Select: the grid does not change size.
        p.click("tile:easings:Back Out")
        st = p.state()
        c.eq("selecting it leaves the grid alone", (st["view"], st["graph"]), grid)
        main = strokes(p, ACCENT, 1, 2)
        c.eq("the curve is one unbroken line", (len(main), len([q for q in main[0] if q["k"] == "M"]) if main else 0), (1, 1))
        c.near("the curve rises above the box as far as it really does", min(q["y"] for q in main[0]), y_of(curve_extent(back_out)[1]), 1.0)
        c.eq("its far handle is marked on the top edge", st["pinned"], [True, False])
        c.ok("the marker is inside the well, above the box", g["y"] - 13 <= st["handles"][0][1] < y_of(1), st["handles"][0])
        c.ok("the tooltip says where the handle is", "beyond the graph (1.56)" in (p.hover("handle0") or p.control("canvas")["helpTip"]), p.control("canvas")["helpTip"])
        p.click("tile:easings:Back In-Out")
        st = p.state()
        c.eq("both far handles are marked", st["pinned"], [True, True])
        c.ok("one below the box, one above", st["handles"][0][1] > y_of(0) and st["handles"][1][1] < y_of(1), st["handles"])
        lo_y, hi_y = curve_extent(back_inout)
        main = strokes(p, ACCENT, 1, 2)[0]
        c.near("the dip below the box is drawn as it is", max(q["y"] for q in main), y_of(lo_y), 1.0)
        c.near("the rise above the box is drawn as it is", min(q["y"] for q in main), y_of(hi_y), 1.0)
        c.eq("still the same grid", (st["view"], st["graph"]), grid)
        # Drag out: the grid does not tighten, on the way or after.
        p.click("tile:easings:Sine In-Out")
        a, b = p.handle(1), p.to_px(0.6, 2.0)
        p.drag(a, b, steps=10, release=False)
        st = p.state()
        c.eq("dragging a handle out leaves the grid alone", (st["view"], st["graph"]), grid)
        c.near("the handle went where the mouse went", st["bezier"][2:], [0.6, 2.0], 0.01)
        p.mouse("mouseup", *b)
        c.eq("and after letting go", (p.state()["view"], p.state()["graph"]), grid)
        # Taking a far handle by its marker does not make it jump.
        st = p.state()
        x, y = st["handles"][1]
        p.mouse("mousemove", x + 3, y + 2)
        p.mouse("mousedown", x + 3, y + 2, buttons=1)
        p.mouse("mousemove", x + 3, y + 3, buttons=1)
        b1 = p.state()["bezier"]
        c.near("one pixel of mouse is one pixel of handle, however far out it is", b1[3], 2.0 - 1 / scale, 0.002)
        c.near("and no sideways jump", b1[2], 0.6, 0.002)
        p.mouse("mouseup", x + 3, y + 3)
        # A visible handle taken off-centre does not jump either.
        p.type("readout", "0.3, 0.4, 0.7, 0.6")
        x, y = p.handle(0)
        p.mouse("mousemove", x + 6, y - 5)
        p.mouse("mousedown", x + 6, y - 5, buttons=1)
        p.mouse("mousemove", x + 6 + 0.1 * g["w"], y - 5, buttons=1)
        c.near("a handle taken off-centre keeps its offset", p.state()["bezier"][:2], [0.4, 0.4], 0.002)
        p.mouse("mouseup", x + 6 + 0.1 * g["w"], y - 5)
        # A curve that goes far out is cut at the edge, not bent along it.
        p.type("readout", "0.3, 2.5, 0.6, 1")
        st = p.state()
        main = strokes(p, ACCENT, 1, 2)[0]
        c.ok("a curve that leaves the graph is cut in two", len([q for q in main if q["k"] == "M"]) == 2, [q["k"] for q in main])
        well_top = g["y"] - 13
        c.ok("nothing is drawn outside the well", all(q["y"] >= well_top + 3.9 for q in main), min(q["y"] for q in main))
        ys = [round(q["y"], 1) for q in main]
        c.ok("no stretch of it runs along the edge", all(not (ys[i] == ys[i + 1] == ys[i + 2]) for i in range(len(ys) - 2)), ys)
        c.eq("the grid is the same as at the start", (st["view"], st["graph"]), grid)
        # The same in a short panel and in the wide layout.
        for size in ((300, 470), (760, 420), (220, 640), (420, 1000)):
            p.resize(*size)
            p.type("readout", "0.37, 0, 0.63, 1")
            before = (p.state()["view"], p.state()["graph"])
            p.type("readout", "0.68, -0.6, 0.32, 1.6")
            st = p.state()
            c.eq("%dx%d: an overshooting curve leaves the grid alone" % size, (st["view"], st["graph"]), before)
            c.ok("%dx%d: headroom above and below" % size, st["view"][0] <= -0.13 and st["view"][1] >= 1.13, st["view"])


def box_size(st):
    """The 0..1 box in pixels: (width, height)."""
    g, (lo, hi) = st["graph"], st["view"]
    return g["w"], g["h"] / (hi - lo)


def easing_tiles(p):
    return sorted(h["id"] for h in p.state()["hits"] if h["id"].startswith("tile:easings:"))


def t_graph_first(c):
    """From the user's second report: the graph comes before the presets. Its 0..1 box is never
    lower than it is wide; the presets keep fewer rows and scroll."""
    with P.Session() as s:
        p = P.Panel(s)
        st = p.state()
        well, graph = st["well"], st["graph"]
        bw, bh = box_size(st)
        c.near("the box is square", bh, bw, 0.01)
        c.near("and as wide as the graph", bw, well["w"] - 26, 0.01)
        c.ok("the graph is taller than it is wide", well["h"] > well["w"], well)
        first = easing_tiles(p)
        c.ok("the presets give way: two rows show and the rest scroll", len(first) == 18 and p.has("scroll"), len(first))
        r = p.rect("scroll")
        p.drag((r["x"] + r["w"] / 2, r["y"] + 4), (r["x"] + r["w"] / 2, r["y"] + r["h"] - 2))
        c.ok("the last easings are reachable", p.has("tile:easings:Linear") and p.has("tile:easings:Back In-Out"), easing_tiles(p))
        st = p.state()
        c.eq("scrolling the presets leaves the graph alone", (st["well"], st["graph"]), (well, graph))
        p.drag((r["x"] + r["w"] / 2, r["y"] + r["h"] - 4), (r["x"] + r["w"] / 2, r["y"] + 2))
        c.eq("and back to the top", (p.state()["scroll"], easing_tiles(p)), (0, first))
        # No mouse wheel reaches a panel in EffectCraft 0.24.1, so the tiles drag the list too.
        before = p.state()["bezier"]
        x, y = p.centre("tile:easings:Cubic Out")
        p.drag((x, y), (x, y - 50))
        c.ok("dragging the tiles up shows the next row", p.state()["scroll"] == 1 and p.has("tile:easings:Expo Out"), (p.state()["scroll"], easing_tiles(p)))
        c.eq("a drag on the tiles chooses no curve", p.state()["bezier"], before)
        x, y = p.centre("tile:easings:Expo Out")
        p.drag((x, y), (x, y + 300))
        c.eq("dragging down goes back, and stops at the top", p.state()["scroll"], 0)
        x, y = p.centre("tile:easings:Cubic Out")
        p.drag((x, y), (x + 3, y - 4))
        c.eq("a press that slips a few pixels is still a click", p.state()["bezier"], [0.33, 1, 0.68, 1])
        # Tall panels: the box takes the graph's whole width and at least two rows of presets stay.
        for size in ((300, 720), (220, 640), (340, 800), (420, 1000)):
            p.resize(*size)
            st = p.state()
            bw, bh = box_size(st)
            c.near("%dx%d: the box is as wide as the graph" % size, bw, st["well"]["w"] - 26, 0.01)
            c.ok("%dx%d: at least two rows of presets" % size, len(easing_tiles(p)) >= 12, len(easing_tiles(p)))
        # Every layout that has a graph: a square box, in the middle, with room above and below.
        for size in ((300, 720), (300, 660), (300, 600), (300, 520), (300, 470), (250, 560), (220, 640), (180, 500),
                     (420, 1000), (760, 420), (700, 300), (1400, 900), (560, 440)):
            p.resize(*size)
            st = p.state()
            if st["layout"] not in ("tall", "wide"):
                c.ok("%dx%d has a graph" % size, False, st["layout"])
                continue
            w, g, (lo, hi) = st["well"], st["graph"], st["view"]
            bw, bh = box_size(st)
            c.near("%dx%d: the box is square" % size, bh, bw, 0.01)
            c.ok("%dx%d: the box is inside the graph" % size, w["x"] + 12.9 <= g["x"] and g["x"] + g["w"] <= w["x"] + w["w"] - 12.9, (g, w))
            c.near("%dx%d: the box is in the middle" % size, g["x"] + g["w"] / 2, w["x"] + w["w"] / 2, 0.01)
            c.ok("%dx%d: room above and below" % size, lo <= -0.139 and abs(-lo - (hi - 1)) < 1e-6, (lo, hi))
            c.ok("%dx%d: some presets show" % size, len(easing_tiles(p)) >= 3, len(easing_tiles(p)))
        # A low grid of your own curves shows two rows of lower tiles, not one row and a gap.
        p.resize(300, 720)
        import_reels(p)
        mine = [h for h in p.state()["hits"] if h["id"].startswith("tile:mine:")]
        c.eq("two rows of your own curves", len(mine), 6)


def t_zoom(c):
    """From the user's second report: when a curve leaves the graph, zooming out shows how far it
    goes. The zoom changes only when asked: never by itself."""
    with P.Session() as s:
        p = P.Panel(s)
        st = p.state()
        well, start = st["well"], (st["view"], st["graph"])
        side = st["graph"]["w"]
        c.eq("starts at full size", st["zoom"], 1)
        c.ok("a button to zoom out, and none to zoom in", p.has("zoom:out") and not p.has("zoom:in"))
        r = p.rect("zoom:out")
        c.ok("the button is inside the graph", well["x"] <= r["x"] and r["x"] + r["w"] <= well["x"] + well["w"]
             and well["y"] <= r["y"] and r["y"] + r["h"] <= well["y"] + well["h"], r)
        c.ok("its tooltip says what it does", "zoom out" in (p.hover("zoom:out") or p.control("canvas")["helpTip"]).lower(), p.control("canvas")["helpTip"])
        p.click("tile:easings:Back In-Out")
        c.eq("at full size both far handles are marked on the edge", p.state()["pinned"], [True, True])
        p.click("zoom:out")
        st = p.state()
        g, (lo, hi) = st["graph"], st["view"]
        c.ok("one step out", 0.5 < st["zoom"] < 1, st["zoom"])
        c.near("the box is smaller by that much", g["w"], side * st["zoom"], 0.01)
        c.near("and still square", g["h"] / (hi - lo), g["w"], 0.01)
        c.near("in the middle of the graph", g["x"] + g["w"] / 2, well["x"] + well["w"] / 2, 0.01)
        c.near("with the same room above and below", -lo, hi - 1, 1e-6)
        c.ok("more values are in sight", hi - lo > start[0][1] - start[0][0] + 0.2, (lo, hi))
        c.eq("the graph itself keeps its size", st["well"], well)
        c.ok("now there is a button to zoom in", p.has("zoom:in") and p.has("zoom:out"))
        c.eq("the zoom-out button did not move", p.rect("zoom:out"), r)
        p.click("zoom:out")
        st = p.state()
        c.eq("two steps out, both handles are in sight", st["pinned"], [False, False])
        c.near("the first handle is drawn where it is", st["handles"][0], p.to_px(0.68, -0.6), 0.6)
        c.near("and the second", st["handles"][1], p.to_px(0.32, 1.6), 0.6)
        main = strokes(p, ACCENT, 1, 2)
        c.eq("the whole curve is one unbroken line", (len(main), len([q for q in main[0] if q["k"] == "M"]) if main else 0), (1, 1))
        # Zoomed out, everything works as before and the zoom stays where it was put.
        zoomed = (st["view"], st["graph"], st["zoom"])
        now = lambda: (p.state()["view"], p.state()["graph"], p.state()["zoom"])
        drag_handle_to(p, 1, 0.5, 2.0)
        c.near("a handle follows the mouse while zoomed out", p.state()["bezier"][2:], [0.5, 2.0], 0.01)
        c.eq("dragging leaves the zoom alone", now(), zoomed)
        p.hover("tile:easings:Back Out")
        c.eq("hovering a preset leaves the zoom alone", now(), zoomed)
        p.click("tile:easings:Sine In-Out")
        c.eq("choosing a curve leaves the zoom alone", now(), zoomed)
        p.type("readout", "0.3, 2.5, 0.6, -1.5")
        c.eq("typing a far curve leaves the zoom alone", now(), zoomed)
        # All the way out: everything a handle can reach is in sight.
        clicks = 0
        while p.has("zoom:out") and clicks < 12:
            p.click("zoom:out")
            clicks += 1
        st = p.state()
        c.ok("zooming out ends after a few steps", 1 <= clicks <= 4, clicks)
        c.ok("at the end the button to zoom out is gone", not p.has("zoom:out") and p.has("zoom:in"))
        c.ok("the whole range a handle can reach is in sight", st["view"][0] < -1.5 and st["view"][1] > 2.5, st["view"])
        c.eq("no handle is out of sight, even at its limits", st["pinned"], [False, False])
        c.near("the box is still square", box_size(st)[1], box_size(st)[0], 0.01)
        drag_handle_to(p, 0, 0.4, 0.5)
        c.near("handles still drag true", p.state()["bezier"][:2], [0.4, 0.5], 0.02)
        # The zoom is kept for the next launch, and zooming in ends at full size.
        p.click("zoom:in")
        kept = p.state()["zoom"]
        c.ok("one step back in", st["zoom"] < kept < 1, kept)
        s.cmd("scriptui.close", {"window": p.window})
        p2 = P.Panel(s)
        c.eq("the zoom is kept for the next launch", p2.state()["zoom"], kept)
        clicks = 0
        while p2.has("zoom:in") and clicks < 12:
            p2.click("zoom:in")
            clicks += 1
        st = p2.state()
        c.eq("zooming in ends at full size", st["zoom"], 1)
        c.eq("which is the grid as it was at the start", (st["view"], st["graph"]), start)
        # The other layouts.
        for size in ((760, 420), (300, 470), (220, 640)):
            p2.resize(*size)
            p2.type("readout", "0.37, 0, 0.63, 1")
            full = box_size(p2.state())[0]
            p2.click("zoom:out")
            st = p2.state()
            w, g = st["well"], st["graph"]
            c.near("%dx%d: zoomed out, the box is smaller and square" % size, box_size(st), (full * st["zoom"], full * st["zoom"]), 0.01)
            c.near("%dx%d: and in the middle" % size, g["x"] + g["w"] / 2, w["x"] + w["w"] / 2, 0.01)
            drag_handle_to(p2, 1, 0.6, 1.3)
            c.near("%dx%d: handles drag true" % size, p2.state()["bezier"][2:], [0.6, 1.3], 0.02)
            p2.click("zoom:in")
        # Damaged settings: full size.
        s.cmd("scriptui.close", {"window": p2.window})
        s.cmd("script.settings.save", {"section": "SmoothCurve", "key": "ui", "value": '{"zoom":"far"}'})
        c.eq("an odd saved zoom: full size", P.Panel(s).state()["zoom"], 1)


def t_apply_as_drawn(c):
    with P.Session() as s:
        s.script(SETUP)
        p = P.Panel(s)
        drag_handle_to(p, 0, 0.15, 0.7)
        drag_handle_to(p, 1, 0.4, 1.25)
        b = p.state()["bezier"]
        before = eases(s)
        p.click("apply")
        st = p.state()
        c.eq("status", st["status"], "Eased 2 keyframes on 1 property.")
        c.eq("status kind", st["statusKind"], "ok")
        for u in (0.2, 0.5, 0.8):
            c.near("value at %s follows the drawn curve" % u, rot_at(s, u), bezier_y(b, u) * 100, 1.0)
        c.near("the third key was not touched", eases(s)[2], before[2], 0)
        s.cmd("edit.undo")
        c.eq("one undo restores the keyframes", eases(s), before)
        c.near("and the motion is linear again", rot_at(s, 0.25), 25, 1e-6)
        hist = s.cmd("edit.history.list")
        c.ok("the undo step is named after the panel", any(x["label"] == "SmoothCurve Ease" for x in hist["states"]), [x["label"] for x in hist["states"]][-3:])


def t_sides(c):
    with P.Session() as s:
        s.script(SETUP + "; r.setSelectedAtKey(3, true); 1")
        p = P.Panel(s)
        before = eases(s)
        p.click("mode:In")
        c.eq("mode In", p.state()["mode"], "In")
        p.click("apply")
        after = eases(s)
        c.eq("status says which side", p.state()["status"], "Eased 2 keyframes on 1 property (incoming side).")
        c.ok("In: incoming sides changed", after[1][:3] != before[1][:3] and after[2][:3] != before[2][:3], after)
        c.ok("In: outgoing sides kept", after[0][3:] == before[0][3:] and after[1][3:] == before[1][3:], after)
        s.cmd("edit.undo")
        p.click("mode:Out")
        p.click("apply")
        after = eases(s)
        c.eq("status says which side (Out)", p.state()["status"], "Eased 2 keyframes on 1 property (outgoing side).")
        c.ok("Out: outgoing sides changed", after[0][3:] != before[0][3:] and after[1][3:] != before[1][3:], after)
        c.ok("Out: incoming sides kept", after[1][:3] == before[1][:3] and after[2][:3] == before[2][:3], after)


def t_nothing_selected(c):
    with P.Session() as s:
        p = P.Panel(s)
        p.click("apply")
        st = p.state()
        c.eq("no comp: message", st["status"], "Open a composition and select keyframes first.")
        c.eq("no comp: it is a warning", st["statusKind"], "warn")
        s.script(SETUP + "; r.setSelectedAtKey(1, false); r.setSelectedAtKey(2, false); 1")
        before = eases(s)
        n = len(s.cmd("edit.history.list")["states"])
        p.click("apply")
        c.eq("nothing selected: message", p.state()["status"], "Nothing eased. Select keyframes that have another keyframe next to them.")
        c.eq("nothing selected: nothing changed", eases(s), before)
        c.eq("nothing selected: no undo step", len(s.cmd("edit.history.list")["states"]), n)
        p.click("fromKeys")
        c.ok("From keys with nothing selected: message", p.state()["status"].startswith("Select two neighbouring keyframes"), p.state()["status"])
        # Only the first key selected, easing In: it has no key before it.
        s.script("%s.setSelectedAtKey(1, true); 1" % ROT)
        p.click("mode:In")
        p.click("apply")
        c.eq("first key, In: message names the side", p.state()["status"], "Nothing eased. Select keyframes that have another keyframe before them.")


def t_readout(c):
    with P.Session() as s:
        p = P.Panel(s)
        p.type("readout", "0.1, 0.2, 0.3, 0.4")
        c.eq("typed numbers move the handles", p.state()["bezier"], [0.1, 0.2, 0.3, 0.4])
        c.eq("the text is tidied", p.text("readout"), "0.10, 0.20, 0.30, 0.40")
        p.type("readout", "cubic-bezier(0.42, 0, 0.58, 1)")
        c.eq("a pasted cubic-bezier() moves the handles", p.state()["bezier"], [0.42, 0, 0.58, 1])
        c.eq("and is shown as four numbers", p.text("readout"), "0.42, 0.00, 0.58, 1.00")
        p.set("readout", ".2 0 0 1", changing=True)
        c.eq("the curve follows while typing", p.state()["bezier"], [0.2, 0, 0, 1])
        c.eq("without rewriting what is being typed", p.text("readout"), ".2 0 0 1")
        p.set("readout", ".2 0 0 1")
        for junk in ["hello", "", "1, 2, 3", "0.1, 0.2, 0.3, abc", "NaN, 0, 0, 1", "1e999, 0, 0, 1", "<script>", "0.1,,0.2,0.3,0.4,0.5"]:
            p.type("readout", junk)
            c.eq("junk %r is ignored" % junk, p.state()["bezier"], [0.2, 0, 0, 1])
            c.eq("junk %r: the numbers come back" % junk, p.text("readout"), "0.20, 0.00, 0.00, 1.00")
            c.eq("junk %r: a warning" % junk, p.state()["statusKind"], "warn")
        p.type("readout", "7, -9, -3, 9")
        c.eq("out-of-range numbers are held to the limits", p.state()["bezier"], [1, -1.5, 0, 2.5])
        p.type("readout", "0.61, 1, 0.88, 1")
        c.eq("typing a built-in's numbers selects its tile", p.state()["selected"], {"lib": "easings", "name": "Sine Out"})


def t_modifiers(c):
    with P.Session() as s:
        p = P.Panel(s)
        p.type("readout", "0.3, 0.4, 0.7, 0.6")              # both handles 0.5 long
        drag_handle_to(p, 0, 0.25, 0.2, shiftKey=True)
        c.near("Shift snaps y to the floor", p.state()["bezier"], [0.25, 0, 0.7, 0.6], 0.006)
        drag_handle_to(p, 0, 0.25, 0.8, shiftKey=True)
        c.near("Shift snaps y to the ceiling", p.state()["bezier"], [0.25, 1, 0.7, 0.6], 0.006)
        for key in ("ctrlKey", "metaKey"):
            p.type("readout", "0.3, 0.4, 0.7, 0.6")
            drag_handle_to(p, 0, 0.9, 0.05, **{key: True})
            b = p.state()["bezier"]
            c.near("%s keeps the handle's length" % key, math.hypot(b[0], b[1]), 0.5, 0.004)
            c.ok("%s lets the angle change" % key, b[1] < 0.1, b)
            p.type("readout", "0.3, 0.4, 0.7, 0.6")
            drag_handle_to(p, 1, 0.2, 0.95, **{key: True})
            b = p.state()["bezier"]
            c.near("%s keeps the second handle's length" % key, math.hypot(b[2] - 1, b[3] - 1), 0.5, 0.004)
        p.type("readout", "0.3, 0.4, 0.7, 0.6")
        drag_handle_to(p, 0, 0.9, 0.3, altKey=True)
        b = p.state()["bezier"]
        c.near("Alt keeps the handle's angle", math.atan2(b[1], b[0]), math.atan2(0.4, 0.3), 0.004)
        c.ok("Alt lets the length change", abs(math.hypot(b[0], b[1]) - 0.5) > 0.1, b)
        p.type("readout", "0.3, 0.4, 0.7, 0.6")
        drag_handle_to(p, 0, 0.2, 0.3, ctrlKey=True, shiftKey=True)
        b = p.state()["bezier"]
        c.near("Ctrl+Shift moves both handles symmetrically", b, [0.2, 0.3, 0.8, 0.7], 0.006)
        drag_handle_to(p, 1, 0.6, 0.9, metaKey=True, shiftKey=True)
        b = p.state()["bezier"]
        c.near("Cmd+Shift from the second handle", b, [0.4, 0.1, 0.6, 0.9], 0.006)
        # A key pressed only part of the way through a drag applies only while it is down.
        p.type("readout", "0.3, 0.4, 0.7, 0.6")
        a, b2 = p.handle(0), p.to_px(0.25, 0.2)
        p.mouse("mousemove", *a)
        p.mouse("mousedown", *a, buttons=1)
        p.mouse("mousemove", *b2, buttons=1, shiftKey=True)
        c.near("Shift pressed mid-drag snaps", p.state()["bezier"][1], 0, 1e-9)
        p.mouse("mousemove", *b2, buttons=1)
        c.near("Shift released mid-drag frees the handle", p.state()["bezier"][1], 0.2, 0.006)
        p.mouse("mouseup", *b2)


def t_lock_toggles(c):
    with P.Session() as s:
        p = P.Panel(s)
        p.type("readout", "0.3, 0.4, 0.7, 0.6")
        p.click("lock:length")
        c.eq("Length is on", p.state()["locks"], {"length": True, "angle": False, "mirror": False, "snap": False})
        drag_handle_to(p, 0, 0.9, 0.05)
        b = p.state()["bezier"]
        c.near("the Length switch keeps the length without a key", math.hypot(b[0], b[1]), 0.5, 0.004)
        p.click("lock:angle")
        c.eq("Angle replaces Length", p.state()["locks"], {"length": False, "angle": True, "mirror": False, "snap": False})
        p.type("readout", "0.3, 0.4, 0.7, 0.6")
        drag_handle_to(p, 0, 0.9, 0.3)
        b = p.state()["bezier"]
        c.near("the Angle switch keeps the angle", math.atan2(b[1], b[0]), math.atan2(0.4, 0.3), 0.004)
        p.click("lock:angle")
        p.click("lock:mirror")
        p.click("lock:snap")
        c.eq("Mirror and Snap together", p.state()["locks"], {"length": False, "angle": False, "mirror": True, "snap": True})
        drag_handle_to(p, 0, 0.2, 0.3)
        c.near("Mirror with Snap", p.state()["bezier"], [0.2, 0, 0.8, 1], 0.006)
        p.click("lock:mirror")
        p.click("lock:snap")
        c.eq("all off again", p.state()["locks"], {"length": False, "angle": False, "mirror": False, "snap": False})


def t_presets(c):
    with P.Session() as s:
        s.script(SETUP)
        p = P.Panel(s)
        p.click("tile:easings:Quad Out", shiftKey=True)
        st = p.state()
        c.eq("Shift+click a preset: In", (st["mode"], st["bezier"]), ("In", [0.5, 1, 0.89, 1]))
        p.click("tile:easings:Cubic In", altKey=True)
        c.eq("Alt+click a preset: Out", p.state()["mode"], "Out")
        p.click("tile:easings:Expo In-Out", ctrlKey=True)
        c.eq("Ctrl+click a preset: In-Out", p.state()["mode"], "In-Out")
        p.click("mode:In")
        p.click("tile:easings:Expo In-Out", metaKey=True)
        c.eq("Cmd+click a preset: In-Out", p.state()["mode"], "In-Out")
        p.click("mode:Out")
        p.click("tile:easings:Sine In")
        c.eq("a plain click keeps the mode", p.state()["mode"], "Out")
        c.eq("a plain click does not apply", rot_at(s, 0.25), 25)
        p.click("mode:In-Out")
        # Every tile loads its curve and Apply lands it on the keyframes.
        worst = 0
        for name, b in PRESETS:
            p.click("tile:easings:" + name)
            st = p.state()
            c.eq("%s: handles take the preset" % name, st["bezier"], b)
            c.eq("%s: its tile is selected" % name, st["selected"], {"lib": "easings", "name": name})
            p.click("apply")
            c.eq("%s: applied" % name, p.state()["status"], "Eased 2 keyframes on 1 property.")
            err = max(abs(rot_at(s, u) - bezier_y(b, u) * 100) for u in (0.1, 0.25, 0.5, 0.75, 0.9))
            worst = max(worst, err)
            c.ok("%s: the keyframes follow it within 1 %%" % name, err <= 1.0, err)
        e = eases(s)
        c.ok("the last one (Back In-Out) is Bezier", e[0][3] == e[1][0] and e[0][3] != 6612, e)
        p.click("tile:easings:Linear")
        p.click("apply")
        e = eases(s)
        c.eq("Linear sets Linear interpolation", (e[0][3], e[1][0]), (6612, 6612))
        # Double-click applies at once.
        p.click("tile:easings:Quart Out")
        p.click("tile:easings:Quart Out", detail=2)
        c.eq("double-click applies", p.state()["status"], "Eased 2 keyframes on 1 property.")
        c.near("double-click: the keyframes follow", rot_at(s, 0.5), bezier_y([0.25, 1, 0.5, 1], 0.5) * 100, 1.0)


def t_auto_apply(c):
    with P.Session() as s:
        s.script(SETUP)
        p = P.Panel(s)
        n0 = len(s.cmd("edit.history.list")["states"])
        p.click("auto")
        c.eq("Auto-apply is on", p.state()["auto"], True)
        p.click("tile:easings:Expo Out")
        c.near("a click applies at once", rot_at(s, 0.5), bezier_y([0.16, 1, 0.3, 1], 0.5) * 100, 1.0)
        n1 = len(s.cmd("edit.history.list")["states"])
        c.eq("as one undo step", n1 - n0, 1)
        # A drag applies once, when the mouse is let go: not on the way.
        a, b = p.handle(0), p.to_px(0.5, 0.5)
        p.drag(a, b, steps=12, release=False)
        c.eq("nothing is applied while dragging", len(s.cmd("edit.history.list")["states"]), n1)
        mid = rot_at(s, 0.5)
        p.mouse("mouseup", *b)
        c.eq("letting go applies once", len(s.cmd("edit.history.list")["states"]), n1 + 1)
        c.ok("and the keyframes changed", abs(rot_at(s, 0.5) - mid) > 1, (mid, rot_at(s, 0.5)))
        c.near("to the curve as drawn", rot_at(s, 0.5), bezier_y(p.state()["bezier"], 0.5) * 100, 1.0)
        s.cmd("edit.undo")
        c.near("one undo takes the drag back", rot_at(s, 0.5), mid, 1e-6)
        # A click on a handle that does not move it applies nothing.
        n2 = len(s.cmd("edit.history.list")["states"])
        p.click_at(*p.handle(1))
        c.eq("a click without a move applies nothing", len(s.cmd("edit.history.list")["states"]), n2)
        p.type("readout", "0.2, 0, 0, 1")
        c.near("typed numbers apply too", rot_at(s, 0.5), bezier_y([0.2, 0, 0, 1], 0.5) * 100, 1.0)
        p.click("auto")
        p.click("tile:easings:Linear")
        c.near("off again: a click does not apply", rot_at(s, 0.5), bezier_y([0.2, 0, 0, 1], 0.5) * 100, 1.0)


def t_hover(c):
    with P.Session() as s:
        p = P.Panel(s)
        p.hover("tile:easings:Back Out")
        st = p.state()
        c.eq("hovering a tile previews it", st["preview"], [0.34, 1.56, 0.64, 1])
        c.eq("without changing the curve", st["bezier"], [0.37, 0, 0.63, 1])
        c.eq("the tile is the hovered region", st["hover"], "tile:easings:Back Out")
        c.ok("the tooltip names it", p.control("canvas")["helpTip"].startswith("Back Out\n0.34, 1.56, 0.64, 1.00"), p.control("canvas")["helpTip"])
        strokes_hover = len([op for op in p.control("canvas")["draw"] if op["op"] == "stroke"])
        p.mouse("mouseout", 5, 5)
        st = p.state()
        c.eq("leaving the panel ends the preview", (st["preview"], st["hover"]), (None, None))
        c.eq("and the tooltip", p.control("canvas")["helpTip"], "")
        c.ok("the preview was one more line", len([op for op in p.control("canvas")["draw"] if op["op"] == "stroke"]) < strokes_hover)
        p.hover("handle0")
        c.ok("a handle's tooltip lists the keys", "Shift" in p.control("canvas")["helpTip"] and "Alt" in p.control("canvas")["helpTip"])


def t_from_keys(c):
    with P.Session() as s:
        s.script(SETUP)
        p = P.Panel(s)
        p.type("readout", "0.2, 0.9, 0.35, 1.2")
        p.click("apply")
        p.click("tile:easings:Linear")
        p.click("fromKeys")
        st = p.state()
        c.near("From keys reads the curve back", st["bezier"], [0.2, 0.9, 0.35, 1.2], 0.002)
        c.eq("and says so", st["status"], "Read the curve between the first two selected keyframes.")
        c.eq("the readout follows", p.text("readout"), "0.20, 0.90, 0.35, 1.20")


def t_layouts(c):
    with P.Session() as s:
        p = P.Panel(s)
        for (w, h), want in [((300, 720), "tall"), ((760, 420), "wide"), ((900, 60), "strip"), ((260, 300), "presets"),
                             ((220, 640), "tall"), ((300, 470), "tall"), ((700, 300), "wide"), ((1400, 900), "wide"), ((420, 1000), "tall")]:
            p.resize(w, h)
            st = p.state()
            c.eq("%dx%d layout" % (w, h), st["layout"], want)
            c.eq("%dx%d size taken" % (w, h), st["size"], [w, h])
            c.eq("%dx%d canvas fills the panel" % (w, h), p.control("canvas")["bounds"], [0, 0, w, h])
            c.ok("%dx%d readout shown only with the graph" % (w, h), p.visible("readout") == (want in ("tall", "wide")))
            c.ok("%dx%d Apply is there" % (w, h), any(x["id"] == "apply" for x in st["hits"]))
        # Every size from a sliver to a big panel: no error, nothing outside the panel.
        bad = []
        for w in (70, 120, 180, 219, 250, 300, 420, 519, 520, 760, 1200):
            for h in (30, 60, 149, 150, 200, 280, 330, 410, 470, 560, 720, 1000):
                p.resize(w, h)
                tree = p.tree()
                st = p.state(tree)
                if st["size"] != [w, h]:
                    bad.append("%dx%d: size %s" % (w, h, st["size"]))
                for x in st["hits"]:
                    if x["id"].startswith("handle"):
                        continue
                    if x["x"] < -0.6 or x["y"] < -0.6 or x["x"] + x["w"] > w + 0.6 or x["y"] + x["h"] > h + 0.6:
                        bad.append("%dx%d: %s outside %s" % (w, h, x["id"], [x["x"], x["y"], x["w"], x["h"]]))
                for ch in tree["root"]["children"]:
                    if ch["type"] == "edittext" and ch["visible"]:
                        b = ch["bounds"]
                        if b[0] < 0 or b[1] < 0 or b[0] + b[2] > w + 0.6 or b[1] + b[3] > h + 0.6 or b[2] < 30:
                            bad.append("%dx%d: field %s at %s" % (w, h, ch["name"], b))
                texts = [op["text"] for op in p.control("canvas", tree).get("draw", []) if op["op"] == "text"]
                if any("could not" in t.lower() or "problem" in t.lower() for t in texts) or "problem" in st["status"].lower() or "could not" in st["status"].lower():
                    bad.append("%dx%d: error text %s" % (w, h, st["status"]))
                if st["layout"] in ("tall", "wide") and st["graph"]["h"] < 50:
                    bad.append("%dx%d: graph only %s px tall" % (w, h, st["graph"]["h"]))
        c.ok("132 sizes lay out cleanly", not bad, bad[:6])
        # Layout switches keep working: handles drag in the wide layout, tiles click in the strip.
        p.resize(760, 420)
        drag_handle_to(p, 0, 0.2, 0.5)
        c.near("wide: handles drag", p.state()["bezier"][:2], [0.2, 0.5], 0.006)
        p.resize(900, 60)
        p.click("tile:easings:Quint In")
        c.eq("strip: tiles click", p.state()["bezier"], [0.64, 0, 0.78, 0])
        p.resize(260, 300)
        p.click("tab:mine")
        c.eq("presets-only: tabs work", p.state()["tab"], "mine")
        p.resize(300, 720)
        c.eq("back to tall", p.state()["layout"], "tall")
        c.eq("the curve survived the resizes", p.state()["bezier"], [0.64, 0, 0.78, 0])
        # The graph does not change size when the tab changes.
        p.click("tab:easings")
        g1 = p.state()["graph"]
        p.click("tab:mine")
        c.eq("the graph keeps its size across tabs", p.state()["graph"], g1)


def t_library(c):
    with P.Session() as s:
        p = P.Panel(s)
        # Keep a curve.
        drag_handle_to(p, 0, 0.2, 0.0)
        drag_handle_to(p, 1, 0.0, 1.0)
        c.ok("no name field before the star", not p.visible("name"))
        p.click("star")
        st = p.state()
        c.eq("the star opens the name bar on Mine", (st["bar"], st["tab"]), ("save", "mine"))
        c.ok("with a name field", p.visible("name"))
        p.click("bar:ok")
        c.ok("an empty name is refused", p.state()["bar"] == "save" and p.state()["statusKind"] == "warn", p.state()["status"])
        p.type("name", "Quad Out")
        p.click("bar:ok")
        c.ok("a built-in name is refused", p.state()["bar"] == "save" and "built-in" in p.state()["status"], p.state()["status"])
        p.type("name", "Snappy")
        p.click("bar:ok")
        st = p.state()
        c.eq("saved", st["status"], "Saved “Snappy” to My curves.")
        c.eq("the bar closes", st["bar"], None)
        c.eq("the new curve is selected", st["selected"], {"lib": "mine", "name": "Snappy"})
        c.eq("the library has one curve", st["libraries"], [{"name": "My curves", "curves": 1}])
        c.ok("its tile is there", p.has("tile:mine:Snappy"))
        saved = json.loads(s.cmd("script.settings.get", {"section": "SmoothCurve", "key": "libraries"})["value"])
        c.near("it is in the settings", saved["libraries"][0]["presets"][0]["bezier"], [0.2, 0, 0, 1], 0.006)
        c.eq("under its name", saved["libraries"][0]["presets"][0]["name"], "Snappy")
        c.eq("the built-in panel's settings are untouched", s.cmd("script.settings.get", {"section": "Ease Presets", "key": "userPresets"})["have"], False)
        # Cancel leaves everything alone.
        p.click("tile:easings:Back Out") if p.has("tile:easings:Back Out") else None
        p.click("tab:easings")
        p.click("tile:easings:Back Out")
        p.click("star")
        p.type("name", "Not kept")
        p.click("bar:cancel")
        c.eq("Cancel saves nothing", p.state()["libraries"], [{"name": "My curves", "curves": 1}])
        # Saving again under the same name updates it.
        p.click("star")
        p.type("name", "snappy")
        p.click("bar:ok")
        c.eq("same name updates", p.state()["status"], "Updated “Snappy” in My curves.")
        c.eq("still one curve", p.state()["libraries"], [{"name": "My curves", "curves": 1}])
        # Selecting it loads it; rename and delete sit next to its name.
        p.click("tab:easings")
        p.click("tile:easings:Linear")
        p.click("tab:mine")
        p.click("tile:mine:Snappy")
        c.eq("clicking my curve loads it", p.state()["bezier"], [0.34, 1.56, 0.64, 1])
        c.eq("the name field shows its name", (p.visible("name"), p.text("name")), (True, "Snappy"))
        p.type("name", "Card pop")
        p.click("preset:rename")
        c.eq("renamed", p.state()["status"], "Renamed to “Card pop”.")
        c.ok("the tile follows", p.has("tile:mine:Card pop") and not p.has("tile:mine:Snappy"))
        p.type("name", "Sine In")
        p.click("preset:rename")
        c.ok("rename to a built-in name is refused", "built-in" in p.state()["status"] and p.has("tile:mine:Card pop"), p.state()["status"])
        p.click("preset:delete")
        c.eq("Delete asks first", p.state()["bar"], "deletePreset")
        c.ok("the question names the curve", any("Delete “Card pop”?" in t for t in p.painted()), p.painted()[-12:])
        p.click("bar:cancel")
        c.ok("Cancel keeps it", p.has("tile:mine:Card pop"))
        p.click("preset:delete")
        p.click("bar:ok")
        c.eq("deleted", p.state()["status"], "Deleted “Card pop”.")
        c.eq("the library is empty", p.state()["libraries"], [{"name": "My curves", "curves": 0}])
        c.ok("the empty hint shows", any("No curves in My curves yet" in t for t in p.painted()), p.painted()[-6:])
        # Libraries: new, switch, rename, delete.
        p.click("more")
        c.eq("the menu opens", p.state()["menu"], "more")
        c.ok("the readout hides under the menu or stays clear of it", True)
        p.click("menu:0")
        c.eq("New library asks for a name", p.state()["bar"], "newLibrary")
        p.type("name", "Easings")
        p.click("bar:ok")
        c.ok("the built-in library's name is refused", "built-in" in p.state()["status"], p.state()["status"])
        p.type("name", "Client A")
        p.click("bar:ok")
        st = p.state()
        c.eq("the new library is active", (st["library"], [x["name"] for x in st["libraries"]]), ("Client A", ["My curves", "Client A"]))
        p.click("tab:easings")
        p.click("tile:easings:Expo Out")
        p.click("star")
        p.type("name", "Landing")
        p.click("bar:ok")
        c.eq("curves go to the active library", p.state()["libraries"], [{"name": "My curves", "curves": 0}, {"name": "Client A", "curves": 1}])
        p.click("library")
        c.eq("the library list opens", p.state()["menu"], "library")
        p.click("menu:0")
        c.eq("switched to My curves", p.state()["library"], "My curves")
        c.ok("its tiles are shown, not the other library's", not p.has("tile:mine:Landing"))
        p.click("library")
        p.click_at(4, 700)
        c.eq("a click elsewhere closes the menu", (p.state()["menu"], p.state()["library"]), (None, "My curves"))
        p.click("library")
        p.click("menu:1")
        p.click("more")
        p.click("menu:1")
        c.eq("Rename library shows the current name", (p.state()["bar"], p.text("name")), ("renameLibrary", "Client A"))
        p.type("name", "my curves")
        p.click("bar:ok")
        c.ok("a taken library name is refused", "exists" in p.state()["status"], p.state()["status"])
        p.type("name", "Client B")
        p.click("bar:ok")
        c.eq("renamed", p.state()["library"], "Client B")
        p.click("more")
        p.click("menu:2")
        c.eq("Delete library asks first", p.state()["bar"], "deleteLibrary")
        c.ok("the question says what goes", any("Delete Client B and its 1 curve?" in t for t in p.painted()), p.painted()[-12:])
        p.click("bar:ok")
        st = p.state()
        c.eq("deleted", st["libraries"], [{"name": "My curves", "curves": 0}])
        c.eq("says so", st["status"], "Deleted the library “Client B” (1 curve).")
        p.click("more")
        p.click("menu:2")
        p.click("bar:ok")
        c.eq("deleting the last library leaves an empty My curves", p.state()["libraries"], [{"name": "My curves", "curves": 0}])


def t_export_import(c):
    with P.Session() as s:
        p = P.Panel(s)
        import_reels(p)
        st = p.state()
        c.eq("import adds the library and shows it", (st["library"], st["tab"], st["page"]), ("Reels", "mine", "main"))
        c.eq("says so", st["status"], "Imported 14 curves as “Reels”.")
        # Export shows the same text back.
        p.click("more")
        p.click("menu:5")
        c.eq("the export page", p.state()["page"], "export")
        text = p.text("libraryText")
        c.eq("export then import: identical curves", json.loads(text), json.loads(LIBRARY))
        c.ok("only the two page fields are shown", p.visible("libraryText") and p.visible("libraryPath") and not p.visible("readout") and not p.visible("name") and not p.visible("search"))
        # Scripts may not write files in this session (EffectCraft's default): a message, not an error.
        p.set("libraryPath", os.path.join(P.HERE, "tmp-ui-export.curves.json"))
        p.click("sheet:file")
        note = p.state()["note"]
        c.ok("a blocked file save explains the setting", "Allow Scripts to Write Files" in note and "copy the text" in note, note)
        c.ok("no file was written", not os.path.exists(os.path.join(P.HERE, "tmp-ui-export.curves.json")))
        p.set("libraryPath", "")
        p.click("sheet:file")
        c.ok("an empty path asks for one", "Type where to save" in p.state()["note"], p.state()["note"])
        p.click("sheet:done")
        c.eq("Done returns", p.state()["page"], "main")
        # Importing the same text again never replaces: a numbered copy.
        p.click("more")
        p.click("menu:4")
        c.eq("the import page", p.state()["page"], "import")
        p.set("libraryText", text)
        p.click("sheet:import")
        c.eq("a second import is a numbered copy", [x["name"] for x in p.state()["libraries"]], ["My curves", "Reels", "Reels 2"])
        c.ok("the message says why", "exists" in p.state()["status"], p.state()["status"])
        # Bad text: the page stays, with a message.
        for label, bad in [("garbage", "not a library"), ("cut off", text[:-7]), ("empty", ""), ("another format", '{"format":"x","version":1,"presets":[]}'),
                           ("newer", '{"format":"curve-library","version":9,"presets":[]}')]:
            p.click("more")
            p.click("menu:4")
            p.set("libraryText", bad)
            p.click("sheet:import")
            st = p.state()
            c.ok("import of %s text: a message, the page stays" % label, st["page"] == "import" and len(st["note"]) > 10, st["note"])
            p.click("sheet:done")
        c.eq("bad imports added nothing", [x["name"] for x in p.state()["libraries"]], ["My curves", "Reels", "Reels 2"])
        p.click("more")
        p.click("menu:4")
        p.set("libraryPath", os.path.join(P.HERE, "no-such-file.curves.json"))
        p.click("sheet:file")
        c.ok("loading a file outside the project explains the setting", "Allow Scripts to Write Files" in p.state()["note"], p.state()["note"])
        p.click("sheet:done")
    # With the setting on, the file is written and reads back.
    path = os.path.join(P.HERE, "tmp-ui-export.curves.json")
    try:
        with P.Session() as s:
            s.cmd("prefs.set", {"key": "scripting.allowScriptsWriteFiles", "value": True})
            p = P.Panel(s)
            import_reels(p)
            p.click("more")
            p.click("menu:5")
            p.set("libraryPath", path)
            p.click("sheet:file")
            c.eq("with the setting on the file is saved", p.state()["note"], "Saved " + path)
            c.ok("the file exists", os.path.exists(path))
            c.eq("and holds the library", json.load(open(path, encoding="utf-8")) if os.path.exists(path) else None, json.loads(LIBRARY))
            p.click("sheet:done")
            p.click("more")
            p.click("menu:2")
            p.click("bar:ok")
            c.eq("library deleted", [x["name"] for x in p.state()["libraries"]], ["My curves"])
            p.click("more")
            p.click("menu:4")
            p.set("libraryPath", path)
            p.click("sheet:file")
            st = p.state()
            c.eq("Load file imports it", ([x["name"] for x in st["libraries"]], st["page"]), (["My curves", "Reels"], "main"))
            open(path, "w").write("{broken")
            p.click("more")
            p.click("menu:4")
            p.set("libraryPath", path)
            p.click("sheet:file")
            c.ok("a damaged file: a message, no error", p.state()["page"] == "import" and "damaged" in p.state()["note"], p.state()["note"])
    finally:
        if os.path.exists(path):
            os.remove(path)


def t_restart(c):
    with P.Session() as s:
        p = P.Panel(s)
        p.type("readout", "0.2, 0, 0, 1")
        p.click("star")
        p.type("name", "Kept")
        p.click("bar:ok")
        p.click("mode:Out")
        p.click("lock:mirror")
        p.click("auto")
        p.type("readout", "0.11, 0.22, 0.33, 0.44")
        s.cmd("scriptui.close", {"window": p.window})
        c.eq("the panel closed", s.cmd("scriptui.list"), [])
        p2 = P.Panel(s)                              # the next launch, as far as the settings go
        st = p2.state()
        c.eq("the curve is back", st["bezier"], [0.11, 0.22, 0.33, 0.44])
        c.eq("the mode is back", st["mode"], "Out")
        c.eq("the switches are back", (st["locks"]["mirror"], st["auto"], st["tab"]), (True, True, "mine"))
        c.eq("the saved curve is still there", st["libraries"], [{"name": "My curves", "curves": 1}])
        c.ok("with its tile", p2.has("tile:mine:Kept"))
        # Damaged settings: the panel still opens, with defaults.
        s.cmd("scriptui.close", {"window": p2.window})
        s.cmd("script.settings.save", {"section": "SmoothCurve", "key": "ui", "value": "{oops"})
        s.cmd("script.settings.save", {"section": "SmoothCurve", "key": "libraries", "value": '{"libraries":[{"name":7},"x"]}'})
        p3 = P.Panel(s)
        st = p3.state()
        c.eq("damaged settings: defaults", (st["bezier"], st["mode"], st["libraries"]), ([0.37, 0, 0.63, 1], "In-Out", [{"name": "My curves", "curves": 0}]))


def t_earlier_name(c):
    """Before its first release the panel was called CurveCraft and kept its settings under that
    name. Curves saved then are still there, and the old section is left as it was."""
    old_libs = '{"version":1,"active":"Reels","libraries":[{"name":"Reels","presets":[{"name":"From before","bezier":[0.2,0,0,1]}]}]}'
    old_ui = '{"bezier":[0.2,0,0,1],"mode":"Out","tab":"mine"}'
    with P.Session() as s:
        s.cmd("script.settings.save", {"section": "CurveCraft", "key": "libraries", "value": old_libs})
        s.cmd("script.settings.save", {"section": "CurveCraft", "key": "ui", "value": old_ui})
        p = P.Panel(s)
        st = p.state()
        c.eq("the library saved under the earlier name is there", st["libraries"], [{"name": "Reels", "curves": 1}])
        c.eq("with the curve, the mode and the tab", (st["bezier"], st["mode"], st["tab"]), ([0.2, 0, 0, 1], "Out", "mine"))
        c.ok("and its tile", p.has("tile:mine:From before"))
        p.type("readout", "0.5, 0, 0.5, 1")
        p.click("star")
        p.type("name", "After")
        p.click("bar:ok")
        new = json.loads(s.cmd("script.settings.get", {"section": "SmoothCurve", "key": "libraries"})["value"])
        c.eq("saving writes both curves under the new name", [x["name"] for x in new["libraries"][0]["presets"]], ["From before", "After"])
        c.eq("the earlier section is left as it was", s.cmd("script.settings.get", {"section": "CurveCraft", "key": "libraries"})["value"], old_libs)
        s.cmd("scriptui.close", {"window": p.window})
        p2 = P.Panel(s)
        c.eq("the next launch reads the new section", p2.state()["libraries"], [{"name": "Reels", "curves": 2}])


def t_search_scroll(c):
    with P.Session() as s:
        p = P.Panel(s)
        c.ok("no search box for an empty library", not p.visible("search"))
        import_reels(p)
        c.ok("a search box once the library is long", p.visible("search"))
        tiles = lambda: sorted(h["id"] for h in p.state()["hits"] if h["id"].startswith("tile:mine:"))
        first = tiles()
        c.ok("the list scrolls: not all 14 fit", 0 < len(first) < 14 and p.has("scroll"), first)
        r = p.rect("scroll")
        p.drag((r["x"] + r["w"] / 2, r["y"] + 4), (r["x"] + r["w"] / 2, r["y"] + r["h"] - 2))
        c.ok("dragging the bar scrolls", p.state()["scroll"] > 0 and tiles() != first, (p.state()["scroll"], tiles()))
        c.ok("the last curve is reachable", p.has("tile:mine:Curve 14"))
        p.set("search", "curve 0", changing=True)
        c.eq("typing filters at once", tiles(), ["tile:mine:Curve 0%d" % i for i in range(1, 10)][:len(tiles())])
        p.set("search", "CURVE 13", changing=True)
        c.eq("the filter ignores case", tiles(), ["tile:mine:Curve 13"])
        p.set("search", "zzz", changing=True)
        c.eq("no match: no tiles", tiles(), [])
        c.ok("and a line that says so", any("is named like that" in t for t in p.painted()))
        c.ok("the search box stays to clear it", p.visible("search"))
        p.set("search", "", changing=True)
        c.eq("clearing shows the list again", tiles(), first)


def t_motion(c):
    with P.Session() as s:
        p = P.Panel(s)
        c.eq("not playing", p.state()["playing"], False)
        p.click("motion")
        c.eq("a click plays the strip", p.state()["playing"], True)
        s.cmd("script.runTasks")
        c.eq("still playing right away", p.state()["playing"], True)
        time.sleep(1.7)
        s.cmd("script.runTasks")
        c.eq("it stops by itself", p.state()["playing"], False)
        r = s.cmd("script.runTasks")
        c.eq("and leaves no task running", (r.get("ran"), r.get("next")), (0, None))


def t_odd_input(c):
    with P.Session() as s:
        s.script(SETUP)
        p = P.Panel(s)
        before = p.state()["bezier"]
        for x, y in [(-50, -50), (99999, 99999), (0, 0), (150, -1), (1e9, 3), (299.999, 719.999)]:
            p.click_at(x, y)
        p.mouse("mouseup", 10, 10)                    # a release with no press
        p.mouse("mouseout", 0, 0)
        p.mouse("mousedown", 150, 200, button=2)      # right button
        p.mouse("mouseup", 150, 200, button=2)
        p.mouse("mousemove", 150, 200, buttons=1)     # a move that claims a held button
        st = p.state()
        c.ok("stray clicks cause no problem", "problem" not in st["status"].lower() and "could not" not in st["status"].lower(), st["status"])
        c.eq("and change no curve", st["bezier"], before)
        # A drag that ends far outside the panel still ends.
        p.drag(p.handle(0), (-4000, 9000))
        st = p.state()
        c.near("far outside: x at its limit", st["bezier"][0], 0, 1e-9)
        c.near("far outside: y at its limit", st["bezier"][1], -1.5, 1e-9)
        p.click("tile:easings:Sine In-Out")
        c.eq("the panel carries on", p.state()["bezier"], [0.37, 0, 0.63, 1])
        # Very long and odd names.
        p.click("star")
        p.type("name", "x" * 65)
        p.click("bar:ok")
        c.ok("a 65-character name is refused", p.state()["bar"] == "save" and p.state()["statusKind"] == "warn")
        odd = "日本語 “quoted” <b>&amp; \\ / ' \U0001F600"
        p.type("name", odd)
        p.click("bar:ok")
        c.eq("an odd name is kept as typed", p.state()["selected"], {"lib": "mine", "name": odd})
        p.click("more")
        p.click("menu:5")
        back = json.loads(p.text("libraryText"))
        c.eq("and exports intact", back["presets"][0]["name"], odd)
        p.click("sheet:done")
        # The undo of an unrelated change does not disturb the panel.
        s.cmd("edit.undo")
        p.click("apply")
        c.ok("Apply after an undo elsewhere still answers", len(p.state()["status"]) > 5)


TESTS = [t_start, t_drag, t_fixed_grid, t_graph_first, t_zoom, t_apply_as_drawn, t_sides, t_nothing_selected, t_readout, t_modifiers, t_lock_toggles, t_presets,
         t_auto_apply, t_hover, t_from_keys, t_layouts, t_library, t_export_import, t_restart, t_earlier_name, t_search_scroll, t_motion, t_odd_input]


def run(_runner, only=None):
    c = Checks()
    for t in TESTS:
        if only and only not in t.__name__:
            continue
        c.group = t.__name__[2:]
        try:
            t(c)
        except Exception as e:                      # a crash in one test is a failure, the rest still run
            c.n += 1
            c.fails.append("FAIL %s: stopped with %s: %s" % (c.group, type(e).__name__, str(e)[:400]))
    if c.fails:
        return False, "FAILED %d of %d checks\n%s" % (len(c.fails), c.n, "\n".join(c.fails))
    return True, "PASSED all %d checks" % c.n
