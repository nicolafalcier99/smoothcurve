#!/usr/bin/env python3
"""The panel in the real EffectCraft app: docked, driven by real pointer and key input.

The headless tests send events straight to the script. This one goes the whole way a user's
mouse does: the app's own event loop, its hit-testing of the docked panel, the edit fields,
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

    def field(self, name):
        for c in self.tree()["root"]["children"]:
            if c["name"] == name:
                return c

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

    def click(self, hit_id, **extra):
        self.ch.call("ui.click", dict(self.at(self.state(), hit_id), **extra))

    def type_into(self, name, text):
        self.ch.call("ui.click", {"id": "scriptui.%d.%s" % (self.win, name)})
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

    # Typing with real keys.
    app.type_into("readout", "cubic-bezier(0.42, 0, 0.58, 1)")
    check("the curve follows the keys", app.state()["bezier"] == [0.42, 0, 0.58, 1], app.state()["bezier"])
    app.ch.call("ui.key", {"key": "Enter"})
    check("Enter tidies the text", app.field("readout")["text"] == "0.42, 0.00, 0.58, 1.00", app.field("readout")["text"])
    app.type_into("readout", "nonsense")
    app.ch.call("ui.key", {"key": "Enter"})
    st = app.state()
    check("nonsense is refused and the numbers come back", st["bezier"] == [0.42, 0, 0.58, 1] and app.field("readout")["text"] == "0.42, 0.00, 0.58, 1.00" and st["statusKind"] == "warn", st["status"])

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
    app.ch.call("ui.click", dict(app.at(app.state(), "tile:easings:Expo Out"), count=2))
    st = app.state()
    check("a real double-click applies", st["bezier"] == [0.16, 1, 0.3, 1] and st["status"] == "Eased 2 keyframes on 1 property.", st["status"])
    app.click("mode:In")
    check("the Ease switch", app.state()["mode"] == "In")
    app.click("mode:In-Out")
    app.ch.call("ui.move", app.at(app.state(), "tile:easings:Back In"))
    st = app.state()
    check("hovering a tile previews it", st["preview"] == [0.36, 0, 0.66, -0.56], st["preview"])
    check("and sets the tooltip", app.field("canvas")["helpTip"].startswith("Back In"), app.field("canvas")["helpTip"])

    # Keep a curve: the settings file on disk.
    name = "Real app %d" % int(time.time())
    app.click("star")
    check("the star opens the name field", app.state()["bar"] == "save" and app.field("name")["visible"])
    app.ch.call("ui.click", {"id": "scriptui.%d.name" % app.win})
    app.ch.call("ui.type", {"text": name})
    app.click("bar:ok")
    st = app.state()
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
    app.ch.close()
    bad = [r for r in results if not r[0]]
    print("\n%s" % ("ALL %d REAL-APP CHECKS PASSED" % len(results) if not bad else "%d of %d real-app checks FAILED" % (len(bad), len(results))))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
