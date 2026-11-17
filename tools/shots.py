#!/usr/bin/env python3
"""Render the panel in many states to PNGs, headless, to look at the design.

    python3 -I tools/shots.py OUT_DIR [name ...]      (needs Pillow)

Uses tests/panel.py to drive the built panel and tools/render.py to paint what it draws.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tests"))
sys.path.insert(0, HERE)

import panel as P          # noqa: E402
import render              # noqa: E402

LIBRARY = ('{"format":"curve-library","version":1,"name":"Reels","presets":['
           '{"name":"Snappy","bezier":[0.2,0,0,1]},{"name":"Soft landing","bezier":[0.16,1,0.3,1]},'
           '{"name":"Card pop","bezier":[0.34,1.56,0.64,1]},{"name":"Slow start","bezier":[0.7,0,0.84,0]},'
           '{"name":"Whip","bezier":[0.87,0,0.13,1]},{"name":"A very long preset name here","bezier":[0.45,0,0.55,1]},'
           '{"name":"Dip","bezier":[0.36,0,0.66,-0.56]},{"name":"Settle","bezier":[0.22,1,0.36,1]},'
           '{"name":"Title in","bezier":[0.25,1,0.5,1]},{"name":"Title out","bezier":[0.5,0,0.75,0]}]}')


def import_library(p):
    p.click("more")
    p.click("menu:4")
    p.set("libraryText", LIBRARY)
    p.click("sheet:import")


def scenes():
    """name -> (size, function that puts the panel in that state)"""
    def tall(p): pass
    def hover(p):
        p.click("tile:easings:Back Out")
        p.hover("tile:easings:Expo In")
    def dragging(p):
        x, y = p.handle(1)
        p.drag((x, y), (x - 40, y - 150), release=False)
    def overshoot(p):
        p.click("tile:easings:Back In-Out")
        p.click("mode:In")
        p.click("lock:mirror")
        p.click("auto")
    def zoomed(p):
        p.click("tile:easings:Back In-Out")
        p.scroll_to("tile:easings:Sine In")
        for _ in range(3):
            p.click("zoom:out")
        p.hover("zoom:out")
    def zoomed_far(p):
        p.click("tile:easings:Back In-Out")
        p.scroll_to("tile:easings:Sine In")
        while p.has("zoom:out"):
            p.click("zoom:out")
    def info(p): p.click("info")
    def find(p):
        import_library(p)
        p.click("tile:mine:Card pop")
        p.set("search", "o", changing=True)
        p.click("entry:done")
    def menu_more(p): p.click("more")
    def mine_empty(p): p.click("tab:mine")
    def mine(p):
        import_library(p)
        p.click("tile:mine:Card pop")
    def menu_library(p):
        import_library(p)
        p.click("library")
        p.hover("menu:0")
    def save_bar(p):
        x, y = p.handle(0)
        p.drag((x, y), (x + 30, y - 60))
        p.click("star")
        p.set("name", "My new curve")
    def delete_bar(p):
        import_library(p)
        p.click("tile:mine:Whip")
        p.click("preset:delete")
    def export(p):
        import_library(p)
        p.click("more")
        p.click("menu:5")
    def export_blocked(p):
        export(p)
        p.set("libraryPath", "/Users/you/Desktop/Reels.curves.json")
        p.click("sheet:file")
    def import_page(p):
        p.click("more")
        p.click("menu:4")
    def applied(p):
        p.s.script('var c = app.project.items.addComp("C", 640, 360, 1, 5, 30); c.openInViewer(); var s = c.layers.addSolid([1,0,0], "Box", 100, 100, 1);'
                   'var r = s.transform.rotation; r.setValueAtTime(0, 0); r.setValueAtTime(1, 90); r.setSelectedAtKey(1, true); r.setSelectedAtKey(2, true);'
                   'var q = s.transform.scale; q.setValueAtTime(0, [100,100]); q.setValueAtTime(1, [50,50]); q.setSelectedAtKey(1, true); q.setSelectedAtKey(2, true); 1')
        p.click("tile:easings:Quart Out")
        p.click("apply")
    def nothing(p): p.click("apply")
    return {
        "tall": ((300, 720), tall), "hover": ((300, 720), hover), "dragging": ((300, 720), dragging),
        "overshoot": ((300, 720), overshoot), "zoomed": ((300, 720), zoomed), "zoomed-far": ((300, 720), zoomed_far),
        "info": ((300, 720), info), "info-dock": ((332, 574), info), "info-short": ((300, 470), info), "info-wide": ((760, 420), info),
        "dock-333x576": ((332, 574), tall), "find": ((332, 574), find), "menu-more": ((300, 720), menu_more), "mine-empty": ((300, 720), mine_empty),
        "mine": ((300, 720), mine), "menu-library": ((300, 720), menu_library), "save-bar": ((300, 720), save_bar),
        "delete-bar": ((300, 720), delete_bar), "export": ((300, 720), export), "export-blocked": ((300, 720), export_blocked),
        "import": ((300, 720), import_page), "applied": ((300, 720), applied), "nothing": ((300, 720), nothing),
        "narrow": ((220, 640), tall), "short": ((300, 470), tall), "shorter": ((300, 380), tall), "presets": ((260, 300), tall),
        "wide": ((760, 420), tall), "wide-mine": ((760, 420), mine), "wide-short": ((700, 300), tall),
        "strip": ((900, 60), tall), "strip-2": ((600, 120), tall), "big": ((420, 900), tall),
    }


def main(argv):
    out = argv[0]
    os.makedirs(out, exist_ok=True)
    all_scenes = scenes()
    names = argv[1:] or list(all_scenes)
    for name in names:
        size, setup = all_scenes[name]
        with P.Session() as s:
            p = P.Panel(s, size=size)
            setup(p)
            tree = p.tree()
            st = p.state()
        path = os.path.join(out, name + ".png")
        render.render(tree, path, 2.0)
        print("%-16s %-7s %s" % (name, st["layout"], st["status"][:90]))


if __name__ == "__main__":
    main(sys.argv[1:])
