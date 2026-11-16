"""Drive the built panel like a user, in a headless EffectCraft session.

`Session` keeps one `effectcraft-cli mcp` process open (settings stay in memory, nothing reaches
the real settings folder). `Panel` runs dist/SmoothCurve.jsx in it and sends the same mouse
events the app's window would: every click goes to a pixel position on the canvas, found from
the regions the panel publishes in its hidden "automation" control.
"""
import json
import os
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def find_cli():
    """effectcraft-cli: $EFFECTCRAFT_CLI, else a release folder next to this project, else the PATH."""
    if os.environ.get("EFFECTCRAFT_CLI"):
        return os.environ["EFFECTCRAFT_CLI"]
    parent = os.path.dirname(ROOT)
    for name in sorted(os.listdir(parent), reverse=True):
        path = os.path.join(parent, name, "effectcraft-cli")
        if name.startswith("effectcraft-cli") and os.path.isfile(path):
            return path
    return shutil.which("effectcraft-cli") or "effectcraft-cli"


CLI = find_cli()
DIST = os.path.join(ROOT, "dist", "SmoothCurve.jsx")


class Session:
    def __init__(self, project=None):
        args = [CLI] + (["--project", project] if project else ["--empty"]) + ["mcp"]
        self.p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.n = 0
        self._rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "smoothcurve-tests", "version": "1"}})
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        self.p.stdin.flush()

    def _rpc(self, method, params):
        self.n += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params}) + "\n")
        self.p.stdin.flush()
        line = self.p.stdout.readline()
        if not line:
            raise RuntimeError("the headless session ended")
        reply = json.loads(line)
        if "error" in reply:
            raise RuntimeError("%s: %s" % (method, reply["error"]))
        return reply["result"]

    def cmd(self, command, params=None):
        """Run one engine command; returns its result."""
        r = self._rpc("tools/call", {"name": "command_run", "arguments": {"id": command, "params": params or {}}})
        text = r["content"][0]["text"] if r.get("content") else "null"
        if r.get("isError"):
            raise RuntimeError("%s failed: %s" % (command, text))
        try:
            return json.loads(text)
        except ValueError:
            return text

    def script(self, code):
        """Run JavaScript in the project; returns its result (raises on a script error)."""
        r = self.cmd("script.run", {"code": code})
        if r.get("error"):
            raise RuntimeError("script error: %s" % json.dumps(r["error"]))
        return r.get("result")

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=10)
        except Exception:
            self.p.kill()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def parse_state(text):
    """The panel's published state; its hit regions ([id, x, y, w, h]) become dicts."""
    st = json.loads(text)
    st["hits"] = [{"id": h[0], "x": h[1], "y": h[2], "w": h[3], "h": h[4]} for h in st["hits"]]
    return st


class Panel:
    def __init__(self, session, path=DIST, size=None):
        self.s = session
        r = session.cmd("file.runScript", {"path": path})
        if r.get("error"):
            raise RuntimeError("the panel did not start: %s" % json.dumps(r["error"]))
        self.window = session.cmd("scriptui.list")[-1]["window"]
        if size:
            self.resize(*size)

    # ---- reading
    def tree(self):
        return self.s.cmd("scriptui.get", {"window": self.window})

    def control(self, name, tree=None):
        for c in (tree or self.tree())["root"]["children"]:
            if c["name"] == name:
                return c
        raise KeyError(name)

    def state(self, tree=None):
        return parse_state(self.control("automation", tree)["text"])

    def rect(self, hit_id, state=None):
        """The region with this id that is on top (the last one registered)."""
        found = None
        for h in (state or self.state())["hits"]:
            if h["id"] == hit_id:
                found = h
        if not found:
            raise KeyError("no region %r; have %s" % (hit_id, sorted({h["id"] for h in (state or self.state())["hits"]})))
        return found

    def has(self, hit_id):
        return any(h["id"] == hit_id for h in self.state()["hits"])

    def text(self, name):
        return self.control(name)["text"]

    def visible(self, name):
        return self.control(name)["visible"]

    def painted(self):
        """Every string the canvas draws, in order."""
        return [op["text"] for op in self.control("canvas").get("draw", []) if op["op"] == "text"]

    # ---- acting
    def mouse(self, kind, x, y, **keys):
        p = {"window": self.window, "widget": "canvas", "type": kind, "x": x, "y": y}
        p.update(keys)
        r = self.s.cmd("scriptui.mouse", p)
        if r.get("error"):
            raise RuntimeError("handler error on %s: %s" % (kind, json.dumps(r["error"])))
        return r

    def move(self, x, y, **keys):
        self.mouse("mousemove", x, y, **keys)

    def centre(self, hit_id):
        r = self.rect(hit_id)
        return r["x"] + r["w"] / 2, r["y"] + r["h"] / 2

    def click_at(self, x, y, detail=1, **keys):
        self.mouse("mousemove", x, y, **keys)
        self.mouse("mousedown", x, y, buttons=1, detail=detail, **keys)
        self.mouse("mouseup", x, y, detail=detail, **keys)

    def click(self, hit_id, detail=1, **keys):
        x, y = self.centre(hit_id)
        self.click_at(x, y, detail=detail, **keys)

    def hover(self, hit_id):
        x, y = self.centre(hit_id)
        self.mouse("mousemove", x, y)

    def drag(self, start, end, steps=6, release=True, **keys):
        (x0, y0), (x1, y1) = start, end
        self.mouse("mousemove", x0, y0)
        self.mouse("mousedown", x0, y0, buttons=1, **keys)
        for i in range(1, steps + 1):
            t = i / steps
            self.mouse("mousemove", x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, buttons=1, **keys)
        if release:
            self.mouse("mouseup", x1, y1, **keys)

    def handle(self, which):
        return tuple(self.state()["handles"][which])

    def to_px(self, u, v, state=None):
        """Graph units to canvas pixels, with the view the panel currently shows."""
        st = state or self.state()
        g, (lo, hi) = st["graph"], st["view"]
        return g["x"] + u * g["w"], g["y"] + (hi - v) / (hi - lo) * g["h"]

    def set(self, widget, value, changing=False):
        r = self.s.cmd("scriptui.set", {"window": self.window, "widget": widget, "value": value, "changing": changing})
        if r.get("error"):
            raise RuntimeError("handler error setting %s: %s" % (widget, json.dumps(r["error"])))

    def type(self, widget, value):
        """Type into a field and leave it (each keystroke would fire onChanging; the end fires onChange)."""
        self.set(widget, value, changing=True)
        self.set(widget, value)

    def resize(self, w, h):
        self.s.cmd("scriptui.resize", {"window": self.window, "size": [w, h]})
