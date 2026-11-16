#!/usr/bin/env python3
"""A separate, scriptable copy of EffectCraft for looking at the panel, without touching the
EffectCraft that is already open.

It starts a second instance of /Applications/EffectCraft.app with its own settings folder
(EFFECTCRAFT_CONFIG_DIR) and a control port (--control), so it shares no settings, session
lock, workspace or installed scripts with the real one. The control port only listens on
127.0.0.1 and has no password, so stop the preview when done.

    python3 -I tools/preview.py start              # launch (window opens without taking focus)
    python3 -I tools/preview.py install            # copy dist/SmoothCurve.jsx into the preview's panels folder
    python3 -I tools/preview.py call METHOD [JSON] # one control-channel request, e.g. ui.inspect
    python3 -I tools/preview.py exec COMMAND [JSON]# one engine command, e.g. window.scriptPanel '{"name":"SmoothCurve.jsx"}'
    python3 -I tools/preview.py shot OUT.png [ID]  # screenshot of the window, or of one element id
    python3 -I tools/preview.py stop               # quit it (only ever the instance this tool started)

Settings folder: $SMOOTHCURVE_PREVIEW_DIR or .preview/ next to this project (safe to delete).
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get("SMOOTHCURVE_PREVIEW_DIR") or os.path.join(ROOT, ".preview")
CONFIG = os.path.join(BASE, "config")
PIDFILE = os.path.join(BASE, "preview.pid")
PORT = int(os.environ.get("SMOOTHCURVE_PREVIEW_PORT") or 9911)
APP = "/Applications/EffectCraft.app"
REAL = os.path.expanduser("~/Library/Application Support/EffectCraft")


class Channel:
    """One persistent control-channel connection (JSON lines)."""

    def __init__(self, timeout=70):
        self.sock = socket.create_connection(("127.0.0.1", PORT), timeout=timeout)
        self.file = self.sock.makefile("rwb")
        self.next = 1

    def call(self, method, params=None):
        self.file.write((json.dumps({"id": self.next, "method": method, "params": params or {}}) + "\n").encode())
        self.file.flush()
        self.next += 1
        line = self.file.readline()
        if not line:
            raise RuntimeError("the preview closed the connection")
        reply = json.loads(line)
        if not reply.get("ok"):
            raise RuntimeError("%s failed: %s" % (method, reply.get("error")))
        return reply.get("result")

    def execute(self, command, params=None):
        return self.call("engine.execute", {"command": command, "params": params or {}})

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def listening_pid():
    p = subprocess.run(["lsof", "-nP", "-iTCP:%d" % PORT, "-sTCP:LISTEN", "-t"], capture_output=True, text=True)
    pids = [int(x) for x in p.stdout.split() if x.strip().isdigit()]
    return pids[0] if pids else None


def command_line(pid):
    return subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()


def is_ours(pid):
    """True only for an EffectCraft started by this tool: it carries our --control port."""
    return ("--control %d" % PORT) in command_line(pid)


def start():
    if listening_pid():
        raise SystemExit("port %d is already in use (a preview is running? try `stop`)" % PORT)
    os.makedirs(os.path.join(CONFIG, "Scripts", "ScriptUI Panels"), exist_ok=True)
    win = os.path.join(CONFIG, "window.json")
    if not os.path.exists(win):
        with open(win, "w") as f:
            f.write('{"pos":[90,60],"size":[1180.0,860.0],"maximized":false}')
    subprocess.run(["open", "-n", "-g", "-a", APP, "--env", "EFFECTCRAFT_CONFIG_DIR=" + CONFIG,
                    "--args", "--control", str(PORT)], check=True)
    pid = None
    for _ in range(120):
        time.sleep(0.25)
        pid = listening_pid()
        if pid:
            break
    if not pid:
        raise SystemExit("the preview did not open its control port within 30 s")
    if not is_ours(pid):
        raise SystemExit("pid %d listens on the port but is not our preview: %s" % (pid, command_line(pid)))
    with open(PIDFILE, "w") as f:
        f.write(str(pid))
    # The real settings folder must not know about this instance.
    try:
        lock = json.load(open(os.path.join(REAL, "session.lock")))
        if lock.get("pid") == pid:
            raise SystemExit("STOP: the preview wrote the real session.lock; the settings folder is not isolated")
    except (OSError, ValueError):
        pass
    print("preview running, pid %d, port %d, settings %s" % (pid, PORT, CONFIG))


def stop():
    pid = listening_pid()
    if not pid and os.path.exists(PIDFILE):
        pid = int(open(PIDFILE).read().strip() or 0) or None
    if not pid or not is_ours(pid):
        print("no preview running")
        return
    try:
        ch = Channel(timeout=10)
        try:
            ch.call("app.quit", {"force": True})
        except (RuntimeError, OSError, ValueError):
            pass
        ch.close()
    except OSError:
        pass
    for _ in range(40):
        if not is_ours(pid):
            break
        time.sleep(0.25)
    if is_ours(pid):
        os.kill(pid, 15)            # only this pid, and only after checking it is the preview
        time.sleep(1)
    print("preview stopped" if not is_ours(pid) else "preview pid %d is still running" % pid)
    if os.path.exists(PIDFILE):
        os.remove(PIDFILE)


def install(src=None):
    src = src or os.path.join(ROOT, "dist", "SmoothCurve.jsx")
    dst = os.path.join(CONFIG, "Scripts", "ScriptUI Panels", os.path.basename(src))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)
    print("installed", dst)


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    cmd, args = argv[0], argv[1:]
    if cmd == "start":
        start()
    elif cmd == "stop":
        stop()
    elif cmd == "install":
        install(args[0] if args else None)
    elif cmd in ("call", "exec"):
        ch = Channel()
        params = json.loads(args[1]) if len(args) > 1 else {}
        r = ch.execute(args[0], params) if cmd == "exec" else ch.call(args[0], params)
        print(json.dumps(r, indent=1))
        ch.close()
    elif cmd == "shot":
        ch = Channel()
        params = {"path": os.path.abspath(args[0])}
        if len(args) > 1:
            params["id"] = args[1]
        print(json.dumps(ch.call("ui.screenshot", params)))
        ch.close()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
