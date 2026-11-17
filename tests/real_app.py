#!/usr/bin/env python3
"""The panel in the real EffectCraft app: docked, driven by real pointer and key input.

The headless tests send events straight to the script. This one goes the whole way a user's
mouse does: the app's own event loop, its hit-testing of the docked panel, the floating entry window,
the settings file on disk and a restart. It uses the preview instance (tools/preview.py: a
second EffectCraft with its own settings folder, never the one you are working in).

    python3 -I tools/preview.py start
    python3 -I tests/real_app.py            # all checks; add "restart" to also quit and relaunch
    python3 -I tools/preview.py stop

What it cannot see: pixels. The preview's window is usually behind other windows, and the app
only renders screenshots while it is visible.
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools"))
import preview  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((bool(cond), name, detail))
    print("%s %s%s" % ("ok  " if cond else "FAIL", name, "" if cond else "  :: %s" % (detail,)))


def bezier_y(b, u):
    lo, hi = 0.0, 1.0
    for _ in range(50):
        t = (lo + hi) / 2
        x = 3 * (1 - t) ** 2 * t * b[0] + 3 * (1 - t) * t * t * b[2] + t ** 3
        lo, hi = (t, hi) if x < u else (lo, t)
    return 3 * (1 - t) ** 2 * t * b[1] + 3 * (1 - t) * t * t * b[3] + t ** 3


class App:
    def __init__(self):
        self.ch = preview.Channel()
        self.win = None

    def ex(self, command, params=None):
        return self.ch.execute(command, params)

    def open_panel(self):
        for w in self.ex("scriptui.list"):
            if w["script"] == "SmoothCurve.jsx":
                self.win = w["window"]
        if self.win is None:
            self.win = self.ex("window.scriptPanel", {"name": "SmoothCurve.jsx"})["window"]
        self.nudge()

    def nudge(self):
        """Let the app draw a frame or two (it idles while nothing happens)."""
        self.ch.call("ui.move", {"x": 200, "y": 200})
        self.ch.call("ui.move", {"x": 204, "y": 204})

    def tree(self):
        return self.ex("scriptui.get", {"window": self.win})

    def state(self):
        for c in self.tree()["root"]["children"]:
            if c["name"] == "automation":
                st = json.loads(c["text"])
                st["hits"] = {h[0]: h[1:] for h in st["hits"]}
                return st

    def entry(self):
        """The id of the panel's floating entry window (where everything is typed), or None."""
        ids = [w["window"] for w in self.ex("scriptui.list") if w["kind"] != "panel"]
        return ids[-1] if ids else None

    def field(self, name):
        """A control by name: of the panel, or of its entry window. None when it is not there."""
        def walk(node):
            if node.get("name") == name:
                return node
            for c in node.get("children", []):
                hit = walk(c)
                if hit:
                    return hit
            return None
        hit = walk(self.tree()["root"])
        if hit is None and self.entry() is not None:
            hit = walk(self.ex("scriptui.get", {"window": self.entry()})["root"])
        return hit

    def shown(self, name):
        f = self.field(name)
        return bool(f and f["visible"])

    def press(self, name):
        """A real click on a button of the entry window."""
        self.ch.call("ui.click", {"id": "scriptui.%d.%s" % (self.entry(), name)})
        self.nudge()

    def origin(self):
        for e in self.ch.call("ui.elements", {"prefix": "scriptui.%d" % self.win}):
            if e["id"].endswith(".canvas"):
                return e["rect"]
        raise RuntimeError("the panel's canvas is not on screen")

    def at(self, st, hit_id):
        o, (x, y, w, h) = self.origin(), st["hits"][hit_id]
        return {"x": o[0] + x + w / 2, "y": o[1] + y + h / 2}

    def unit(self, st, u, v):
        o, g, (lo, hi) = self.origin(), st["graph"], st["view"]
        return {"x": o[0] + g["x"] + u * g["w"], "y": o[1] + g["y"] + (hi - v) / (hi - lo) * g["h"]}

    def handle(self, st, i):
        o = self.origin()
        return {"x": o[0] + st["handles"][i][0], "y": o[1] + st["handles"][i][1]}

    def show(self, hit_id, steps=12):
        """Where this region is on screen. A preset tile that is scrolled out of sight is
        scrolled to first, with real clicks along the list's bar."""
        st = self.state()
        if hit_id not in st["hits"] and hit_id.startswith("tile:") and "scroll" in st["hits"]:
            o, (x, y, w, h) = self.origin(), st["hits"]["scroll"]
            for i in range(steps + 1):
                self.ch.call("ui.click", {"x": o[0] + x + w / 2, "y": o[1] + y + 1 + (h - 2) * i / steps})
                st = self.state()
                if hit_id in st["hits"]:
                    break
        return self.at(st, hit_id)

    def click(self, hit_id, **extra):
        self.ch.call("ui.click", dict(self.show(hit_id), **extra))

    # ---- the dock around the panel
    def dock(self):
        """The dock's rectangle, and where the panel's canvas sits in it."""
        els = self.ch.call("ui.elements", {})
        d = [e["rect"] for e in els if e["id"].startswith("panel.ScriptPanel")][0]
        c = [e["rect"] for e in els if e["id"] == "scriptui.%d.canvas" % self.win][0]
        return d, [round(c[0] - d[0], 2), round(c[1] - d[1], 2)]

    def gutters(self):
        """The dock gutters to drag: the one beside the panel's dock and the one above it."""
        els = self.ch.call("ui.elements", {})
        d = [e["rect"] for e in els if e["id"].startswith("panel.ScriptPanel")][0]
        side = top = None
        for e in els:
            if not e["id"].startswith("dock.gutter"):
                continue
            x, y, w, h = e["rect"]
            if h > w and abs(x + w - d[0]) < 12 and y <= d[1] and y + h >= d[1] + d[3] - 2:
                side = e["rect"]
            if w > h and 0 <= d[1] - (y + h) < 60 and abs(x - d[0]) < 12:
                top = e["rect"]
        return side, top

    def drag_gutter(self, rect, dx, dy, steps):
        a = {"x": rect[0] + rect[2] / 2, "y": rect[1] + rect[3] / 2}
        self.ch.call("ui.drag", {"from": a, "to": {"x": a["x"] + dx, "y": a["y"] + dy}, "steps": steps})
        self.nudge()

    def still(self):
        """Scroll over the panel towards each corner of its dock and say whether it stayed where
        it was. (A docked panel that holds a real control can be slid a few pixels inside its
        dock in EffectCraft 0.24.1; this one must not move at all.)"""
        d, base = self.dock()
        at = {"x": d[0] + d[2] / 2, "y": d[1] + d[3] / 2}
        for dx, dy in ((-300, -300), (300, 300), (-300, 300), (300, -300)):
            for _ in range(4):
                self.ch.call("ui.scroll", dict(at, dx=dx, dy=dy))
                self.nudge()
            if self.dock()[1] != base:
                return False
        # At rest the canvas sits 1 px inside the dock's frame (a dock with a fraction of a pixel
        # in its size is snapped to the screen's pixels, hence the slack).
        return abs(base[0] - 1) <= 0.25 and abs(base[1] - 1) <= 0.25

    def type_into(self, name, text):
        """Type into a field of the entry window with real keys. The numbers are opened first by
        a real click on them in the panel."""
        if not self.shown(name) and name == "readout":
            self.click("readout")
            self.nudge()
        self.ch.call("ui.click", {"id": "scriptui.%d.%s" % (self.entry(), name)})
        self.ch.call("ui.key", {"key": "Cmd+A"})
        self.ch.call("ui.type", {"text": text})

    def script(self, code):
        r = self.ex("script.run", {"code": code})
        if r.get("error"):
            raise RuntimeError(r["error"])
        return r["result"]


def main(argv):
    app = App()
    info = app.ex("app.capabilities")
    print("EffectCraft", info.get("version"), "| settings", preview.CONFIG)
    preview.install()
    listed = [x["name"] for x in app.ex("file.scripts.list") if x.get("panel") and x.get("source") == "installed"]
    check("a copied panel is listed without a restart", "SmoothCurve.jsx" in listed, listed)
    for w in app.ex("scriptui.list"):                       # start from a fresh copy of the script
        if w["script"] == "SmoothCurve.jsx":
            app.ex("scriptui.close", {"window": w["window"]})
    app.open_panel()
    kinds = [(w["kind"], w["title"]) for w in app.ex("scriptui.list") if w["window"] == app.win]
    check("it opens as a dockable panel titled SmoothCurve", kinds == [("panel", "SmoothCurve")], kinds)
    st = app.state()
    o = app.origin()
    check("it takes its dock's size", st["size"] == [round(o[2]), round(o[3])] and st["layout"] in ("tall", "wide"), (st["size"], o, st["layout"]))
    app.type_into("readout", "0.37, 0, 0.63, 1")
    app.ch.call("ui.key", {"key": "Enter"})

    # Real drags: the app's own hit-testing and drag capture.
    st = app.state()
    app.ch.call("ui.drag", {"from": app.handle(st, 0), "to": app.unit(st, 0.2, 0.5), "steps": 20})
    st = app.state()
    check("a real drag moves the first handle exactly", all(abs(a - b) < 0.006 for a, b in zip(st["bezier"], [0.2, 0.5, 0.63, 1])), st["bezier"])
    check("the panel itself did not move or scroll", app.origin() == o, (app.origin(), o))
    app.ch.call("ui.drag", {"from": app.handle(st, 0), "to": app.unit(st, 0.3, 0.8), "steps": 8, "modifiers": {"shift": True}})
    st = app.state()
    check("Shift snaps", abs(st["bezier"][1] - 1) < 1e-9 and abs(st["bezier"][0] - 0.3) < 0.006, st["bezier"])
    app.ch.call("ui.drag", {"from": app.handle(st, 1), "to": app.unit(st, 0.5, 0.6), "steps": 8, "modifiers": {"command": True, "shift": True}})
    st = app.state()
    check("Cmd+Shift mirrors", all(abs(a - b) < 0.006 for a, b in zip(st["bezier"], [0.5, 0.4, 0.5, 0.6])), st["bezier"])
    b0 = st["bezier"]
    app.ch.call("ui.drag", {"from": app.handle(st, 1), "to": app.unit(st, 0.9, 0.2), "steps": 8, "modifiers": {"alt": True}})
    b = app.state()["bezier"]
    check("Alt keeps the angle", abs(math.atan2(b0[3] - 1, b0[2] - 1) - math.atan2(b[3] - 1, b[2] - 1)) < 0.01 and b != b0, (b0, b))
    app.type_into("readout", "0.3, 0.4, 0.7, 0.6")
    app.ch.call("ui.key", {"key": "Enter"})
    st = app.state()
    app.ch.call("ui.drag", {"from": app.handle(st, 0), "to": app.unit(st, 0.9, 0.05), "steps": 8, "modifiers": {"command": True}})
    b = app.state()["bezier"]
    check("Cmd keeps the length", abs(math.hypot(b[0], b[1]) - 0.5) < 0.006, b)
    st = app.state()
    grid = (st["view"], st["graph"])
    app.ch.call("ui.drag", {"from": app.handle(st, 1), "to": app.unit(st, 0.6, 1.6), "steps": 12})
    st = app.state()
    check("a drag past the box follows the mouse", abs(st["bezier"][3] - 1.6) < 0.02 and st["pinned"] == [False, True], (st["bezier"], st["pinned"]))
    check("and the grid keeps its size", (st["view"], st["graph"]) == grid, (st["view"], grid[0]))

    # Zoom: real clicks on the two buttons, and a real drag while zoomed out.
    app.type_into("readout", "0.68, -0.6, 0.32, 1.6")
    app.ch.call("ui.key", {"key": "Enter"})
    st = app.state()
    full, well = (st["view"], st["graph"]), st["well"]
    check("the box is square and the graph is not lower than the box", abs(st["graph"]["h"] / (st["view"][1] - st["view"][0]) - st["graph"]["w"]) < 0.01
          and st["well"]["h"] >= st["graph"]["w"], (st["graph"], st["view"]))
    check("at full size a far handle is marked on the edge", st["zoom"] == 1 and True in st["pinned"], (st["zoom"], st["pinned"]))
    for _ in range(3):
        app.click("zoom:out")
    st = app.state()
    check("three real clicks zoom out three steps", st["zoom"] == 0.51 and st["well"] == well and st["graph"]["w"] < full[1]["w"], (st["zoom"], st["graph"]))
    check("and both handles are in sight", st["pinned"] == [False, False], st["pinned"])
    app.ch.call("ui.drag", {"from": app.handle(st, 1), "to": app.unit(st, 0.5, 1.2), "steps": 12})
    st2 = app.state()
    check("a real drag is exact while zoomed out", all(abs(a - b) < 0.012 for a, b in zip(st2["bezier"][2:], [0.5, 1.2])), st2["bezier"])
    check("and the zoom stays where it was put", (st2["view"], st2["graph"]) == (st["view"], st["graph"]), st2["view"])
    for _ in range(3):
        app.click("zoom:in")
    st = app.state()
    check("three clicks back in: full size, as before", st["zoom"] == 1 and (st["view"], st["graph"]) == full and "zoom:in" not in st["hits"], (st["zoom"], st["view"]))

    # Zoom without steps: a real drag on the empty graph, and a real double-click.
    mid = app.unit(app.state(), 0.5, 0.5)
    app.ch.call("ui.drag", {"from": mid, "to": {"x": mid["x"], "y": mid["y"] + 60}, "steps": 12})
    z = app.state()["zoom"]
    check("a real drag down on the empty graph zooms out, between the steps", 0.55 < z < 0.65, z)
    check("and moves nothing else", app.origin() == o, (app.origin(), o))
    mid = app.unit(app.state(), 0.5, 0.5)
    app.ch.call("ui.click", dict(mid, count=2))
    check("a real double-click there is the full size again", app.state()["zoom"] == 1, app.state()["zoom"])

    # The info page, with real clicks.
    app.click("info")
    check("the i button opens the shortcuts page", app.state()["page"] == "help" and "readout" not in app.state()["hits"], app.state()["page"])
    app.click("help:done")
    check("Done closes it", app.state()["page"] == "main" and "readout" in app.state()["hits"], app.state()["page"])

    # Typing with real keys, in the floating window that a click on the numbers opens.
    if app.entry() is not None:
        app.press("entry:done")
    check("no floating window at this point", app.entry() is None and app.state()["entry"] is None, app.ex("scriptui.list"))
    app.click("readout")
    app.nudge()
    kinds = [(w["kind"], w["title"]) for w in app.ex("scriptui.list") if w["kind"] != "panel"]
    check("a real click on the numbers opens a floating window with their field", kinds == [("palette", "Curve numbers")] and app.shown("readout") and app.state()["entry"] == "numbers", kinds)
    check("the docked panel itself holds no real control", [c["name"] for c in app.tree()["root"]["children"] if c["visible"]] == ["canvas"], [c["name"] for c in app.tree()["root"]["children"]])
    app.type_into("readout", "cubic-bezier(0.42, 0, 0.58, 1)")
    check("the curve follows the keys", app.state()["bezier"] == [0.42, 0, 0.58, 1], app.state()["bezier"])
    app.ch.call("ui.key", {"key": "Enter"})
    check("Enter tidies the text", app.field("readout")["text"] == "0.42, 0.00, 0.58, 1.00", app.field("readout")["text"])
    app.type_into("readout", "nonsense")
    app.ch.call("ui.key", {"key": "Enter"})
    st = app.state()
    check("nonsense is refused and the numbers come back", st["bezier"] == [0.42, 0, 0.58, 1] and app.field("readout")["text"] == "0.42, 0.00, 0.58, 1.00" and st["statusKind"] == "warn", st["status"])
    app.press("entry:done")
    check("a real click on Done closes the window", app.entry() is None and app.state()["entry"] is None, app.ex("scriptui.list"))

    # Apply on real keyframes.
    app.script('var c = app.project.items.addComp("SmoothCurve check", 640, 360, 1, 5, 30); c.openInViewer();'
               'var s = c.layers.addSolid([1, 0, 0], "Box", 100, 100, 1); var r = s.transform.rotation;'
               'r.setValueAtTime(0, 0); r.setValueAtTime(1, 100); r.setSelectedAtKey(1, true); r.setSelectedAtKey(2, true); 1')
    rot = "app.project.activeItem.layer(1).transform.rotation"
    if app.state()["tab"] != "easings":
        app.click("tab:easings")
    app.click("tile:easings:Back Out")
    st = app.state()
    check("a real click on a tile loads it", st["bezier"] == [0.34, 1.56, 0.64, 1] and st["selected"] == {"lib": "easings", "name": "Back Out"}, st["bezier"])
    app.click("apply")
    st = app.state()
    check("Apply reports", st["status"] == "Eased 2 keyframes on 1 property.", st["status"])
    got = [app.script("%s.valueAtTime(%s, false)" % (rot, u)) for u in (0.2, 0.5, 0.8)]
    want = [bezier_y(st["bezier"], u) * 100 for u in (0.2, 0.5, 0.8)]
    check("the keyframes follow the curve", all(abs(g - w) < 1 for g, w in zip(got, want)), (got, want))
    labels = [x["label"] for x in app.ex("edit.history.list")["states"]]
    check("one undo step, named", labels[-1] == "SmoothCurve Ease", labels[-3:])
    app.ch.call("ui.click", dict(app.show("tile:easings:Expo Out"), count=2))
    st = app.state()
    check("a real double-click applies", st["bezier"] == [0.16, 1, 0.3, 1] and st["status"] == "Eased 2 keyframes on 1 property.", st["status"])
    app.click("mode:In")
    check("the Ease switch", app.state()["mode"] == "In")
    app.click("mode:In-Out")
    app.ch.call("ui.move", app.show("tile:easings:Back In"))
    st = app.state()
    check("hovering a tile previews it", st["preview"] == [0.36, 0, 0.66, -0.56], st["preview"])
    check("and sets the tooltip", app.field("canvas")["helpTip"].startswith("Back In"), app.field("canvas")["helpTip"])

    # The presets scroll: a real drag on the tiles (no mouse wheel reaches a panel in 0.24.1).
    st = app.state()
    if "scroll" in st["hits"]:
        app.show("tile:easings:Sine In")
        st = app.state()
        a = app.at(st, "tile:easings:Sine Out")
        app.ch.call("ui.drag", {"from": a, "to": {"x": a["x"], "y": a["y"] - 60}, "steps": 8})
        st2 = app.state()
        check("a real drag on the tiles scrolls the list", st["scroll"] == 0 and st2["scroll"] >= 1 and st2["bezier"] == st["bezier"], (st2["scroll"], st2["bezier"]))
        check("and the panel itself did not scroll", app.origin() == o, (app.origin(), o))
    else:
        check("every preset fits in this dock (nothing to scroll)", len([k for k in st["hits"] if k.startswith("tile:easings:")]) == 25, len(st["hits"]))

    # Keep a curve: the settings file on disk.
    name = "Real app %d" % int(time.time())
    app.click("star")
    app.nudge()
    check("the star opens the name window", app.state()["bar"] == "save" and app.shown("name"), app.state()["entry"])
    app.type_into("name", name)
    app.press("bar:ok")
    st = app.state()
    check("and Save closes it", app.entry() is None, app.ex("scriptui.list"))
    check("saved", st["status"] == "Saved “%s” to %s." % (name, st["library"]), st["status"])
    path = os.path.join(preview.CONFIG, "script_settings.json")
    on_disk = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    check("the curve is in script_settings.json on disk", name in on_disk and "SmoothCurve" in on_disk, path)
    check("the built-in panel's section is not there", '"Ease Presets"' not in on_disk)

    # The motion strip plays by itself (the app runs the scheduled task every frame).
    app.click("motion")
    check("the strip starts playing", app.state()["playing"] is True)
    time.sleep(2.2)
    app.nudge()
    check("and stops by itself", app.state()["playing"] is False)

    # Speed: what every mouse event costs (handler, redraw and what the app reads back).
    st = app.state()
    hx, hy = st["handles"][0]
    send = lambda kind, x, y, **k: app.ex("scriptui.mouse", dict({"window": app.win, "widget": "canvas", "type": kind, "x": x, "y": y}, **k))
    send("mousemove", hx, hy)
    send("mousedown", hx, hy, buttons=1)
    n, t0 = 200, time.time()
    for i in range(n):
        send("mousemove", hx + 60 * math.sin(i / 10.0), hy - 80 * abs(math.sin(i / 17.0)), buttons=1)
    per = (time.time() - t0) * 1000 / n
    send("mouseup", hx, hy)
    # Each request also waits for the app's own frame, so a busy comp adds to this number.
    check("a drag step takes under 12 ms, script and app frame together (%.1f ms)" % per, per < 12, per)

    # 50 keyframed properties selected: Apply stays quick.
    # (Adding a layer clears the selection, so the keys are selected after all layers exist.)
    app.script('var c = app.project.activeItem, i, j, p; for (i = 0; i < 25; i++) { var s = c.layers.addSolid([0, 1, 0], "S" + i, 50, 50, 1);'
               'p = [s.transform.rotation, s.transform.opacity]; for (j = 0; j < 2; j++) { p[j].setValueAtTime(0, 0); p[j].setValueAtTime(1, 50); } }'
               'for (i = 1; i <= c.numLayers; i++) { p = [c.layer(i).transform.rotation, c.layer(i).transform.opacity];'
               'for (j = 0; j < 2; j++) if (p[j].numKeys >= 2) { p[j].setSelectedAtKey(1, true); p[j].setSelectedAtKey(2, true); } } 1')
    t0 = time.time()
    app.click("apply")
    dt = (time.time() - t0) * 1000
    st = app.state()
    check("Apply on 51 properties (%s) in %.0f ms" % (st["status"], dt), "on 51 properties" in st["status"] and dt < 1500, (st["status"], dt))

    # The panel must stay still in its dock. EffectCraft 0.24.1 shows a docked panel in a scroll
    # area, and every real control adds 4 px under the panel: one edit field brings up both of
    # the dock's scroll bars for good, and the panel can then be slid by a few pixels (the
    # bundled panels do it). Seen in the first user's app. So the panel holds no real control:
    # by now this run has typed numbers, named a curve and opened the info page, all in the
    # floating window, and the panel must not have moved a pixel.
    st = app.state()
    root = app.tree()["root"]["bounds"]
    d0 = app.dock()[0]
    check("the panel runs docked, with a window smaller than any dock", st["docked"] is True and root[2] <= 1 and root[3] <= 1, (st["docked"], root))
    check("it fills its dock", st["size"] == [round(d0[2] - 2), round(d0[3] - 2)], (st["size"], d0))
    check("after all of the above the dock cannot scroll the panel: it stays still", app.still(), app.dock())
    app.click("readout")
    app.nudge()
    check("nor with the entry window open", app.shown("readout") and app.still(), app.dock())
    app.press("entry:done")
    side, top = app.gutters()
    check("the dock has a gutter beside the panel and one above it", side is not None and top is not None, (side, top))
    if side and top:
        app.drag_gutter(side, 41.6, 0, 6)                 # narrower, slowly, to a width with a fraction
        d1, st = app.dock()[0], app.state()
        check("a narrower dock: the panel follows", d1[2] < d0[2] - 30 and abs(st["size"][0] - (d1[2] - 2)) <= 1, (d1, st["size"]))
        check("a narrower dock with a fraction of a pixel: still", app.still(), app.dock())
        app.drag_gutter(top, 0, 53.4, 5)                  # lower
        d2, st = app.dock()[0], app.state()
        check("a lower dock: the panel follows", d2[3] < d1[3] - 30 and abs(st["size"][1] - (d2[3] - 2)) <= 1, (d2, st["size"]))
        check("a lower dock: still", app.still(), app.dock())
        side, top = app.gutters()
        app.drag_gutter(side, 60, 0, 1)                   # 60 pixels narrower in one frame
        check("a dock that shrinks 60 pixels in one frame: still", app.still(), app.dock())
        side, top = app.gutters()
        app.drag_gutter(side, -101.6, 0, 6)
        app.drag_gutter(top, 0, -53.4, 5)
        d3, st = app.dock()[0], app.state()
        check("back to the first size: the panel fills it, and is still",
              abs(d3[2] - d0[2]) < 1 and abs(d3[3] - d0[3]) < 1 and st["size"] == [round(d3[2] - 2), round(d3[3] - 2)] and app.still(), (d0, d3, st["size"]))
    app.type_into("readout", "0.37, 0, 0.63, 1")
    app.ch.call("ui.key", {"key": "Enter"})
    drag0 = app.state()
    grab, drop = app.handle(drag0, 0), app.unit(drag0, 0.25, 0.4)
    app.ch.call("ui.drag", {"from": grab, "to": drop, "steps": 10})
    check("a handle still drags true after all that", all(abs(a - b) < 0.012 for a, b in zip(app.state()["bezier"][:2], [0.25, 0.4])),
          (app.state()["bezier"], drag0["handles"], grab, drop, app.origin()))
    check("and the open numbers field followed the drag", app.field("readout")["text"] == app.state()["numbers"], app.field("readout")["text"])
    panel_win = app.win
    app.ex("scriptui.close", {"window": panel_win})
    left = [(w["window"], w["kind"]) for w in app.ex("scriptui.list")]
    check("closing the panel closes its entry window too", left == [], left)
    app.win = None
    app.open_panel()
    check("the panel opens again, still", app.still(), app.dock())

    if "restart" in argv:
        before = app.state()
        app.ch.close()
        preview.stop()
        preview.start()
        app = App()
        open_now = [w["script"] for w in app.ex("scriptui.list")]
        check("the panel reopens with the app", "SmoothCurve.jsx" in open_now, open_now)
        app.open_panel()
        st = app.state()
        check("the saved curve survived the restart", any(l["curves"] >= 1 for l in st["libraries"]), st["libraries"])
        check("the last curve, mode and tab survived", (st["bezier"], st["mode"], st["tab"]) == (before["bezier"], before["mode"], before["tab"]), (st["bezier"], st["tab"]))
        check("its tile is there", ("tile:mine:" + name) in st["hits"], [k for k in st["hits"] if k.startswith("tile:mine")][:5])
        check("after the restart the panel is still in its dock", app.still(), app.dock())
    app.ch.close()
    bad = [r for r in results if not r[0]]
    print("\n%s" % ("ALL %d REAL-APP CHECKS PASSED" % len(results) if not bad else "%d of %d real-app checks FAILED" % (len(bad), len(results))))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
